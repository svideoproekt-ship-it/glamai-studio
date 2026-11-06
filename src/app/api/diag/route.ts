import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import {
  ensureProxyConfig,
  proxyText,
  proxyVision,
  proxyEditImage,
  type ProxyConfig,
} from "@/lib/proxy-ai";

export const maxDuration = 60;

/**
 * Временный диагностический маршрут для движка «прокси» (v1.4.3).
 *
 * БЕЗ ?diag=1 ничего не проверяет (чтобы не списывать деньги случайно).
 * С ?diag=1 — четыре проверки параллельно:
 *   1) textPing  — текстовая модель (ключ принят?);
 *   2) visionPing — vision-модель смотрит тестовую картинку;
 *   3) editsTest — правка фото через /images/edits (OpenAI-формат);
 *   4) chatTest  — правка фото через /chat/completions (Nano Banana и др.).
 * С ?diag=all — дополнительно googleTest (generateContent, Google-формат).
 *
 * Тестовая картинка — красный квадрат 64×64, промпт «перекрась в синий».
 * Каждая успешная правка стоит ~1–5 ₽ по тарифам прокси.
 */

interface TestResult {
  ok: boolean;
  status?: number;
  rawStart?: string;
  bytes?: number;
  detail: string;
}

async function makeTestSquare(): Promise<string> {
  const buf = await sharp({
    create: { width: 64, height: 64, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

function describeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/aborted|AbortError|timeout/i.test(raw)) return "Таймаут: модель не успела ответить за 45 с.";
  return raw.slice(0, 300);
}

async function runTextEdit(cfg: ProxyConfig): Promise<TestResult> {
  try {
    const reply = await proxyText(cfg, "Ответь одним словом: Функционирует.", {
      maxTokens: 20,
      timeoutMs: 30_000,
    });
    return { ok: true, detail: `Текстовая модель отвечает: «${reply.slice(0, 40)}»` };
  } catch (e) {
    return { ok: false, detail: describeError(e) };
  }
}

async function runVisionTest(cfg: ProxyConfig, square: string): Promise<TestResult> {
  try {
    const reply = await proxyVision(cfg, {
      text: "Какого цвета квадрат на картинке? Ответь одним словом.",
      images: [square],
      timeoutMs: 35_000,
    });
    return { ok: true, detail: `Vision отвечает: «${reply.slice(0, 40)}»` };
  } catch (e) {
    return { ok: false, detail: describeError(e) };
  }
}

async function runEditTest(
  cfg: ProxyConfig,
  square: string,
  style: "edits" | "chat" | "google"
): Promise<TestResult> {
  try {
    const b64 = await proxyEditImage(cfg, {
      prompt: "Перекрась красный квадрат в синий цвет. Фон оставь белым. Ничего кроме цвета не меняй.",
      imageDataUrl: square,
      size: "1024x1024",
      timeoutMs: 45_000,
      style,
    });
    const bytes = Math.round((b64.length * 3) / 4);
    return {
      ok: true,
      bytes,
      detail: `Правка (${style}) вернула картинку ~${Math.round(bytes / 1024)} КБ.`,
    };
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const m = /HTTP (\d{3})/.exec(raw);
    return {
      ok: false,
      status: m ? Number(m[1]) : undefined,
      rawStart: raw.slice(0, 300),
      detail: describeError(e),
    };
  }
}

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("diag");
  if (mode !== "1" && mode !== "all") {
    return NextResponse.json({
      note: "Диагностика выключена. Откройте /api/diag?diag=1 — она проверит текст, vision и правку фото на вашем прокси (успешные правки списываются по тарифу прокси, ~2–10 ₽ за тест). ?diag=all — ещё и Google-формат.",
    });
  }

  const withGoogle = mode === "all";

  let cfg: ProxyConfig;
  try {
    cfg = ensureProxyConfig();
  } catch (e) {
    return NextResponse.json(
      {
        provider: "proxy",
        error: e instanceof Error ? e.message : String(e),
        note: "Сначала задайте PROXY_API_KEY и PROXY_BASE_URL в Vercel (Settings → Environment Variables) и сделайте Redeploy.",
      },
      { status: 503 }
    );
  }

  const square = await makeTestSquare();
  const host = new URL(cfg.baseUrl).host;

  const tasks: Record<string, Promise<TestResult>> = {
    textPing: runTextEdit(cfg),
    visionPing: runVisionTest(cfg, square),
    editsTest: runEditTest(cfg, square, "edits"),
    chatTest: runEditTest(cfg, square, "chat"),
  };
  if (withGoogle) tasks.googleTest = runEditTest(cfg, square, "google");

  const names = Object.keys(tasks);
  const settled = await Promise.allSettled(names.map((n) => tasks[n]));
  const results: Record<string, TestResult> = {};
  names.forEach((n, i) => {
    results[n] =
      settled[i].status === "fulfilled"
        ? (settled[i] as PromiseFulfilledResult<TestResult>).value
        : { ok: false, detail: String((settled[i] as PromiseRejectedResult).reason).slice(0, 300) };
  });

  const anyEditOk = ["editsTest", "chatTest", "googleTest"].some(
    (k) => k in results && results[k].ok
  );

  return NextResponse.json({
    time: new Date().toISOString(),
    provider: "proxy",
    proxy: {
      host,
      baseUrl: cfg.baseUrl,
      editModel: cfg.editModel || "НЕ ЗАДАНА (PROXY_EDIT_MODEL)",
      visionModel: cfg.visionModel,
      textModel: cfg.textModel,
      editStyle: cfg.editStyle,
    },
    ...results,
    verdict: anyEditOk
      ? "Правка фото работает — этот движок подходит для GlamAI. Можно закрепить удачный способ переменной PROXY_EDIT_STYLE (edits/chat/google)."
      : "Правка фото пока не удалась ни одним способом. Пришлите этот вывод целиком — подберём модель или поправим формат запроса.",
  });
}
