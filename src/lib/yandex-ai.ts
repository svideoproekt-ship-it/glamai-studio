/**
 * Адаптер к Yandex Cloud AI Studio (Foundation Models) — v1.4.2
 *
 *  - текст:      POST https://llm.api.cloud.yandex.net/foundationModels/v1/completion
 *  - vision:     POST https://llm.api.cloud.yandex.net/v1/chat/completions
 *                (OpenAI-совместимый режим: картинки передаются в content-части
 *                image_url как data URL)
 *  - картинки:   POST https://ai.api.cloud.yandex.net/v1/images/generations
 *                (НОВЫЙ синхронный Images API, модель aliceai-image-art-3.0/latest.
 *                 Старые модели yandex-art / yandex-art-2.0 отключены Яндексом
 *                 07.09.2026, а старый асинхронный imageGenerationAsync будет
 *                 отключён — подтверждено поддержкой Яндекса 05.11.2026.
 *                 Ответ приходит сразу: { data: [ { b64_json } ] }, опрос
 *                 операций больше не нужен.)
 *
 * Авторизация:
 *  - текст и vision:  Authorization: Api-Key <YC_API_KEY>
 *  - Images API:      Authorization: Bearer <YC_API_KEY> + заголовок
 *                     OpenAI-Project: <YC_FOLDER_ID> (как в код-примере
 *                     Playground AI Studio; проверено запросами 05.11.2026)
 *
 * Аккаунту ключа нужны роли ai.languageModels.user и ai.imageGeneration.user.
 * Ошибки переводятся на понятный русский — сообщения этого файла показываются
 * пользователю как есть (friendlyError их пропускает).
 */

export interface YandexConfig {
  apiKey: string;
  folderId: string;
}

const LLM_BASE = "https://llm.api.cloud.yandex.net";
const AI_API_BASE = "https://ai.api.cloud.yandex.net";

/** Ключ и каталог: без них Яндекс-движок не работает. Русские ошибки — сразу в интерфейс. */
export function ensureYandexConfig(): YandexConfig {
  const apiKey = String(process.env.YC_API_KEY ?? "").trim();
  const folderId = String(process.env.YC_FOLDER_ID ?? "").trim();

  if (!apiKey || !folderId) {
    const missing = [
      !apiKey ? "YC_API_KEY" : null,
      !folderId ? "YC_FOLDER_ID" : null,
    ]
      .filter(Boolean)
      .join(" и ");
    throw new Error(
      `Не задан(ы) ${missing}. На Vercel: Settings → Environment Variables → добавьте YC_API_KEY и YC_FOLDER_ID, затем Redeploy. ` +
        "YC_API_KEY — это API-ключ Yandex Cloud (начинается с AQVN…), YC_FOLDER_ID — идентификатор каталога (folder id)."
    );
  }
  // Частая ошибка вставки: перенос строки внутри ключа — HTTP-заголовок так не умеет
  if (/\s/.test(apiKey)) {
    throw new Error(
      "В ключе Yandex (YC_API_KEY) есть пробел или перенос строки. Пересохраните переменную одной строкой (API-ключ выглядит как AQVN…) и сделайте Redeploy."
    );
  }
  return { apiKey, folderId };
}

function textModelUri(folderId: string): string {
  const model = String(process.env.YC_TEXT_MODEL ?? "").trim() || "yandexgpt/latest";
  return `gpt://${folderId}/${model}`;
}

