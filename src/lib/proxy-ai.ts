/**
 * Адаптер к OpenAI-совместимому прокси-шлюзу — v1.4.3 (третий движок).
 *
 * Зачем: у Яндекса (Alice ART) нет правки фото — лицо клиента сохранить нельзя.
 * Прокси даёт модели-редакторы (img2img): Nano Banana (Gemini Flash Image),
 * GPT Image, Seedream, Flux Kontext и т.п. — они принимают ФОТО на входе и
 * правят его, лицо сохраняется. Оплата в рублях.
 *
 * Переменные окружения (Vercel → Environment Variables):
 *  PROXY_API_KEY      — ключ ProxyAPI (кабинет → «Ключи API», начинается с sk-),
 *                       одной строкой (обязателен);
 *  PROXY_BASE_URL     — базовый адрес API (обязателен); для ProxyAPI —
 *                       https://api.proxyapi.ru/v1;
 *  PROXY_EDIT_MODEL   — модель-редактор изображений, принимающая фото на входе
 *                       (обязательна для генерации). Рекомендации по каталогу
 *                       ProxyAPI: bytedance-seed/seedream-5-0-flash
 *                       (~1,5–2 ₽/правка) — основной;
 *                       google/gemini-nano-banana-2.1 — Nano Banana
 *                       (~10 ₽/правка, максимум точности лица);
 *                       openai/gpt-image-2.5-flare — модель из примера доков
 *                       (~4 ₽/правка). Точные имена и цены — в каталоге
 *                       proxyapi.ru/models (каталог обновляется).
 *  PROXY_VISION_MODEL — vision-модель (разбор референса + словесный портрет +
 *                       QA-аудит); для ProxyAPI — qwen/qwen3.8-omni-flash
 *                       (21,05/63,16 ₽ за 1М токенов, ~0,05 ₽ за разбор).
 *                       Имена моделей сверяются с каталогом proxyapi.ru —
 *                       каталог обновляется, старые имена уходят (как
 *                       qwen3.7-flash); если пришёл 404 — взять точное
 *                       текущее имя из каталога.
 *  PROXY_TEXT_MODEL   — текстовая модель для пинга (по умолчанию = vision);
 *  PROXY_EDIT_STYLE   — как править фото: "edits" | "chat" | "google" | "auto"
 *                       (по умолчанию auto — порядок ниже).
 *
 * Три пути правки фото (в auto перебираются в этом порядке):
 *  A) POST {base}/images/edits  — OpenAI-формат: multipart с файлом картинки.
 *     ОСНОВНОЙ: у ProxyAPI правка работает здесь, ответ data[0].b64_json.
 *  B) POST {base}/chat/completions — «разговорный» путь (OpenRouter-стиль):
 *     ЗАПАСНОЙ. У ProxyAPI chat-ответы картинок НЕ возвращают никогда —
 *     это прямо написано в их доке «Распознавание изображений».
 *  C) POST {base}/models/{модель}:generateContent — Google-формат
 *     (inline_data), для прокси, отдающих Gemini как у Google.
 *
 * Ошибки переводятся на русский: сообщения этого файла показываются
 * пользователю как есть (friendlyError их пропускает по слову «прокси»).
 */

export interface ProxyConfig {
  apiKey: string;
  baseUrl: string;
  editModel: string;
  visionModel: string;
  textModel: string;
  editStyle: "edits" | "chat" | "google" | "auto";
}

