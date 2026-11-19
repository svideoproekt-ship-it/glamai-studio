// Хранилище подписок на Neon Postgres (серверлесс-совместимый postgres.js).
//
// Почему не SQLite/Prisma: приложение живёт на Vercel (serverless) — файловая
// база там не сохраняется между запросами. Neon — управляемый Postgres с
// бесплатным тарифом; достаточно одной переменной DATABASE_URL.
//
// Схема создаётся автоматически при первом обращении (ensureSchema) — никаких
// миграций при деплое: залил код, задал DATABASE_URL, и всё работает.

import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { checkAllowance, currentYm, type UserPlanState } from "@/lib/plan";

export interface UserRow {
  telegramId: number;
  username: string | null;
  firstName: string | null;
  plan: string;
  trialUsed: number;
  monthlyUsed: number;
  monthlyResetYm: string | null;
  subscriptionUntil: Date | null;
  createdAt: Date;
  lastSeenAt: Date;
}

let sqlInstance: postgres.Sql | null = null;
let schemaReady: Promise<void> | null = null;

function getSql(): postgres.Sql {
  if (sqlInstance) return sqlInstance;
  const url = process.env.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "База данных не настроена: добавьте переменную DATABASE_URL (Neon Postgres) в Settings → Environment Variables на Vercel и сделайте Redeploy. Инструкция — в README-DEPLOY-RU.md, раздел «Подключаем базу»."
    );
  }
  const isLocal = /(^|@|\/\/)(localhost|127\.0\.0\.1)/.test(url);
  sqlInstance = postgres(url, {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
    // Neon и прочие облачные Postgres требуют TLS; локальный — нет
    ssl: isLocal ? false : "require",
    prepare: false,
  });
  return sqlInstance;
}

/** Создаёт таблицы, если их ещё нет. Выполняется один раз на инстанс функции. */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const sql = getSql();
      await sql`
        CREATE TABLE IF NOT EXISTS glam_users (
          telegram_id        BIGINT PRIMARY KEY,
          username           TEXT,
          first_name         TEXT,
          plan               TEXT NOT NULL DEFAULT 'trial',
          trial_used         INTEGER NOT NULL DEFAULT 0,
          monthly_used       INTEGER NOT NULL DEFAULT 0,
          monthly_reset_ym   TEXT,
          subscription_until TIMESTAMPTZ,
          created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
          last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`
        CREATE TABLE IF NOT EXISTS glam_generations (
          id          BIGSERIAL PRIMARY KEY,
          telegram_id BIGINT NOT NULL,
          kind        TEXT NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`
        CREATE INDEX IF NOT EXISTS glam_generations_user_idx
        ON glam_generations (telegram_id, created_at)`;
      await sql`
        CREATE TABLE IF NOT EXISTS glam_pay_requests (
          id          BIGSERIAL PRIMARY KEY,
          telegram_id BIGINT NOT NULL,
          username    TEXT,
          first_name  TEXT,
          plan        TEXT NOT NULL,
          status      TEXT NOT NULL DEFAULT 'pending',
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
          handled_at  TIMESTAMPTZ
        )`;
      await sql`
        CREATE INDEX IF NOT EXISTS glam_pay_requests_pending_idx
        ON glam_pay_requests (status, created_at)`;
      await sql`
        CREATE TABLE IF NOT EXISTS glam_photo_links (
          id         TEXT PRIMARY KEY,
          mime       TEXT NOT NULL,
          data       TEXT NOT NULL,
          created_by BIGINT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          expires_at TIMESTAMPTZ NOT NULL
        )`;
      await sql`
        CREATE INDEX IF NOT EXISTS glam_photo_links_expires_idx
        ON glam_photo_links (expires_at)`;
    })().catch((err) => {
      schemaReady = null; // следующая попытка повторит создание
      throw err;
    });
  }
  return schemaReady;
}

// Приводит к UserPlanState любую из внутренних форм записи пользователя.
// Числа прогоняем через Number(): BIGINT у postgres.js приходит строкой.
function toState(r: {
  plan: string;
  trialUsed?: number;
  monthlyUsed?: number;
  monthlyResetYm?: string | null;
  subscriptionUntil?: Date | string | null;
}): UserPlanState {
  return {
    plan: r.plan,
    trialUsed: Number(r.trialUsed ?? 0),
    monthlyUsed: Number(r.monthlyUsed ?? 0),
    monthlyResetYm: r.monthlyResetYm ?? null,
    subscriptionUntil:
      r.subscriptionUntil instanceof Date
        ? r.subscriptionUntil
        : r.subscriptionUntil
          ? new Date(r.subscriptionUntil)
          : null,
  };
}

