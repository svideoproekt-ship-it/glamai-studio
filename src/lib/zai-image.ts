import ZAI from "z-ai-web-dev-sdk";
import { isRouteMissing } from "@/lib/zai-vision";
import { getAiProvider } from "@/lib/ai-provider";
import { visionChatAny } from "@/lib/vision";
import { ensureYandexConfig, yandexArt } from "@/lib/yandex-ai";
import { ensureProxyConfig, proxyEditImage } from "@/lib/proxy-ai";

/**
 * Генерация образа с автоподбором способа (v1.4.3):
 *
 *  НОВОЕ в v1.4.3 — движок «прокси» (OpenAI-совместимый шлюз): модели-редакторы
 *  (Nano Banana, GPT Image, Seedream…) принимают ФОТО на входе — правка с
 *  СОХРАНЕНИЕМ ЛИЦА. Вернулся режим «edit» и QA-аудит. См. src/lib/proxy-ai.ts.
 *
 *  Изменение для движка Яндекс: модель aliceai-image-art-3.0 («Alice ART»)
 *  отклоняла прежний промпт (HTTP 400 «Я не могу сгенерировать это
 *  изображение»). Причина: в YandexART уходили инструкции редактирования
 *  фото («Photo edit: change ONLY the makeup…») и утверждения о конкретном
 *  человеке («same person», «of this person») — модель работает только как
 *  «текст → картинка» и такие запросы блокирует контент-фильтр.
 *  Теперь: 1) vision снимает внешность на РУССКОМ (модель русскоязычная);
 *  2) промпт — нейтральное описание портрета без инструкций;
 *  3) при отказе фильтра — автоматический повтор коротким запасным промптом.
 *
 *  1. «edit» — правка исходного фото (сохраняет лицо): путь
 *     /images/generations/edit. Он есть у внутреннего шлюза Z.AI.
 *  2. «portrait» — запасной режим: правка недоступна (публичный api.z.ai
 *     не имеет /images/generations/edit — проверено по официальной
 *     OpenAPI-спеке; внутренний шлюз может отвечать 500). Тогда:
 *       2a. vision-модель снимает словесный портрет с фото клиента;
 *       2b. glm-image генерирует фотореалистичный портрет «по описанию»
 *           с выбранным макияжем (quality standard — быстрее, см. тесты:
 *           hd 1280 ≈ 90 с, standard 1024 ≈ 35 с, бюджет Vercel — 60 с).
 *     Лицо в результате может немного отличаться от оригинала — это
 *     честно помечается в ответе (pipeline: "portrait") и показывается
 *     в интерфейсе.
 */

type Zai = Awaited<ReturnType<typeof ZAI.create>>;

/**
 * Лимит промпта YandexART — жёсткий (≈500 символов), поэтому для Яндекса
 * портретный промпт собирается короче: внешность ужата сильнее макияжа.
 */
const YANDEX_PROMPT_LIMIT = 490;

/** Промпт для vision-модели в Яндекс-пути: снимает словесный портрет внешности
 *  НА РУССКОМ (Alice ART — русскоязычная модель, русский текст проходит надёжнее).
 *  Просим нейтральное описание БЕЗ макияжа и без привязки к конкретному человеку:
 *  формулировки «тот же человек / this person» контент-фильтр модели отклоняет. */
const IDENTITY_VISION_PROMPT_RU =
  "Посмотри на фото и одной строкой опиши внешность человека на русском языке, максимум 40 слов. " +
  "Нейтральное фактическое описание: возраст, форма лица, глаза (форма и цвет), брови, нос, губы, " +
  "скулы, тон кожи, причёска и цвет волос, очки, если есть. Макияж игнорируй. " +
  "Без имён, без оценок и предположений — только описание.";

/** Вытаскивает из промпта правки только ОПИСАНИЕ макияжа (продукты, оттенки,
 *  стиль, пожелание клиента), выбрасывая инструкции «Photo edit / Keep the
 *  person / Output…». Именно инструкции редактирования вызывали отказ модели. */