/** Читаем и валидируем переменные. Русские ошибки — сразу в интерфейс. */
export function ensureProxyConfig(): ProxyConfig {
  const apiKey = String(process.env.PROXY_API_KEY ?? "").trim();
  const baseUrl = String(process.env.PROXY_BASE_URL ?? "")
    .trim()
    .replace(/\/+$/, "");
  const editModel = String(process.env.PROXY_EDIT_MODEL ?? "").trim();
  // Дефолт по каталогу ProxyAPI (проверен в ноябре 2026). Если придёт 404 —
  // имя модели устарело: взять точное из каталога proxyapi.ru/models.
  const visionModel = String(process.env.PROXY_VISION_MODEL ?? "").trim() || "qwen/qwen3.8-omni-flash";
  const textModel = String(process.env.PROXY_TEXT_MODEL ?? "").trim() || visionModel;
  const styleRaw = String(process.env.PROXY_EDIT_STYLE ?? "").trim().toLowerCase();
  const editStyle: ProxyConfig["editStyle"] =
    styleRaw === "edits" || styleRaw === "chat" || styleRaw === "google" ? styleRaw : "auto";

  if (!apiKey || !baseUrl) {
    const missing = [!apiKey ? "PROXY_API_KEY" : null, !baseUrl ? "PROXY_BASE_URL" : null]
      .filter(Boolean)
      .join(" и ");
    throw new Error(
      `Не задан(ы) ${missing}. На Vercel: Settings → Environment Variables → добавьте переменные прокси-шлюза, затем Redeploy. PROXY_BASE_URL обычно заканчивается на /v1.`
    );
  }
  if (/\s/.test(apiKey)) {
    throw new Error(
      "В ключе прокси (PROXY_API_KEY) есть пробел или перенос строки. Пересохраните переменную одной строкой и сделайте Redeploy."
    );
  }
  // https — всегда; http разрешаем ТОЛЬКО для локального шлюза (localhost / 127.0.0.1),
  // чтобы гонять регресс-тесты с мок-сервером. Для Vercel остаётся только https.
  const isLocalHttp = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/i.test(baseUrl);
  if (!/^https:\/\//.test(baseUrl) && !isLocalHttp) {
    throw new Error(
      "PROXY_BASE_URL должен начинаться с https:// (http допустим только для localhost при локальной отладке) — проверьте адрес прокси-шлюза и сделайте Redeploy."
    );
  }
  return { apiKey, baseUrl, editModel, visionModel, textModel, editStyle };
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Понятная русская ошибка по ответу прокси (status + кусок тела). */
function proxyApiError(status: number, bodySnippet: string, what: string): Error {
  const b = bodySnippet.toLowerCase();
  let hint = "";
  if (status === 401 || status === 403) {
    hint =
      status === 401
        ? "Прокси не принял ключ (401). Проверьте PROXY_API_KEY: одной строкой, без пробелов, из кабинета вашего прокси. Пересохраните переменную в Vercel и сделайте Redeploy."
        : "Прокси запретил операцию (403). Проверьте: имя модели (PROXY_EDIT_MODEL / PROXY_VISION_MODEL) доступно на вашем тарифе, и баланс аккаунта прокси не пуст.";
  } else if (status === 404) {
    hint =
      "Прокси не нашёл путь или модель (404). Проверьте PROXY_BASE_URL (обычно заканчивается на /v1) и точное имя PROXY_EDIT_MODEL из перечня вашего прокси.";
  } else if (status === 429 || b.includes("quota") || b.includes("rate")) {
    hint = "Сработал лимит запросов (429) на прокси. Подождите минуту и попробуйте снова.";
  } else if (
    b.includes("insufficient") ||
    b.includes("balance") ||
    b.includes("余额") ||
    b.includes("credit")
  ) {
    hint = "На аккаунте прокси не хватает средств. Пополните баланс в кабинете прокси и повторите.";
  } else if (status === 400) {
    hint =
      "Прокси отклонил запрос (400). Чаще всего — не то имя модели или не тот формат запроса. Проверьте PROXY_EDIT_MODEL по перечню вашего прокси.";
  }
  return new Error(
    `Ошибка прокси-шлюза ${what} (HTTP ${status}). ${hint}${hint ? " " : ""}Детали: ${bodySnippet.slice(0, 240)}`
  );
}

/** POST JSON с Bearer-авторизацией (общий для всех путей). */
async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number
): Promise<{ status: number; json: unknown; raw: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(raw);
    } catch {
      // тело может быть не-JSON — оставляем raw
    }
    return { status: res.status, json, raw };
  } finally {
    clearTimeout(timer);
  }
}

/** Базовый URL: добавляем /v1, если пользователь его не вписал. */
function apiUrl(cfg: ProxyConfig, path: string): string {
  const base = cfg.baseUrl.replace(/\/+$/, "");
  return /\/v\d+(beta)?$/.test(base) ? `${base}${path}` : `${base}/v1${path}`;
}

