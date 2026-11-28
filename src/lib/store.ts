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
import { checkAllowance, currentYm, TRIAL_LIMIT, type UserPlanState } from "@/lib/plan";
import { cleanStudioSlug, type StudioImportReport } from "@/lib/studio-import";
import { STUDIO_TRIAL_BONUS, type PackId } from "@/lib/tariffs";

export interface UserRow {
  telegramId: number;
  username: string | null;
  firstName: string | null;
  plan: string;
  trialUsed: number;
  monthlyUsed: number;
  monthlyResetYm: string | null;
  subscriptionUntil: Date | null;
  /** Студия-партнёр, которая привела пользователя (v41, ставится один раз при входе). */
  studioSlug: string | null;
  /** Бонусные бесплатные генерации (добор «+5» — v41). */
  bonusGenerations: number;
  /** v49: баланс КУПЛЕННЫХ генераций (Stars-пакеты и поштучные).
   *  Расходуется после бесплатных, срока нет. */
  paidGenerations: number;
  /** v49: когда пользователю уже отправляли напоминание (чтобы не спамить). */
  reminderSentAt: Date | null;
  /** v49: язык приложения Telegram (ru/en/de/fr) — на нём пишем webhook/cron. */
  languageCode: string | null;
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
      // ---------- v41: студии-партнёры + атрибуция + бонусные генерации ----------
      await sql`
        CREATE TABLE IF NOT EXISTS glam_studios (
          slug        TEXT PRIMARY KEY,
          name        TEXT NOT NULL,
          booking_url TEXT,
          note        TEXT,
          active      BOOLEAN NOT NULL DEFAULT TRUE,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`ALTER TABLE glam_users ADD COLUMN IF NOT EXISTS studio_slug TEXT`;
      await sql`ALTER TABLE glam_users ADD COLUMN IF NOT EXISTS bonus_generations INTEGER NOT NULL DEFAULT 0`;
      await sql`CREATE INDEX IF NOT EXISTS glam_users_studio_idx ON glam_users (studio_slug)`;
      // ---------- v47: панель открытий — каждое открытие мини-приложения ----------
      await sql`
        CREATE TABLE IF NOT EXISTS glam_start_events (
          id          BIGSERIAL PRIMARY KEY,
          telegram_id BIGINT NOT NULL,
          username    TEXT,
          first_name  TEXT,
          start_param TEXT NOT NULL DEFAULT '',
          attributed  BOOLEAN NOT NULL DEFAULT FALSE,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`CREATE INDEX IF NOT EXISTS glam_start_events_created_idx
        ON glam_start_events (created_at)`;
      await sql`CREATE INDEX IF NOT EXISTS glam_start_events_param_idx
        ON glam_start_events (start_param, created_at)`;
      // ---------- v49: автоприём платежей (Telegram Stars) и баланс ----------
      await sql`ALTER TABLE glam_users
        ADD COLUMN IF NOT EXISTS paid_generations INTEGER NOT NULL DEFAULT 0`;
      await sql`ALTER TABLE glam_users
        ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ`;
      // v49 (мультиязычность): язык приложения Telegram — на нём шлём
      // благодарность об оплате и напоминания замершим.
      await sql`ALTER TABLE glam_users
        ADD COLUMN IF NOT EXISTS language_code TEXT`;
      await sql`
        CREATE TABLE IF NOT EXISTS glam_payments (
          id           BIGSERIAL PRIMARY KEY,
          telegram_id  BIGINT NOT NULL,
          pack         TEXT NOT NULL,
          generations  INTEGER NOT NULL,
          stars        INTEGER NOT NULL,
          rub          NUMERIC(10, 2) NOT NULL DEFAULT 0,
          charge_id    TEXT NOT NULL UNIQUE,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
        )`;
      await sql`CREATE INDEX IF NOT EXISTS glam_payments_user_idx
        ON glam_payments (telegram_id, created_at)`;
      // Переход на модель «1 бесплатно + 5 у клиентов студии»: тем, кто пришёл
      // от студии, но бонуса ещё не получал, доначисляем +4 — обещание «5
      // бесплатных примерок» продолжает работать и после обновления.
      await sql`UPDATE glam_users SET bonus_generations = ${STUDIO_TRIAL_BONUS}
        WHERE studio_slug IS NOT NULL AND bonus_generations = 0
          AND plan = 'trial'`;
    })().catch((err) => {
      schemaReady = null; // следующая попытка повторит создание
      throw err;
    });
  }
  return schemaReady;
}