function toRow(r: Record<string, unknown>): UserRow {
  return {
    telegramId: Number(r.telegram_id),
    username: (r.username as string | null) ?? null,
    firstName: (r.first_name as string | null) ?? null,
    plan: r.plan as string,
    trialUsed: Number(r.trial_used),
    monthlyUsed: Number(r.monthly_used),
    monthlyResetYm: (r.monthly_reset_ym as string | null) ?? null,
    subscriptionUntil: (r.subscription_until as Date | null) ?? null,
    createdAt: r.created_at as Date,
    lastSeenAt: r.last_seen_at as Date,
  };
}

/** Создаёт пользователя при первом входе, обновляет имя/username при повторных. */
export async function upsertUser(t: {
  id: number;
  username?: string;
  firstName: string;
}): Promise<void> {
  const sql = getSql();
  await ensureSchema();
  const usernameLower = t.username?.toLowerCase() ?? null;
  await sql`
    INSERT INTO glam_users (telegram_id, username, first_name)
    VALUES (${t.id}, ${usernameLower}, ${t.firstName})
    ON CONFLICT (telegram_id) DO UPDATE SET
      username = COALESCE(EXCLUDED.username, glam_users.username),
      first_name = COALESCE(EXCLUDED.first_name, glam_users.first_name),
      last_seen_at = now()`;
}

export async function getUser(telegramId: number): Promise<UserRow | null> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`
    SELECT telegram_id, username, first_name, plan, trial_used,
           monthly_used, monthly_reset_ym, subscription_until, created_at, last_seen_at
    FROM glam_users WHERE telegram_id = ${telegramId} LIMIT 1`;
  return rows[0] ? toRow(rows[0]) : null;
}

export function rowAllowance(row: UserRow) {
  return checkAllowance(toState(row));
}

/**
 * Списывает одну генерацию: по месячной квоте подписки либо из пробного остатка.
 * Вызывается ТОЛЬКО после успешной генерации — неудачные запросы не расходуют лимит.
 */
export async function consumeGeneration(telegramId: number, kind: string): Promise<void> {
  const sql = getSql();
  await ensureSchema();
  await sql.begin(async (tx) => {
    const rows = await tx`
      SELECT plan, trial_used, monthly_used, monthly_reset_ym, subscription_until
      FROM glam_users WHERE telegram_id = ${telegramId} FOR UPDATE`;
    const row = rows[0];
    if (!row) return;
    const allowance = checkAllowance({
      plan: row.plan,
      trialUsed: Number(row.trial_used),
      monthlyUsed: Number(row.monthly_used),
      monthlyResetYm: row.monthly_reset_ym,
      subscriptionUntil: row.subscription_until,
    });
    if (allowance.mode === "sub") {
      const ym = currentYm();
      if (row.monthly_reset_ym === ym) {
        await tx`UPDATE glam_users SET monthly_used = monthly_used + 1, last_seen_at = now()
          WHERE telegram_id = ${telegramId}`;
      } else {
        await tx`UPDATE glam_users SET monthly_used = 1, monthly_reset_ym = ${ym}, last_seen_at = now()
          WHERE telegram_id = ${telegramId}`;
      }
    } else {
      await tx`UPDATE glam_users SET trial_used = trial_used + 1, last_seen_at = now()
        WHERE telegram_id = ${telegramId}`;
    }
    await tx`INSERT INTO glam_generations (telegram_id, kind) VALUES (${telegramId}, ${kind})`;
  });
}

// ---------- Админ-операции (ручные продажи) ----------

export type AdminUserRow = UserRow & { generationsTotal: number };

/** Список последних пользователей с числом генераций. */
export async function listUsers(limit = 100): Promise<AdminUserRow[]> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`
    SELECT u.telegram_id, u.username, u.first_name, u.plan, u.trial_used,
           u.monthly_used, u.monthly_reset_ym, u.subscription_until,
           u.created_at, u.last_seen_at,
           (SELECT COUNT(*) FROM glam_generations g WHERE g.telegram_id = u.telegram_id)::int AS generations_total
    FROM glam_users u
    ORDER BY u.last_seen_at DESC
    LIMIT ${Math.min(500, Math.max(1, limit))}`;
  return rows.map((r) => ({ ...toRow(r), generationsTotal: Number(r.generations_total) }));
}

