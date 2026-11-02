import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { ensureZaiConfig, findZaiConfig } from "@/lib/zai-config";

export const dynamic = "force-dynamic";

/**
 * Экспресс-диагностика приложения.
 *
 * GET /api/health        — проверка конфигурации (без обращений к ИИ).
 * GET /api/health?ping=1 — дополнительно делает минимальный запрос к ИИ,
 *                          чтобы проверить, что ключ принят (может занять 1–3 с).
 *
 * Никаких секретов не возвращает: ключ маскируется, фото не принимает.
 */
export async function GET(req: NextRequest) {
  const wantsPing = req.nextUrl.searchParams.get("ping") === "1";

  const envKeySet = Boolean(process.env.ZAI_API_KEY);
  const envUrlSet = Boolean(process.env.ZAI_BASE_URL);
  // Частая ошибка: в .env остался текст-заполнитель из .env.example вместо ключа
  const isPlaceholderKey =
    envKeySet && /вставьте|placeholder|your[_-]?key|пример/i.test(String(process.env.ZAI_API_KEY));
  // Частая ошибка при вставке: ключ разорван переносом строки или содержит пробелы
  const keyHasWhitespace = envKeySet && /\s/.test(String(process.env.ZAI_API_KEY));

  // Как это сделает SDK: ensureZaiConfig() пишет конфиг из env, если нужно.
  ensureZaiConfig();
  const cfg = findZaiConfig();

  // Режим API: у публичного api.z.ai нет правки фото (/images/generations/edit) —
  // приложение само переключится на портретный режим; сообщаем об этом заранее.
  const baseUrl = String(process.env.ZAI_BASE_URL ?? "");
  const isPublicApi = /api\.z\.ai|bigmodel/i.test(baseUrl);

  const checks: Array<{ name: string; ok: boolean; hint: string }> = [
    {
      name: "Переменные окружения (ZAI_API_KEY, ZAI_BASE_URL)",
      // Переменные — источник конфига; если конфиг уже есть, их отсутствие не мешает работе
      ok: ((envKeySet && envUrlSet) || cfg.found) && !isPlaceholderKey,
      hint: isPlaceholderKey
        ? "В ZAI_API_KEY остался текст-заполнитель из .env.example. Впишите настоящий ключ из кабинета Z.AI и перезапустите сервер (на Vercel — обновите переменную и сделайте Redeploy)."
        : envKeySet && envUrlSet
        ? keyHasWhitespace
          ? "Заданы, но в ZAI_API_KEY есть пробел или перенос строки — при вставке ключ разорвался на части. Пересохраните его одной строкой (формат ID.секрет, без пробелов) и сделайте Redeploy."
          : "ОК"
        : cfg.found
          ? `Не заданы, но конфиг уже найден (${cfg.path}) — ИИ доступен. Для Vercel переменные всё равно нужны.`
          : !envKeySet && !envUrlSet
            ? "Не заданы. Локально: создайте .env по образцу .env.example и перезапустите сервер. На Vercel: Settings → Environment Variables, затем Redeploy."
            : !envKeySet
              ? "Не задан ZAI_API_KEY."
              : "Не задан ZAI_BASE_URL (должен быть https://api.z.ai/api/paas/v4).",
    },
    {
      name: "Файл конфига SDK (.z-ai-config)",
      ok: cfg.found,
      hint: cfg.found
        ? `Найден: ${cfg.path}`
        : "Не найден ни в папке проекта, ни в домашней папке. Приложение не сможет обратиться к ИИ.",
    },
  ];

  let aiPing: { ok: boolean; detail: string } | null = null;
  if (wantsPing && cfg.found) {
    try {
      const zai = await ZAI.create();
      const res = (await zai.chat.completions.create({
        messages: [{ role: "user", content: "Reply with the single word: OK" }],
        thinking: { type: "disabled" },
      })) as { choices?: Array<{ message?: { content?: string } }> };
      const reply = res?.choices?.[0]?.message?.content?.trim() ?? "";
      aiPing = {
        ok: true,
        detail: `ИИ отвечает (${(reply || "пусто").slice(0, 30)}). Ключ принят.`,
      };
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      aiPing = {
        ok: false,
        detail: /429|too many|rate limit/i.test(raw)
          ? "Ключ принят, но сработал лимит запросов (429). Подождите 1–2 минуты."
          : /invalid header value|newline/i.test(raw)
            ? "В ключе ZAI_API_KEY есть перенос строки или недопустимый символ — обычно ключ разрывается на две строки при вставке. Пересохраните его одной строкой (формат ID.секрет, без пробелов) и сделайте Redeploy."
            : /401|403|unauthorized|api key/i.test(raw)
            ? "ИИ отверг ключ (401/403). Проверьте ZAI_API_KEY и баланс аккаунта Z.AI."
            : `Ошибка обращения к ИИ: ${raw.slice(0, 160)}`,
      };
    }
  }

  const ok = checks.every((c) => c.ok) && (!aiPing || aiPing.ok);

  return NextResponse.json(
    {
      status: ok ? "ok" : "config-error",
      app: "GlamAI Studio",
      node: process.version,
      platform: process.platform,
      env: {
        ZAI_API_KEY: envKeySet ? `задан (${String(process.env.ZAI_API_KEY).slice(0, 4)}…)` : "не задан",
        ZAI_BASE_URL: envUrlSet ? process.env.ZAI_BASE_URL : "не задан",
      },
      checks,
      imageMode: isPublicApi
        ? {
            mode: "public",
            note: "Публичный API Z.AI не поддерживает правку фотографии. Приложение создаст образ как фотореалистичный портрет по описанию внешности с вашего фото — лицо может немного отличаться от оригинала."
          }
        : {
            mode: "custom",
            note: "Нестандартный ZAI_BASE_URL: приложение попытается править фото напрямую (с сохранением лица), при недоступности — перейдёт в портретный режим."
          },
      aiPing,
      advice: ok
        ? isPublicApi
          ? "Всё настроено — генерация работает в портретном режиме (см. imageMode). Если она всё же падает, пришлите текст ошибки из приложения."
          : "Всё настроено — генерация должна работать. Если она всё же падает, пришлите текст ошибки из приложения."
        : wantsPing
          ? "Откройте подсказки в поле checks и исправьте конфигурацию, затем обновите страницу."
          : "Проверьте подсказки в поле checks. После исправления откройте /api/health?ping=1 — он проверит и сам ключ.",
    },
    { status: ok ? 200 : 503 }
  );
}
