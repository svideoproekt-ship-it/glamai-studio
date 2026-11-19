// GlamAI Studio — общие типы, палитра и построители промптов.
// Файл используется и на клиенте (данные палитры), и на сервере (сборка промпта).

export type ProductId =
  | "lips"
  | "eyeshadow"
  | "eyeliner"
  | "mascara"
  | "brows"
  | "blush"
  | "contour"
  | "highlighter";

export type FinishId = "matte" | "satin" | "gloss" | "shimmer";

export interface Swatch {
  hex: string;
  name: string; // RU — для тултипа
  en: string; // EN — попадает в промпт
}

export interface FinishOption {
  id: FinishId;
  label: string;
  en: string;
}

export interface ProductDef {
  id: ProductId;
  label: string;
  desc: string;
  swatches: Swatch[];
  defaultColor: string;
  finishes?: FinishOption[];
  defaultFinish?: FinishId;
  defaultEnabled?: boolean;
}

export interface ProductState {
  enabled: boolean;
  color: string;
  intensity: 1 | 2 | 3;
  finish?: FinishId;
}

export interface BrushDef {
  id: string;
  label: string;
  hint: string;
  en: string;
}

export interface StyleDef {
  id: 1 | 2 | 3 | 4 | 5;
  label: string;
  en: string;
}

export const FINISHES: Record<FinishId, FinishOption> = {
  matte: { id: "matte", label: "Матовый", en: "matte" },
  satin: { id: "satin", label: "Сатиновый", en: "satin (no gloss, no shine)" },
  gloss: { id: "gloss", label: "Глянцевый", en: "glossy" },
  shimmer: { id: "shimmer", label: "Мерцающий", en: "shimmer" },
};

export const INTENSITY_LABELS: Record<1 | 2 | 3, string> = {
  1: "Лёгкий",
  2: "Средний",
  3: "Яркий",
};

export const PRODUCTS: ProductDef[] = [
  {
    id: "lips",
    label: "Помада",
    desc: "цвет и финиш губ",
    defaultColor: "#b23a48",
    defaultFinish: "satin",
    finishes: [FINISHES.matte, FINISHES.satin, FINISHES.gloss],
    swatches: [
      { hex: "#b23a48", name: "Кармин", en: "carmine red" },
      { hex: "#8e2a38", name: "Винный", en: "deep wine" },
      { hex: "#7c2430", name: "Тёмная слива", en: "dark plum" },
      { hex: "#c96a5b", name: "Терракота", en: "terracotta" },
      { hex: "#e4574f", name: "Коралл", en: "coral" },
      { hex: "#d98c94", name: "Пудровая роза", en: "soft rosy pink" },
      { hex: "#b9597a", name: "Ягодный нюд", en: "berry nude" },
      { hex: "#e2b6a0", name: "Обнажённый нюд", en: "nude beige" },
    ],
  },
  {
    id: "eyeshadow",
    label: "Тени",
    desc: "оттенок и финиш век",
    defaultColor: "#8a6d3b",
    defaultFinish: "satin",
    finishes: [FINISHES.matte, FINISHES.satin, FINISHES.shimmer],
    swatches: [
      { hex: "#6e5a4e", name: "Тёплый тауп", en: "warm taupe" },
      { hex: "#3e3a45", name: "Дымчатый серый", en: "smoky grey" },
      { hex: "#2e2a28", name: "Уголь", en: "charcoal" },
      { hex: "#8a6d3b", name: "Бронза", en: "bronze" },
      { hex: "#a4846b", name: "Шампань", en: "light golden champagne beige" },
      { hex: "#c7a17a", name: "Золотой песок", en: "golden sand" },
      { hex: "#7a5c40", name: "Какао", en: "cocoa" },
      { hex: "#5c4a6b", name: "Пыльная слива", en: "dusty plum" },
    ],
  },
  {
    id: "eyeliner",
    label: "Подводка / стрелки",
    desc: "акцент вдоль ресниц",
    defaultColor: "#1c1c1e",
    swatches: [
      { hex: "#1c1c1e", name: "Чёрный", en: "jet black" },
      { hex: "#3b2b20", name: "Тёмный шоколад", en: "dark brown" },
      { hex: "#1e7159", name: "Изумруд", en: "emerald green" },
      { hex: "#4a2c3f", name: "Слива", en: "deep plum" },
    ],
  },
  {
    id: "mascara",
    label: "Тушь",
    desc: "объём и разделение ресниц",
    defaultColor: "#1c1c1e",
    swatches: [
      { hex: "#1c1c1e", name: "Чёрный", en: "black" },
      { hex: "#52402f", name: "Коричневый", en: "soft brown" },
    ],
  },
  {
    id: "brows",
    label: "Брови",
    desc: "форма и оттенок",
    defaultColor: "#4a382a",
    swatches: [
      { hex: "#2e241e", name: "Тёмный шоколад", en: "dark chocolate" },
      { hex: "#4a382a", name: "Шатен", en: "chestnut" },
      { hex: "#6b4f3a", name: "Тёплый русый", en: "warm taupe brown" },
      { hex: "#86684c", name: "Светлый русый", en: "soft blonde brown" },
    ],
  },
  {
    id: "blush",
    label: "Румяна",
    desc: "свежий оттенок щёк",
    defaultColor: "#d98a8a",
    defaultFinish: "satin",
    finishes: [FINISHES.matte, FINISHES.satin],
    swatches: [
      { hex: "#d98a8a", name: "Нежная роза", en: "soft rose" },
      { hex: "#c96f6f", name: "Персик", en: "peachy" },
      { hex: "#e0a98f", name: "Абрикос", en: "soft apricot peach" },
      { hex: "#b85c6b", name: "Малина", en: "raspberry" },
      { hex: "#a65e52", name: "Тёплый терракот", en: "warm terracotta" },
    ],
  },
  {
    id: "contour",
    label: "Скульптор",
    desc: "контуринг скул и челюсти",
    defaultColor: "#8a6752",
    swatches: [
      { hex: "#9c7b62", name: "Светлый бронзер", en: "light bronze" },
      { hex: "#8a6752", name: "Мягкий тёплый", en: "soft warm brown" },
      { hex: "#75584a", name: "Нейтральный", en: "neutral brown" },
    ],
  },
  {
    id: "highlighter",
    label: "Хайлайтер",
    desc: "сияние на скулах",
    defaultColor: "#f2dfb8",
    swatches: [
      { hex: "#f2dfb8", name: "Золотое шампанское", en: "golden champagne" },
      { hex: "#e8c890", name: "Медовый", en: "honey gold" },
      { hex: "#efd9c8", name: "Перламутр", en: "pearl" },
      { hex: "#e5e0d5", name: "Ледяной", en: "icy highlight" },
    ],
  },
];

