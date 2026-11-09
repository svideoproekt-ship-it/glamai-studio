// Заявка на подписку: клиент нажал «Выбрать тариф» в paywall — его данные
// улетают в /admin, владельцу не нужно перепечатывать ID из сообщения.
//
// Безопасность: ID, @username и имя берём ИЗ ПОДПИСАННОЙ СЕССИИ, а не из
// тела запроса — подделать заявку от чужого имени нельзя. Ошибку наружу
// не отдаём: заявка — вспомогательная механика, чат с владельцем откроется
// в любом случае.

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { createPayRequest, getUser } from "@/lib/store";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const tid = verifySession(req.cookies.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET ?? "");
  if (tid === null) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { plan?: string };
  const plan = body.plan === "salon" ? "salon" : "start";

  try {
    const user = await getUser(tid);
    if (!user) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    await createPayRequest(
      { telegramId: user.telegramId, username: user.username, firstName: user.firstName },
      plan
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[pay-request] ошибка БД:", err instanceof Error ? err.message : err);
    // Не ломаем клиентский сценарий: чат откроется, заявку владелец внесёт руками
    return NextResponse.json({ ok: false });
  }
}
