// Тарифная сетка v49 — единый источник правды для розничных пакетов.
//
// Модель (зафиксирована с владельцем 28.11.2026, цены в звёздах — 28.11.2026):
//  · Массовый контур: 1 генерация бесплатно, дальше поштучно 14,9 ₽.
//  · «Пять за 74» — 5 генераций за 74 ₽ (5 × 14,9 = 74,5, округлили
//    в пользу клиента; выходит по 14,8 ₽ за генерацию).
//  · «Старт» — 690 ₽ разово за 46 генераций (690 / 14,9 = 46,3 → 46;
//    в пересчёте ровно 15 ₽ за генерацию). Идёт СВЕРХ бесплатных примерок.
//  · «Салон» (студийный) — 2 490 ₽/мес подписка: 170 генераций в месяц
//    для студии + 3 бесплатных примерки каждому клиенту студии
//    (реализуется бонусом +2 к триалу при атрибуции по ссылке студии;
//    было 5 примерок — владелец 28.11.2026 сократил до трёх).
//
// Цены в Звёздах Telegram (XTR) — ФИКСИРОВАННЫЕ, подобраны по принципу
// «для клиента те же деньги»: звезда стоит у магазина ~1,6–1,7 ₽, значит
// 9★ ≈ 15 ₽ (поштучно), 45★ ≈ 74 ₽ («Пять за 74»), 430★ ≈ 700 ₽ («Старт»).
// Курс магазина меняется — поправь цену пакета в Vercel → Environment
// Variables (STARS_GEN1 / STARS_FIVE74 / STARS_START46), код трогать не нужно.

function starsEnv(name: string, def: number): number {
  const v = Math.round(Number(process.env[name] ?? def) || def);
  return Math.max(1, v);
}

/** Поштучная генерация в звёздах (≈ 14,9 ₽ для клиента). */
export const STARS_GEN1 = starsEnv("STARS_GEN1", 9);
/** Пакет «Пять за 74» в звёздах (≈ 74 ₽ для клиента). */
export const STARS_FIVE74 = starsEnv("STARS_FIVE74", 45);
/** Пакет «Старт» (46 генераций) в звёздах — 430★ решением владельца. */
export const STARS_START46 = starsEnv("STARS_START46", 430);

export type PackId = "gen1" | "five74" | "start46";

export interface RetailPack {
  id: PackId;
  /** Название для кнопки в paywall */
  title: string;
  /** Сколько генераций зачисляем на баланс */
  generations: number;
  /** Цена в рублях (для отображения рядом со звёздами) */
  rub: number;
  /** Цена в Звёздах Telegram — именно она идёт в счёт XTR */
  stars: number;
  /** Короткая подпись-преимущество */
  perk: string;
  /** Метка «выгодно» — подсветка карточки */
  best?: boolean;
}

export const RETAIL_PACKS: RetailPack[] = [
  {
    id: "gen1",
    title: "Одна генерация",
    generations: 1,
    rub: 14.9,
    stars: STARS_GEN1,
    perk: "попробовать прямо сейчас",
  },
  {
    id: "five74",
    title: "Пять за 74",
    generations: 5,
    rub: 74,
    stars: STARS_FIVE74,
    perk: "по 14,8 ₽ — выгоднее поштучной",
    best: true,
  },
  {
    id: "start46",
    title: "Старт",
    generations: 46,
    rub: 690,
    stars: STARS_START46,
    perk: "46 генераций — рабочий запас мастера",
  },
];

export function packById(id: string): RetailPack | null {
  return RETAIL_PACKS.find((p) => p.id === id) ?? null;
}

/** Бесплатных генераций у розничного пользователя (без студии). */
export const MASS_TRIAL_LIMIT = 1;

/** Сколько бесплатных примерок получает клиент СТУДИИ: 1 базовая + 2 бонуса
 *  = 3 примерки (сокращено с пяти решением владельца 28.11.2026). */
export const STUDIO_TRIAL_BONUS = 2;
export const STUDIO_TRIAL_TOTAL = MASS_TRIAL_LIMIT + STUDIO_TRIAL_BONUS; // 3

/** Салон: подписка 2 490 ₽/мес, 170 генераций в месяц. */
export const SALON_PRICE_RUB = 2490;
export const SALON_MONTHLY_QUOTA = 170;
