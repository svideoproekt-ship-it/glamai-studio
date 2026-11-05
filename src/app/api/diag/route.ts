/**
 * ВРЕМЕННЫЙ диагностический маршрут v3: /api/diag?diag=1
 *
 * Расшифровка «Посмотреть код» из Playground показала:
 *  - модель переименована: aliceai-image-art-3.0/latest (не yandex-art!);
 *  - эндпоинт OpenAI-совместимый, СИНХРОННЫЙ:
 *      POST https://ai.api.cloud.yandex.net/v1/images/generations
 *      Authorization: Bearer <api-key>, заголовок OpenAI-Project: <folder>
 *      тело: { model: "art://<folder>/aliceai-image-art-3.0/latest",
 *              prompt: "...", size: "1024x1024" }
 *      ответ сразу: { data: [ { b64_json: "..." } ] }
 *
 * Проверяем две связки (параллельно):
 *  - artOurFolder:  наш каталог (b1g10…)
 *  - artSampleFolder: каталог из код-примера Playground (b1g8kmq3tbqf838vfus3)
 * Если обе вернут 401 — дополнительно пробуем заголовок Api-Key вместо Bearer.
 *
 * Успех = status 200 (картинка реально сгенерировалась, ~1–2 ₽).
 * Без параметра ?diag=1 ничего не проверяет. После починки файл удалить.
 */

import { NextResponse } from "next/server";
import { ensureYandexConfig, yandexText } from "@/lib/yandex-ai";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const AI_BASE = "https://ai.api.cloud.yandex.net/v1/images/generations";
const MODEL = "aliceai-image-art-3.0/latest";
const SAMPLE_FOLDER = "b1g8kmq3tbqf838vfus3";

type ArtResult = { status: number; raw: string };

/** Синхронный запрос картинки через OpenAI-совместимый эндпоинт. */
async function artOnce(
  apiKey: string,
  folder: string,
  auth: "bearer" | "apikey"
): Promise<ArtResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 50_000);
  try {
    const res = await fetch(AI_BASE, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth === "bearer"
          ? { Authorization: `Bearer ${apiKey}` }
          : { Authorization: `Api-Key ${apiKey}` }),
        "OpenAI-Project": folder,
      },
      body: JSON.stringify({
        model: `art://${folder}/${MODEL}`,
        prompt: "маленький красный квадрат на белом фоне",
        size: "1024x1024",
      }),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    return { status: res.status, raw: raw.slice(0, 300) };
  } catch (e) {
    return { status: 0, raw: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Упаковка результата в отчёт. */
function artReport(tag: string, folder: string, r: ArtResult) {
  if (r.status === 200) {
    return {
      ok: true,
      folder,
      status: 200,
      rawStart: r.raw,
      note: `${tag}: ЭНДПОИНТ ПРИНЯЛ И НАРИСОВАЛ — вот рабочий рецепт YandexART (~1–2 ₽).`,
    };
  }
  return {
    ok: false,
    folder,
    status: r.status,
    raw: r.raw,
    note: `${tag}: дословный ответ эндпоинта.`,
  };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("diag") !== "1") {
    return NextResponse.json({
      hint: "Временный диагностический маршрут v3. Добавьте ?diag=1 к адресу.",
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

    // 1) Текст — контроль, тем же ключом
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

    // 2) Новый синхронный эндпоинт: наш каталог и каталог из примера
    const [own, sample] = await Promise.all([
      artOnce(cfg.apiKey, cfg.folderId, "bearer"),
      artOnce(cfg.apiKey, SAMPLE_FOLDER, "bearer"),
    ]);
    yandexReport.artOurFolder = artReport("Наш каталог", cfg.folderId, own);
    yandexReport.artSampleFolder = artReport("Каталог из примера", SAMPLE_FOLDER, sample);

    // 3) Если обе попытки упёрлись в аутентификацию — пробуем Api-Key-заголовок
    if (own.status === 401 && sample.status === 401) {
      const fallback = await artOnce(cfg.apiKey, cfg.folderId, "apikey");
      yandexReport.artApiKeyAuth = {
        ...artReport("Наш каталог, Api-Key-заголовок", cfg.folderId, fallback),
        note:
          "Проверка заголовка Api-Key вместо Bearer (если Bearer не принят).",
      };
    }
  } catch (e) {
    yandexReport.configError = e instanceof Error ? e.message : String(e);
  }
  report.yandex = yandexReport;

  return NextResponse.json(report, { headers: { "Cache-Control": "no-store" } });
}