export const BRUSHES: BrushDef[] = [
  {
    id: "fluffy",
    label: "Пушистая кисть",
    hint: "мягкая растушёвка теней",
    en: "softly diffused, seamlessly blended color transitions",
  },
  {
    id: "flat",
    label: "Плоская кисть",
    hint: "чёткие грани и аккуратная укладка цвета",
    en: "crisp sharp edges and precise color placement",
  },
  {
    id: "sponge",
    label: "Спонж",
    hint: "аэрографный тон без полос",
    en: "airbrushed, seamless base finish",
  },
  {
    id: "pencil",
    label: "Карандаш",
    hint: "прорисовка мелких деталей",
    en: "fine pencil-drawn detailing",
  },
  {
    id: "fan",
    label: "Веерная кисть",
    hint: "лёгкая вуаль хайлайтера",
    en: "a light feathered veil of highlighter",
  },
  {
    id: "spoolie",
    label: "Щёточка для бровей",
    hint: "естественные зачёсанные брови",
    en: "fluffy brushed-up brows with soft shading",
  },
];

// Стили образа — БЛОК 1 конструктора («Стиль, образ»). Управляет только
// ПЛОТНОСТЬЮ нанесения перечисленных продуктов, но не цветами — иначе слова
// "depth/definition/bold" уводят оттенки в темноту.
// Формулировки короткие: промпт должен влезать в «внимание» edit-модели целиком.
export const STYLES: StyleDef[] = [
  { id: 1, label: "Натуральный", en: "minimal barely-there application of the listed products" },
  { id: 2, label: "Дневной", en: "clean everyday application of the listed products" },
  { id: 3, label: "Вечерний", en: "evening application, a bit stronger and more defined, still elegant" },
  { id: 4, label: "Подиумный", en: "runway application at full strength, strictly in the listed shades" },
  {
    id: 5,
    label: "Возрастной",
    en: "age-graceful makeup for mature skin: soft hydrating satin finish, gentle warm shades, featherlight application around fine lines, nothing heavy and nothing drying",
  },
];

// ============================================================
// КОНСТРУКТОР v36: три блока — «Стиль, образ» → «Лицо» → «Глаза»
// ============================================================

/** Блок 2 «Лицо»: помада, румяна, скульптор, хайлайтер */
export type FaceProductId = "lips" | "blush" | "contour" | "highlighter";
export const FACE_PRODUCT_IDS: FaceProductId[] = ["lips", "blush", "contour", "highlighter"];

