/**
 * Геометрия фото для правки моделью-редактором (v1.4.11 — фикс «растянутого лица»).
 *
 * ПРОБЛЕМА: шлюзы принимают размер генерации только в фиксированных категориях
 * (например 1024x1536, то есть 2:3). Фото клиента почти никогда не ровно 2:3 —
 * чаще 3:4 или 9:16. Модель-редактор втягивает исходник в запрошенную рамку,
 * РАСТЯГИВАЯ содержимое: лицо становится заметно вытянутым по вертикали
 * (3:4 → 2:3 даёт +12,5% по высоте).
 *
 * РЕШЕНИЕ (как в классической фото-печати): дописываем фото до точных пропорций
 * запрошенного размера «размывкой краёв» (edge smear — крайние строки/столбцы
 * растягиваются в поля, выглядит как естественное продолжение фона), отправляем
 * модели — искажений больше нет. После правки срезаем дописанные поля:
 * модель отвечает в пропорциях рамки, поля занимают в ответе ту же ДОЛЮ площади,
 * что и в дописанном исходнике — координаты обрезки известны точно.
 *
 * Всё делается sharp'ом на сервере (он уже используется для сжатия ответа).
 * Любой сбой здесь НЕ должен ронять генерацию: вызывающий код падает обратно
 * на исходное фото без дописки.
 */

import sharp from "sharp";

/** Прямоугольник дописанных полей (в пикселях дописанного холста). */
export interface PadGeometry {
  /** Размер дописанного холста (то, что уходит модели). */
  width: number;
  height: number;
  /** Поля: верх/низ/лево/право. */
  padTop: number;
  padBottom: number;
  padLeft: number;
  padRight: number;
}

/** "1024x1536" → 0,6667 (ширина/высота). Некорректная строка → 0. */
export function sizeRatio(size: string): number {
  const m = /^(\d+)x(\d+)$/.exec(String(size ?? "").trim().toLowerCase());
  if (!m) return 0;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return 0;
  return w / h;
}

/** Разница пропорций меньше 2% — модель растянет незаметно, дописывать не будем. */
const RATIO_TOLERANCE = 0.02;

export interface PaddedPhoto {
  /** Фото для отправки модели (data URL; исходное, если дописка не понадобилась). */
  dataUrl: string;
  /** Была ли сделана дописка. */
  padded: boolean;
  /** Геометрия полей; заполнена только при padded = true. */
  geom: PadGeometry;
}

/**
 * Дописывает фото (data URL) до пропорций targetRatio размывкой краёв.
 * Исходник НЕ масштабируется и НЕ обрезается — только добавляются поля
 * с двух сторон (по вертикали или горизонтали, где не хватает).
 */
export async function padToRatio(
  dataUrl: string,
  targetRatio: number
): Promise<PaddedPhoto> {
  const m = /^data:image\/(?:png|jpe?g|webp);base64,([\s\S]+)$/i.exec(dataUrl.trim());
  if (!m) throw new Error("padToRatio: фото клиента имеет неподдерживаемый формат");
  const src = Buffer.from(m[1], "base64");

  const meta = await sharp(src).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) throw new Error("padToRatio: не удалось прочитать размеры фото");

  const empty: PaddedPhoto = {
    dataUrl,
    padded: false,
    geom: { width: w, height: h, padTop: 0, padBottom: 0, padLeft: 0, padRight: 0 },
  };
  if (!Number.isFinite(targetRatio) || targetRatio <= 0) return empty;

  const ratio = w / h;
  if (Math.abs(ratio - targetRatio) / targetRatio < RATIO_TOLERANCE) return empty;

  // Дописываем там, где не хватает: фото шире цели → растим высоту, уже → ширину.
  let canvasW = w;
  let canvasH = h;
  if (ratio > targetRatio) canvasH = Math.round(w / targetRatio);
  else canvasW = Math.round(h * targetRatio);
  canvasW = Math.max(canvasW, w);
  canvasH = Math.max(canvasH, h);

  const padTop = Math.floor((canvasH - h) / 2);
  const padBottom = canvasH - h - padTop;
  const padLeft = Math.floor((canvasW - w) / 2);
  const padRight = canvasW - w - padLeft;
  if (padTop + padBottom + padLeft + padRight === 0) return empty;

  // Размывка краёв: крайняя строка/столбец исходника растягивается в поле.
  const strips: sharp.OverlayOptions[] = [];
  if (padTop > 0) {
    const top = await sharp(src)
      .extract({ left: 0, top: 0, width: w, height: 1 })
      .resize(canvasW, padTop, { fit: "fill" })
      .jpeg({ quality: 90 })
      .toBuffer();
    strips.push({ input: top, top: 0, left: 0 });
  }
  if (padBottom > 0) {
    const bottom = await sharp(src)
      .extract({ left: 0, top: h - 1, width: w, height: 1 })
      .resize(canvasW, padBottom, { fit: "fill" })
      .jpeg({ quality: 90 })
      .toBuffer();
    strips.push({ input: bottom, top: h + padTop, left: 0 });
  }
  if (padLeft > 0) {
    const left = await sharp(src)
      .extract({ left: 0, top: 0, width: 1, height: h })
      .resize(padLeft, canvasH, { fit: "fill" })
      .jpeg({ quality: 90 })
      .toBuffer();
    strips.push({ input: left, top: 0, left: 0 });
  }
  if (padRight > 0) {
    const right = await sharp(src)
      .extract({ left: w - 1, top: 0, width: 1, height: h })
      .resize(padRight, canvasH, { fit: "fill" })
      .jpeg({ quality: 90 })
      .toBuffer();
    strips.push({ input: right, top: 0, left: w + padLeft });
  }

  const out = await sharp({
    create: { width: canvasW, height: canvasH, channels: 3, background: "#f0eee9" },
  })
    .composite([...strips, { input: src, top: padTop, left: padLeft }])
    .jpeg({ quality: 92 })
    .toBuffer();

  return {
    dataUrl: `data:image/jpeg;base64,${out.toString("base64")}`,
    padded: true,
    geom: { width: canvasW, height: canvasH, padTop, padBottom, padLeft, padRight },
  };
}

