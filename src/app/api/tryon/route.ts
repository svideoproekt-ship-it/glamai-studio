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

// Vercel Hobby ограничивает функцию 60 с — задаём ровно лимит плана,
// чтобы деплой/вызов не падал из-за завышенного maxDuration.
export const maxDuration = 60;

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
  if (
    low.includes("configuration file not found") ||
    low.includes("config file") ||
    low.includes(".z-ai-config")
  ) {
    return "Ключ доступа к ИИ не найден. Локально: создайте файл .env по образцу .env.example (впишите ZAI_API_KEY и ZAI_BASE_URL), сохраните и перезапустите сервер. На Vercel: Settings → Environment Variables → добавьте ZAI_API_KEY и ZAI_BASE_URL, затем Redeploy. Проверить настройку можно, открыв адрес <адрес-сайта>/api/health — он покажет, что именно не так.";
  }
  if (
    low.includes("api key") ||
    low.includes("apikey") ||
    low.includes("unauthorized") ||
    low.includes("401") ||
    low.includes("403") ||
    low.includes("authenticat")
  ) {
    return "ИИ-сервис не принял ключ доступа. Если приложение развёрнуто на Vercel, добавьте переменные окружения ZAI_API_KEY и ZAI_BASE_URL (Settings → Environment Variables) и сделайте redeploy. Проверить ключ можно, открыв адрес <адрес-сайта>/api/health?ping=1. Инструкция — в README-DEPLOY-RU.md, раздел «Если генерация отказывает».";
  }
  if (low.includes("timeout") || low.includes("timed out") || low.includes("aborted") || low.includes("econnreset") || low.includes("fetch failed")) {
    return "ИИ-сервис не успел ответить (таймаут). Попробуйте ещё раз — обычно вторая попытка проходит.";
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

// Шаг 1 референсного режима: vision-модель «снимает рецепт» макияжа с референса
async function extractMakeupRecipe(
  zai: Awaited<ReturnType<typeof ZAI.create>>,
  referenceDataUrl: string,
  startedAt: number
): Promise<string> {
  const response = (await callWithRateLimitRetry(
    () =>
      zai.chat.completions.createVision({
        model: "glm-4.6v",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: REFERENCE_VISION_PROMPT },
              { type: "image_url", image_url: { url: referenceDataUrl } },
            ],
          },
        ],
        thinking: { type: "disabled" },
      }),
    { startedAt, deadlineMs: 55_000, label: "reference vision" }
  )) as { choices?: Array<{ message?: { content?: string } }> };

  const recipe = response?.choices?.[0]?.message?.content?.trim();
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

// QA-аудит: сравниваем оригинал и результат, ищем отклонения оттенков/лишний макияж
async function auditResult(
  zai: Awaited<ReturnType<typeof ZAI.create>>,
  resultDataUrl: string,
  originalDataUrl: string,
  requested: string
): Promise<string> {
  try {
    const response = (await zai.chat.completions.createVision({
      model: "glm-4.6v",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: buildAuditPrompt(requested) },
            { type: "image_url", image_url: { url: originalDataUrl } },
            { type: "image_url", image_url: { url: resultDataUrl } },
          ],
        },
      ],
      thinking: { type: "disabled" },
    })) as { choices?: Array<{ message?: { content?: string } }> };
    const text = response?.choices?.[0]?.message?.content?.trim() ?? "";
    const issues = /ISSUES:\s*(.+)/i.exec(text)?.[1]?.trim() ?? "none";
    return /none/i.test(issues) ? "none" : issues.slice(0, 600);
  } catch {
    // Аудит — вспомогательный шаг: при сбое считаем результат приемлемым
    return "none";
  }
}

