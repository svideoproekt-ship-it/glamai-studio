// v49: Webhook Telegram — входящая точка платежей Telegram Stars.
//
// Как работает Stars-оплата в боте:
//  1. Мини-приложение просит /api/pay/stars создать счёт → сервер вызывает
//     Bot API createInvoiceLink (валюта XTR) → клиенту возвращается ссылка.
//  2. Клиент открывает счёт через WebApp.openInvoice и платит Звёздами.
//  3. Telegram присылает сюда pre_checkout_query — на него НУЖНО ответить
//     answerPreCheckoutQuery (ok=true) в течение 10 секунд, иначе оплата
//     отменится на стороне клиента.
//  4. После оплаты Telegram присылает message.successful_payment — здесь
//     зачисляем генерации на баланс (идемпотентно по charge_id) и говорим
//     «спасибо» в личку.
//
// Безопасность: Telegram подписывает каждый апдейт заголовком
// X-Telegram-Bot-Api-Secret-Token, заданным при setWebhook. Сверяем его с
// TELEGRAM_WEBHOOK_SECRET. Чужой запрос не сможет подсунуть фейковую оплату.
// Настройка — кнопка в /admin (экшен webhook_setup), она вызовет setWebhook
// с адресом этого роута.

import { NextRequest, NextResponse } from "next/server";
import { creditPaidGenerations, getUser, rowAllowance } from "@/lib/store";
import { packById } from "@/lib/tariffs";
import { thanksText, langFromCode, packTitle, t } from "@/lib/i18n";
import {
  parsePackPayload,
  tgCall,
  webhookSecret,
  type TgUpdate,
} from "@/lib/telegram";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  // Подпись Telegram: обязательна, если секрет задан в переменных окружения.
  const secret = webhookSecret();
  if (secret && req.headers.get("x-telegram-bot-api-secret-token") !== secret) {
    return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const update = (await req.json().catch(() => null)) as TgUpdate | null;
  if (!update) return NextResponse.json({ ok: true });

  try {
    // Шаг 3: подтвердить счёт. Payload формата v49.<pack>.<telegramId>.
    if (update.pre_checkout_query) {
      const q = update.pre_checkout_query;
      const parsed = parsePackPayload(q.invoice_payload ?? "");
      const valid =
        parsed !== null &&
        q.currency === "XTR" &&
        q.total_amount > 0 &&
        parsed.tid === q.from?.id;
      // Текст отказа — на языке клиента (если он уже есть в базе).
      let errorMessage: string | undefined;
      if (!valid) {
        const lang = langFromCode((await getUser(q.from?.id ?? 0).catch(() => null))?.languageCode);
        errorMessage = t(lang, "pw.sessionNote");
      }
      await tgCall("answerPreCheckoutQuery", {
        pre_checkout_query_id: q.id,
        ok: valid,
        error_message: valid ? undefined : errorMessage,
      });
      return NextResponse.json({ ok: true });
    }

    // Шаг 4: оплата прошла — зачисляем генерации.
    const sp = update.message?.successful_payment;
    if (sp && update.message?.chat?.id) {
      const tid = update.message.chat.id;
      const parsed = parsePackPayload(sp.invoice_payload ?? "");
      const pack = parsed ? packById(parsed.pack) : null;
      const chargeId = String(sp.telegram_payment_charge_id ?? "").slice(0, 128);
      if (!parsed || !pack || sp.currency !== "XTR") {
        // Неизвестный payload — платеж всё равно фиксируем (без зачисления),
        // чтобы сумму можно было вручную зачесть из админки.
        console.error("[webhook] неизвестный payload:", sp.invoice_payload, chargeId);
        await creditPaidGenerations({
          telegramId: tid,
          pack: "unknown",
          generations: 0,
          stars: Number(sp.total_amount ?? 0),
          rub: 0,
          chargeId: chargeId || `unknown-${Date.now()}`,
        });
        return NextResponse.json({ ok: true });
      }
      const credited = await creditPaidGenerations({
        telegramId: tid,
        pack: pack.id,
        generations: pack.generations,
        stars: Number(sp.total_amount ?? pack.stars),
        rub: pack.rub,
        chargeId,
      });
      // Благодарность с новым остатком — на языке клиента (glam_users.language_code).
      // Отправляем только при первом зачислении, чтобы при ретрае вебхука
      // не приходило дублирующее сообщение.
      if (credited) {
        const user = await getUser(tid);
        const allowance = user ? rowAllowance(user) : null;
        const name = user?.firstName ?? "мастер";
        const remaining = allowance ? allowance.remaining : pack.generations;
        const lang = langFromCode(user?.languageCode);
        await tgCall("sendMessage", {
          chat_id: tid,
          text: thanksText(lang, {
            name,
            pack: packTitle(lang, pack.id),
            n: pack.generations,
            rest: remaining,
          }),
        });
      }
      return NextResponse.json({ ok: true });
    }
  } catch (err) {
    // БД упала — Telegram перезапустит доставку апдейта сам (нужен не-200).
    console.error("[webhook] ошибка обработки:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