/** "123456789" | "@username" | "username" → telegram id либо null.
 *  Числовой ввод — это Telegram ID, и он ОБЯЗАН быть в базе: без проверки
 *  любой набор цифр (например, вползшая в поле цена 690) проходил как
 *  «успех» — UPDATE не трогал ни одну строку, а админка рапортовала
 *  «Подписка выдана». */
async function resolveUser(user: string): Promise<number | null> {
  const raw = user.trim();
  if (!raw) return null;
  const sql = getSql();
  if (/^\d+$/.test(raw)) {
    const id = Number(raw);
    const rows = await sql`SELECT telegram_id FROM glam_users WHERE telegram_id = ${id} LIMIT 1`;
    return rows[0] ? Number(rows[0].telegram_id) : null;
  }
  const username = raw.replace(/^@/, "").toLowerCase();
  const rows = await sql`SELECT telegram_id FROM glam_users WHERE username = ${username} LIMIT 1`;
  return rows[0] ? Number(rows[0].telegram_id) : null;
}

/**
 * Выдаёт (или продлевает) подписку: к текущему сроку прибавляется days дней.
 * Квота месяца обнуляется — новый период начинается с полным лимитом.
 * Возвращает id и новую дату окончания (для подтверждения в админке).
 */
export async function grantPlan(
  user: string,
  plan: "start" | "salon",
  days: number
): Promise<{ id: number; untilIso: string | null } | null> {
  const id = await resolveUser(user);
  if (id === null) return null;
  const safeDays = Math.min(3650, Math.max(1, Math.floor(days) || 30));
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`
    UPDATE glam_users SET
      plan = ${plan},
      subscription_until = GREATEST(COALESCE(subscription_until, now()), now())
        + ${safeDays} * interval '1 day',
      monthly_used = 0,
      monthly_reset_ym = NULL
    WHERE telegram_id = ${id}
    RETURNING subscription_until`;
  if (rows.length === 0) return null; // пользователь исчез между проверками — не рапортуем успех
  const until = rows[0]?.subscription_until;
  return {
    id,
    untilIso: until ? new Date(until as unknown as string).toISOString() : null,
  };
}

/** Отключает подписку (для тестов и ошибочных выдач): возврат на пробный тариф. */
export async function revokeSubscription(user: string): Promise<number | null> {
  const id = await resolveUser(user);
  if (id === null) return null;
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`
    UPDATE glam_users SET
      plan = 'trial',
      subscription_until = NULL,
      monthly_used = 0,
      monthly_reset_ym = NULL
    WHERE telegram_id = ${id}
    RETURNING telegram_id`;
  return rows[0] ? Number(rows[0].telegram_id) : null;
}

/** Обнуляет пробный лимит (например, для честного повторного триала). */
export async function resetTrial(user: string): Promise<number | null> {
  const id = await resolveUser(user);
  if (id === null) return null;
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`UPDATE glam_users SET trial_used = 0 WHERE telegram_id = ${id} RETURNING telegram_id`;
  return rows[0] ? Number(rows[0].telegram_id) : null;
}

/** Статистика для админки. */
export async function adminStats(): Promise<{ total: number; paying: number; generations: number }> {
  const sql = getSql();
  await ensureSchema();
  const [u] = await sql`SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE subscription_until IS NOT NULL AND subscription_until > now())::int AS paying
    FROM glam_users`;
  const [g] = await sql`SELECT COUNT(*)::int AS total FROM glam_generations`;
  return { total: Number(u?.total ?? 0), paying: Number(u?.paying ?? 0), generations: Number(g?.total ?? 0) };
}

// ---------- Заявки на подписку (автоподстановка ID в админку) ----------

export interface PayRequestRow {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  plan: string;
  createdAt: Date;
}

/**
 * Клиент нажал «Выбрать тариф» → заявка уходит в админку, владельцу больше
 * не нужно перепечатывать ID руками. Дубль в течение 12 часов не создаётся,
 * но время существующей заявки обновляется — она поднимается наверх списка.
 */
