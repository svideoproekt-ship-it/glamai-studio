// Тонкий клиент Bot API для исходящих вызовов: отправка счетов, ответ на
// pre_checkout_query, благодарность после оплаты, напоминания, установка
// webhook. В v48 бот только ОТПРАВЛЯЛ запросы к Telegram (sendPhoto) —
// v49 добавляет приём: /api/telegram/webhook ловит pre_checkout_query и
// successful_payment, без этого Stars-оплаты не существует.
//
// Все вызовы НИКОГДА не бросают исключений: платёжная механика не должна
// падать из-за сетевой ошибки. Возвращаем ответ Telegram или null.

const API_TIMEOUT_MS = 15_000;

export interface TgApiResult<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
}

export function getBotToken(): string {
  return process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
}

/** Вызов метода Bot API. Не бросает: возвращает { ok: false } при любой ошибке. */
export async function tgCall<T = unknown>(
  method: string,
  payload: Record<string, unknown>
): Promise<TgApiResult<T>> {
  const token = getBotToken();
  if (!token) return { ok: false, description: "TELEGRAM_BOT_TOKEN не задан" };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    const data = (await res.json().catch(() => null)) as TgApiResult<T> | null;
    if (!data) return { ok: false, description: `HTTP ${res.status}` };
    return data;
  } catch (err) {
    return { ok: false, description: err instanceof Error ? err.message : "network" };
  }
}

/** Подпись вебхука: Telegram присылает её в заголовке каждого апдейта. */
export function webhookSecret(): string {
  return process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? "";
}

/** Случайный секрет для подсказки владельцу (он кладёт его в Vercel). */
export function suggestWebhookSecret(): string {
  return `glamwh_${randomHex(24)}`;
}

function randomHex(n: number): string {
  let out = "";
  const alphabet = "abcdef0123456789";
  for (let i = 0; i < n; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

// ---------- Типы апдейтов, которые ловит webhook ----------

export interface TgPreCheckoutQuery {
  id: string;
  from: { id: number };
  currency: string;
  total_amount: number;
  invoice_payload: string;
}

export interface TgSuccessfulPayment {
  currency: string;
  total_amount: number;
  invoice_payload: string;
  telegram_payment_charge_id: string;
  provider_payment_charge_id?: string;
}

export interface TgUpdate {
  update_id?: number;
  pre_checkout_query?: TgPreCheckoutQuery;
  message?: {
    chat?: { id: number };
    successful_payment?: TgSuccessfulPayment;
  };
}

/** Разбирает payload нашего счёта: "v49.<pack>.<telegramId>". */
export function parsePackPayload(payload: string): { pack: string; tid: number } | null {
  const parts = payload.split(".");
  if (parts.length !== 3 || parts[0] !== "v49") return null;
  const pack = parts[1];
  const tid = Number(parts[2]);
  if (!pack || !Number.isFinite(tid) || tid <= 0) return null;
  return { pack, tid };
}
