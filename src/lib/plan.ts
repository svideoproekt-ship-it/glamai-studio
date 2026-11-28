// Тарифная модель GlamAI Studio (чистая логика, без обращений к БД/сети).
// v49: розница — 1 бесплатная генерация + баланс купленных генераций
// («Пять за 74», «Старт» на 46 — см. lib/tariffs.ts); «Салон» — студийная
// подписка 170 генераций в месяц. Клиент студии получает 3 бесплатных
// примерки: 1 базовая + 2 бонуса, которые начисляются при атрибуции
// (сокращено с пяти решением владельца 28.11.2026).

import { MASS_TRIAL_LIMIT, SALON_MONTHLY_QUOTA } from "@/lib/tariffs";

export type PlanName = "trial" | "start" | "salon";

/** Цена в рублях (ручные продажи: «Старт» — разово, «Салон» — в месяц). */
export const PLAN_PRICES: Record<"start" | "salon", number> = {
  start: 690,
  salon: 2490,
};

/** Лимит генераций по платным тарифам. «Старт» с v49 — разовый пакет на 46
 *  генераций (без месяца); квота ниже — только для старых подписок,
 *  выданных вручную до перехода на пакетную модель. */
export const PLAN_QUOTA: Record<"start" | "salon", number> = {
  start: 60,
  salon: SALON_MONTHLY_QUOTA,
};

/** Сколько генераций даём бесплатно розничному пользователю.
 *  v49 — ОДНА (было 5). Клиент студии получает три: 1 базовая + 2 бонуса
 *  при атрибуции по ссылке студии (см. store.ts → attachStudioBySlug).
 *  Если на Vercel задана переменная TRIAL_LIMIT — она перекрывает дефолт:
 *  для новой модели удали её или поставь 1. */
export const TRIAL_LIMIT = Math.max(
  1,
  Number(process.env.TRIAL_LIMIT ?? MASS_TRIAL_LIMIT) || MASS_TRIAL_LIMIT
);

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
  /** Дополнительные бесплатные генерации (v41): добор от салона/владельца,
   *  увеличивает пробный лимит сверху — расходуется наравне с обычными. */
  bonusGenerations?: number;
  /** v49: баланс КУПЛЕННЫХ генераций («Пять за 74», «Старт», поштучные).
   *  Расходуется после бесплатных, не имеет срока. */
  paidGenerations?: number;
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
  /** Сколько из общего лимита — бонусные генерации (v41, только для trial) */
  bonus?: number;
  /** v49: осталось бесплатных (триал + бонус), без купленных */
  trialRemaining?: number;
  /** v49: остаток купленного баланса (не имеет срока) */
  paidRemaining?: number;
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

  // Пробный лимит + бонусные генерации (добор «+5» от салона или владельца).
  // Расходуются из одного счётчика trial_used — бонус просто поднимает потолок.
  // v49: после бесплатных расходуется купленный баланс (paid_generations).
  const bonus = Math.max(0, Math.floor(s.bonusGenerations ?? 0));
  const paid = Math.max(0, Math.floor(s.paidGenerations ?? 0));
  const total = TRIAL_LIMIT + bonus;
  const trialRemaining = Math.max(0, total - s.trialUsed);
  const remaining = trialRemaining + paid;
  return {
    allowed: remaining > 0,
    mode: "trial",
    remaining,
    total,
    planLabel: label,
    subscriptionActive: false,
    bonus,
    trialRemaining,
    paidRemaining: paid,
    reason: remaining > 0 ? undefined : "trial_exhausted",
  };
}