function extractMakeupForArt(makeupPrompt: string): string {
  const s = makeupPrompt.replace(/QC feedback[\s\S]*$/i, "").replace(/\s+/g, " ");
  const recipe =
    /MAKEUP RECIPE[^:]*:\s*([\s\S]*?)(?=\s*Apply exactly|\s*COLORS:|\s*Keep the person|\s*Note:|\s*Output:|$)/i
      .exec(s)?.[1] ?? "";
  const items = /Makeup:\s*([^.]+?)\./i.exec(s)?.[1] ?? "";
  const note =
    /Note:\s*"([^"]+)"/i.exec(s)?.[1] ??
    /described in the note:\s*"([^"]+)"/i.exec(s)?.[1] ??
    "";
  const style = /Style:\s*([^.]+?)\./i.exec(s)?.[1] ?? "";

  let core = (recipe.trim() || items.trim()).replace(/\s+/g, " ");
  if (!core && note) core = note.trim();
  if (core && note && core.length < 150) core += `. Пожелание клиента: ${note.trim()}`;
  if (core && style && core.length < 165) core += `. Общий стиль: ${style.trim()}`;
  return core.trim();
}

/** Финальный промпт для YandexART: нейтральное описание будущей картинки.
 *  Никаких «this person / same face / photo edit» — только описание:
 *  ракурс, свет, внешность, макияж. Рамка на русском, детали макияжа могут
 *  остаться на английском — модель понимает оба языка. */
function buildYandexArtPrompt(identity: string, makeup: string): string {
  const base =
    "Фотореалистичный студийный портрет, голова и плечи, взгляд в камеру, мягкий ровный свет, естественная кожа";
  const mk = makeup.replace(/\s+/g, " ").trim().slice(0, 160) || "лёгкий естественный макияж";
  const id = identity.replace(/\s+/g, " ").trim().slice(0, 190);
  const full = id ? `${base}. Внешность: ${id}. Макияж: ${mk}` : `${base}. Макияж: ${mk}`;
  return full.length > YANDEX_PROMPT_LIMIT ? `${full.slice(0, YANDEX_PROMPT_LIMIT - 1)}…` : full;
}

/** Запасной промпт — вторая попытка, если фильтр отклонил основной:
 *  короче, только описание, ничего кроме внешности и макияжа. */
function buildYandexFallbackPrompt(identity: string, makeup: string): string {
  const mk = makeup.replace(/\s+/g, " ").trim().slice(0, 80) || "лёгкий естественный макияж";
  const id = identity.replace(/\s+/g, " ").trim().slice(0, 130);
  const base = "Фотореалистичный студийный портрет, голова и плечи, взгляд в камеру, мягкий свет";
  return id ? `${base}. Внешность: ${id}. Макияж: ${mk}.` : `${base}. Макияж: ${mk}.`;
}

/** Отказ контент-фильтра YandexART: HTTP 400 и «Я не могу сгенерировать…».
 *  Сюда же попадает любой 400 invalid_request_error — запасной промпт
 *  короче и чище, поэтому вторая попытка безопасна и в других случаях. */
function isArtContentRefusal(err: unknown): boolean {
  const t = errText(err);
  return t.includes("HTTP 400") && /не могу сгенерировать|другую тему|invalid_request_error/i.test(t);
}

export type ImagePipeline = "edit" | "portrait";

export interface MakeupImageRequest {
  /** Полный промпт макияжа (как построил buildPrompt). */
  makeupPrompt: string;
  /** Фото клиента в виде data URL. */
  modelPhoto: string;
  /** Размер от pickSize (например "864x1152"). */
  size: string;
}