/** Блок 3 «Глаза»: ресницы (стрелки), брови, веки */
export type EyeAreaId = "lashes" | "brows" | "lids";
export const EYE_AREA_IDS: EyeAreaId[] = ["lashes", "brows", "lids"];

export interface AreaOptionDef {
  id: string;
  label: string;
  en: string;
}

/** Варианты «Ресницы»: форма стрелок (+ «только тушь») */
export const LASH_OPTIONS: AreaOptionDef[] = [
  { id: "none", label: "Без стрелки — только тушь", en: "no wing" },
  { id: "classic", label: "Классическая стрелка", en: "classic winged eyeliner, the wing flicking upward from the outer corner" },
  { id: "double", label: "Двойная стрелка", en: "double winged eyeliner, two parallel lines along the lash line" },
  { id: "arabic", label: "Арабская стрелка", en: "Arabic-style eyeliner tracing the whole upper lid into a sharp wing" },
  { id: "cat", label: "Кошачий глаз", en: "cat-eye eyeliner, elongated slanted wing" },
  { id: "hollywood", label: "Голливудская стрелка", en: "Hollywood-style eyeliner, thin elegant deep-set wing" },
  { id: "egyptian", label: "Египетская стрелка", en: "Egyptian-style eyeliner, straight heavy wing extending the whole upper lash line" },
  { id: "smoky", label: "Дымчатая растушёвка", en: "smudged smoky pencil lash line, softly diffused" },
];

/** Варианты «Брови»: форма */
export const BROW_OPTIONS: AreaOptionDef[] = [
  { id: "straight", label: "Прямые", en: "straight brows" },
  { id: "horizontal", label: "Горизонтальные", en: "horizontal low-arch brows" },
  { id: "arched", label: "Дугообразные", en: "softly arched brows" },
  { id: "curved", label: "Изогнутые домиком", en: "brows with a high curved peak" },
  { id: "wide", label: "Широкие густые", en: "wide full brows" },
  { id: "thin", label: "Тонкие изящные", en: "thin refined brows" },
  { id: "natural", label: "Естественные пушистые", en: "natural fluffy brushed-up brows" },
];

/** Варианты «Веки»: техника нанесения теней */
export const LID_OPTIONS: AreaOptionDef[] = [
  { id: "banana", label: "Банан", en: "banana technique, crescent shading above the crease" },
  { id: "loop", label: "Петля", en: "loop technique, color wrapping around the crease" },
  { id: "bat", label: "Летучая мышь", en: "bat-wing technique, color lifted into a sharp outer wing" },
  { id: "smoky", label: "Дымка (смоки-айс)", en: "smoky eyes, softly diffused shading" },
  { id: "cut", label: "Кутикс (cut crease)", en: "cut crease, sharply separated lid color" },
  { id: "hollywood", label: "Голливудская дымка", en: "Hollywood-style deep-set shading" },
];

export const EYE_OPTION_CATALOGS: Record<EyeAreaId, AreaOptionDef[]> = {
  lashes: LASH_OPTIONS,
  brows: BROW_OPTIONS,
  lids: LID_OPTIONS,
};

/** Состояние одной области глаз: вкл/выкл, вариант, оттенок, плотность, финиш */
export interface EyeAreaState {
  enabled: boolean;
  option: string;
  color: string;
  intensity: 1 | 2 | 3;
  finish?: FinishId; // только для век
}

/** Инструменты лица (id из BRUSHES) и инструменты глаз */
export const FACE_TOOLS: string[] = ["sponge", "fluffy", "fan"];
export const EYE_TOOLS: string[] = ["flat", "fluffy", "pencil", "spoolie"];

/** Что выбрал мастер в конструкторе — летит в /api/tryon и в сборку промпта */
export interface SelectionInput {
  style: number; // id из STYLES (1–5)
  face: Partial<Record<FaceProductId, ProductState>>;
  eyes: Partial<Record<EyeAreaId, EyeAreaState>>;
  faceTools: string[];
  eyeTools: string[];
}

/** Дефолты блока «Лицо»: всё выключено, цвет — первый оттенок палитры */
export function defaultFace(): Record<FaceProductId, ProductState> {
  const out = {} as Record<FaceProductId, ProductState>;
  for (const id of FACE_PRODUCT_IDS) {
    const def = PRODUCTS.find((p) => p.id === id);
    out[id] = {
      enabled: false,
      color: def?.defaultColor ?? "#000000",
      intensity: 2,
      finish: def?.defaultFinish,
    };
  }
  return out;
}

