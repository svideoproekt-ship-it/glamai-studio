// Админ-API для ручных продаж: вход по паролю, список пользователей,
// выдача/продление подписки, сброс триала.
//
// Сценарий: мастер платит переводом → владелец открывает /admin →
// «Выдать подписку» по @username или telegram id. ЮKassa подключим позже.

import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, signAdmin, verifyAdmin } from "@/lib/auth";
import { adminStats, grantPlan, listUsers, resetTrial, revokeSubscription } from "@/lib/store";

export const runtime = "nodejs";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 12 * 3600,
};

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "Требуется вход в админ-панель." }, { status: 401 });
}

export async function GET(req: NextRequest) {
  if (!verifyAdmin(req.cookies.get(ADMIN_COOKIE)?.value, process.env.ADMIN_SECRET ?? "")) {
    return unauthorized();
  }
  try {
    const [users, stats] = await Promise.all([listUsers(200), adminStats()]);
    return NextResponse.json({ ok: true, users, stats });
  } catch (err) {
    console.error("[admin] ошибка БД:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { ok: false, error: "База недоступна: проверьте DATABASE_URL и сделайте Redeploy." },
      { status: 503 }
    );
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    secret?: string;
    user?: string;
    plan?: string;
    days?: number;
  };
  const adminSecret = process.env.ADMIN_SECRET?.trim() ?? "";

  // Вход по паролю → подписанная админ-cookie
  if (body.action === "login") {
    if (!adminSecret || body.secret?.trim() !== adminSecret) {
      return NextResponse.json({ ok: false, error: "Неверный пароль." }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_COOKIE, signAdmin(adminSecret), COOKIE_OPTS);
    return res;
  }

  if (!verifyAdmin(req.cookies.get(ADMIN_COOKIE)?.value, adminSecret)) {
    return unauthorized();
  }

  try {
    if (body.action === "grant") {
      const plan = body.plan === "salon" ? "salon" : "start";
      const grant = await grantPlan(body.user ?? "", plan, Number(body.days) || 30);
      if (grant === null) {
        return NextResponse.json(
          { ok: false, error: "Пользователь не найден. Он должен хотя бы раз войти на сайт." },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true, id: grant.id, untilIso: grant.untilIso });
    }
    if (body.action === "revoke") {
      const id = await revokeSubscription(body.user ?? "");
      if (id === null) {
        return NextResponse.json({ ok: false, error: "Пользователь не найден." }, { status: 404 });
      }
      return NextResponse.json({ ok: true, id });
    }
    if (body.action === "reset_trial") {
      const id = await resetTrial(body.user ?? "");
      if (id === null) {
        return NextResponse.json({ ok: false, error: "Пользователь не найден." }, { status: 404 });
      }
      return NextResponse.json({ ok: true, id });
    }
    return NextResponse.json({ ok: false, error: "Неизвестное действие." }, { status: 400 });
  } catch (err) {
    console.error("[admin] ошибка:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Операция не удалась, попробуйте ещё раз." }, { status: 500 });
  }
}
