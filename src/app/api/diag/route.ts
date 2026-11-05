/**
 * ВРЕМЕННЫЙ диагностический маршрут v2: /api/diag?diag=1
 *
 * Отличие от v1: генерация картинок проверяется на ДВУХ хостах Яндекса:
 *  - artPing        — старый хост  llm.api.cloud.yandex.net  (давал 403);
 *  - artPingNewHost — новый хост   ai.api.cloud.yandex.net   (его указывают
 *    актуальные доки AI Studio). Если новый хост примет запрос — чиним
 *    приложение одной строкой, без поддержки.
 *
 * Остальное как в v1: folderId, префикс ключа, textPing.
 * Без параметра ?diag=1 ничего не проверяет. После починки файл удалить.
 */

import { NextResponse } from "next/server";
import { ensureYandexConfig, yandexText } from "@/lib/yandex-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const LLM_BASE = "https://llm.api.cloud.yandex.net";
const AI_API_BASE = "https://ai.api.cloud.yandex.net";

/** Один запрос на генерацию по указанному хосту: статус и кусок ответа как есть. */
async function artPingOnce(
  base: string,
  apiKey: string,
  folderId: string
): Promise<{ status: number; raw: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(`${base}/foundationModels/v1/imageGenerationAsync`, {
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

/** Упаковка результата art-пинга в отчёт. */
function artReport(host: string, r: { status: number; raw: string }) {
  if (r.status === 200) {
    let opId = "";
    try {
      opId = String((JSON.parse(r.raw) as { id?: string })?.id ?? "");
    } catch {
      // тело не JSON — оставим как есть
    }
    return {
      ok: true,
      host,
      operationId: opId,
      note: "Хост ПРИНЯЛ запрос на генерацию — право на YandexART есть (~1–2 ₽).",
    };
  }
  return {
    ok: false,
    host,
    status: r.status,
    raw: r.raw,
    note: "Дословный ответ хоста на генерацию картинок.",
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("diag") !== "1") {
    return NextResponse.json({
      hint: "Это временный диагностический маршрут v2. Добавьте ?diag=1 к адресу.",
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

    // 2) Генерация картинок — СРАЗУ НА ОБОИХ ХОСТАХ
    const [artOld, artNew] = await Promise.all([
      artPingOnce(LLM_BASE, cfg.apiKey, cfg.folderId),
      artPingOnce(AI_API_BASE, cfg.apiKey, cfg.folderId),
    ]);
    yandexReport.artPing = artReport("llm.api.cloud.yandex.net", artOld);
    yandexReport.artPingNewHost = artReport("ai.api.cloud.yandex.net", artNew);
  } catch (e) {
    yandexReport.configError = e instanceof Error ? e.message : String(e);
  }
  report.yandex = yandexReport;

  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}