/** Дефолты блока «Глаза»: всё выключено, вариант — самый универсальный */
export function defaultEyes(): Record<EyeAreaId, EyeAreaState> {
  const colorOf = (id: ProductId) => PRODUCTS.find((p) => p.id === id)?.defaultColor ?? "#000000";
  return {
    lashes: { enabled: false, option: "classic", color: colorOf("eyeliner"), intensity: 2 },
    brows: { enabled: false, option: "natural", color: colorOf("brows"), intensity: 2 },
    lids: { enabled: false, option: "banana", color: colorOf("eyeshadow"), intensity: 2, finish: "satin" },
  };
}

const clampStyle = (v: unknown): number => {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 2;
  return (n >= 1 && n <= 5 ? n : 2) as 1 | 2 | 3 | 4 | 5;
};

const cleanTools = (list: unknown, allowed: string[]): string[] =>
  Array.isArray(list) ? [...new Set(list.filter((x): x is string => typeof x === "string" && allowed.includes(x)))] : [];

/**
 * Приводит тело запроса к полному SelectionInput: дозаполняет дефолты,
 * отбрасывает неизвестные id и понимает СТАРЫЙ формат конструктора
 * (products/brushes/overall) — для вкладок, открытых до обновления.
 */
export function normalizeSelection(
  raw: {
    style?: unknown;
    face?: Record<string, ProductState>;
    eyes?: Record<string, EyeAreaState>;
    faceTools?: unknown;
    eyeTools?: unknown;
    legacy?: { products?: Record<string, ProductState>; brushes?: unknown; overall?: unknown };
  }
): SelectionInput {
  // Полные Record'ы: циклы ниже заполняют ВСЕ id, поэтому тип без Partial —
  // и в legacy-блоке не нужны лишние проверки на undefined
  const face = {} as Record<FaceProductId, ProductState>;
  for (const id of FACE_PRODUCT_IDS) {
    const s = raw.face?.[id];
    face[id] = {
      enabled: Boolean(s?.enabled),
      color: s && HEX_RE.test(s.color) ? s.color : defaultFace()[id].color,
      intensity: s?.intensity === 1 || s?.intensity === 3 ? s.intensity : 2,
      finish: s?.finish,
    };
  }

  const eyes = {} as Record<EyeAreaId, EyeAreaState>;
  for (const id of EYE_AREA_IDS) {
    const s = raw.eyes?.[id];
    const base = defaultEyes()[id];
    const catalog = EYE_OPTION_CATALOGS[id];
    const option = s && catalog.some((o) => o.id === s.option) ? s.option : base.option;
    eyes[id] = {
      enabled: Boolean(s?.enabled),
      option,
      color: s && HEX_RE.test(s.color) ? s.color : base.color,
      intensity: s?.intensity === 1 || s?.intensity === 3 ? s.intensity : 2,
      finish: id === "lids" ? (s?.finish === "matte" || s?.finish === "shimmer" ? s.finish : "satin") : undefined,
    };
  }

  // Совместимость: старый клиент присылает products/brushes/overall
  const legacy = raw.legacy;
  const legacyProducts = legacy?.products;
  const hasNewShape = Object.values(raw.face ?? {}).some(Boolean) || Object.values(raw.eyes ?? {}).some(Boolean);
  if (!hasNewShape && legacyProducts) {
    const mapIntensity = (v: unknown): 1 | 2 | 3 => (v === 1 || v === 3 ? v : 2);
    for (const id of FACE_PRODUCT_IDS) {
      const s = legacyProducts[id];
      if (s?.enabled) face[id] = { enabled: true, color: HEX_RE.test(s.color) ? s.color : face[id].color, intensity: mapIntensity(s.intensity), finish: s.finish };
    }
    const esh = legacyProducts["eyeshadow"];
    if (esh?.enabled) eyes.lids = { enabled: true, option: "banana", color: HEX_RE.test(esh.color) ? esh.color : eyes.lids.color, intensity: mapIntensity(esh.intensity), finish: esh.finish === "matte" || esh.finish === "shimmer" ? esh.finish : "satin" };
    const lin = legacyProducts["eyeliner"];
    const mas = legacyProducts["mascara"];
    if (lin?.enabled || mas?.enabled) {
      eyes.lashes = {
        enabled: true,
        option: lin?.enabled ? "classic" : "none",
        color: HEX_RE.test(lin?.color ?? "") ? (lin?.color as string) : eyes.lashes.color,
        intensity: mapIntensity(lin?.intensity ?? mas?.intensity),
      };
    }
    const br = legacyProducts["brows"];
    if (br?.enabled) eyes.brows = { enabled: true, option: "natural", color: HEX_RE.test(br.color) ? br.color : eyes.brows.color, intensity: mapIntensity(br.intensity) };
  }

  const legacyBrushes = Array.isArray(legacy?.brushes) ? (legacy?.brushes as string[]) : [];
  const faceTools = cleanTools(raw.faceTools, FACE_TOOLS).length || !legacyBrushes.length
    ? cleanTools(raw.faceTools, FACE_TOOLS)
    : legacyBrushes.filter((b) => FACE_TOOLS.includes(b));
  const eyeTools = cleanTools(raw.eyeTools, EYE_TOOLS).length || !legacyBrushes.length
    ? cleanTools(raw.eyeTools, EYE_TOOLS)
    : legacyBrushes.filter((b) => EYE_TOOLS.includes(b));

  return { style: clampStyle(raw.style ?? legacy?.overall), face, eyes, faceTools, eyeTools };
}

