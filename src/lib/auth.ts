// Авторизация через Telegram Login Widget + собственные подписанные cookie.
//
// Как это работает:
//  1. На экране входа рендерится официальный виджет Telegram (telegram-widget.js),
//     который после подтверждения перебрасывает браузер на
//     /api/auth/telegram?id=...&first_name=...&hash=... (data-auth-url).
//  2. Сервер проверяет подпись hash: HMAC-SHA256 от data_check_string ключом
//     SHA256(bot_token) — ровно так, как требует документация Telegram.
//     Это гарантирует, что данные пришли от Telegram, а не подделаны.
//  3. Мы выдаём свою сессию: cookie glam_session = "v1.<tg_id>.<exp>.<hmac>".
//     Подпись — HMAC-SHA256 с AUTH_SECRET. Telegram-данные повторно не спрашиваем.

import crypto from "node:crypto";

export const SESSION_COOKIE = "glam_session";
export const ADMIN_COOKIE = "glam_admin";
export const SESSION_TTL_SEC = 30 * 24 * 3600; // 30 дней

export interface TelegramAuthData {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  photoUrl?: string;
  authDate: number;
}

/**
 * Проверка подписи данных Telegram Login. Возвращает разобранные данные
 * или null, если подпись не сходится, данные устарели или id некорректен.
 */
export function verifyTelegramAuth(
  params: Record<string, string>,
  botToken: string,
  maxAgeSec = 24 * 3600
): TelegramAuthData | null {
  const hash = params.hash;
  if (!hash) return null;

  // data_check_string: все поля, кроме hash, по алфавиту, в виде key=value через \n
  const checkString = Object.keys(params)
    .filter((k) => k !== "hash" && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("\n");

  const secretKey = crypto.createHash("sha256").update(botToken).digest();
  const computed = crypto.createHmac("sha256", secretKey).update(checkString).digest("hex");
  const a = Buffer.from(computed, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const id = Number(params.id);
  const authDate = Number(params.auth_date);
  if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(authDate)) return null;
  // Защита от повторного использования старых данных
  if (Math.abs(Date.now() / 1000 - authDate) > maxAgeSec) return null;

  return {
    id,
    firstName: params.first_name?.slice(0, 100) || "Мастер",
    lastName: params.last_name?.slice(0, 100) || undefined,
    username: params.username?.slice(0, 100) || undefined,
    photoUrl: /^https:\/\//.test(params.photo_url ?? "") ? params.photo_url : undefined,
    authDate,
  };
}

// ---------- Сессии ----------

function hmacHex(value: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(value).digest("hex");
}

/** Подписанная сессия: "v1.<tid>.<expSec>.<hmac>" */
export function signSession(tid: number, secret: string, ttlSec = SESSION_TTL_SEC): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `v1.${tid}.${exp}`;
  return `${payload}.${hmacHex(payload, secret)}`;
}

/** Возвращает telegram id или null (нет/испорчена/просрочена cookie). */
export function verifySession(token: string | undefined | null, secret: string): number | null {
  if (!token || !secret) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const [, tidRaw, expRaw, mac] = parts;
  const payload = `v1.${tidRaw}.${expRaw}`;
  const expected = hmacHex(payload, secret);
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const exp = Number(expRaw);
  const tid = Number(tidRaw);
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return null;
  if (!Number.isFinite(tid) || tid <= 0) return null;
  return tid;
}

// ---------- Админ-сессии (/admin) ----------

export function signAdmin(secret: string, ttlSec = 12 * 3600): string {
  const exp = Math.floor(Date.now() / 1000) + ttlSec;
  const payload = `adm1.${exp}`;
  return `${payload}.${hmacHex(payload, secret)}`;
}

export function verifyAdmin(token: string | undefined | null, secret: string): boolean {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "adm1") return false;
  const [, expRaw, mac] = parts;
  const expected = hmacHex(`adm1.${expRaw}`, secret);
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(expRaw) * 1000 >= Date.now();
}