export async function createPayRequest(
  u: { telegramId: number; username: string | null; firstName: string | null },
  plan: "start" | "salon"
): Promise<void> {
  const sql = getSql();
  await ensureSchema();
  await sql`
    UPDATE glam_pay_requests SET created_at = now()
    WHERE telegram_id = ${u.telegramId} AND plan = ${plan}
      AND status = 'pending' AND created_at > now() - interval '12 hours'`;
  await sql`
    INSERT INTO glam_pay_requests (telegram_id, username, first_name, plan)
    SELECT ${u.telegramId}, ${u.username}, ${u.firstName}, ${plan}
    WHERE NOT EXISTS (
      SELECT 1 FROM glam_pay_requests
      WHERE telegram_id = ${u.telegramId} AND plan = ${plan}
        AND status = 'pending' AND created_at > now() - interval '12 hours'
    )`;
}

/** Ждущие оплаты заявки — для блока «Заявки на подписку» в /admin. */
export async function listPayRequests(limit = 20): Promise<PayRequestRow[]> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`
    SELECT id, telegram_id, username, first_name, plan, created_at
    FROM glam_pay_requests
    WHERE status = 'pending'
    ORDER BY created_at DESC
    LIMIT ${Math.min(50, Math.max(1, limit))}`;
  return rows.map((r) => ({
    id: Number(r.id),
    telegramId: Number(r.telegram_id),
    username: (r.username as string | null) ?? null,
    firstName: (r.first_name as string | null) ?? null,
    plan: String(r.plan),
    createdAt: new Date(r.created_at as unknown as string),
  }));
}

/** Помечает заявку обработанной: done — подписка выдана, dismissed — скрыта. */
export async function setPayRequestStatus(
  id: number,
  status: "done" | "dismissed"
): Promise<boolean> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`
    UPDATE glam_pay_requests SET status = ${status}, handled_at = now()
    WHERE id = ${id} AND status = 'pending'
    RETURNING id`;
  return rows.length > 0;
}

// ---------- Фото по ссылке (v40) ----------
//
// Готовый образ хранится на сервере (Neon) и выдаётся по неугадываемой
// ссылке /f/<id>: ссылку можно отправить клиенту в ЛЮБОМ мессенджере
// (WhatsApp, MAX, почта, SMS), а страница фото в настоящем браузере
// сохраняется в галерею штатными средствами телефона. Фото автоматически
// стирается через PHOTO_LINK_TTL_DAYS дней — база не растёт, ссылка
// не живёт вечно, личные фотографии не копятся на сервере.

export const PHOTO_LINK_TTL_DAYS = 7;

export interface PhotoLinkRow {
  id: string;
  mime: string;
  /** base64 без префикса data: */
  data: string;
  expiresAt: Date;
}

/** 18 символов base62 без похожих символов (0/O, 1/l/I) — неугадываемо. */
function newPhotoLinkId(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = randomBytes(18);
  let id = "";
  for (const b of bytes) id += alphabet[b % alphabet.length];
  return id;
}

function parseDataUrl(dataUrl: string): { mime: string; data: string } | null {
  const m = /^data:(image\/(?:png|jpe?g|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  return m ? { mime: m[1], data: m[2] } : null;
}

/** Сохраняет образ и создаёт ссылку /f/<id>. Просроченные фото подчищаем
 *  здесь же — отдельный cron не нужен: чистка идёт при каждой новой ссылке. */
export async function createPhotoLink(
  dataUrl: string,
  createdBy: number
): Promise<{ id: string; expiresAt: Date }> {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) throw new Error("Картинка не передана или неверного формата.");
  const sql = getSql();
  await ensureSchema();
  await sql`DELETE FROM glam_photo_links WHERE expires_at < now()`;
  const id = newPhotoLinkId();
  const rows = await sql`
    INSERT INTO glam_photo_links (id, mime, data, created_by, expires_at)
    VALUES (${id}, ${parsed.mime}, ${parsed.data}, ${createdBy},
            now() + ${PHOTO_LINK_TTL_DAYS} * interval '1 day')
    RETURNING expires_at`;
  return { id, expiresAt: new Date(rows[0].expires_at as string) };
}

/** Отдаёт фото по ссылке, пока не истёк срок. Вне срока или не найдено — null. */
export async function getPhotoLink(id: string): Promise<PhotoLinkRow | null> {
  if (!/^[A-Za-z0-9]{10,40}$/.test(id)) return null;
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`
    SELECT id, mime, data, expires_at
    FROM glam_photo_links
    WHERE id = ${id} AND expires_at > now()
    LIMIT 1`;
  const r = rows[0];
  if (!r) return null;
  return {
    id: String(r.id),
    mime: String(r.mime),
    data: String(r.data),
    expiresAt: new Date(r.expires_at as string),
  };
}