export interface PromptBuildInput {
  selection: SelectionInput;
  userPrompt: string;
}

export function hasSelection(sel: SelectionInput, userPrompt: string): boolean {
  return (
    Boolean(userPrompt.trim()) ||
    Object.values(sel.face).some((p) => p?.enabled) ||
    Object.values(sel.eyes).some((e) => e?.enabled)
  );
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
// Интенсивность = плотность покрытия. Короткие формы: длинные описания вымывают
// цветовые якоря из промпта (edit-модель читает промпт целиком, но «забывает» середину).
const INTENSITY_EN: Record<1 | 2 | 3, string> = {
  1: "sheer",
  2: "semi-sheer",
  3: "opaque",
};
const EYELINER_THICKNESS: Record<1 | 2 | 3, string> = {
  1: "hairline",
  2: "thin",
  3: "bold wide",
};
// Хайлайтер: слово "highlighter" у модели тянет белую полосу — гасим по интенсивности
const HIGHLIGHTER_EN: Record<1 | 2 | 3, string> = {
  1: "faint dewy sheen",
  2: "soft glow",
  3: "bright metallic glow",
};

// Разложение hex на HSL (h: 0..360, s/l: 0..1)
function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return { h, s, l };
}

// Явное слово светлоты — модели часто «съезжают» по яркости, фиксируем словами
function lightnessWord(l: number): string {
  if (l < 0.14) return "very deep";
  if (l < 0.28) return "deep";
  if (l < 0.42) return "medium-dark";
  if (l < 0.6) return "mid-tone";
  if (l < 0.75) return "light";
  if (l < 0.88) return "very light";
  return "pale";
}

// Явное слово насыщенности — фиксируем, чтобы не уезжало в неон или серость
function saturationWord(s: number): string {
  if (s < 0.12) return "grayish";
  if (s < 0.28) return "muted";
  if (s < 0.45) return "dusty";
  if (s < 0.65) return "softly saturated";
  if (s < 0.85) return "saturated";
  return "vivid";
}

// Словесное описание произвольного оттенка (HSL) — модели понимают слова лучше, чем hex.
// Формат всегда включает явные слова светлоты и насыщенности.
export function describeColor(hex: string): string {
  const hsl = hexToHsl(hex);
  if (!hsl) return "natural shade";
  const { h, s, l } = hsl;

  // Ахроматические оттенки
  if (s < 0.09 || l < 0.045 || l > 0.975) {
    if (l < 0.16) return "jet black";
    if (l < 0.32) return "charcoal grey";
    if (l < 0.58) return "medium grey";
    if (l < 0.82) return "soft silver grey";
    return "pearl white";
  }

  // У очень светлых цветов формула насыщенности завышает — гасим
  const sEff = l > 0.8 ? s * 0.75 : s;

  // Терракотовая зона: приглушённые тёплые (3–20°) человек читает как терракоту,
  // а не как красный; слово red уводит модель в малиновый (жалоба тестировщика)
  if (h >= 3 && h < 20 && s >= 0.3 && s < 0.78 && l >= 0.4 && l < 0.72) {
    return `${lightnessWord(l)} ${saturationWord(sEff)} terracotta`;
  }

  // Коричневая зона (тёплые, затемнённые, умеренно насыщенные)
  if (h >= 15 && h <= 55 && l < 0.45 && s < 0.6) {
    if (l < 0.16) return "very deep espresso brown";
    if (l < 0.3) return s < 0.25 ? "deep cool taupe brown" : "dark chocolate brown";
    return s < 0.3 ? "medium-dark muted mushroom taupe" : "medium-dark golden brown";
  }

  // Голое имя семейства оттенка (без слов светлоты/насыщенности)
  let core: string;
  if (h < 14 || h >= 348) {
    // Тёплые приглушённые красные (5–14°) — «кирпичные»: слово red без уточнения
    // тянет модель к розово-красному (жалоба тестировщика)
    core = l < 0.42 ? "wine red" : h >= 5 && h < 14 && s < 0.7 ? "brick red" : "red";
  }
  else if (h < 24) core = l > 0.75 ? "peach" : "terracotta";
  else if (h < 40) core = l < 0.35 ? "bronze" : s > 0.78 ? "orange" : l > 0.78 ? "apricot" : "caramel";
  else if (h < 62) core = l < 0.35 ? "olive bronze" : "golden sand";
  else if (h < 92) core = s > 0.6 ? "lime green" : l < 0.35 ? "olive green" : "pistachio green";
  else if (h < 160) core = l < 0.3 ? "forest green" : l > 0.72 ? "mint green" : "fresh green";
  else if (h < 190) core = l < 0.32 ? "emerald green" : "teal";
  else if (h < 228) core = l < 0.3 ? "navy blue" : l > 0.72 ? "baby blue" : "sky blue";
  else if (h < 255) core = l < 0.3 ? "navy blue" : "classic blue";
  else if (h < 268) core = l > 0.72 ? "lavender" : "violet";
  else if (h < 292) core = "plum purple";
  else if (h < 320) core = l < 0.35 ? "magenta" : "orchid pink";
  else core = l > 0.78 ? "baby pink" : l < 0.35 ? "berry pink" : "rose pink";

  const parts: string[] = [];
  const lWord = lightnessWord(l);
  const sWord = saturationWord(sEff);
  if (!core.includes(lWord)) parts.push(lWord);
  if (!core.includes(sWord)) parts.push(sWord);
  parts.push(core);
  return parts.join(" ");
}