/**
 * Срезает дописанные поля с результата модели. Ответ приходит в пропорциях
 * рамки, поэтому поля занимают в нём ту же ДОЛЮ площади, что и в дописанном
 * исходнике — отображаем пиксельные координаты на фактический размер ответа.
 * Возвращает base64 (JPEG) без data-префикса — как ждёт остальной конвейер.
 */
export async function cropBack(resultBase64: string, geom: PadGeometry): Promise<string> {
  const src = Buffer.from(resultBase64, "base64");
  const meta = await sharp(src).metadata();
  const ow = meta.width ?? 0;
  const oh = meta.height ?? 0;
  if (!ow || !oh) throw new Error("cropBack: не удалось прочитать размеры результата");

  const x0 = geom.padLeft / geom.width;
  const y0 = geom.padTop / geom.height;
  const x1 = (geom.width - geom.padRight) / geom.width;
  const y1 = (geom.height - geom.padBottom) / geom.height;

  let left = Math.round(x0 * ow);
  let top = Math.round(y0 * oh);
  let width = Math.round((x1 - x0) * ow);
  let height = Math.round((y1 - y0) * oh);
  left = Math.max(0, Math.min(left, ow - 1));
  top = Math.max(0, Math.min(top, oh - 1));
  width = Math.max(1, Math.min(width, ow - left));
  height = Math.max(1, Math.min(height, oh - top));

  // Срезали бы всё изображение целиком — ничего не делаем.
  if (left === 0 && top === 0 && width === ow && height === oh) {
    return resultBase64;
  }

  const out = await sharp(src)
    .extract({ left, top, width, height })
    .jpeg({ quality: 95 })
    .toBuffer();
  return out.toString("base64");
}

/* ------------------------------------------------------------------ */
/*  v1.14.0: срез ЧЁРНЫХ полей-«письма» с результата модели            */
/* ------------------------------------------------------------------ */

/**
 * ПРОБЛЕМА (заметил пользователь на живом телефоне): на выходном фото
 * чёрные прямоугольники сверху и снизу, а «до/после» в слайдере не
 * совпадают. Причина: шлюз/модель в части случаев игнорирует size или
 * отдаёт картинку в своей категории, добивая исходник до рамки ЧЁРНЫМИ
 * полями (портретное фото в более широком кадре — поля сверху и снизу).
 * cropBack тут бессилен: он срезает только СВОИ поля размывки по
 * известной геометрии, а модельные поля приходят другого размера.
 *
 * РЕШЕНИЕ: ищем у результата сплошные равномерно-чёрные полосы по краям
 * и срезаем их — но ТОЛЬКО если срез возвращает пропорции к пропорциям
 * ИСХОДНОГО фото клиента. Тёмный фон живой фотографии (шторы, ночной
 * клуб, чёрная одежда на весь кадр) не бывает равномерно нулевым: шум
 * JPEG, блики и детали дают яркость выше порога, поэтому реальное фото
 * функция не трогает.
 */

/** Порог «почти чёрного» для ОДНОГО пикселя полосы (0-255, грейскейл). */
const BAR_PIXEL_MAX = 32;
/** Порог средней яркости полосы: у чистого чёрного она около нуля. */
const BAR_MEAN_MAX = 8;
/** Полоса короче 2% стороны — не полоса, а шум по краю. */
const MIN_BAR_FRACTION = 0.02;
/** После среза должно оставаться минимум 55% каждой стороны. */
const KEEP_FRACTION = 0.55;

export interface TrimResult {
  base64: string;
  /** Были ли срезаны поля. */
  trimmed: boolean;
  /** Что нашлось/почему не режем — для журнала. */
  detail: string;
}

