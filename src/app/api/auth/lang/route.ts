// v49: сохранение ВЫБРАННОГО языка интерфейса (кнопки RU/EN/DE/FR).
// Приходит только из мини-приложения, где личность подтверждена подписанными
// initData — поэтому пишем в базу по сессии. Клиент из обычного браузера
// получит 401: его выбор живёт в localStorage, на серверные сообщения он
// всё равно не влияет (у него нет Telegram-лички).

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { setUserLanguage } from "@/lib/store";
import { isLang } from "@/lib/i18n";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const tid = verifySession(req.cookies.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET ?? "");
  if (tid === null) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { lang?: unknown };
  const lang = typeof body.lang === "string" ? body.lang : "";
  if (!isLang(lang)) {
    return NextResponse.json({ ok: false, error: "bad_lang" }, { status: 400 });
  }

  try {
    await setUserLanguage(tid, lang);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[auth/lang] ошибка БД:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "db" }, { status: 503 });
  }
}