// Полная цветовая фраза для промпта: имя пресета (если есть) + словесное описание + hex-якорь.
// Hex — «источник истины», слова объясняют тот же цвет на человеческом языке.
// Формат компактный: длинные связки выталкивают якоря из «памяти» edit-модели.
function colorPhrase(hex: string, presetEn?: string): string {
  const up = HEX_RE.test(hex) ? hex.toUpperCase() : "";
  const desc = describeColor(hex);
  const core = presetEn && presetEn !== desc ? `${presetEn}, ${desc}` : desc;
  return up ? `${core} (hex ${up})` : core;
}

// Цветовая фраза для hex из палитры конкретного продукта: имя пресета (если есть)
// + словесное описание + hex-якорь
function colorPhraseFor(hex: string, productId: ProductId): string {
  const def = PRODUCTS.find((p) => p.id === productId);
  if (!def) return "neutral";
  const valid = HEX_RE.test(hex) ? hex : def.defaultColor;
  const preset = def.swatches.find((s) => s.hex.toLowerCase() === valid.toLowerCase());
  return colorPhrase(valid, preset?.en);
}

// Сбор элементов образа из состояния конструктора — общий для промпта и QA-аудита.
// Компактный формат: сначала лицо, потом глаза. Выбранный стиль (блок 1) задаёт
// плотность нанесения всего списка.
function collectLookItems(sel: SelectionInput): string[] {
  const items: string[] = [];

  // —— Лицо ——
  const lips = sel.face.lips;
  if (lips?.enabled) {
    const fin = lips.finish ? `, ${FINISHES[lips.finish]?.en ?? "satin"}` : "";
    items.push(`lips: lipstick ${colorPhraseFor(lips.color, "lips")}${fin}, ${INTENSITY_EN[lips.intensity]}`);
  }
  const blush = sel.face.blush;
  if (blush?.enabled) {
    const fin = blush.finish ? `, ${FINISHES[blush.finish]?.en ?? "satin"}` : "";
    items.push(`cheeks: blush ${colorPhraseFor(blush.color, "blush")}${fin}, ${INTENSITY_EN[blush.intensity]}`);
  }
  const contour = sel.face.contour;
  if (contour?.enabled) {
    items.push(
      `under cheekbones and jaw: contour ${colorPhraseFor(contour.color, "contour")}, ${
        contour.intensity === 3 ? "visible" : contour.intensity === 2 ? "soft" : "barely visible"
      }`
    );
  }
  const highlighter = sel.face.highlighter;
  if (highlighter?.enabled) {
    items.push(
      `top of cheekbones: highlighter ${colorPhraseFor(highlighter.color, "highlighter")}, ${HIGHLIGHTER_EN[highlighter.intensity]}`
    );
  }

  // —— Глаза ——
  const lashes = sel.eyes.lashes;
  if (lashes?.enabled) {
    const opt = LASH_OPTIONS.find((o) => o.id === lashes.option) ?? LASH_OPTIONS[1];
    if (opt.id !== "none") {
      items.push(
        `lash line: ${EYELINER_THICKNESS[lashes.intensity]} ${opt.en} in ${colorPhraseFor(lashes.color, "eyeliner")}`
      );
    }
    items.push(
      `lashes: ${
        lashes.intensity === 3
          ? "volumizing"
          : lashes.intensity === 2
            ? "naturally defined"
            : "one light coat of"
      } black mascara`
    );
  }
  const brows = sel.eyes.brows;
  if (brows?.enabled) {
    const opt = BROW_OPTIONS.find((o) => o.id === brows.option) ?? BROW_OPTIONS[6];
    items.push(
      `brows: shaped as ${opt.en}, filled ${colorPhraseFor(brows.color, "brows")}, hair-like strokes, ${INTENSITY_EN[brows.intensity]}`
    );
  }
  const lids = sel.eyes.lids;
  if (lids?.enabled) {
    const opt = LID_OPTIONS.find((o) => o.id === lids.option) ?? LID_OPTIONS[0];
    const fin = lids.finish ? `, ${FINISHES[lids.finish]?.en ?? "satin"}` : "";
    items.push(
      `eyelids: eyeshadow ${colorPhraseFor(lids.color, "eyeshadow")}${fin}, ${opt.en}, ${INTENSITY_EN[lids.intensity]}`
    );
  }

  return items;
}

