import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import sharp from "sharp";
import {
  buildPrompt,
  buildReferenceEditPrompt,
  buildAuditPrompt,
  buildCorrectivePrompt,
  buildRequestedSummary,
  hasSelection,
  REFERENCE_VISION_PROMPT,
  type ProductState,
} from "@/lib/makeup";
import { ensureZaiConfig } from "@/lib/zai-config";
import { visionChatAny } from "@/lib/vision";
import { getAiProvider, providerLabel } from "@/lib/ai-provider";
import { generateMakeupImage, sizeForGlmImage, type ImagePipeline } from "@/lib/zai-image";
import { consumeAfterSuccess, gateTryon } from "@/lib/gate";

// Vercel с Fluid compute (по умолчанию для новых проектов) даёт на Hobby план
// до 300 c. Задаём 120 c: этого хватает на полный QA-цикл (правка + аудит +
// корректирующий ретрай + второй аудит) даже в референс-режиме, где раньше
// при лимите 60 c аудит почти никогда не успевал стартовать.
export const maxDuration = 120;

// Соотношение сторон (ширина/высота) → ближайший поддерживаемый размер генерации
type GenSize = "1024x1024" | "768x1344" | "864x1152" | "1344x768" | "1152x864" | "1440x720" | "720x1440";
function pickSize(ratio: number): GenSize {
  if (!Number.isFinite(ratio) || ratio <= 0) return "864x1152";
  if (ratio < 0.62) return "768x1344";
  if (ratio < 0.9) return "864x1152";
  if (ratio < 1.15) return "1024x1024";
  if (ratio < 1.5) return "1152x864";
  return "1344x768";
}

