// Тарифная модель GlamAI Studio (чистая логика, без обращений к БД/сети).
// Модель продаж: бесплатный триал (несколько генераций) + месячная подписка.
// «Старт» — один мастер, «Салон» — студия с несколькими мастерами.

export type PlanName = "trial" | "start" | "salon";

/** Цена в рублях в месяц (ручные продажи на старте, ЮKassa — позже). */
export const PLAN_PRICES: Record<"start" | "salon", number> = {
  start: 690,
  salon: 2490,
};

/** Лимит генераций на месяц по платным тарифам. */
export const PLAN_QUOTA: Record<"start" | "salon", number> = {
  start: 60,
  salon: 200,
};

/** Сколько генераций даём бесплатно без карты. */
export const TRIAL_LIMIT = Math.max(1, Number(process.env.TRIAL_LIMIT ?? 5) || 5);

export function planLabel(plan: string): string {
  if (plan === "start") return "Старт";
  if (plan === "salon") return "Салон";
  return "Пробный";
}

/** Текущий месяц в формате YYYY-MM — по нему сбрасывается месячная квота. */
export function currentYm(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Состояние пользователя, нужное для расчёта лимита (приходит из БД). */
export interface UserPlanState {
  plan: string;
  trialUsed: number;
  monthlyUsed: number;
  monthlyResetYm: string | null;
  subscriptionUntil: Date | null;
}

/** Безопасное приведение даты: принимает Date или ISO-строку, NULL → null. */
function toDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === "string" && value.length > 0) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export interface Allowance {
  allowed: boolean;
  /** trial — считаем пробные генерации, sub — месячную квоту подписки */
  mode: "trial" | "sub";
  remaining: number;
  total: number;
  planLabel: string;
  /** Активна ли сейчас подписка (для плашки в шапке) */
  subscriptionActive: boolean;
  /** Почему нельзя: «trial_exhausted» | «quota_exhausted» (только при allowed=false) */
  reason?: "trial_exhausted" | "quota_exhausted";
}

/**
 * Может ли пользователь сгенерировать образ прямо сейчас.
 * Подписка активна → месячная квота; иначе → пробный остаток.
 * Подписка истекла → пользователь автоматически возвращается на пробный остаток
 * (если триал уже израсходован — увидит paywall).
 */
export function checkAllowance(s: UserPlanState, now: Date = new Date()): Allowance {
  const label = planLabel(s.plan);
  // Даты могут прийти строкой ISO (зависит от драйвера) — приводим надёжно
  const until = toDate(s.subscriptionUntil);
  const subActive =
    (s.plan === "start" || s.plan === "salon") &&
    until !== null &&
    until.getTime() > now.getTime();

  if (subActive) {
    const quota = PLAN_QUOTA[s.plan as "start" | "salon"];
    const used = s.monthlyResetYm === currentYm(now) ? s.monthlyUsed : 0;
    const remaining = Math.max(0, quota - used);
    return {
      allowed: remaining > 0,
      mode: "sub",
      remaining,
      total: quota,
      planLabel: label,
      subscriptionActive: true,
      reason: remaining > 0 ? undefined : "quota_exhausted",
    };
  }

  const remaining = Math.max(0, TRIAL_LIMIT - s.trialUsed);
  return {
    allowed: remaining > 0,
    mode: "trial",
    remaining,
    total: TRIAL_LIMIT,
    planLabel: label,
    subscriptionActive: false,
    reason: remaining > 0 ? undefined : "trial_exhausted",
  };
}
