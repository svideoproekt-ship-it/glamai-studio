// Надёжное сохранение картинки в любой среде, включая WebView внутри Telegram.
//
// Почему просто <a href={dataUrl} download> не работает: API отдаёт результат
// как data:URL (base64 прямо в ссылке). Атрибут download у data-ссылок
// игнорируется в WebKit (Telegram на iPhone) и часто в Android-WebView —
// клик молча ничего не делает. Поэтому цепочка из трёх путей:
//
//   1) navigator.share с файлом — системное меню «Поделиться»: на телефоне
//      это «Сохранить в Фото», а мастеру — ещё и переслать образ клиенту
//      прямо из Telegram (на iOS работает только этот путь);
//   2) blob-ссылка + download — обычные браузеры и Android;
//   3) открыть картинку в новой вкладке — запасной путь: удержать палец
//      на картинке → «Сохранить в Фото» / правый клик → «Сохранить как».

export type SaveMethod = "share" | "download" | "tab" | "opened-raw";

/** Мы внутри WebView Telegram (Mini App) — там молча проглатываются и
 *  blob-скачивания, и window.open: для фото нужен либо бот, либо
 *  долгое нажатие на картинку, показанную внутри самой студии. */
export function isTelegramWebView(): boolean {
  if (typeof window === "undefined") return false;
  const t = (window as unknown as { Telegram?: { WebApp?: unknown } }).Telegram?.WebApp;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  return Boolean(t) || /Telegram/i.test(ua);
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  const m = /^data:([^;,]+);base64,([\s\S]*)$/.exec(dataUrl);
  if (!m) return null;
  const mime = m[1] || "image/png";
  try {
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

async function srcToBlob(src: string): Promise<Blob | null> {
  if (src.startsWith("data:")) return dataUrlToBlob(src);
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    return await res.blob();
  } catch {
    return null; // чужой домен без CORS и прочее — не страшно, у нас data:URL
  }
}

/** iPhone/iPad? Нужен для подсказок: на iOS фото в галерею попадает через
 *  «Поделиться» → «Сохранить изображение», на Android — через скачивание. */
export const isIosDevice = (): boolean =>
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

function extOf(type: string): string {
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("webp")) return "webp";
  return "png";
}

/**
 * Настоящее системное «Поделиться» с файлом-картинкой: на телефоне в меню
 * видны Telegram, MAX, WhatsApp и «Сохранить в галерею» — мастер выбирает сам.
 *
 * Возвращает:
 *   "share"       — меню открылось (или мастер сам его закрыл — это не сбой);
 *   "unsupported" — системного «Поделиться» здесь нет (WebView и т.п.);
 *   "failed"      — меню не удалось открыть (нет картинки или ошибка).
 */
export async function shareImage(
  src: string,
  title = "GlamAI Studio"
): Promise<"share" | "unsupported" | "failed"> {
  if (typeof window === "undefined") return "failed";
  const blob = await srcToBlob(src);
  if (!blob) return "failed";
  const file = new File([blob], `glamai-look-${Date.now()}.${extOf(blob.type)}`, {
    type: blob.type || "image/png",
  });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!("share" in nav)) return "unsupported";
  // Часть оболочек врёт в canShare({files}) — но.share() всё равно открывает
  // меню, поэтому сначала пробуем настоящее меню, а не отдаёмся фолбэку сразу
  const can = !nav.canShare || nav.canShare({ files: [file] });
  if (!can) {
    try {
      await nav.share({ files: [file], title });
      return "share";
    } catch {
      return "unsupported";
    }
  }
  try {
    await nav.share({ files: [file], title });
    return "share";
  } catch (err) {
    // AbortError — мастер сам закрыл меню, это не сбой
    if ((err as Error)?.name === "AbortError") return "share";
    return "failed";
  }
}

/**
 * Сохраняет картинку из data:/http(s)-URL. Возвращает, каким путём
 * получилось — чтобы интерфейс показал нужную подсказку.
 *
 * mode:
 *   "auto"           — сначала «Поделиться», потом скачивание (по умолчанию);
 *   "download-only" — пропустить «Поделиться», сразу файл (кнопка «Скачать»).
 */
export async function saveImageFile(
  src: string,
  filename: string,
  mode: "auto" | "download-only" = "auto"
): Promise<SaveMethod> {
  if (typeof window === "undefined") return "download";

  const blob = await srcToBlob(src);
  if (!blob) {
    // Разве что показать картинку — вдруг пользователь сохранит вручную
    window.open(src, "_blank", "noopener");
    return "opened-raw";
  }

  const name = `${filename.replace(/\.[a-z0-9]+$/i, "")}.${extOf(blob.type)}`;
  const file = new File([blob], name, { type: blob.type || "image/png" });

  // 1) Нативное «Поделиться» — единственный надёжный путь на iOS,
  //    на Android ещё и удобный: «Сохранить» или «Отправить клиенту»
  if (mode === "auto") {
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if ("share" in nav && nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: "GlamAI Studio" });
        return "share";
      } catch (err) {
        // AbortError — мастер сам закрыл меню «Поделиться», это не сбой
        if ((err as Error)?.name === "AbortError") return "share";
        // любая другая ошибка — пробуем скачать по-старинке
      }
    }
  }

  // 2) Классическое скачивание: blob-ссылка с атрибутом download
  try {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);

    // 3) Подстраховка для iOS без «Поделиться»: WKWebView часто игнорирует
    //    download — открываем картинку в новой вкладке, оттуда «Сохранить»
    if (isIosDevice()) {
      window.open(url, "_blank", "noopener");
      return "tab";
    }
    return "download";
  } catch {
    window.open(src, "_blank", "noopener");
    return "opened-raw";
  }
}