// PNG от edit-модели может весить 2-4 МБ, base64 — до 5+ МБ: упирается в лимит
// ответа serverless-функции Vercel (4.5 МБ) и медленно качается клиенту.
// Сжимаем результат в JPEG — вес падает в ~10 раз без заметной потери качества.
async function toJpegDataUrl(pngBase64: string): Promise<string> {
  const buffer = Buffer.from(pngBase64, "base64");
  const jpeg = await sharp(buffer).jpeg({ quality: 92, mozjpeg: true }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString("base64")}`;
}

// Понятная русская ошибка вместо сырого сообщения SDK/сети.
function friendlyError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const low = raw.toLowerCase();
  // Ошибки Яндекс- и прокси-движков уже переведены на русский — показываем как есть
  if (low.includes("yandex") || low.includes("яндекс") || low.includes("прокси") || low.includes("proxy")) {
    return raw;
  }
  if (
    low.includes("configuration file not found") ||
    low.includes("config file") ||
    low.includes(".z-ai-config")
  ) {
    return "Ключ доступа к ИИ не найден. Локально: создайте файл .env по образцу .env.example (впишите ZAI_API_KEY и ZAI_BASE_URL), сохраните и перезапустите сервер. На Vercel: Settings → Environment Variables → добавьте ZAI_API_KEY и ZAI_BASE_URL, затем Redeploy. Проверить настройку можно, открыв адрес <адрес-сайта>/api/health — он покажет, что именно не так.";
  }
  if (low.includes("invalid header value") || low.includes("newline")) {
    return "В ключе доступа к ИИ есть перенос строки или пробел — обычно ключ разрывается на две строки при вставке. Пересохраните переменную ZAI_API_KEY одной строкой (формат ID.секрет, без пробелов) в настройках Vercel (Settings → Environment Variables) и сделайте Redeploy.";
  }
  if (
    low.includes("api key") ||
    low.includes("apikey") ||
    low.includes("unauthorized") ||
    low.includes("401") ||
    low.includes("403") ||
    low.includes("authenticat")
  ) {
    return "ИИ-сервис не принял ключ доступа. Если приложение развёрнуто на Vercel, проверьте переменные окружения (Settings → Environment Variables) и сделайте redeploy. Проверить ключ можно, открыв адрес <адрес-сайта>/api/health?ping=1. Инструкция — в README-DEPLOY-RU.md.";
  }
  if (low.includes("status 404") || (/\b404\b/.test(low) && low.includes("api request"))) {
    return "ИИ-сервис не нашёл запрошенную операцию (404). Приложение само переключится на запасной режим; если это повторяется, обновите код на GitHub до последней версии и сделайте Redeploy. Если ошибка осталась — пришлите её текст целиком.";
  }
  if (low.includes("timeout") || low.includes("timed out") || low.includes("aborted") || low.includes("econnreset") || low.includes("fetch failed")) {
    return "ИИ-сервис не успел ответить (таймаут). Попробуйте ещё раз — обычно вторая попытка проходит.";
  }
  if (
    low.includes("insufficient balance") ||
    low.includes("no resource package") ||
    low.includes("余额不足") ||
    low.includes("please recharge")
  ) {
    return "На аккаунте Z.AI не хватает средств для генерации изображения: модель картинок тарифицируется отдельно (примерно $0.015 за изображение) и не входит в подписки. Пополните баланс на z.ai в разделе Billing (или подключите пакет ресурсов) и повторите генерацию через пару минут.";
  }
  if (low.includes("429") || low.includes("rate limit") || low.includes("too many")) {
    return "Слишком много запросов к ИИ-сервису подряд. Подождите минуту и попробуйте снова.";
  }
  return raw;
}

function isDataUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^data:image\/(png|jpe?g|webp);base64,/.test(value) &&
    value.length < 15_000_000
  );
}

interface TryonBody {
  mode?: string;
  modelPhoto?: string;
  referencePhoto?: string;
  ratio?: number;
  products?: Record<string, ProductState>;
  brushes?: string[];
  overall?: number;
  userPrompt?: string;
  /** Быстрый режим: без QA-аудита и ретрая — 1 обращение к ИИ вместо 3–4 */
  fastMode?: boolean;
}

// Шаг 1 референсного режима: vision-модель «снимает рецепт» макияжа с референса.
// Работает на любом движке: Z.AI (glm-4.6v) или Яндекс (мультимодальный YandexGPT).
async function extractMakeupRecipe(
  referenceDataUrl: string,
  startedAt: number
): Promise<string> {
  const recipe = await callWithRateLimitRetry(
    () =>
      visionChatAny({
        text: REFERENCE_VISION_PROMPT,
        images: [referenceDataUrl],
      }),
    { startedAt, deadlineMs: 55_000, label: "reference vision" }
  );

  if (!recipe) {
    throw new Error("ИИ не смог разобрать макияж на референсе. Попробуйте другое фото.");
  }
  return recipe.slice(0, 2500);
}

// Грубая «стоимость» проблем из строки ISSUES — для выбора лучшего из двух вариантов
function countIssues(audit: string): number {
  if (audit === "none") return 0;
  const off = (audit.match(/\boff\b/gi) ?? []).length;
  const structural = (audit.match(/extra|added|unrequested|smoothing|closed|changed|altered|distort|unnatural|asymmetr|different colou?rs?/gi) ?? []).length;
  return off + structural;
}

// Отказ 429 («Too many requests») — главная причина «приложение в отказе» при
// повторных генерациях подряд. Поэтому каждый вызов к ИИ повторяем с паузой,
// пока не выйдет бюджет времени функции (на Vercel Hobby — 60 c).
function isRateLimitError(err: unknown): boolean {
  const msg = String(err instanceof Error ? err.message : err).toLowerCase();
  return msg.includes("429") || msg.includes("too many requests") || msg.includes("rate limit");
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

// Promise.race со страховочным таймером. Таймер ОБЯЗАН очищаться, когда гонка
// завершилась: иначе «проигравший» reject срабатывает уже после успешного ответа
// клиенту и становится unhandledRejection — Node 20+ падает с этим процессом.
async function raceWithTimeout<T>(
  p: Promise<T>,
  ms: number,
  makeTimeoutError: () => Error
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(makeTimeoutError()), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// То же, но по таймауту возвращаем null (для ретрая, где таймаут = «не успели,
// берём первый вариант»); таймер тоже очищается, чтобы не держать процесс.
async function raceWithSoftTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T | null>((resolve) => {
        timer = setTimeout(() => resolve(null), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// До 3 попыток при 429: паузы 4 с и 8 с. Итоговые вызовы защищены таймаутом.
async function callWithRateLimitRetry<T>(
  fn: () => Promise<T>,
  opts: { startedAt: number; deadlineMs: number; label: string }
): Promise<T> {
  let lastErr: unknown;
  const pauses = [4_000, 8_000];
  for (let attempt = 0; attempt <= pauses.length; attempt++) {
    const elapsed = Date.now() - opts.startedAt;
    // Последняя попытка должна успеть уложиться в бюджет функции (запас 15 c)
    if (attempt > 0 && elapsed > opts.deadlineMs - 15_000) break;
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (!isRateLimitError(e)) throw e;
      const wait = pauses[Math.min(attempt, pauses.length - 1)];
      console.warn(`[tryon] ${opts.label}: 429 rate limit, повтор №${attempt + 1} через ${wait / 1000} с`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

// QA-аудит: сравниваем оригинал и результат, ищем отклонения оттенков/лишний макияж.
// Работает на любом движке: Z.AI — бесплатная glm-4.6v-flash,
// Яндекс — мультимодальный YandexGPT.
async function auditResult(
  resultDataUrl: string,
  originalDataUrl: string,
  requested: string
): Promise<string> {
  try {
    // Аудит — вспомогательный шаг: ограничиваем его 20 c (мягкий таймаут),
    // чтобы он не съедал бюджет ретрая. Не успел — считаем результат приемлемым.
    const text = await raceWithSoftTimeout(
      visionChatAny({
        text: buildAuditPrompt(requested),
        images: [originalDataUrl, resultDataUrl],
      }),
      20_000
    );
    if (!text) return "none";
    const issues = /ISSUES:\s*(.+)/i.exec(text)?.[1]?.trim() ?? "none";
    return /none/i.test(issues) ? "none" : issues.slice(0, 600);
  } catch {
    // Аудит — вспомогательный шаг: при сбое считаем результат приемлемым
    return "none";
  }
}

export async function POST(req: NextRequest) {
  // Бюджет времени: maxDuration = 120 c (Fluid compute на Hobby даёт до 300 c).
  // Худший случай укладывается так: правка до 60 c (старт не позже ~55-й),
  // аудит 1 — до 70-й секунды (мягкий таймаут 20 c), ретрай — старт до 72-й
  // секунды и до 45 c, второй аудит — старт до 95-й и до 20 c ⇒ всё
  // завершается к ~115 c < 120 c. Если правка завершилась позже 70 c —
  // возвращаем её результат без аудита (лучше быстрый результат, чем обрыв).
  const startedAt = Date.now();
  const AUDIT_LIMIT_MS = 70_000; // аудит 1 запускаем, только если результат готов к этому моменту
  const RETRY_LIMIT_MS = 72_000; // ретрай стартует не позже 72-й секунды (72 + 45 = 117 < 120)
  const RETRY_TIMEOUT_MS = 45_000;
  const AUDIT2_LIMIT_MS = 95_000; // второй аудит — иначе доверяем корректирующему промпту

  try {
    // Ворота подписки: сессия Telegram → пользователь → остаток лимита.
    // Без входа — 401, без остатка — 402 (клиент откроет окно тарифов).
    const gate = await gateTryon(req);
    if (!gate.ok) return gate.response;

    const body = (await req.json()) as TryonBody;
    const mode = body.mode === "reference" ? "reference" : "prompt";

    if (!isDataUrl(body.modelPhoto)) {
      return NextResponse.json(
        { success: false, error: "Загрузите фото модели (JPEG, PNG или WebP)." },
        { status: 400 }
      );
    }
    // Локальная константа: внутри колбэков TS теряет сужение типа свойства body
    const modelPhoto: string = body.modelPhoto;
    if (mode === "reference" && !isDataUrl(body.referencePhoto)) {
      return NextResponse.json(
        { success: false, error: "Загрузите референсное фото макияжа." },
        { status: 400 }
      );
    }
    const referencePhoto = mode === "reference" ? (body.referencePhoto as string) : null;

    const userPrompt =
      typeof body.userPrompt === "string" ? body.userPrompt.slice(0, 800) : "";
    const products = body.products ?? {};

    // Выбор движка: Яндекс (YC_API_KEY + YC_FOLDER_ID) или Z.AI (по умолчанию).
    // Ключи создаются только для того движка, который реально активен:
    // на Vercel с Яндекс-переменными ZAI-конфиг не требуется.
    const provider = getAiProvider();
    const zai = provider === "zai" ? ((ensureZaiConfig(), await ZAI.create())) : undefined;
    let prompt: string;
    let description: string | null = null;

    if (mode === "reference") {
      // Шаг 1: разбор референса, шаг 2: нанесение «рецепта» на оригинал
      const recipe = await extractMakeupRecipe(referencePhoto as string, startedAt);
      description = recipe;
      prompt = buildReferenceEditPrompt(recipe, userPrompt);
    } else {
      if (!hasSelection(products, userPrompt)) {
        return NextResponse.json(
          {
            success: false,
            error:
              "Опишите образ словами или включите хотя бы один продукт в палитре — иначе ИИ не знает, что наносить.",
          },
          { status: 400 }
        );
      }
      prompt = buildPrompt({
        products,
        brushes: Array.isArray(body.brushes) ? body.brushes.slice(0, 6) : [],
        overall: typeof body.overall === "number" ? body.overall : 2,
        userPrompt,
      });
    }

    const size = pickSize(body.ratio ?? 0.75);

    // Страховка: если генерация зависла, не даём функции уйти в таймаут платформы —
    // возвращаем понятную ошибку, пока бюджет ещё позволяет.
    // generateMakeupImage сам выбирает способ: правка фото (внутренний шлюз) или
    // портрет по описанию внешности (публичный api.z.ai, где правки нет).
    const EDIT_TIMEOUT_MS = 60_000;
    let genResult: Awaited<ReturnType<typeof generateMakeupImage>>;
    try {
      genResult = await callWithRateLimitRetry(
        () =>
          raceWithTimeout(
            generateMakeupImage(zai, {
              makeupPrompt: prompt,
              modelPhoto,
              size,
            }),
            EDIT_TIMEOUT_MS,
            () => new Error("edit timeout")
          ),
        { startedAt, deadlineMs: 110_000, label: "edit" }
      );
    } catch (editErr) {
      console.error("[tryon] edit failed:", editErr instanceof Error ? editErr.message : editErr);
      return NextResponse.json(
        { success: false, error: friendlyError(editErr) },
        { status: 502 }
      );
    }
    const pipeline: ImagePipeline = genResult.pipeline;
    const base64 = genResult.base64;
    let imageDataUrl: string;
    try {
      imageDataUrl = await toJpegDataUrl(base64);
    } catch {
      imageDataUrl = `data:image/png;base64,${base64}`;
    }

    // QA-цикл: аудит результата и один корректирующий ретрай с выбором лучшего
    // варианта. Только для режима правки фото: в портретном режиме сравнивать
    // «оригинал vs результат» бессмысленно (лицо сгенерировано заново).
    let audit: string = "none";
    let retried = false;
    const fastMode = body.fastMode === true;
    const requested =
      mode === "prompt"
        ? buildRequestedSummary({
            products,
            brushes: [],
            overall: typeof body.overall === "number" ? body.overall : 2,
            userPrompt,
          })
        : `makeup transferred from the reference photo: ${description ?? ""}`;

    if (pipeline === "edit" && !fastMode && Date.now() - startedAt < AUDIT_LIMIT_MS) {
      audit = await auditResult(imageDataUrl, body.modelPhoto, requested);
      console.log(`[tryon] qa: audit1 at ${((Date.now() - startedAt) / 1000).toFixed(1)}s -> ${audit.slice(0, 120)}`);
      if (audit !== "none" && Date.now() - startedAt < RETRY_LIMIT_MS) {
        try {
          // Ретрай — это новая генерация, а не правка: он может оказаться хуже.
          // Поэтому второй вариант тоже аудируем и возвращаем лучший из двух.
          const retryRes = await raceWithSoftTimeout(
            callWithRateLimitRetry(
              () =>
                generateMakeupImage(zai, {
                  makeupPrompt: buildCorrectivePrompt(prompt, audit),
                  modelPhoto,
                  size,
                }),
              { startedAt, deadlineMs: 110_000, label: "qa retry" }
            ),
            RETRY_TIMEOUT_MS
          );
          const retryB64 = (retryRes as Awaited<ReturnType<typeof generateMakeupImage>> | null)?.base64;
          console.log(`[tryon] qa: retry done at ${((Date.now() - startedAt) / 1000).toFixed(1)}s, got image: ${Boolean(retryB64)}`);
          if (retryB64) {
            let retryUrl: string;
            try {
              retryUrl = await toJpegDataUrl(retryB64);
            } catch {
              retryUrl = `data:image/png;base64,${retryB64}`;
            }
            if (Date.now() - startedAt < AUDIT2_LIMIT_MS) {
              // Время есть: второй вариант тоже аудируем и возвращаем лучший из двух
              const retryAudit = await auditResult(retryUrl, body.modelPhoto, requested);
              if (countIssues(retryAudit) < countIssues(audit)) {
                imageDataUrl = retryUrl;
                audit = retryAudit;
                retried = true;
              }
            } else {
              // Второй аудит не влезает в бюджет — доверяем корректирующему промпту:
              // он строился на конкретных замечаниях аудитора
              imageDataUrl = retryUrl;
              retried = true;
            }
          }
        } catch (retryErr) {
          // Ретрай не удался — возвращаем первый вариант
          console.error("[tryon] qa: retry failed:", retryErr instanceof Error ? retryErr.message : retryErr);
        }
      }
    }

    // Списываем генерацию ТОЛЬКО после успешного результата —
    // неудачные попытки лимит не расходуют
    await consumeAfterSuccess(gate.tid, mode);

    return NextResponse.json({
      success: true,
      image: imageDataUrl,
      prompt,
      description,
      size: pipeline === "portrait" && provider === "zai" ? sizeForGlmImage(size) : size,
      audit: fastMode ? "fast-mode" : audit,
      retried,
      pipeline,
      provider: providerLabel(provider),
    });
  } catch (err) {
    console.error("[tryon] error:", err);
    const msg = friendlyError(err);
    return NextResponse.json(
      { success: false, error: `Не удалось создать образ: ${msg}` },
      { status: 500 }
    );
  }
}