function artModelUri(folderId: string): string {
  // По умолчанию — новая модель Images API. Старое имя yandex-art отключено Яндексом.
  const model =
    String(process.env.YC_ART_MODEL ?? "").trim() || "aliceai-image-art-3.0/latest";
  return `art://${folderId}/${model}`;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isAbort(err: unknown): boolean {
  return errText(err).includes("aborted") || errText(err).includes("AbortError");
}

/** Понятная русская ошибка по ответу API Яндекса (status + кусок тела).
 *  Для диагностики всегда показывает, на какой URL и с какой моделью шёл запрос. */
function yandexApiError(
  status: number,
  bodySnippet: string,
  what: string,
  url = "",
  model = ""
): Error {
  const b = bodySnippet.toLowerCase();
  let hint = "";
  if (status === 401) {
    hint =
      "Яндекс не принял ключ (401). Проверьте YC_API_KEY: это API-ключ Yandex Cloud (вид AQVN…), одной строкой, без пробелов. Пересохраните переменную в Vercel и сделайте Redeploy.";
  } else if (status === 403) {
    hint =
      "Яндекс запретил операцию (403). Обычно дело в ролях: аккаунту, которому принадлежит ключ, нужны роли ai.languageModels.user (текст и понимание фото) и ai.imageGeneration.user (генерация картинок), а также активный платёжный аккаунт в Yandex Cloud.";
  } else if (status === 404) {
    hint =
      "Яндекс не нашёл модель или каталог (404). Проверьте YC_FOLDER_ID (folder id из консоли Yandex Cloud) и, если задан YC_TEXT_MODEL / YC_ART_MODEL, — имя модели.";
  } else if (status === 429 || b.includes("quota")) {
    hint =
      "Сработал лимит запросов (429) в Yandex Cloud. Подождите минуту и попробуйте снова; если повторяется — проверьте квоты в консоли Yandex Cloud.";
  } else if (b.includes("billing") || b.includes("insufficient") || b.includes("balance") || b.includes("грант") || b.includes("grant")) {
    hint =
      "У аккаунта Яндекса нет доступа к платной генерации: не активирован платёжный аккаунт или закончились средства. Пополните баланс в консоли Yandex Cloud (Биллинг) в рублях и повторите.";
  }
  return new Error(
    `Ошибка Yandex ${what} (HTTP ${status}). ${hint}${hint ? " " : ""}` +
      `[diag2: запрос шёл на ${url || "?"}${model ? `, модель ${model}` : ""}] ` +
      `Детали: ${bodySnippet.slice(0, 240)}`
  );
}

async function postJson(
  url: string,
  apiKey: string,
  body: unknown,
  timeoutMs: number,
  opts?: {
    /** Схема авторизации: "api-key" (по умолчанию) или "bearer" — как в Images API. */
    auth?: "api-key" | "bearer";
    /** Дополнительные заголовки (например OpenAI-Project для Images API). */
    extraHeaders?: Record<string, string>;
  }
): Promise<{ status: number; json: unknown; raw: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        ...(opts?.auth === "bearer"
          ? { Authorization: `Bearer ${apiKey}` }
          : { Authorization: `Api-Key ${apiKey}` }),
        "Content-Type": "application/json",
        ...(opts?.extraHeaders ?? {}),
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

/** Достаём текст ответа из формата completion (result.alternatives) и из OpenAI-формата. */
function extractAlternativesText(json: unknown): string {
  const j = json as {
    result?: { alternatives?: Array<{ message?: { text?: string } }> };
    choices?: Array<{ message?: { content?: string | Array<{ type?: string; text?: string }> } }>;
  };
  const alt = j?.result?.alternatives?.[0]?.message?.text ?? "";
  const choice = j?.choices?.[0]?.message?.content;
  const choiceText =
    typeof choice === "string"
      ? choice
      : Array.isArray(choice)
        ? choice
            .filter((p) => (p?.type ?? "text") === "text" && typeof p?.text === "string")
            .map((p) => String(p.text))
            .join("\n")
        : "";
  return String(alt || choiceText || "").trim();
}

/**
 * Текстовый запрос к YandexGPT (нужен для проверки ключа в /api/health).
 */
export async function yandexText(
  cfg: YandexConfig,
  userText: string,
  opts?: { maxTokens?: number; temperature?: number; timeoutMs?: number }
): Promise<string> {
  const { status, json, raw } = await postJson(
    `${LLM_BASE}/foundationModels/v1/completion`,
    cfg.apiKey,
    {
      modelUri: textModelUri(cfg.folderId),
      completionOptions: {
        stream: false,
        temperature: opts?.temperature ?? 0.3,
        maxTokens: opts?.maxTokens ?? 50,
      },
      messages: [{ role: "user", text: userText }],
    },
    opts?.timeoutMs ?? 25_000
  );
  if (status !== 200)
    throw yandexApiError(
      status,
      raw.slice(0, 300),
      "text",
      `${LLM_BASE}/foundationModels/v1/completion`,
      textModelUri(cfg.folderId)
    );
  const text = extractAlternativesText(json);
  if (!text) throw new Error("YandexGPT вернул пустой ответ (completion).");
  return text;
}

/**
 * Vision-запрос: текст + изображения (data URL) → описание/анализ.
 * Идём через OpenAI-совместимый эндпоинт /v1/chat/completions:
 * он принимает картинки в content-частях image_url (data URL).
 */
export async function yandexVision(
  cfg: YandexConfig,
  req: { text: string; images: string[]; timeoutMs?: number }
): Promise<string> {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: req.text }];
  for (const img of req.images) {
    // Формат OpenAI: image_url.url — data URL вида "data:image/jpeg;base64,…"
    content.push({
      type: "image_url",
      image_url: { url: img.startsWith("data:") ? img : `data:image/jpeg;base64,${img}` },
    });
  }

  const { status, json, raw } = await postJson(
    `${LLM_BASE}/v1/chat/completions`,
    cfg.apiKey,
    {
      model: textModelUri(cfg.folderId),
      messages: [{ role: "user", content }],
      temperature: 0.2,
    },
    req.timeoutMs ?? 35_000
  );
  if (status !== 200)
    throw yandexApiError(
      status,
      raw.slice(0, 300),
      "vision",
      `${LLM_BASE}/v1/chat/completions`,
      textModelUri(cfg.folderId)
    );
  const text = extractAlternativesText(json);
  if (!text) throw new Error("YandexGPT вернул пустой ответ (vision).");
  return text;
}

