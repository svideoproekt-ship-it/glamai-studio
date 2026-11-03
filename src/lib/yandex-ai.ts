/**
 * Адаптер к Yandex Cloud AI Studio (Foundation Models):
 *  - текст:      POST https://llm.api.cloud.yandex.net/foundationModels/v1/completion
 *  - vision:     POST https://llm.api.cloud.yandex.net/v1/chat/completions
 *                (OpenAI-совместимый режим: картинки передаются в content-части
 *                image_url как data URL. Отдельного REST-маршрута multimodalCompletion
 *                у llm.api.cloud.yandex.net нет — проверено probe-запросами, отвечает 404)
 *  - картинки:   POST https://llm.api.cloud.yandex.net/foundationModels/v1/imageGenerationAsync
 *                (YandexART — асинхронно: получаем operation, опрашиваем до готовности)
 *
 * Авторизация: заголовок `Authorization: Api-Key <YC_API_KEY>`
 * (API-ключ сервисного аккаунта; аккаунту нужны роли
 *  ai.languageModels.user и ai.imageGeneration.user).
 *
 * Ошибки переводятся на понятный русский — сообщения этого файла
 * показываются пользователю как есть (friendlyError их пропускает).
 */

export interface YandexConfig {
  apiKey: string;
  folderId: string;
}

const LLM_BASE = "https://llm.api.cloud.yandex.net";
const OPS_BASE = "https://operation.api.cloud.yandex.net";

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
        "YC_API_KEY — это API-ключ сервисного аккаунта Yandex Cloud (начинается с AQVN…), YC_FOLDER_ID — идентификатор каталога (folder id)."
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
  const model = String(process.env.YC_ART_MODEL ?? "").trim() || "yandex-art/latest";
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
      "Яндекс не принял ключ (401). Проверьте YC_API_KEY: это API-ключ сервисного аккаунта (вид AQVN…), одной строкой, без пробелов. Пересохраните переменную в Vercel и сделайте Redeploy.";
  } else if (status === 403) {
    hint =
      "Яндекс запретил операцию (403). Обычно дело в ролях: сервисному аккаунту нужны роли ai.languageModels.user (текст и понимание фото) и ai.imageGeneration.user (YandexART), а также активный платёжный аккаунт в Yandex Cloud.";
  } else if (status === 404) {
    hint =
      "Яндекс не нашёл модель или каталог (404). Проверьте YC_FOLDER_ID (folder id из консоли Yandex Cloud) и, если задан YC_TEXT_MODEL / YC_ART_MODEL, — имя модели.";
  } else if (status === 429 || b.includes("quota")) {
    hint =
      "Сработал лимит запросов (429) в Yandex Cloud. Подождите минуту и попробуйте снова; если повторяется — проверьте квоты в консоли Yandex Cloud.";
  } else if (b.includes("billing") || b.includes("insufficient") || b.includes("balance") || b.includes("грант") || b.includes("grant")) {
    hint =
      "У аккаунта Яндекса нет доступа к платной генерации: не активирован платёжный аккаунт или закончились средства/грант. Пополните баланс в консоли Yandex Cloud (Биллинг) в рублях и повторите.";
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
  timeoutMs: number
): Promise<{ status: number; json: unknown; raw: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Api-Key ${apiKey}`,
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
 * он принимает картинки в content-частях image_url (data URL),
 * а отдельный REST-маршрут multimodalCompletion у Яндекса отсутствует (404).
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

/** Пропорции для YandexART: пары чисел (как 3:4), а не пиксели. */
export function aspectRatioForSize(size: string): { widthRatio: number; heightRatio: number } {
  switch (size) {
    case "768x1344":
    case "720x1440":
      return { widthRatio: 1, heightRatio: 2 };
    case "864x1152":
      return { widthRatio: 3, heightRatio: 4 };
    case "1152x864":
      return { widthRatio: 4, heightRatio: 3 };
    case "1344x768":
    case "1440x720":
      return { widthRatio: 2, heightRatio: 1 };
    default:
      return { widthRatio: 1, heightRatio: 1 };
  }
}

interface YandexArtOptions {
  prompt: string;
  size: string;
  /** Бюджет на ожидание результата, мс (обычно 15–45 с). */
  budgetMs?: number;
}

/**
 * Генерация изображения YandexART.
 * Асинхронная схема: POST → {id} → опрашиваем операцию до done:true.
 * Возвращает base64 изображения (jpeg).
 */
export async function yandexArt(
  cfg: YandexConfig,
  opts: YandexArtOptions
): Promise<string> {
  // У промпта YandexART жёсткий лимит длины — ужимаем до безопасных ~490 символов.
  const prompt = opts.prompt.length > 490 ? `${opts.prompt.slice(0, 489)}…` : opts.prompt;
  const ratio = aspectRatioForSize(opts.size);
  const budgetMs = Math.min(Math.max(opts.budgetMs ?? 40_000, 12_000), 55_000);
  const startedAt = Date.now();

  const { status, json, raw } = await postJson(
    `${LLM_BASE}/foundationModels/v1/imageGenerationAsync`,
    cfg.apiKey,
    {
      modelUri: artModelUri(cfg.folderId),
      messages: [{ weight: 1, text: prompt }],
      generationOptions: {
        mimeType: "image/jpeg",
        aspectRatio: ratio,
      },
    },
    20_000
  );
  if (status !== 200)
    throw yandexApiError(
      status,
      raw.slice(0, 300),
      "генерации изображения",
      `${LLM_BASE}/foundationModels/v1/imageGenerationAsync`,
      artModelUri(cfg.folderId)
    );

  const opId = (json as { id?: string })?.id;
  if (!opId) {
    throw new Error(
      `Yandex не вернул идентификатор операции генерации. Детали: ${raw.slice(0, 200)}`
    );
  }

  // Опрос операции: раз в 2.5 с, пока не выйдет бюджет
  while (Date.now() - startedAt < budgetMs) {
    await new Promise((r) => setTimeout(r, 2500));
    const left = budgetMs - (Date.now() - startedAt);
    if (left <= 0) break;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Math.min(left, 10_000));
    let opJson: {
      done?: boolean;
      response?: { image?: unknown };
      error?: { code?: number; message?: string };
    };
    try {
      const opRes = await fetch(`${OPS_BASE}/operations/${opId}`, {
        headers: { Authorization: `Api-Key ${cfg.apiKey}` },
        signal: ctrl.signal,
      });
      opJson = (await opRes.json()) as typeof opJson;
    } catch (e) {
      if (isAbort(e)) break; // бюджет исчерпан
      continue; // сетевой сбой опроса — пробуем ещё раз, пока есть время
    } finally {
      clearTimeout(timer);
    }

    if (opJson.error?.message) {
      throw new Error(`YandexART вернул ошибку генерации: ${opJson.error.message}`);
    }
    if (opJson.done && opJson.response) {
      const b64 = String(opJson.response.image ?? "");
      if (!b64) {
        throw new Error("YandexART закончил операцию, но не вернул изображение.");
      }
      return b64;
    }
  }

  throw new Error(
    "YandexART не успел нарисовать портрет в отведённое время (на Vercel функция ограничена 60 с). Попробуйте ещё раз или включите «Быстрый режим» — обычно вторая попытка проходит быстрее."
  );
}