export interface MakeupImageResult {
  base64: string;
  pipeline: ImagePipeline;
  /** Словесный портрет внешности — заполняется только в режиме portrait. */
  identity?: string;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Когда имеет смысл уходить в портретный фолбэк:
 *  - 404 (путь правки отсутствует — публичный API) — всегда;
 *  - 500/502/503 у edit (внутренний шлюз отвечает «сетевой ошибкой») — да,
 *    на другой стороне проблемы, а не у пользователя;
 *  НЕ фолбэчимся при: 429 (лимит — спасает ретрай), таймауте (портрет тоже
 *  не успеет), 401/403 (ключ), «insufficient balance» (не поможет).
 */
function shouldFallbackToPortrait(err: unknown): boolean {
  const t = errText(err).toLowerCase();
  if (isRouteMissing(err)) return true;
  if (/429|rate limit|too many/.test(t)) return false;
  if (/insufficient balance|no resource package|余额不足|please recharge/.test(t)) return false;
  if (/401|403|unauthorized|api key|apikey/.test(t)) return false;
  if (/timeout|timed out|aborted|econnreset|fetch failed/.test(t)) return false;
  return /status 5\d\d|网络错误|internal server error|bad gateway|service unavailable/.test(t);
}

/**
 * Минимальные размеры glm-image (стороны кратны 32, диапазон 1024–2048,
 * площадь ≤ 2^22) для тех же пропорций, что дают исходные GenSize:
 * чем меньше пикселей — тем быстрее генерация (важно для бюджета 60 с).
 */
const GLM_IMAGE_SIZE_MAP: Record<string, string> = {
  "768x1344": "1024x1792",
  "720x1440": "1024x1792",
  "864x1152": "1056x1408",
  "1024x1024": "1024x1024",
  "1152x864": "1408x1056",
  "1344x768": "1792x1024",
  "1440x720": "1792x1024",
};

export function sizeForGlmImage(size: string): string {
  return GLM_IMAGE_SIZE_MAP[size] ?? "1024x1024";
}

/** Просим vision-модель снять словесный портрет внешности (без макияжа). */
const IDENTITY_VISION_PROMPT =
  "Look at the photo and describe this person's appearance in English, maximum 60 words, " +
  "as a neutral factual description that will be used to generate a photorealistic portrait " +
  "of the same person. Include: age range, face shape, eye shape and color, eyebrows, nose, " +
  "lips, cheekbones, skin tone, hairstyle and hair color, any visible accessories such as " +
  "glasses. No makeup details, no evaluation, no assumptions about identity.";

/** У публичного glm-image вход промпта ограничен ~1000 символами — ужимаем. */
const PORTRAIT_PROMPT_LIMIT = 1000;

function buildPortraitPrompt(makeupPrompt: string, identity: string): string {
  const head =
    "Create a photorealistic professional beauty portrait photograph of this person: " +
    `${identity}. `;
  const style =
    "Studio-quality lighting, natural skin texture, same age, same hair, same facial features " +
    "as described. Front-facing head-and-shoulders framing. Makeup to apply: ";
  const budget = PORTRAIT_PROMPT_LIMIT - head.length - style.length - 2;
  const makeup =
    makeupPrompt.length > Math.max(200, budget)
      ? `${makeupPrompt.slice(0, Math.max(200, budget))}…`
      : makeupPrompt;
  const full = `${head}${style}${makeup}`;
  return full.length > PORTRAIT_PROMPT_LIMIT ? full.slice(0, PORTRAIT_PROMPT_LIMIT) : full;
}

async function extractBase64(res: unknown, label: string): Promise<string> {
  const data = (res as { data?: Array<{ base64?: string }> })?.data?.[0]?.base64;
  if (!data) {
    throw new Error(`ИИ не вернул изображение (${label}). Попробуйте ещё раз.`);
  }
  return data;
}

/** glm-image: quality standard быстрее (~35 с против ~90 с hd в тестах). */
async function glmImageGenerate(
  zai: Zai,
  prompt: string,
  size: string
): Promise<string> {
  try {
    const body = { model: "glm-image", prompt, size, quality: "standard" } as Parameters<
      typeof zai.images.generations.create
    >[0];
    const res = await zai.images.generations.create(body);
    return await extractBase64(res, "glm-image");
  } catch (e) {
    // Некоторые шлюзы не принимают quality для glm-image — повторяем без него
    const t = errText(e).toLowerCase();
    if (/status 400|quality/.test(t)) {
      const body = { model: "glm-image", prompt, size } as Parameters<
        typeof zai.images.generations.create
      >[0];
      const res = await zai.images.generations.create(body);
      return await extractBase64(res, "glm-image");
    }
    throw e;
  }
}

export async function generateMakeupImage(
  zai: Zai | undefined,
  req: MakeupImageRequest
): Promise<MakeupImageResult> {
  const provider = getAiProvider();
  // Движок прокси: правка фото моделью-редактором — лицо сохраняется.
  if (provider === "proxy") {
    return proxyMakeupImage(req);
  }
  // Движок Яндекс: правка фото не предусмотрена — сразу портретный режим
  // (YandexGPT снимает словесный портрет, YandexART рисует с макияжем).
  if (provider === "yandex" || !zai) {
    return yandexMakeupImage(req);
  }

  // Попытка 1: правка исходного фото (лицо сохраняется).
  try {
    const editBody = {
      prompt: req.makeupPrompt,
      images: [{ url: req.modelPhoto }],
      size: req.size,
    } as Parameters<typeof zai.images.generations.edit>[0];
    const res = await zai.images.generations.edit(editBody);
    const base64 = await extractBase64(res, "edit");
    return { base64, pipeline: "edit" };
  } catch (e) {
    if (!shouldFallbackToPortrait(e)) throw e;
  }

  // Попытка 2: портретный режим (правка недоступна).
  const identityRaw = await visionChatAny({
    text: IDENTITY_VISION_PROMPT,
    images: [req.modelPhoto],
    models: ["glm-4.6v", "glm-4.6v-flash"],
  });
  const identity = identityRaw.replace(/\s+/g, " ").slice(0, 600);

  const prompt = buildPortraitPrompt(req.makeupPrompt, identity);
  const size = sizeForGlmImage(req.size);
  const base64 = await glmImageGenerate(zai, prompt, size);
  return { base64, pipeline: "portrait", identity };
}

/**
 * Правка фото на движке прокси (OpenAI-совместимый шлюз):
 * модель-редактор принимает исходное фото и промпт макияжа — возвращает
 * ту же фотографию с макияжем, лицо сохраняется (pipeline: "edit").
 */
async function proxyMakeupImage(req: MakeupImageRequest): Promise<MakeupImageResult> {
  const cfg = ensureProxyConfig();
  if (!cfg.editModel) {
    throw new Error(
      "Не задана PROXY_EDIT_MODEL. На Vercel: Settings → Environment Variables → добавьте имя модели-редактора из перечня ProxyAPI (например bytedance-seed/seedream-5-0-flash или openai/gpt-image-2.5-flare) и сделайте Redeploy."
    );
  }
  const base64 = await proxyEditImage(cfg, {
    prompt: req.makeupPrompt,
    imageDataUrl: req.modelPhoto,
    size: req.size,
    // 55 c на попытку пути: Seedream и Nano Banana иногда отвечают дольше 40 c,
    // а функция на Vercel теперь держит 120 c (Fluid compute) — даём помедлить.
    timeoutMs: 55_000,
  });
  return { base64, pipeline: "edit" };
}

/**
 * Портретный режим на движке Яндекса:
 *  1) YandexGPT (multimodal) снимает словесный портрет внешности с фото (на русском);
 *  2) YandexART рисует фотореалистичный портрет с выбранным макияжем
 *     по нейтральному промпту-описанию;
 *  3) если контент-фильтр модели отклонил промпт (HTTP 400) — один повтор
 *     коротким запасным промптом, чтобы пользователь всё равно получил картинку.
 * Правки исходного фото у Яндекса нет — честно возвращаем pipeline: "portrait".
 */
async function yandexMakeupImage(req: MakeupImageRequest): Promise<MakeupImageResult> {
  const cfg = ensureYandexConfig();
  const startedAt = Date.now();

  const identityRaw = await visionChatAny({
    text: IDENTITY_VISION_PROMPT_RU,
    images: [req.modelPhoto],
  });
  const identity = identityRaw.replace(/\s+/g, " ").trim().slice(0, 400);

  const makeup = extractMakeupForArt(req.makeupPrompt);
  const prompt = buildYandexArtPrompt(identity, makeup);
  const fallbackPrompt = buildYandexFallbackPrompt(identity, makeup);
  console.log(`[yandex-art] prompt (${prompt.length} зн.): ${prompt}`);
  console.log(`[yandex-art] fallback (${fallbackPrompt.length} зн.): ${fallbackPrompt}`);

  // Бюджет YandexART — что осталось от ~50 с (у Vercel-функции лимит 60 с).
  const remaining = 50_000 - (Date.now() - startedAt);
  const artBudget = Math.max(15_000, Math.min(remaining, 40_000));

  try {
    const base64 = await yandexArt(cfg, { prompt, size: req.size, budgetMs: artBudget });
    return { base64, pipeline: "portrait", identity };
  } catch (e) {
    // Фильтр отклоняет БЫСТРО (без рендера) — повтор успевает даже при 60 с на функцию.
    const left = 50_000 - (Date.now() - startedAt);
    if (!isArtContentRefusal(e) || left < 13_000) throw e;
    console.warn("[yandex-art] модель отклонила промпт (400 «не могу сгенерировать»), повтор запасным промптом");
    const base64 = await yandexArt(cfg, {
      prompt: fallbackPrompt,
      size: req.size,
      budgetMs: Math.max(12_000, Math.min(left - 2_000, 30_000)),
    });
    return { base64, pipeline: "portrait", identity };
  }
}
