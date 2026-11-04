/**
 * ВРЕМЕННЫЙ диагностический маршрут: /api/diag?diag=1
 *
 * Что делает: стучится к Яндексу ТЕМ ЖЕ ключом и ТЕМ ЖЕ каталогом,
 * что использует приложение, и показывает дословные ответы API:
 *  - folderId   — какой каталог реально подставлен из переменных Vercel;
 *  - textPing   — текстовая модель (gpt://<folder>/yandexgpt/latest);
 *  - artPing    — генерация картинок (art://<folder>/yandex-art/latest).
 *
 * artPing отправляет НАСТОЯЩИЙ запрос на генерацию (мы результат не ждём):
 * если Яндекс его принял — право на YandexART есть, операция дорисуется
 * сама и спишет ~1–2 ₽ за одну картинку. Это цена точного диагноза.
 *
 * Без параметра ?diag=1 маршрут ничего не проверяет (чтобы чужие не дёргали).
 * После починки файл можно удалить: src/app/api/diag/route.ts
 */

import { NextResponse } from "next/server";
import { ensureYandexConfig, yandexText } from "@/lib/yandex-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LLM_BASE = "https://llm.api.cloud.yandex.net";

/** Один запрос на генерацию: возвращаем HTTP-статус и кусок ответа как есть. */
async function artPingOnce(
  apiKey: string,
  folderId: string
): Promise<{ status: number; raw: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`${LLM_BASE}/foundationModels/v1/imageGenerationAsync`, {
      method: "POST",
      headers: {
        Authorization: `Api-Key ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        modelUri: `art://${folderId}/yandex-art/latest`,
        messages: [{ weight: 1, text: "маленький красный квадрат на белом фоне" }],
        generationOptions: {
          mimeType: "image/jpeg",
          aspectRatio: { widthRatio: 1, heightRatio: 1 },
        },
      }),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    return { status: res.status, raw: raw.slice(0, 600) };
  } catch (e) {
    return { status: 0, raw: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("diag") !== "1") {
    return NextResponse.json({
      hint: "Это временный диагностический маршрут. Добавьте ?diag=1 к адресу.",
    });
  }

  const report: Record<string, unknown> = { time: new Date().toISOString() };
  report.provider =
    String(process.env.AI_PROVIDER ?? "").trim() || "(авто-выбор движка)";

  const yandexReport: Record<string, unknown> = {};
  try {
    const cfg = ensureYandexConfig();
    yandexReport.folderId = cfg.folderId;
    yandexReport.apiKeyPrefix = `${cfg.apiKey.slice(0, 8)}…`;
    yandexReport.apiKeyLength = cfg.apiKey.length;

    // 1) Текстовая модель — тем же ключом и каталогом
    try {
      const reply = await yandexText(
        cfg,
        "Ответь одним словом: работает?",
        { maxTokens: 20, timeoutMs: 15_000 }
      );
      yandexReport.textPing = { ok: true, reply: reply.slice(0, 120) };
    } catch (e) {
      yandexReport.textPing = {
        ok: false,
        error: (e instanceof Error ? e.message : String(e)).slice(0, 400),
      };
    }

    // 2) Генерация картинок — принимается ли запрос (до рисования)
    const art = await artPingOnce(cfg.apiKey, cfg.folderId);
    if (art.status === 200) {
      let opId = "";
      try {
        opId = String((JSON.parse(art.raw) as { id?: string })?.id ?? "");
      } catch {
        // тело не JSON — оставим как есть
      }
      yandexReport.artPing = {
        ok: true,
        operationId: opId,
        note: "Яндекс ПРИНЯЛ запрос на генерацию — право на YandexART есть. Картинка дорисуется сама (~1–2 ₽), ждать не нужно.",
      };
    } else {
      yandexReport.artPing = {
        ok: false,
        status: art.status,
        raw: art.raw,
        note: "Дословный ответ Яндекса на генерацию картинок.",
      };
    }
  } catch (e) {
    yandexReport.configError = e instanceof Error ? e.message : String(e);
  }
  report.yandex = yandexReport;

  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}
