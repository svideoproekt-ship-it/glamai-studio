import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { ensureZaiConfig, findZaiConfig } from "@/lib/zai-config";
import { getAiProvider, providerLabel } from "@/lib/ai-provider";
import { ensureYandexConfig, yandexText } from "@/lib/yandex-ai";

export const dynamic = "force-dynamic";

/**
 * Экспресс-диагностика приложения (оба движка).
 *
 * GET /api/health        — проверка конфигурации (без обращений к ИИ).
 * GET /api/health?ping=1 — дополнительно делает минимальный запрос к активному
 *                          движку, чтобы проверить, что ключ принят (1–5 с).
 *
 * Активный движок выбирается так же, как в генерации:
 *   AI_PROVIDER=yandex|zai, иначе Яндекс при заданных YC_API_KEY + YC_FOLDER_ID,
 *   иначе Z.AI.
 *
 * Никаких секретов не возвращает: ключи маскируются, фото не принимает.
 */
export async function GET(req: NextRequest) {
  const wantsPing = req.nextUrl.searchParams.get("ping") === "1";
  const provider = getAiProvider();

  // ---------- Переменные Z.AI ----------
  const envKeySet = Boolean(process.env.ZAI_API_KEY);
  const envUrlSet = Boolean(process.env.ZAI_BASE_URL);
  // Частая ошибка: в .env остался текст-заполнитель из .env.example вместо ключа
  const isPlaceholderKey =
    envKeySet && /вставьте|placeholder|your[_-]?key|пример/i.test(String(process.env.ZAI_API_KEY));
  // Частая ошибка при вставке: ключ разорван переносом строки или содержит пробелы
  const keyHasWhitespace = envKeySet && /\s/.test(String(process.env.ZAI_API_KEY));

  // ---------- Переменные Яндекса ----------
  const yKeySet = Boolean(process.env.YC_API_KEY?.trim());
  const yFolderSet = Boolean(process.env.YC_FOLDER_ID?.trim());
  const yPlaceholder =
    yKeySet && /вставьте|placeholder|your[_-]?key|пример/i.test(String(process.env.YC_API_KEY));
  const yKeyWhitespace = yKeySet && /\s/.test(String(process.env.YC_API_KEY));

  ensureZaiConfig();
  const cfg = findZaiConfig();

  // Режим API: у публичного api.z.ai нет правки фото (/images/generations/edit) —
  // приложение само переключится на портретный режим; у Яндекса правки нет вообще.
  const baseUrl = String(process.env.ZAI_BASE_URL ?? "");
  const isPublicApi = /api\.z\.ai|bigmodel/i.test(baseUrl);

  const zaiChecks: Array<{ name: string; ok: boolean; hint: string }> = [
    {
      name: "Переменные окружения (ZAI_API_KEY, ZAI_BASE_URL)",
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

  const yandexCheck = {
    name: "Переменные Яндекса (YC_API_KEY, YC_FOLDER_ID)",
    ok: (yKeySet && yFolderSet && !yPlaceholder) || provider === "zai",
    hint: yPlaceholder
      ? "В YC_API_KEY остался текст-заполнитель из .env.example — впишите настоящий API-ключ сервисного аккаунта (вид AQVN…)."
      : yKeySet && yFolderSet
      ? yKeyWhitespace
        ? "Заданы, но в YC_API_KEY есть пробел или перенос строки — пересохраните ключ одной строкой и сделайте Redeploy."
        : "ОК"
      : provider === "yandex"
      ? `Активен движок Яндекс (AI_PROVIDER=yandex), но ${!yKeySet ? "YC_API_KEY" : "YC_FOLDER_ID"} не задан. Добавьте переменную в Vercel и сделайте Redeploy.`
      : "Не заданы — движок Яндекс не используется, приложение работает через Z.AI. Чтобы включить Яндекс, задайте YC_API_KEY и YC_FOLDER_ID.",
  };

  const checks = [...zaiChecks, yandexCheck];

  // ---------- Пинг активного движка ----------
  let aiPing: { ok: boolean; detail: string } | null = null;
  let ycPing: { ok: boolean; detail: string } | null = null;

  if (wantsPing && provider === "yandex" && yKeySet && yFolderSet && !yPlaceholder) {
    try {
      const ycfg = ensureYandexConfig();
      const reply = await yandexText(ycfg, "Ответь одним словом: OK", { maxTokens: 20 });
      ycPing = { ok: true, detail: `YandexGPT отвечает (${reply.slice(0, 30) || "пусто"}). Ключ принят.` };
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      ycPing = {
        ok: false,
        detail: /401/.test(raw)
          ? "Яндекс отверг ключ (401). Проверьте YC_API_KEY — API-ключ сервисного аккаунта, одной строкой (вид AQVN…)."
          : /403/.test(raw)
          ? "Доступ запрещён (403). Сервисному аккаунту нужна роль ai.languageModels.user и активный платёжный аккаунт Yandex Cloud."
          : `Ошибка YandexGPT: ${raw.slice(0, 200)}`,
      };
    }
  } else if (wantsPing && provider === "yandex") {
    ycPing = { ok: false, detail: "Пинг не выполнен: не заданы YC_API_KEY и/или YC_FOLDER_ID." };
  }

  if (wantsPing && cfg.found && (provider === "zai" || ycPing === null)) {
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

  // Итоговый статус смотрим по активному движку:
  //  - Яндекс активен → критичны только YC-переменные и ycPing;
  //  - Z.AI активен → как раньше (ZAI-переменные + aiPing), YC — информационно.
  const activeOk =
    provider === "yandex"
      ? yandexCheck.ok && (!ycPing || ycPing.ok)
      : zaiChecks.every((c) => c.ok) && (!aiPing || aiPing.ok);

  const activeEngineNote =
    provider === "yandex"
      ? "Активен движок Яндекс: YandexGPT понимает фото и текст, YandexART рисует портрет. Оплата в рублях (платёжный аккаунт Yandex Cloud)."
      : "Активен движок Z.AI. Чтобы переключиться на Яндекс (оплата в рублях), задайте YC_API_KEY и YC_FOLDER_ID и сделайте Redeploy.";

  return NextResponse.json(
    {
      status: activeOk ? "ok" : "config-error",
      app: "GlamAI Studio",
      provider: providerLabel(provider),
      node: process.version,
      platform: process.platform,
      env: {
        ZAI_API_KEY: envKeySet ? `задан (${String(process.env.ZAI_API_KEY).slice(0, 4)}…)` : "не задан",
        ZAI_BASE_URL: envUrlSet ? process.env.ZAI_BASE_URL : "не задан",
        YC_API_KEY: yKeySet ? `задан (${String(process.env.YC_API_KEY).trim().slice(0, 4)}…)` : "не задан",
        YC_FOLDER_ID: yFolderSet ? "задан" : "не задан",
      },
      checks,
      imageMode:
        provider === "yandex"
          ? {
              mode: "portrait",
              note: "У Яндекса нет правки фотографии — приложение создаёт образ как фотореалистичный портрет по описанию внешности с вашего фото (YandexGPT описывает внешность, YandexART рисует с макияжем). Лицо может немного отличаться от оригинала."
            }
          : isPublicApi
          ? {
              mode: "public",
              note: "Публичный API Z.AI не поддерживает правку фотографии. Приложение создаст образ как фотореалистичный портрет по описанию внешности с вашего фото — лицо может немного отличаться от оригинала."
            }
          : {
              mode: "custom",
              note: "Нестандартный ZAI_BASE_URL: приложение попытается править фото напрямую (с сохранением лица), при недоступности — перейдёт в портретный режим."
            },
      aiPing,
      ycPing,
      advice: activeOk
        ? "Всё настроено — генерация должна работать. Если она всё же падает, пришлите текст ошибки из приложения."
        : wantsPing
          ? "Откройте подсказки в поле checks и исправьте конфигурацию, затем обновите страницу."
          : "Проверьте подсказки в поле checks. После исправления откройте /api/health?ping=1 — он проверит и сам ключ активного движка.",
      engineNote: activeEngineNote,
    },
    { status: activeOk ? 200 : 503 }
  );
}
