// Приёмник Telegram Login Widget: виджет перебрасывает сюда браузер с
// подписанными данными пользователя (?id=...&hash=...). Проверяем подпись,
// заводим/обновляем пользователя и ставим сессионную cookie.

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, SESSION_TTL_SEC, signSession, verifyTelegramAuth } from "@/lib/auth";
import { upsertUser } from "@/lib/store";

export const runtime = "nodejs";

function redirectTo(req: NextRequest, path: string): NextResponse {
  return NextResponse.redirect(new URL(path, req.url), 303);
}

export async function GET(req: NextRequest) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const secret = process.env.AUTH_SECRET?.trim();

  if (!botToken || !secret) {
    console.error("[auth/telegram] не заданы TELEGRAM_BOT_TOKEN или AUTH_SECRET");
    return redirectTo(req, "/?auth_error=config");
  }

  const params: Record<string, string> = {};
  req.nextUrl.searchParams.forEach((v, k) => {
    params[k] = v;
  });

  const data = verifyTelegramAuth(params, botToken);
  if (!data) {
    console.warn("[auth/telegram] подпись не прошла — отклоняем");
    return redirectTo(req, "/?auth_error=telegram");
  }

  try {
    await upsertUser({
      id: data.id,
      username: data.username,
      firstName: data.firstName,
    });
  } catch (err) {
    console.error("[auth/telegram] ошибка БД:", err instanceof Error ? err.message : err);
    return redirectTo(req, "/?auth_error=db");
  }

  const res = redirectTo(req, "/");
  res.cookies.set(SESSION_COOKIE, signSession(data.id, secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SEC,
  });
  return res;
}
