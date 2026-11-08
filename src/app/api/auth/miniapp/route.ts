// Вход через Telegram Mini App: страница, открытая кнопкой бота «Открыть студию»,
// отправляет подписанные initData, сервер проверяет подпись ботом и выдаёт
// сессионную cookie. Личность подтверждает сам клиент Telegram — коды, SMS и
// oauth-подтверждения не нужны, вход происходит одним нажатием кнопки.

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_SEC, signSession, verifyMiniAppInitData } from "@/lib/auth";
import { upsertUser } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const secret = process.env.AUTH_SECRET?.trim();

  if (!botToken || !secret) {
    console.error("[auth/miniapp] не заданы TELEGRAM_BOT_TOKEN или AUTH_SECRET");
    return NextResponse.json(
      {
        ok: false,
        error: "config",
        message:
          "Вход не настроен на сервере: не заданы TELEGRAM_BOT_TOKEN или AUTH_SECRET. Инструкция — в README-DEPLOY-RU.md.",
      },
      { status: 500 }
    );
  }

  let initData = "";
  try {
    const body = (await req.json()) as { initData?: unknown };
    if (typeof body?.initData === "string") initData = body.initData;
  } catch {
    return NextResponse.json(
      { ok: false, error: "bad_request", message: "Неверный формат запроса." },
      { status: 400 }
    );
  }

  if (!initData) {
    return NextResponse.json(
      {
        ok: false,
        error: "no_init_data",
        message: "Открыто вне Telegram: входите через кнопку бота «Открыть студию».",
      },
      { status: 400 }
    );
  }

  const data = verifyMiniAppInitData(initData, botToken);
  if (!data) {
    console.warn("[auth/miniapp] подпись initData не прошла — отклоняем");
    return NextResponse.json(
      {
        ok: false,
        error: "bad_signature",
        message: "Telegram не подтвердил вход. Закрой студию и открой её через кнопку бота ещё раз.",
      },
      { status: 401 }
    );
  }

  try {
    await upsertUser({ id: data.id, username: data.username, firstName: data.firstName });
  } catch (err) {
    console.error("[auth/miniapp] ошибка БД:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      {
        ok: false,
        error: "db",
        message: "База подписок недоступна. Если вы только что задали DATABASE_URL — сделайте Redeploy.",
      },
      { status: 503 }
    );
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, signSession(data.id, secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
  return res;
}
