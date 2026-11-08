// Профиль для UI: вошёл ли мастер, сколько генераций осталось, какой тариф.
// Отдаёт также имя бота (для виджета входа) и Telegram владельца для оплаты.

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getUser, rowAllowance } from "@/lib/store";
import { APP_VERSION } from "@/lib/version";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const botUsername = process.env.TELEGRAM_BOT_USERNAME?.trim() ?? "";
  const ownerTg = process.env.OWNER_TG_USERNAME?.trim() ?? "";

  const secret = process.env.AUTH_SECRET;
  const tid = verifySession(req.cookies.get(SESSION_COOKIE)?.value, secret ?? "");
  if (tid === null) {
    return NextResponse.json({ authed: false, botUsername, ownerTg, version: APP_VERSION });
  }

  try {
    const user = await getUser(tid);
    if (!user) {
      return NextResponse.json({ authed: false, botUsername, ownerTg, version: APP_VERSION });
    }
    const allowance = rowAllowance(user);
    return NextResponse.json({
      authed: true,
      botUsername,
      ownerTg,
      dbConfigured: true,
      profile: {
        name: user.firstName || user.username || "Мастер",
        username: user.username,
        plan: user.plan,
        planLabel: allowance.planLabel,
        subscriptionActive: allowance.subscriptionActive,
        subscriptionUntil: user.subscriptionUntil ? user.subscriptionUntil.toISOString() : null,
        mode: allowance.mode,
        remaining: allowance.remaining,
        total: allowance.total,
      },
    });
  } catch (err) {
    // База недоступна/не настроена — считаем неавторизованным, но подскажем в ответе
    console.error("[auth/me] ошибка БД:", err instanceof Error ? err.message : err);
    return NextResponse.json({
      authed: false,
      botUsername,
      ownerTg,
      dbError: true,
      dbHint:
        "База подписок не отвечает: проверьте DATABASE_URL (Neon) в Settings → Environment Variables и сделайте Redeploy.",
    });
  }
}