/** Пропорции фото из data URL (0, если прочитать не удалось). */
export async function dataUrlRatio(dataUrl: string): Promise<number> {
  try {
    const m = /^data:image\/(?:png|jpe?g|webp);base64,([\s\S]+)$/i.exec(dataUrl.trim());
    if (!m) return 0;
    const meta = await sharp(Buffer.from(m[1], "base64")).metadata();
    if (!meta.width || !meta.height) return 0;
    return meta.width / meta.height;
  } catch {
    return 0;
  }
}

/**
 * Срезает равномерно-чёрные поля по краям картинки (base64 без data-префикса,
 * как возвращает cropBack). expectedRatio — пропорции исходного фото клиента
 * (ширина/высота); 0 означает «пропорции неизвестны» — тогда режем любые
 * обнаруженные полосы. Возвращает base64 (JPEG) — исходный буфер, если резать
 * нечего или срез небезопасен.
 */
export async function trimLetterbox(resultBase64: string, expectedRatio: number): Promise<TrimResult> {
  const src = Buffer.from(resultBase64, "base64");
  const meta = await sharp(src).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return { base64: resultBase64, trimmed: false, detail: "нет размеров" };

  const { data, info } = await sharp(src).greyscale().raw().toBuffer({ resolveWithObject: true });
  const gw = info.width;
  const gh = info.height;
  if (!gw || !gh) return { base64: resultBase64, trimmed: false, detail: "нет размеров" };

  // Максимум и среднее по каждой строке и столбцу: у полосы и максимум
  // почти нулевой, и среднее — по всему краю, а не по отдельным пикселям
  const rowMax = new Float64Array(gh);
  const rowMean = new Float64Array(gh);
  for (let y = 0; y < gh; y++) {
    let mx = 0;
    let sum = 0;
    const off = y * gw;
    for (let x = 0; x < gw; x++) {
      const v = data[off + x];
      if (v > mx) mx = v;
      sum += v;
    }
    rowMax[y] = mx;
    rowMean[y] = sum / gw;
  }
  const colMax = new Float64Array(gw);
  const colMean = new Float64Array(gw);
  for (let x = 0; x < gw; x++) {
    let mx = 0;
    let sum = 0;
    for (let y = 0; y < gh; y++) {
      const v = data[y * gw + x];
      if (v > mx) mx = v;
      sum += v;
    }
    colMax[x] = mx;
    colMean[x] = sum / gh;
  }

  const isBarRow = (y: number) => rowMax[y] <= BAR_PIXEL_MAX && rowMean[y] <= BAR_MEAN_MAX;
  const isBarCol = (x: number) => colMax[x] <= BAR_PIXEL_MAX && colMean[x] <= BAR_MEAN_MAX;

  let top = 0;
  while (top < gh && isBarRow(top)) top++;
  let bottom = 0;
  while (bottom < gh && isBarRow(gh - 1 - bottom)) bottom++;
  let left = 0;
  while (left < gw && isBarCol(left)) left++;
  let right = 0;
  while (right < gw && isBarCol(gw - 1 - right)) right++;

  // Короткие тёмные кромки по краю — это виньетка/шум, а не «письмо»
  const minRowBar = Math.max(3, Math.floor(gh * MIN_BAR_FRACTION));
  const minColBar = Math.max(3, Math.floor(gw * MIN_BAR_FRACTION));
  if (top < minRowBar) top = 0;
  if (bottom < minRowBar) bottom = 0;
  if (left < minColBar) left = 0;
  if (right < minColBar) right = 0;

  const newW = gw - left - right;
  const newH = gh - top - bottom;
  if (newW === gw && newH === gh) {
    return { base64: resultBase64, trimmed: false, detail: "чёрных полей нет" };
  }
  // Срезали бы больше половины стороны — это не поля, это тёмное фото: не режем
  if (newW < gw * KEEP_FRACTION || newH < gh * KEEP_FRACTION) {
    return {
      base64: resultBase64,
      trimmed: false,
      detail: `полосы слишком велики (T${top}/B${bottom}/L${left}/R${right}) — не режем`,
    };
  }

  // Срез должен приближать пропорции к исходным — иначе перед нами просто
  // тёмное по краям фото, и тогда резать нельзя
  if (Number.isFinite(expectedRatio) && expectedRatio > 0) {
    const arBefore = gw / gh;
    const arAfter = newW / newH;
    const missBefore = Math.abs(arBefore - expectedRatio) / expectedRatio;
    const missAfter = Math.abs(arAfter - expectedRatio) / expectedRatio;
    if (missAfter >= missBefore) {
      return {
        base64: resultBase64,
        trimmed: false,
        detail: `срез не приближает пропорции (${arBefore.toFixed(3)}→${arAfter.toFixed(3)}, ждали ${expectedRatio.toFixed(3)})`,
      };
    }
  }

  const out = await sharp(src)
    .extract({ left, top, width: newW, height: newH })
    .jpeg({ quality: 95 })
    .toBuffer();
  return {
    base64: out.toString("base64"),
    trimmed: true,
    detail: `срезано T${top}/B${bottom}/L${left}/R${right} → ${newW}x${newH}`,
  };
}