/** Размер для Images API: строка "ШИРИНАxВЫСОТА" вида "1024x1024".
 *  Достоверно работает 1024x1024; остальные размеры передаём как есть,
 *  а если Яндекс отклонит — yandexArt повторит с квадратом (см. ниже). */
function normalizeArtSize(size: string): string {
  const s = String(size ?? "").trim().toLowerCase();
  return /^\d{3,4}x\d{3,4}$/.test(s) ? s : "1024x1024";
}

interface YandexArtOptions {
  prompt: string;
  size: string;
  /** Бюджет на генерацию, мс — он же таймаут синхронного запроса (обычно 15–45 с). */
  budgetMs?: number;
}

/**
 * Генерация изображения YandexART (новый синхронный Images API).
 * POST /v1/images/generations → ответ сразу содержит b64_json картинки.
 * Возвращает base64 изображения (jpeg) — как раньше, но без опроса операций.
 */
export async function yandexArt(
  cfg: YandexConfig,
  opts: YandexArtOptions
): Promise<string> {
  // У промпта модели жёсткий лимит длины — ужимаем до безопасных ~490 символов.
  const prompt = opts.prompt.length > 490 ? `${opts.prompt.slice(0, 489)}…` : opts.prompt;
  const model = artModelUri(cfg.folderId);
  const url = `${AI_API_BASE}/v1/images/generations`;
  const budgetMs = Math.min(Math.max(opts.budgetMs ?? 40_000, 12_000), 55_000);
  const size = normalizeArtSize(opts.size);

  const attempt = async (sz: string) => {
    const { status, json, raw } = await postJson(
      url,
      cfg.apiKey,
      { model, prompt, size: sz },
      budgetMs,
      {
        auth: "bearer",
        extraHeaders: { "OpenAI-Project": cfg.folderId },
      }
    );
    return { status, json, raw };
  };

  let r: Awaited<ReturnType<typeof attempt>>;
  try {
    r = await attempt(size);

    // Яндекс отклонил размер (не поддерживается моделью) — повторяем квадратом,
    // чтобы пользователь всё равно получил картинку.
    if (r.status === 400 && size !== "1024x1024") {
      r = await attempt("1024x1024");
    }
  } catch (e) {
    if (isAbort(e)) {
      // Бюджет исчерпан (генерация синхронная — таймаут запроса и есть бюджет).
      throw new Error(
        "YandexART не успел нарисовать портрет в отведённое время (на Vercel функция ограничена 60 с). Попробуйте ещё раз или включите «Быстрый режим» — обычно вторая попытка проходит быстрее."
      );
    }
    throw e;
  }

  if (r.status !== 200) {
    throw yandexApiError(
      r.status,
      r.raw.slice(0, 300),
      "генерации изображения",
      url,
      model
    );
  }

  const data = (r.json as { data?: Array<{ b64_json?: string }> })?.data;
  const b64 = String(data?.[0]?.b64_json ?? "");
  if (!b64) {
    throw new Error(
      `YandexART не вернул изображение в ответе. Детали: ${r.raw.slice(0, 200)}`
    );
  }
  return b64;
}


