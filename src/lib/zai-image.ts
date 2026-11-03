import ZAI from "z-ai-web-dev-sdk";
import { isRouteMissing } from "@/lib/zai-vision";
import { getAiProvider } from "@/lib/ai-provider";
import { visionChatAny } from "@/lib/vision";
import { ensureYandexConfig, yandexArt } from "@/lib/yandex-ai";

/**
 * Генерация образа с автоподбором способа:
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

function buildYandexPortraitPrompt(makeupPrompt: string, identity: string): string {
  const head = "Photorealistic studio beauty portrait of this person: ";
  const style =
    ". Same face and hairstyle as described. Head-and-shoulders, front-facing. Makeup: ";
  const headLen = head.length + style.length + 2;
  const identityBudget = 200;
  const idRaw = identity.replace(/\s+/g, " ").slice(0, identityBudget);
  const makeupBudget = Math.max(120, YANDEX_PROMPT_LIMIT - headLen - idRaw.length - 1);
  const makeup =
    makeupPrompt.length > makeupBudget ? `${makeupPrompt.slice(0, makeupBudget - 1)}…` : makeupPrompt;
  const full = `${head}${idRaw}${style}${makeup}`;
  return full.length > YANDEX_PROMPT_LIMIT ? full.slice(0, YANDEX_PROMPT_LIMIT - 1) + "…" : full;
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
  // Движок Яндекс: правка фото не предусмотрена — сразу портретный режим
  // (YandexGPT снимает словесный портрет, YandexART рисует с макияжем).
  if (getAiProvider() === "yandex" || !zai) {
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
 * Портретный режим на движке Яндекса:
 *  1) YandexGPT (multimodal) снимает словесный портрет внешности с фото;
 *  2) YandexART рисует фотореалистичный портрет с выбранным макияжем.
 * Правки исходного фото у Яндекса нет — честно возвращаем pipeline: "portrait".
 */
async function yandexMakeupImage(req: MakeupImageRequest): Promise<MakeupImageResult> {
  const cfg = ensureYandexConfig();
  const startedAt = Date.now();

  const identityRaw = await visionChatAny({
    text: IDENTITY_VISION_PROMPT,
    images: [req.modelPhoto],
  });
  const identity = identityRaw.replace(/\s+/g, " ").slice(0, 400);

  const prompt = buildYandexPortraitPrompt(req.makeupPrompt, identity);

  // Бюджет YandexART — что осталось от ~50 с (у Vercel-функции лимит 60 с,
  // сверху ещё QA-аудит): 50 − (ушло на vision), но не больше 45 с и не меньше 15 с.
  const remaining = 50_000 - (Date.now() - startedAt);
  const artBudget = Math.max(15_000, Math.min(remaining, 45_000));

  const base64 = await yandexArt(cfg, { prompt, size: req.size, budgetMs: artBudget });
  return { base64, pipeline: "portrait", identity };
}