// Приводит к UserPlanState любую из внутренних форм записи пользователя.
// Числа прогоняем через Number(): BIGINT у postgres.js приходит строкой.
export function toState(r: {
  plan: string;
  trialUsed?: number;
  monthlyUsed?: number;
  monthlyResetYm?: string | null;
  subscriptionUntil?: Date | string | null;
  bonusGenerations?: number;
  paidGenerations?: number;
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
    bonusGenerations: Number(r.bonusGenerations ?? 0),
    paidGenerations: Number(r.paidGenerations ?? 0),
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
    studioSlug: (r.studio_slug as string | null) ?? null,
    bonusGenerations: Number(r.bonus_generations ?? 0),
    paidGenerations: Number(r.paid_generations ?? 0),
    reminderSentAt: (r.reminder_sent_at as Date | null) ?? null,
    languageCode: (r.language_code as string | null) ?? null,
    createdAt: r.created_at as Date,
    lastSeenAt: r.last_seen_at as Date,
  };
}

/** Создаёт пользователя при первом входе, обновляет имя/username при повторных. */
export async function upsertUser(t: {
  id: number;
  username?: string;
  firstName: string;
  /** v49: язык приложения Telegram (ru/en/de/fr) — пишется при входе. */
  languageCode?: string;
}): Promise<void> {
  const sql = getSql();
  await ensureSchema();
  const usernameLower = t.username?.toLowerCase() ?? null;
  const language = t.languageCode?.trim().slice(0, 8) ?? null;
  await sql`
    INSERT INTO glam_users (telegram_id, username, first_name, language_code)
    VALUES (${t.id}, ${usernameLower}, ${t.firstName}, ${language})
    ON CONFLICT (telegram_id) DO UPDATE SET
      username = COALESCE(EXCLUDED.username, glam_users.username),
      first_name = COALESCE(EXCLUDED.first_name, glam_users.first_name),
      language_code = COALESCE(EXCLUDED.language_code, glam_users.language_code),
      last_seen_at = now()`;
}

export async function getUser(telegramId: number): Promise<UserRow | null> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`
    SELECT telegram_id, username, first_name, plan, trial_used,
           monthly_used, monthly_reset_ym, subscription_until,
           studio_slug, bonus_generations, paid_generations, reminder_sent_at,
           language_code, created_at, last_seen_at
    FROM glam_users WHERE telegram_id = ${telegramId} LIMIT 1`;
  return rows[0] ? toRow(rows[0]) : null;
}

export function rowAllowance(row: UserRow) {
  return checkAllowance({
    plan: row.plan,
    trialUsed: row.trialUsed,
    monthlyUsed: row.monthlyUsed,
    monthlyResetYm: row.monthlyResetYm,
    subscriptionUntil: row.subscriptionUntil,
    bonusGenerations: row.bonusGenerations,
    paidGenerations: row.paidGenerations,
  });
}

/**
 * Списывает одну генерацию: по месячной квоте подписки, из бесплатного остатка
 * (триал + бонус) либо из купленного баланса — в этом порядке.
 * Вызывается ТОЛЬКО после успешной генерации — неудачные запросы не расходуют лимит.
 */