export function buildPrompt(input: PromptBuildInput): string {
  const sel = input.selection;
  const parts: string[] = [];

  // Идентичность — в начало: модели держат начало и конец промпта лучше всего.
  // Всё сжато: длинный промпт (>600 токенов) теряет середину — цвета и симметрию.
  parts.push(
    "Photo edit: change ONLY the makeup. Keep the person 100% identical — same face shape and features, same skin tone with natural texture, same eyes (same state, gaze and shape; the eyes are never painted over), same lashes unless lashes are listed below, brows keep their shape unless a brow style is listed below, same hair, clothes, background and pose."
  );

  const enabledCount =
    Object.values(sel.face).filter((p) => p?.enabled).length +
    Object.values(sel.eyes).filter((e) => e?.enabled).length;
  if (enabledCount > 0 && enabledCount <= 2) {
    parts.push(
      "Apply ONLY the products listed below; every other area stays bare and natural, exactly as in the photo. Do not add anything unlisted — no extra blush, bronzer, eyeshadow or lip tint."
    );
  } else {
    parts.push(
      "Apply the makeup listed below, exactly in these shades; every other area stays natural."
    );
  }

  // Блок 1 «Стиль, образ»: выбранная кнопка задаёт плотность нанесения всего списка
  const style = STYLES.find((s) => s.id === sel.style) ?? STYLES[1];
  parts.push(`Style: ${style.en}.`);

  const chosen = collectLookItems(sel);
  const wish = input.userPrompt.trim();

  if (chosen.length) {
    parts.push(`Makeup: ${chosen.join("; ")}.`);
    parts.push(
      "COLORS: match every hex exactly — same lightness, same saturation, same hue; do not brighten or darken. SYMMETRY: both eyes exactly the same color and shape, both cheeks the same, as if applied with the same brush at the same moment."
    );
    if (wish) {
      parts.push(`Note: "${wish}" — styling only, the listed shades stay exactly as specified.`);
    }
  } else {
    parts.push(`Apply the makeup described in the note: "${wish}".`);
  }

  // Инструменты (блок «Лицо» и блок «Глаза»): одна и та же пушистая кисть может
  // быть выбрана в обоих блоках — дедуплицируем идентификаторы
  const techniques = [...new Set([...sel.faceTools, ...sel.eyeTools])]
    .map((id) => BRUSHES.find((b) => b.id === id)?.en)
    .filter(Boolean) as string[];
  if (techniques.length) {
    parts.push(`Blending: ${techniques.join("; ")}.`);
  }

  parts.push(
    "Output: a realistic photo of the same person wearing this makeup — no retouching beyond the makeup itself: no skin smoothing or beautification filters, no reshaping of face or body, no added text, logos or watermarks."
  );

  return parts.join(" ");
}

// Краткая сводка «что просили» — вход для QA-аудита в API
export function buildRequestedSummary(input: PromptBuildInput): string {
  const items = collectLookItems(input.selection);
  if (items.length) return items.join("; ");
  const wish = input.userPrompt.trim();
  return wish ? `the makeup described in the note: "${wish}"` : "a clean natural look";
}

