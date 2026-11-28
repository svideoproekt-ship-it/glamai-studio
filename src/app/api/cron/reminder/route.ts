// v49: Напоминание «замершим» — тем, у кого ещё есть генерации (бесплатная,
// примерки студии или купленный баланс), но кто не заходил несколько дней.
// По нашей же воронке люди теряются после первой примерки — это письмо
// возвращает их в студию. Одному пользователю напоминание уходит один раз
// (reminder_sent_at), спама не будет.
//
// Запуск: Vercel Cron раз в день (vercel.json → crons). Vercel сам
// подставляет заголовок Authorization: Bearer <CRON_SECRET>, если
// переменная CRON_SECRET задана — роут её проверяет.

import { NextRequest, NextResponse } from "next/server";
import { listSleepers, markReminded } from "@/lib/store";
import { remindText, langFromCode } from "@/lib/i18n";
import { getBotToken, tgCall } from "@/lib/telegram";

export const runtime = "nodejs";

const IDLE_DAYS = Math.max(2, Number(process.env.REMINDER_IDLE_DAYS ?? 3) || 3);
const BATCH = 50;

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET?.trim() ?? "";
  if (cronSecret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
  }
  if (!getBotToken()) {
    return NextResponse.json({ ok: false, error: "TELEGRAM_BOT_TOKEN не задан" }, { status: 500 });
  }

  const sleepers = await listSleepers(IDLE_DAYS, BATCH).catch(() => []);
  let sent = 0;
  const reminded: number[] = [];

  for (const s of sleepers) {
    const name = s.firstName?.slice(0, 40) || "мастер";
    // Напоминание — на языке приложения Telegram этого человека.
    const text = remindText(langFromCode(s.languageCode), { name, n: s.remaining });
    const res = await tgCall("sendMessage", {
      chat_id: s.telegramId,
      text,
    });
    if (res.ok) {
      sent += 1;
      reminded.push(s.telegramId);
    }
  }

  await markReminded(reminded);
  return NextResponse.json({ ok: true, candidates: sleepers.length, sent });
}
