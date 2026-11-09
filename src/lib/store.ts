// Хранилище подписок на Neon Postgres (серверлесс-совместимый postgres.js).
//
// Почему не SQLite/Prisma: приложение живёт на Vercel (serverless) — файловая
// база там не сохраняется между запросами. Neon — управляемый Postgres с
// бесплатным тарифом; достаточно одной переменной DATABASE_URL.
//
// Схема создаётся автоматически при первом обращении (ensureSchema) — никаких
// миграций при деплое: залил код, задал DATABASE_URL, и всё работает.

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
    subscriptionUntil: r.subscriptionUntil ?? null,
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