/** data URL → бинарный Blob для multipart (/images/edits). */
function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) throw new Error("Фото клиента имеет неподдерживаемый формат (ожидается data URL изображения).");
  const buf = Buffer.from(m[2], "base64");
  return new Blob([new Uint8Array(buf)], { type: m[1] });
}

/** data URL → {mime, base64} для Google-пути. */
function dataUrlToInline(dataUrl: string): { mimeType: string; data: string } {
  const m = /^data:(image\/(?:png|jpe?g|webp));base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) throw new Error("Фото клиента имеет неподдерживаемый формат (ожидается data URL изображения).");
  return { mimeType: m[1].toLowerCase(), data: m[2] };
}

/** https-URL картинки → base64 (без префикса data:). */
async function fetchImageAsBase64(url: string, timeoutMs = 20_000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.toString("base64");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Любая ссылка/дата-URL → чистый base64. */
async function toBase64(value: string): Promise<string | null> {
  const v = String(value ?? "").trim();
  if (!v) return null;
  const m = /^data:image\/[a-z+]+;base64,([\s\S]+)$/i.exec(v);
  if (m) return m[1];
  if (/^https?:\/\//i.test(v)) return fetchImageAsBase64(v);
  // голый base64 (без префикса)
  if (/^[A-Za-z0-9+/=]{100,}$/.test(v)) return v;
  return null;
}

/** Достаём картинку из ответа chat-модели (несколько форматов шлюзов). */
async function extractImageFromChat(json: unknown): Promise<string | null> {
  const j = json as {
    choices?: Array<{
      message?: {
        images?: Array<{ image_url?: { url?: string } | string }>;
        content?: string | Array<Record<string, unknown>>;
      };
    }>;
    data?: Array<{ b64_json?: string; url?: string }>;
  };

  // 1) OpenRouter-стиль: message.images[].image_url.url
  const imgs = j.choices?.[0]?.message?.images;
  if (Array.isArray(imgs) && imgs.length) {
    const first = imgs[0];
    const url =
      typeof first === "string"
        ? first
        : typeof first?.image_url === "string"
        ? first.image_url
        : first?.image_url?.url;
    const b64 = url ? await toBase64(url) : null;
    if (b64) return b64;
  }

  // 2) content строкой (markdown с data-URL) или массивом частей
  const content = j.choices?.[0]?.message?.content;
  if (typeof content === "string") {
    const m = /data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)/i.exec(content);
    if (m) return m[1];
    const url = /(https?:\/\/\S+\.(?:png|jpe?g|webp)(?:\?\S*)?)/i.exec(content)?.[1];
    if (url) return fetchImageAsBase64(url);
  } else if (Array.isArray(content)) {
    for (const part of content) {
      const p = part as { type?: string; image_url?: { url?: string }; inlineData?: { data?: string }; text?: string };
      if (p.inlineData?.data) return p.inlineData.data;
      const url = typeof p.image_url?.url === "string" ? p.image_url.url : null;
      if (url) {
        const b64 = await toBase64(url);
        if (b64) return b64;
      }
      if (typeof p.text === "string") {
        const m = /data:image\/[a-z+]+;base64,([A-Za-z0-9+/=]+)/i.exec(p.text);
        if (m) return m[1];
      }
    }
  }

  // 3) некоторые шлюзы отвечают картинками в images-формате даже на chat
  const d = j.data?.[0];
  if (d?.b64_json) return d.b64_json;
  if (d?.url) return fetchImageAsBase64(d.url);

  return null;
}

/** Текстовый ответ из chat/completions (строка или массив частей). */
function extractChatText(json: unknown): string {
  const j = json as {
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  };
  const choice = j.choices?.[0]?.message?.content;
  if (typeof choice === "string") return choice.trim();
  if (Array.isArray(choice)) {
    return choice
      .filter((p) => (p?.type ?? "text") === "text" && typeof p?.text === "string")
      .map((p) => String(p.text))
      .join("\n")
      .trim();
  }
  return "";
}

/** Размер для OpenAI images/edits: разрешены 1024x1024, 1536x1024, 1024x1536, auto. */
export function openaiSize(size: string): string {
  const s = String(size ?? "").toLowerCase();
  if (/^\d+x\d+$/.test(s)) {
    const [w, h] = s.split("x").map(Number);
    if (w && h) {
      if (h > w) return "1024x1536";
      if (w > h) return "1536x1024";
      return "1024x1024";
    }
  }
  return "1024x1024";
}



/* ------------------------------------------------------------------ */
/*  Публичные вызовы                                                   */
/* ------------------------------------------------------------------ */

/** Текстовый запрос (пинг ключа в /api/health и diag). */
export async function proxyText(
  cfg: ProxyConfig,
  userText: string,
  opts?: { timeoutMs?: number; maxTokens?: number }
): Promise<string> {
  const { status, json, raw } = await postJson(
    apiUrl(cfg, "/chat/completions"),
    cfg.apiKey,
    {
      model: cfg.textModel,
      messages: [{ role: "user", content: userText }],
      max_tokens: opts?.maxTokens ?? 50,
      temperature: 0.3,
    },
    opts?.timeoutMs ?? 25_000
  );
  if (status !== 200) throw proxyApiError(status, raw.slice(0, 300), "text");
  const text = extractChatText(json);
  if (!text) throw new Error(`Прокси вернул пустой текстовый ответ. Детали: ${raw.slice(0, 200)}`);
  return text;
}

/** Vision-запрос: текст + картинки (data URL) → описание/анализ. */
export async function proxyVision(
  cfg: ProxyConfig,
  req: { text: string; images: string[]; timeoutMs?: number }
): Promise<string> {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: req.text }];
  for (const img of req.images) {
    content.push({
      type: "image_url",
      image_url: { url: img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}` },
    });
  }
  const { status, json, raw } = await postJson(
    apiUrl(cfg, "/chat/completions"),
    cfg.apiKey,
    {
      model: cfg.visionModel,
      messages: [{ role: "user", content }],
      temperature: 0.2,
    },
    req.timeoutMs ?? 35_000
  );
  if (status !== 200) throw proxyApiError(status, raw.slice(0, 300), "vision");
  const text = extractChatText(json);
  if (!text) throw new Error(`Прокси вернул пустой ответ vision. Детали: ${raw.slice(0, 200)}`);
  return text;
}

export interface ProxyEditOptions {
  prompt: string;
  /** Фото клиента в виде data URL. */
  imageDataUrl: string;
  /** Желаемый размер от pickSize, например "864x1152" (приведём к поддерживаемому). */
  size: string;
  /** Таймаут одного пути, мс (генерация обычно 10–40 с). */
  timeoutMs?: number;
  /** Переопределение стиля для diag: "edits" | "chat" | "google" | "auto". */
  style?: ProxyConfig["editStyle"];
}

/**
 * ПРАВКА ФОТО: prompt + исходное фото → та же фотография с макияжем.
 * Лицо сохраняется (в отличие от Яндекса). Возвращает чистый base64 картинки.
 * Порядок путей: auto → edits, chat, google (edits — документированный путь
 * ProxyAPI); фиксированный стиль задаётся через PROXY_EDIT_STYLE / опции.
 */
export async function proxyEditImage(cfg: ProxyConfig, opts: ProxyEditOptions): Promise<string> {
  const style = opts.style ?? cfg.editStyle;
  const order: Array<"edits" | "chat" | "google"> =
    style === "edits"
      ? ["edits"]
      : style === "chat"
      ? ["chat"]
      : style === "google"
      ? ["google"]
      : ["edits", "chat", "google"];

  const failures: string[] = [];
  for (const path of order) {
    try {
      const b64 = await editOnce(cfg, path, opts);
      if (b64) return b64;
      failures.push(`${path}: ответ без картинки`);
    } catch (e) {
      failures.push(`${path}: ${errText(e).slice(0, 160)}`);
      // Переходим к следующему пути только при «структурных» ошибках:
      // 404 (нет пути), 400 (не тот формат), 415/422. 401/403/429/баланс —
      // бессмысленно повторять, бросаем сразу.
      const t = errText(e);
      if (/(HTTP 401|HTTP 403|HTTP 429|HTTP 402|не хватает средств|не принял ключ|запретил операцию)/.test(t)) throw e;
    }
  }
  throw new Error(
    `Прокси-шлюз не смог отредактировать фото ни одним способом (${failures.join("; ")}). Проверьте PROXY_EDIT_MODEL по перечню вашего прокси — нужна модель-редактор, принимающая изображение на входе.`
  );
}

/** Один путь правки. Возвращает base64 или null (ответ без картинки). */
async function editOnce(cfg: ProxyConfig, path: "edits" | "chat" | "google", opts: ProxyEditOptions): Promise<string | null> {
  const timeoutMs = opts.timeoutMs ?? 40_000;

  if (path === "edits") {
    if (!cfg.editModel) throw new Error("Не задана PROXY_EDIT_MODEL — укажите модель-редактор из перечня прокси.");
    // Поля запроса — по доке ProxyAPI «Генерация изображений» (model, prompt,
    // image, n; size задаёт пропорции). Неподдерживаемые поля у ProxyAPI дают
    // 400, поэтому response_format не шлём вовсе (ответ и так b64_json),
    // а при 400 «про размер» повторяем один раз без size.
    const sendEdits = async (withSize: boolean): Promise<{ status: number; raw: string; json: unknown }> => {
      const form = new FormData();
      form.append("model", cfg.editModel);
      form.append("prompt", opts.prompt.slice(0, 4000));
      form.append("image", dataUrlToBlob(opts.imageDataUrl), "image.png");
      form.append("n", "1");
      if (withSize) form.append("size", openaiSize(opts.size));
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(apiUrl(cfg, "/images/edits"), {
          method: "POST",
          headers: { Authorization: `Bearer ${cfg.apiKey}` },
          body: form,
          signal: ctrl.signal,
        });
        const raw = await res.text();
        let json: unknown = null;
        try {
          json = JSON.parse(raw);
        } catch {
          // тело может быть не-JSON — разберём ниже
        }
        return { status: res.status, raw, json };
      } finally {
        clearTimeout(timer);
      }
    };
    let r = await sendEdits(true);
    if (r.status === 400 && /size/i.test(r.raw)) r = await sendEdits(false);
    if (r.status !== 200) throw proxyApiError(r.status, r.raw.slice(0, 300), "правки фото (images/edits)");
    if (r.json === null) {
      throw new Error(`Прокси вернул не-JSON на /images/edits: ${r.raw.slice(0, 160)}`);
    }
    const d = (r.json as { data?: Array<{ b64_json?: string; url?: string }> })?.data?.[0];
    if (d?.b64_json) return d.b64_json;
    if (d?.url) return fetchImageAsBase64(d.url);
    return null;
  }

  if (path === "chat") {
    if (!cfg.editModel) throw new Error("Не задана PROXY_EDIT_MODEL — укажите модель-редактор из перечня прокси.");
    const { status, json, raw } = await postJson(
      apiUrl(cfg, "/chat/completions"),
      cfg.apiKey,
      {
        model: cfg.editModel,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: opts.prompt.slice(0, 4000) },
              { type: "image_url", image_url: { url: opts.imageDataUrl } },
            ],
          },
        ],
      },
      timeoutMs
    );
    if (status !== 200) throw proxyApiError(status, raw.slice(0, 300), "правки фото (chat/completions)");
    return extractImageFromChat(json);
  }

  // Google-формат generateContent
  if (!cfg.editModel) throw new Error("Не задана PROXY_EDIT_MODEL — укажите модель-редактор из перечня прокси.");
  const inline = dataUrlToInline(opts.imageDataUrl);
  const base = cfg.baseUrl.replace(/\/+$/, "");
  const url = /\/v\d+(beta)?$/.test(base)
    ? `${base}/models/${cfg.editModel}:generateContent`
    : `${base}/v1beta/models/${cfg.editModel}:generateContent`;
  const { status, json, raw } = await postJson(
    url,
    cfg.apiKey,
    {
      contents: [
        {
          parts: [{ text: opts.prompt.slice(0, 4000) }, { inline_data: inline }],
        },
      ],
    },
    timeoutMs
  );
  if (status !== 200) throw proxyApiError(status, raw.slice(0, 300), "правки фото (generateContent)");
  const parts = (json as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string }; inline_data?: { data?: string } }> } }>;
  })?.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts)) {
    for (const p of parts) {
      const b64 = p.inlineData?.data ?? p.inline_data?.data;
      if (b64) return b64;
    }
  }
  return null;
}