export async function POST(req: NextRequest) {
  // Бюджет времени: на Vercel Hobby функция ограничена ~60 с — оставляем запас.
  // Худший случай: ретрай стартует на 30-й секунде + 25 c = 55 c < 60 c.
  // Быстрый случай: edit 12с + аудит 8с + ретрай 25с + аудит 9с = 54 c.
  const startedAt = Date.now();
  const AUDIT_LIMIT_MS = 30_000; // аудит 1 запускаем, только если результат готов к этому моменту
  const RETRY_LIMIT_MS = 30_000; // ретрай стартует не позже 30-й секунды (30 + 25 = 55 < 60)
  const RETRY_TIMEOUT_MS = 25_000;
  const AUDIT2_LIMIT_MS = 46_000; // второй аудит — иначе доверяем корректирующему промпту

  try {
    const body = (await req.json()) as TryonBody;
    const mode = body.mode === "reference" ? "reference" : "prompt";

    if (!isDataUrl(body.modelPhoto)) {
      return NextResponse.json(
        { success: false, error: "Загрузите фото модели (JPEG, PNG или WebP)." },
        { status: 400 }
      );
    }
    if (mode === "reference" && !isDataUrl(body.referencePhoto)) {
      return NextResponse.json(
        { success: false, error: "Загрузите референсное фото макияжа." },
        { status: 400 }
      );
    }

    const userPrompt =
      typeof body.userPrompt === "string" ? body.userPrompt.slice(0, 800) : "";
    const products = body.products ?? {};

    // На Vercel ключи берутся из переменных окружения (см. src/lib/zai-config.ts)
    ensureZaiConfig();
    const zai = await ZAI.create();
    let prompt: string;
    let description: string | null = null;

    if (mode === "reference") {
      // Шаг 1: разбор референса, шаг 2: нанесение «рецепта» на оригинал
      const recipe = await extractMakeupRecipe(zai, body.referencePhoto as string, startedAt);
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
    const editBody = { prompt, images: [{ url: body.modelPhoto }], size } as Parameters<
      typeof zai.images.generations.edit
    >[0];

    // Страховка: если edit-вызов завис, не даём функции уйти в таймаут платформы —
    // возвращаем понятную ошибку, пока бюджет ещё позволяет.
    const EDIT_TIMEOUT_MS = 48_000;
    let response: Awaited<ReturnType<typeof zai.images.generations.edit>>;
    try {
      response = await callWithRateLimitRetry(
        () =>
          Promise.race([
            zai.images.generations.edit(editBody),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("edit timeout")), EDIT_TIMEOUT_MS)
            ),
          ]),
        { startedAt, deadlineMs: 55_000, label: "edit" }
      );
    } catch (editErr) {
      console.error("[tryon] edit failed:", editErr instanceof Error ? editErr.message : editErr);
      return NextResponse.json(
        { success: false, error: friendlyError(editErr) },
        { status: 502 }
      );
    }
    const base64 = response?.data?.[0]?.base64;
    if (!base64) {
      throw new Error("ИИ не вернул изображение. Попробуйте ещё раз.");
    }
    let imageDataUrl: string;
    try {
      imageDataUrl = await toJpegDataUrl(base64);
    } catch {
      imageDataUrl = `data:image/png;base64,${base64}`;
    }

    // QA-цикл: аудит результата и один корректирующий ретрай с выбором лучшего
    // варианта. Работает в ОБЕИХ режимах; пропускается в быстром режиме
    // (fastMode — экономия лимита) и если время поджимает (Hobby ~60 c).
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

    if (!fastMode && Date.now() - startedAt < AUDIT_LIMIT_MS) {
      audit = await auditResult(zai, imageDataUrl, body.modelPhoto, requested);
      console.log(`[tryon] qa: audit1 at ${((Date.now() - startedAt) / 1000).toFixed(1)}s -> ${audit.slice(0, 120)}`);
      if (audit !== "none" && Date.now() - startedAt < RETRY_LIMIT_MS) {
        try {
          // Ретрай — это новая генерация, а не правка: он может оказаться хуже.
          // Поэтому второй вариант тоже аудируем и возвращаем лучший из двух.
          const retryRes = await Promise.race([
            callWithRateLimitRetry(
              () =>
                zai.images.generations.edit({
                  ...editBody,
                  prompt: buildCorrectivePrompt(prompt, audit),
                }),
              { startedAt, deadlineMs: 55_000, label: "qa retry" }
            ),
            new Promise<null>((resolve) => setTimeout(() => resolve(null), RETRY_TIMEOUT_MS)),
          ]);
          const retryB64 = (retryRes as { data?: Array<{ base64?: string }> } | null)?.data?.[0]?.base64;
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
              const retryAudit = await auditResult(zai, retryUrl, body.modelPhoto, requested);
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

    return NextResponse.json({
      success: true,
      image: imageDataUrl,
      prompt,
      description,
      size,
      audit: fastMode ? "fast-mode" : audit,
      retried,
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
