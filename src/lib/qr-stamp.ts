// v43: QR-код в фирменной подписи образа.
//
// Зачем: каждая готовая картинка уезжает в чаты и сторис. QR в правом нижнем
// углу ведёт в бот — и любая клиентка, которой переслали образ, попадает
// в приложение с той же меткой студии (start=studio_<slug>): салон видит
// рост в админке, а «сарафан» замыкается без нашего участия.
//
// Принципы безопасности (то, что обещали владельцу):
// - Ссылка ведёт на БОТА (t.me/<бот>?start=...), а не на сайт: переезд
//   домена не ломает старые картинки. QR живёт, пока жив бот.
// - QR строится локально пакетом qrcode (уже в зависимостях) — внешних
//   сервисов нет, нечему ломаться.
// - Плашка — украшение: при любой ошибке картинка уходит без неё.

import QRCode from "qrcode";
import sharp from "sharp";

// Палитра «Тёмное ателье» (v42): кремовая плашка, тёмно-зелёные модули,
// тонкая золотая кайма — как золотые кнопки.
const QR_DARK = "#0B3D22";
const QR_LIGHT = "#F8F1E1";
const QR_BORDER = "#D4A437";

export interface QrPlate {
  png: Buffer;
  /** Сторона плашки (квадрат), px — нужна для расчёта позиции при наложении. */
  size: number;
}

/**
 * Собирает ссылку для QR. botUsername из TELEGRAM_BOT_USERNAME, slug —
 * студия пользователя (или null: ведём просто в бот, без чужой атрибуции).
 * Нет имени бота — нет и QR (картинка без плашки).
 */
export function buildQrLink(
  botUsername: string | null | undefined,
  studioSlug: string | null | undefined
): string | null {
  const bot = (botUsername ?? "").trim().replace(/^@/, "");
  if (!bot) return null;
  const slug = (studioSlug ?? "").trim();
  return slug
    ? `https://t.me/${bot}?start=studio_${slug}`
    : `https://t.me/${bot}`;
}

/**
 * Рисует QR-плашку: кремовый скруглённый квадрат с золотой каймой и тёмно-
 * зелёными модулями. `px` — сторона плашки; сам QR занимает центр с полем
 * 10% с каждой стороны (тихая зона вокруг модулей сохраняется).
 * Возвращает null, если QR построить не удалось — вызывающий код просто
 * накладывает картинку без плашки.
 */
export async function buildQrPlate(link: string, px: number): Promise<QrPlate | null> {
  try {
    if (!link || px < 96) return null;
    const pad = Math.round(px * 0.1); // поле плашки — тихая зона QR
    const inner = px - 2 * pad;
    if (inner < 64) return null;

    const qrPng = await QRCode.toBuffer(link, {
      type: "png",
      width: inner,
      margin: 1, // внешние поля добирает сама плашка (pad ≥ 10%)
      errorCorrectionLevel: "M",
      color: { dark: QR_DARK, light: QR_LIGHT },
    });

    // Плашка: скруглённый кремовый квадрат + золотая кайма. Рисуем SVG-вектором,
    // sharp растрирует в нужный размер. Радиус 5.5% не задевает QR (поле 10%).
    const sw = Math.max(2, Math.round(px * 0.012));
    const r = Math.round(px * 0.055);
    const half = Math.round(sw / 2);
    const plateSvg = Buffer.from(
      `<svg width="${px}" height="${px}">` +
        `<rect x="${half}" y="${half}" width="${px - sw}" height="${px - sw}" ` +
        `rx="${r}" ry="${r}" fill="${QR_LIGHT}" stroke="${QR_BORDER}" ` +
        `stroke-width="${sw}" stroke-opacity="0.9"/>` +
        `</svg>`
    );
    const plate = await sharp(plateSvg).png().toBuffer();

    const out = await sharp(plate)
      .composite([{ input: qrPng, left: pad, top: pad }])
      .png()
      .toBuffer();
    return { png: out, size: px };
  } catch (err) {
    console.warn(
      "[qr-stamp] плашка QR не построена:",
      err instanceof Error ? err.message : err
    );
    return null;
  }
}
