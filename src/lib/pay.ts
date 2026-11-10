// Реквизиты для ручной оплаты переводом. Владелец задаёт их ОДИН раз на Vercel
// (Settings → Environment Variables → PAYMENT_* → Redeploy), после этого клиент
// видит их прямо в paywall: банк, номер карты и имя получателя.
//
// ВАЖНО: это ПУБЛИЧНЫЕ данные — их показывают всем клиентам, секретов здесь
// нет. Секретные ключи (TELEGRAM_BOT_TOKEN, AUTH_SECRET, PROXY_API_KEY и т.п.)
// через paywall никогда не передаются.

export interface PayInfo {
  /** Банк получателя, напр. «Сбер» */
  bank: string;
  /** Номер телефона для перевода по СБП (самый простой путь для клиента) */
  phone: string;
  /** Номер карты получателя, напр. «2200 7007 1234 5678» */
  card: string;
  /** Имя получателя на карте, напр. «Иван И.» */
  holder: string;
  /** Ссылка «Перевести по ссылке» из банка (СБП) — если получится создать */
  link: string;
  /** Ссылка на профиль владельца в мессенджере MAX (max.ru) — необязательно */
  maxLink: string;
}

export function getPayInfo(): PayInfo {
  return {
    bank: process.env.PAYMENT_BANK?.trim() ?? "",
    phone: process.env.PAYMENT_PHONE?.trim() ?? "",
    card: process.env.PAYMENT_CARD_NUMBER?.trim() ?? "",
    holder: process.env.PAYMENT_CARD_OWNER?.trim() ?? "",
    link: process.env.PAYMENT_LINK?.trim() ?? "",
    maxLink: process.env.OWNER_MAX_LINK?.trim() ?? "",
  };
}

/** Есть хоть один способ оплаты → клиенту можно показать реквизиты. */
export function payInfoComplete(p: PayInfo): boolean {
  return p.phone.length > 0 || p.card.length > 0;
}

/** Что закодировать в QR-код оплаты: сначала ссылка банка (лучший опыт —
 *  банк открывается сразу с переводом), если её нет — телефон СБП
 *  (камера покажет номер, клиент вставит его в своём банке). */
export function payQrPayload(p: PayInfo): string {
  return p.link || p.phone || "";
}