export async function consumeGeneration(telegramId: number, kind: string): Promise<void> {
  const sql = getSql();
  await ensureSchema();
  await sql.begin(async (tx) => {
    const rows = await tx`
      SELECT plan, trial_used, monthly_used, monthly_reset_ym, subscription_until,
             bonus_generations, paid_generations
      FROM glam_users WHERE telegram_id = ${telegramId} FOR UPDATE`;
    const row = rows[0];
    if (!row) return;
    const allowance = checkAllowance({
      plan: row.plan,
      trialUsed: Number(row.trial_used),
      monthlyUsed: Number(row.monthly_used),
      monthlyResetYm: row.monthly_reset_ym,
      subscriptionUntil: row.subscription_until,
      bonusGenerations: Number(row.bonus_generations ?? 0),
      paidGenerations: Number(row.paid_generations ?? 0),
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
    } else if ((allowance.trialRemaining ?? 0) > 0) {
      // Бесплатные (триал + бонус) идут первыми
      await tx`UPDATE glam_users SET trial_used = trial_used + 1, last_seen_at = now()
        WHERE telegram_id = ${telegramId}`;
    } else if ((allowance.paidRemaining ?? 0) > 0) {
      // Затем купленный баланс (Stars-пакеты, поштучные)
      await tx`UPDATE glam_users
        SET paid_generations = GREATEST(0, paid_generations - 1), last_seen_at = now()
        WHERE telegram_id = ${telegramId}`;
    } else {
      // Ничего не осталось — списывать нечего (защита от гонки)
      return;
    }
    await tx`INSERT INTO glam_generations (telegram_id, kind) VALUES (${telegramId}, ${kind})`;
  });
}

// ---------- Админ-операции (ручные продажи) ----------

export type AdminUserRow = UserRow & {
  generationsTotal: number;
  /** Название студии-партнёра (или null, если пользователь пришёл сам). */
  studioName: string | null;
};

/** Список последних пользователей с числом генераций и студией-источником. */
export async function listUsers(limit = 100): Promise<AdminUserRow[]> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`
    SELECT u.telegram_id, u.username, u.first_name, u.plan, u.trial_used,
           u.monthly_used, u.monthly_reset_ym, u.subscription_until,
           u.studio_slug, u.bonus_generations, u.paid_generations, u.reminder_sent_at,
           u.created_at, u.last_seen_at, st.name AS studio_name,
           (SELECT COUNT(*) FROM glam_generations g WHERE g.telegram_id = u.telegram_id)::int AS generations_total
    FROM glam_users u
    LEFT JOIN glam_studios st ON st.slug = u.studio_slug
    ORDER BY u.last_seen_at DESC
    LIMIT ${Math.min(500, Math.max(1, limit))}`;
  return rows.map((r) => ({
    ...toRow(r),
    generationsTotal: Number(r.generations_total),
    studioName: (r.studio_name as string | null) ?? null,
  }));
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

/** Выдаёт бонусные бесплатные генерации (добор «+5»): поднимает потолок триала.
 *  Не трогает trial_used — клиент просто получает дополнительные попытки. */
export async function grantBonus(
  user: string,
  amount: number
): Promise<{ id: number; bonusTotal: number } | null> {
  const id = await resolveUser(user);
  if (id === null) return null;
  const safeAmount = Math.min(50, Math.max(1, Math.floor(amount) || 5));
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`
    UPDATE glam_users SET bonus_generations = LEAST(1000, bonus_generations + ${safeAmount})
    WHERE telegram_id = ${id}
    RETURNING bonus_generations`;
  if (rows.length === 0) return null;
  return { id, bonusTotal: Number(rows[0].bonus_generations) };
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

// ---------- Панель открытий (v47) ----------
//
// Воронка штурма: письмо/сообщение ушло → клиентка открыла бота по ссылке
// с меткой studio_<slug> → дошла до генерации. Раньше был виден только конец
// цепочки (glam_users), и «никто не пользовался» нельзя было разобрать:
// ссылки не открывают ИЛИ открывают, но не доходят до примерки. Теперь
// каждое открытие мини-приложения пишется в glam_start_events — с сырой
// меткой ссылки, даже если студии с таким слагом ещё нет в базе.

export interface StartEventRow {
  telegramId: number;
  username: string | null;
  firstName: string | null;
  /** Сырая метка ссылки (studio_…) или пусто, если открыли бота напрямую. */
  startParam: string;
  /** true — метка распознана и студия привязана (первое касание). */
  attributed: boolean;
  createdAt: Date;
}

export interface StartParamStat {
  param: string;
  opens: number;
  unique: number;
  /** Сколько из них реально привязались к студии. */
  attributed: number;
}

export interface StartStats {
  totalOpens: number;
  uniqueUsers: number;
  opens7d: number;
  byParam: StartParamStat[];
  recent: StartEventRow[];
}

/** Пишет одно открытие. НИКОГДА не бросает: аналитика не должна ломать вход. */
export async function logStartEvent(t: {
  telegramId: number;
  username?: string;
  firstName?: string;
  startParam: string;
  attributed: boolean;
}): Promise<void> {
  try {
    const sql = getSql();
    await ensureSchema();
    await sql`
      INSERT INTO glam_start_events (telegram_id, username, first_name, start_param, attributed)
      VALUES (${t.telegramId}, ${t.username?.toLowerCase() ?? null}, ${t.firstName ?? null},
              ${t.startParam.slice(0, 64)}, ${t.attributed})`;
  } catch (err) {
    console.warn("[store] logStartEvent пропущен:", err instanceof Error ? err.message : err);
  }
}

/** Сводка открытий для блока «Открытия бота» в /admin. */
export async function startStats(limit = 12): Promise<StartStats> {
  const sql = getSql();
  await ensureSchema();
  const [tot] = await sql`
    SELECT COUNT(*)::int AS opens, COUNT(DISTINCT telegram_id)::int AS uniq
    FROM glam_start_events`;
  const [week] = await sql`
    SELECT COUNT(*)::int AS opens
    FROM glam_start_events
    WHERE created_at > now() - interval '7 days'`;
  const byParam = await sql`
    SELECT start_param,
           COUNT(*)::int AS opens,
           COUNT(DISTINCT telegram_id)::int AS uniq,
           COUNT(*) FILTER (WHERE attributed)::int AS attributed
    FROM glam_start_events
    GROUP BY start_param
    ORDER BY opens DESC, start_param
    LIMIT ${Math.min(20, Math.max(1, limit))}`;
  const recent = await sql`
    SELECT telegram_id, username, first_name, start_param, attributed, created_at
    FROM glam_start_events
    ORDER BY created_at DESC
    LIMIT ${Math.min(20, Math.max(1, limit))}`;
  return {
    totalOpens: Number(tot?.opens ?? 0),
    uniqueUsers: Number(tot?.uniq ?? 0),
    opens7d: Number(week?.opens ?? 0),
    byParam: byParam.map((r) => ({
      param: String(r.start_param ?? ""),
      opens: Number(r.opens),
      unique: Number(r.uniq),
      attributed: Number(r.attributed),
    })),
    recent: recent.map((r) => ({
      telegramId: Number(r.telegram_id),
      username: (r.username as string | null) ?? null,
      firstName: (r.first_name as string | null) ?? null,
      startParam: String(r.start_param ?? ""),
      attributed: Boolean(r.attributed),
      createdAt: new Date(r.created_at as unknown as string),
    })),
  };
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

// ---------- v49: Автоплатежи (Telegram Stars) ----------

export interface PaymentRow {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  pack: string;
  generations: number;
  stars: number;
  rub: number;
  chargeId: string;
  createdAt: Date;
}

function toPayment(r: Record<string, unknown>): PaymentRow {
  return {
    id: Number(r.id),
    telegramId: Number(r.telegram_id),
    username: (r.username as string | null) ?? null,
    firstName: (r.first_name as string | null) ?? null,
    pack: String(r.pack),
    generations: Number(r.generations),
    stars: Number(r.stars),
    rub: Number(r.rub ?? 0),
    chargeId: String(r.charge_id ?? ""),
    createdAt: new Date(r.created_at as unknown as string),
  };
}

/**
 * Зачисляет генерации за успешный Stars-платёж. Идемпотентно по charge_id:
 * Telegram может прислать successful_payment дважды (ретрай вебхука) —
 * второй раз зачисления не будет, но ответ останется «успех».
 * Возвращает true, если зачисление выполнено именно этим вызовом.
 */
export async function creditPaidGenerations(t: {
  telegramId: number;
  pack: PackId | "unknown";
  generations: number;
  stars: number;
  rub: number;
  chargeId: string;
}): Promise<boolean> {
  const sql = getSql();
  await ensureSchema();
  return sql.begin(async (tx) => {
    const inserted = await tx`
      INSERT INTO glam_payments (telegram_id, pack, generations, stars, rub, charge_id)
      VALUES (${t.telegramId}, ${t.pack}, ${t.generations}, ${t.stars}, ${t.rub}, ${t.chargeId})
      ON CONFLICT (charge_id) DO NOTHING
      RETURNING id`;
    if (inserted.length === 0) return false;
    if (t.generations > 0) {
      await tx`
        UPDATE glam_users
        SET paid_generations = GREATEST(0, paid_generations) + ${t.generations}
        WHERE telegram_id = ${t.telegramId}`;
    }
    return true;
  });
}

/** Последние платежи — для блока «Платежи» в /admin. */
export async function listPayments(limit = 20): Promise<PaymentRow[]> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`
    SELECT p.id, p.telegram_id, p.pack, p.generations, p.stars, p.rub,
           p.charge_id, p.created_at,
           u.username, u.first_name
    FROM glam_payments p
    LEFT JOIN glam_users u ON u.telegram_id = p.telegram_id
    ORDER BY p.created_at DESC
    LIMIT ${Math.min(100, Math.max(1, limit))}`;
  return rows.map(toPayment);
}

export interface PaymentsStats {
  total: number;
  stars: number;
  rub: number;
  generations: number;
  buyers: number;
  byPack: Array<{ pack: string; count: number; stars: number }>;
}

/** Сводка по всем платежам — суммарная выручка и разбивка по пакетам. */
export async function paymentsStats(): Promise<PaymentsStats> {
  const sql = getSql();
  await ensureSchema();
  const [tot] = await sql`
    SELECT COUNT(*)::int AS total,
           COALESCE(SUM(stars), 0)::int AS stars,
           COALESCE(SUM(rub), 0)::float8 AS rub,
           COALESCE(SUM(generations), 0)::int AS generations,
           COUNT(DISTINCT telegram_id)::int AS buyers
    FROM glam_payments`;
  const byPack = await sql`
    SELECT pack, COUNT(*)::int AS count, COALESCE(SUM(stars), 0)::int AS stars
    FROM glam_payments GROUP BY pack ORDER BY count DESC`;
  return {
    total: Number(tot?.total ?? 0),
    stars: Number(tot?.stars ?? 0),
    rub: Number(tot?.rub ?? 0),
    generations: Number(tot?.generations ?? 0),
    buyers: Number(tot?.buyers ?? 0),
    byPack: byPack.map((r) => ({
      pack: String(r.pack),
      count: Number(r.count),
      stars: Number(r.stars),
    })),
  };
}

// ---------- v49: Напоминания замершим ----------

export interface SleeperRow {
  telegramId: number;
  firstName: string | null;
  /** Сколько генераций доступно прямо сейчас (бесплатных + купленных). */
  remaining: number;
  /** v49: язык приложения Telegram — на нём пишем напоминание. */
  languageCode: string | null;
  lastSeenAt: Date;
}

/**
 * «Замершие»: ещё есть генерации (бесплатные или купленные), но не заходили
 * idleDays дней и напоминание им ещё не отправляли. Кандидаты на мягкое
 * «твои примерки ждут» — ровно тот сегмент, который теряется после первой
 * генерации. Подписчиков салона не трогаем.
 */
export async function listSleepers(idleDays: number, limit = 50): Promise<SleeperRow[]> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`
    SELECT telegram_id, first_name, trial_used, bonus_generations,
           paid_generations, language_code, last_seen_at
    FROM glam_users
    WHERE plan = 'trial'
      AND reminder_sent_at IS NULL
      AND last_seen_at < now() - ${Math.max(1, Math.floor(idleDays))} * interval '1 day'
      AND (trial_used < ${TRIAL_LIMIT} + bonus_generations OR paid_generations > 0)
    ORDER BY last_seen_at DESC
    LIMIT ${Math.min(200, Math.max(1, limit))}`;
  return rows.map((r) => {
    const row: UserRow = toRow({ ...r, plan: "trial", monthly_used: 0, monthly_reset_ym: null, subscription_until: null, studio_slug: null, created_at: r.last_seen_at });
    const allowance = rowAllowance(row);
    return {
      telegramId: Number(r.telegram_id),
      firstName: (r.first_name as string | null) ?? null,
      remaining: allowance.remaining,
      languageCode: (r.language_code as string | null) ?? null,
      lastSeenAt: r.last_seen_at as Date,
    };
  });
}

/** Отмечает, что напоминание отправлено — повторно пользователю не пишем. */
export async function markReminded(telegramIds: number[]): Promise<void> {
  if (telegramIds.length === 0) return;
  const sql = getSql();
  await ensureSchema();
  await sql`
    UPDATE glam_users SET reminder_sent_at = now()
    WHERE telegram_id IN ${sql(telegramIds)} AND reminder_sent_at IS NULL`;
}

/**
 * v49: сохраняет ВЫБРАННЫЙ язык интерфейса (кнопки RU/EN/DE/FR в paywall).
 * Вызывается из /api/auth/lang — только внутри подписанной сессии.
 * Язык из Telegram (language_code) пишется отдельно — при входе через Mini App.
 */
export async function setUserLanguage(telegramId: number, lang: string): Promise<void> {
  const sql = getSql();
  await ensureSchema();
  await sql`UPDATE glam_users SET language_code = ${lang}
    WHERE telegram_id = ${telegramId}`;
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

// ---------- Студии-партнёры (v41) ----------
//
// Студия получает ссылку вида https://t.me/<bot>?start=studio_<slug> — она
// стоит на кнопке баннера на сайте студии. Клиентка, открывшая бота по этой
// ссылке, попадает в Mini App с start_param=studio_<slug>: мы запоминаем
// источник (первое касание, не перезаписывается) и показываем клиентке
// кнопку «Записаться» с контактами именно этой студии — в том числе на
// экране «пробные образы закончились».

export interface StudioRow {
  slug: string;
  name: string;
  bookingUrl: string | null;
  note: string | null;
  active: boolean;
  /** Сколько пользователей пришло от студии (для админки). */
  invited: number;
}

/** Нормализует слаг: только латиница/цифры/дефис, до 40 символов. */
export function normalizeStudioSlug(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function toStudio(r: Record<string, unknown>): StudioRow {
  return {
    slug: String(r.slug),
    name: String(r.name),
    bookingUrl: (r.booking_url as string | null) ?? null,
    note: (r.note as string | null) ?? null,
    active: Boolean(r.active),
    invited: Number(r.invited ?? 0),
  };
}

/** Создаёт студию или обновляет её данные по слагу. */
export async function upsertStudio(s: {
  slug: string;
  name: string;
  bookingUrl?: string | null;
  note?: string | null;
}): Promise<StudioRow | null> {
  const slug = normalizeStudioSlug(s.slug);
  const name = s.name.trim().slice(0, 80);
  if (!slug || !name) return null;
  const bookingUrl =
    s.bookingUrl && /^https?:\/\/\S{4,300}$/i.test(s.bookingUrl.trim())
      ? s.bookingUrl.trim().slice(0, 300)
      : null;
  const note = s.note?.trim().slice(0, 200) || null;
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`
    INSERT INTO glam_studios (slug, name, booking_url, note)
    VALUES (${slug}, ${name}, ${bookingUrl}, ${note})
    ON CONFLICT (slug) DO UPDATE SET
      name = EXCLUDED.name,
      booking_url = EXCLUDED.booking_url,
      note = EXCLUDED.note
    RETURNING slug, name, booking_url, note, active`;
  return rows[0] ? toStudio(rows[0]) : null;
}

// ---------- v48: массовое добавление студий списком ----------

export interface StudioImportInput {
  name: string;
  slug: string;
  bookingUrl?: string | null;
  note?: string | null;
}

/**
 * Массовый импорт студий (v48). Для каждой строки:
 * 1) чистим слаг (снимаем @ и приставку studio-…);
 * 2) если в базе запись со старым слагом «studio-<слаг>» (ручной ввод с
 *    приставкой) — переименовываем её в правильный слаг: ссылки писем
 *    ?start=studio_<слаг> ищут слаг БЕЗ приставки, поэтому такая запись
 *    никогда не привязывала клиенток. Привязки переезжают вместе со слагом;
 * 3) иначе — создаём или обновляем студию. Ссылка записи и заметка
 *    перезаписываются только если в списке они заполнены — уже введённые
 *    вручную данные не теряются.
 * Ни одна строка не роняет всю пачку: ошибки собираются в отчёт.
 */
export async function importStudios(rows: StudioImportInput[]): Promise<StudioImportReport> {
  const sql = getSql();
  await ensureSchema();
  const report: StudioImportReport = { added: [], updated: [], fixed: [], skipped: [] };

  for (const row of rows) {
    const name = String(row.name ?? "").trim().slice(0, 80);
    const slug = cleanStudioSlug(String(row.slug ?? ""));
    if (!slug) {
      report.skipped.push({
        slug: String(row.slug ?? "").slice(0, 40),
        reason: "слаг пустой или из недопустимых символов",
      });
      continue;
    }
    if (!name) {
      report.skipped.push({ slug, reason: "нет названия студии" });
      continue;
    }
    const bookingRaw = String(row.bookingUrl ?? "").trim();
    const bookingUrl = /^https?:\/\/\S{4,300}$/i.test(bookingRaw) ? bookingRaw.slice(0, 300) : null;
    const noteRaw = String(row.note ?? "").trim();
    const note = noteRaw ? noteRaw.slice(0, 200) : null;

    const existing = await sql`
      SELECT slug FROM glam_studios WHERE slug = ${slug} LIMIT 1`;
    if (existing.length === 0) {
      const legacySlug = `studio-${slug}`;
      const legacy = await sql`
        SELECT slug FROM glam_studios WHERE slug = ${legacySlug} LIMIT 1`;
      if (legacy.length > 0) {
        await sql`
          UPDATE glam_studios
          SET slug = ${slug},
              name = ${name},
              booking_url = COALESCE(${bookingUrl}, booking_url),
              note = COALESCE(${note}, note)
          WHERE slug = ${legacySlug}`;
        await sql`
          UPDATE glam_users SET studio_slug = ${slug} WHERE studio_slug = ${legacySlug}`;
        report.fixed.push({ slug, name, oldSlug: legacySlug });
        continue;
      }
    }

    const res = await sql`
      INSERT INTO glam_studios (slug, name, booking_url, note)
      VALUES (${slug}, ${name}, ${bookingUrl}, ${note})
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        booking_url = COALESCE(EXCLUDED.booking_url, glam_studios.booking_url),
        note = COALESCE(EXCLUDED.note, glam_studios.note)
      RETURNING slug, name`;
    if (res[0]) {
      (existing.length > 0 ? report.updated : report.added).push({
        slug: String(res[0].slug),
        name: String(res[0].name),
      });
    }
  }
  return report;
}

/** Список студий для админки — с числом приведённых пользователей. */
export async function listStudios(limit = 100): Promise<StudioRow[]> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`
    SELECT slug, name, booking_url, note, active,
           (SELECT COUNT(*) FROM glam_users u WHERE u.studio_slug = s.slug)::int AS invited
    FROM glam_studios s
    ORDER BY s.created_at DESC
    LIMIT ${Math.min(200, Math.max(1, limit))}`;
  return rows.map(toStudio);
}

/** Включает/выключает студию: у выключенной баннерная ссылка перестаёт привязывать. */
export async function setStudioActive(slug: string, active: boolean): Promise<boolean> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`
    UPDATE glam_studios SET active = ${active} WHERE slug = ${normalizeStudioSlug(slug)}
    RETURNING slug`;
  return rows.length > 0;
}

/** Студия по слагу (даже выключенная — для админки). */
export async function getStudioBySlug(slug: string): Promise<StudioRow | null> {
  const clean = normalizeStudioSlug(slug);
  if (!clean) return null;
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`
    SELECT slug, name, booking_url, note, active, 0::int AS invited
    FROM glam_studios WHERE slug = ${clean} LIMIT 1`;
  return rows[0] ? toStudio(rows[0]) : null;
}

/**
 * Привязывает пользователя к студии-источнику. Срабатывает только при ПЕРВОМ
 * касании (studio_slug ещё пустой) и только если студия существует и активна:
 * «первый показал — тот и собрал аудиторию», перебить источник нельзя.
 * v49: клиенту студии сразу начисляем бонус +4 — обещание «5 бесплатных
 * примерок для ваших клиентов» (1 базовая + 4 бонуса).
 */
export async function attachStudioBySlug(telegramId: number, slug: string): Promise<boolean> {
  const clean = normalizeStudioSlug(slug);
  if (!clean) return false;
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`
    UPDATE glam_users u SET studio_slug = s.slug,
      bonus_generations = GREATEST(u.bonus_generations, ${STUDIO_TRIAL_BONUS})
    FROM glam_studios s
    WHERE s.slug = ${clean} AND s.active
      AND u.telegram_id = ${telegramId} AND u.studio_slug IS NULL
    RETURNING u.telegram_id`;
  return rows.length > 0;
}

/** Студия, которая привела пользователя (для кнопки «Записаться»). */
export async function getStudioForUser(telegramId: number): Promise<StudioRow | null> {
  const sql = getSql();
  await ensureSchema();
  const rows = await sql`
    SELECT s.slug, s.name, s.booking_url, s.note, s.active,
           (SELECT COUNT(*) FROM glam_users u2 WHERE u2.studio_slug = s.slug)::int AS invited
    FROM glam_studios s
    JOIN glam_users u ON u.studio_slug = s.slug
    WHERE u.telegram_id = ${telegramId} AND s.active
    LIMIT 1`;
  return rows[0] ? toStudio(rows[0]) : null;
}
