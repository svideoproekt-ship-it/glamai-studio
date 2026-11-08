// Реквизиты для ручной оплаты переводом. Владелец задаёт их ОДИН раз на Vercel
// (Settings → Environment Variables → PAYMENT_* → Redeploy), после этого клиент
// видит их прямо в paywall: банк, номер карты и имя получателя.
//
// ВАЖНО: это ПУБЛИЧНЫЕ данные — их показывают всем клиентам, секретов здесь
// нет. Секретные ключи (TELEGRAM_BOT_TOKEN, AUTH_SECRET, PROXY_API_KEY и т.п.)
// через paywall никогда не передаются.

export interface PayInfo {
  /** Банк получателя, напр. «Т-Банк» */
  bank: string;
  /** Номер карты получателя, напр. «2200 7007 1234 5678» */
  card: string;
  /** Имя получателя на карте, напр. «Иван И.» */
  holder: string;
}

export function getPayInfo(): PayInfo {
  return {
    bank: process.env.PAYMENT_BANK?.trim() ?? "",
    card: process.env.PAYMENT_CARD_NUMBER?.trim() ?? "",
    holder: process.env.PAYMENT_CARD_OWNER?.trim() ?? "",
  };
}

/** Все три поля заданы → клиенту можно показать готовые реквизиты. */
export function payInfoComplete(p: PayInfo): boolean {
  return p.bank.length > 0 && p.card.length > 0 && p.holder.length > 0;
}