// QA-аудит результата: сравниваем «что просили» и «что получилось».
// Возвращаем строгий вердикт — он же становится обратной связью для ретрая.
export function buildAuditPrompt(requested: string): string {
  return [
    "You are a strict QA inspector for a virtual-makeup app. Image 1 = the ORIGINAL photo. Image 2 = the RESULT after AI applied makeup.",
    `The result was SUPPOSED to contain exactly this makeup and nothing else: ${requested}`,
    "Compare and answer strictly in this format:",
    "SHADES: for each requested item, 'requested X -> saw Y; ok/close/off'",
    "EXTRA: makeup items visible in the result that were not requested, or 'none'",
    "EYES: 'same' if the eyes kept their original state (open/closed, gaze, iris color) — else describe what changed",
    "SYMMETRY: 'ok' if both eyes have identical eyeshadow/eyeliner (same color and shape) and both cheeks match, else describe the asymmetry",
    "FACE: 'yes' if it is clearly the same person with unchanged face geometry, else 'no'",
    "WEIRD: 'no' if the skin and photo look natural, else describe the artifact (smoothing, repainted skin, distortions)",
    "ISSUES: a single line listing only the REAL problems worth fixing (shade mismatches marked 'off', missing items, real extras, eye/face changes, asymmetry between the two eyes, heavy artifacts). If everything is acceptable, write 'none'.",
  ].join("\n");
}

// Корректирующий ретрай: исходный промпт + конкретные замечания аудитора (коротко)
export function buildCorrectivePrompt(originalPrompt: string, issues: string): string {
  return [
    originalPrompt,
    `QC feedback on the previous attempt: ${issues.trim()}`,
    "Regenerate with these problems fixed; keep everything that was already correct unchanged.",
  ].join(" ");
}

// Вопрос к vision-модели: «снять рецепт» макияжа с референса.
// Ключевые правила: без base/skin (иначе edit перекрашивает всё лицо → гротеск),
// честная оценка интенсивности, запрет драматизирующих слов.
export const REFERENCE_VISION_PROMPT =
  "You are a professional makeup artist looking at a makeup reference photo. Describe ONLY the makeup, as a short recipe another artist can recreate on a different face.\nRules:\n- List only areas with clearly visible makeup: eyeshadow, eyeliner, lashes, brows, lips, blush, contour, highlighter. NEVER describe foundation, base or skin — the other artist keeps their own skin.\n- For each area give: the exact shade as a specific color name (for example 'burnt orange', 'dusty rose', 'champagne beige' — never just 'dark' or 'bright'), the finish (matte/satin/glossy/shimmer), where it sits, and an honest intensity word: 'sheer', 'light', 'moderate' or 'strong'.\n- Look carefully and honestly: the recipe must match what is really on the face. If the reference is stage or editorial makeup, report the actual shades and intensity as they are — do not exaggerate, do not add drama that is not there.\n- Use calm, literal, technical language, like a professional makeup chart. Do not use the words bold, dramatic, striking, glamorous, editorial, smoldering, piercing, flawless, smoky haze, otherworldly.\n- The recipe will be recreated on a real client's photo, so describe a wearable, realistic version of this makeup.\n- Maximum 90 words, numbered list, in English. Do not describe the person, face, hair, skin, clothing, mood or lighting — only the makeup products and shades.";

// Промпт редактирования по «рецепту» с референса — компактный и щадящий:
// только макияж, ничего кроме макияжа, никакой стилизации.
export function buildReferenceEditPrompt(recipe: string, comment: string): string {
  const parts: string[] = [];

  parts.push(
    "Photo edit: change ONLY the makeup, following the recipe. Apply it to the person in the photo."
  );
  parts.push(`MAKEUP RECIPE (from the reference photo): ${recipe.trim()}`);
  parts.push(
    "Apply exactly the recipe items and shades, adapted to this person's features. Sheer or light stays subtle. Nothing beyond the recipe; if an item is extreme, apply a softer wearable version."
  );
  parts.push(
    "COLORS: match every recipe shade exactly — same lightness, same saturation, same hue. SYMMETRY: both eyes exactly the same color and shape, both cheeks the same."
  );
  parts.push(
    "Keep the person 100% identical — same face shape and features, same skin tone with natural texture, same eyes (never repainted, iris unchanged), same brows, same hair, clothes, background and pose. Take nothing from the reference photo except the makeup shades and placement."
  );

  const wish = comment.trim();
  if (wish) {
    parts.push(`Note: "${wish}" — styling only, the recipe shades stay exactly as specified.`);
  }

  parts.push(
    "Output: a realistic photo of the same person wearing this makeup — no retouching beyond the makeup itself: no skin smoothing or beautification filters, no reshaping of face or body, no added text, logos or watermarks."
  );

  return parts.join(" ");
}
