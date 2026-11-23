// Массовое добавление студий списком (v48).
// Чистые функции без обращений к БД: разбор вставленного в админке списка
// и формат отчёта. Один источник правды и для клиента (форма в /admin),
// и для сервера (action studio_import), и для тестов.

export interface StudioImportItem {
  name: string;
  slug: string;
  bookingUrl?: string;
  note?: string;
}

export interface StudioImportSkip {
  slug: string;
  reason: string;
}

export interface StudioImportReport {
  added: { slug: string; name: string }[];
  updated: { slug: string; name: string }[];
  /** Ручные записи с приставкой studio-… переименованы в правильный слаг. */
  fixed: { slug: string; name: string; oldSlug: string }[];
  skipped: StudioImportSkip[];
}

export const MAX_IMPORT_ROWS = 200;

/**
 * Приводит слаг к виду базы. Ссылки писем выглядят как
 * ?start=studio_<slug>, поэтому слаг в базе хранится БЕЗ приставки
 * studio-. Ручной ввод часто несёт её же (@studio_dunaeva-nsk,
 * studio_dunaeva-nsk, studio-dunaeva-nsk) — снимаем один раз.
 * Пустой результат = строка некорректна.
 */
export function cleanStudioSlug(raw: string): string {
  let s = raw.trim().replace(/^@/, "").toLowerCase();
  s = s
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const prefix = "studio-";
  if (s.startsWith(prefix) && s.length > prefix.length) {
    s = s.slice(prefix.length);
  }
  return s.slice(0, 40);
}

/**
 * Разбирает вставленный список. Форматы:
 * 1) по строке на студию: «Название | слаг | ссылка записи | заметка»
 *    (после слага всё необязательно, строки с # — комментарии);
 * 2) JSON-массив [{name, slug, bookingUrl?, note?}] или {items: [...]}.
 */
export function parseStudioList(text: string): {
  items: StudioImportItem[];
  errors: string[];
} {
  const t = text.trim();
  if (!t) return { items: [], errors: ["Список пустой"] };

  if (t.startsWith("[") || t.startsWith("{")) {
    try {
      const raw: unknown = JSON.parse(t);
      const arr = Array.isArray(raw)
        ? raw
        : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items)
          ? ((raw as { items: unknown[] }).items)
          : null;
      if (!arr) {
        return { items: [], errors: ["JSON: ожидался массив студий или объект с полем items"] };
      }
      const items: StudioImportItem[] = [];
      const errors: string[] = [];
      arr.forEach((v, i) => {
        const o = v as Record<string, unknown> | null;
        const name = typeof o?.name === "string" ? o.name.trim() : "";
        const slugRaw = typeof o?.slug === "string" ? o.slug.trim() : "";
        if (name && slugRaw) {
          items.push({
            name,
            slug: cleanStudioSlug(slugRaw),
            bookingUrl: typeof o?.bookingUrl === "string" && o.bookingUrl.trim() ? o.bookingUrl.trim() : undefined,
            note: typeof o?.note === "string" && o.note.trim() ? o.note.trim() : undefined,
          });
        } else {
          errors.push(`JSON-элемент №${i + 1}: нет полей «name» и «slug»`);
        }
      });
      return { items: items.slice(0, MAX_IMPORT_ROWS), errors };
    } catch {
      return { items: [], errors: ["Не удалось разобрать JSON — проверь запятые и кавычки"] };
    }
  }

  const items: StudioImportItem[] = [];
  const errors: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const s = line.trim();
    if (!s || s.startsWith("#") || s.startsWith("//")) return;
    const parts = s.split("|").map((p) => p.trim());
    if (parts.length < 2 || !parts[0] || !parts[1]) {
      errors.push(`Строка ${i + 1}: нужно минимум «Название | слаг»`);
      return;
    }
    items.push({
      name: parts[0],
      slug: cleanStudioSlug(parts[1]),
      bookingUrl: parts[2] || undefined,
      note: parts[3] || undefined,
    });
  });
  return { items: items.slice(0, MAX_IMPORT_ROWS), errors };
}

/** Человекочитаемый отчёт для блока импорта в админке. */
export function formatImportReport(
  r: StudioImportReport,
  extraErrors: string[] = []
): string {
  const lines: string[] = [];
  extraErrors.forEach((e) => lines.push("— " + e));
  r.fixed.forEach((f) => lines.push(`починен слаг: ${f.oldSlug} → ${f.slug} (${f.name})`));
  if (r.added.length) lines.push(`добавлено новых: ${r.added.length}`);
  if (r.updated.length) lines.push(`обновлено существующих: ${r.updated.length}`);
  r.skipped.forEach((s) => lines.push(`пропущено «${s.slug || "без слага"}»: ${s.reason}`));
  if (lines.length === 0) lines.push("Изменений нет");
  return lines.join("\n");
}
