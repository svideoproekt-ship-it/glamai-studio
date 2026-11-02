// Клиентские утилиты: подготовка фото перед отправкой на сервер.
// Уменьшаем изображение до 1152px по длинной стороне (совпадает с размерами генерации),
// конвертируем в JPEG — так запрос остаётся компактным, а EXIF-поворот применяется.

export interface PreparedImage {
  dataUrl: string;
  width: number;
  height: number;
  ratio: number; // ширина / высота
  name: string;
}

const MAX_DIM = 1152;

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

async function decode(file: File): Promise<Decoded> {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return {
        source: bmp,
        width: bmp.width,
        height: bmp.height,
        close: () => bmp.close(),
      };
    } catch {
      // некоторые форматы (например, HEIC) не декодируются — падаем в <img>
    }
  }

  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    return {
      source: img,
      width: w,
      height: h,
      close: () => URL.revokeObjectURL(url),
    };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error(
      "Не удалось прочитать изображение. Подойдёт JPEG, PNG или WebP — пересохраните фото и попробуйте снова."
    );
  }
}

export async function prepareImage(file: File): Promise<PreparedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Это не изображение. Загрузите фото в формате JPEG, PNG или WebP.");
  }

  const decoded = await decode(file);

  const scale = Math.min(1, MAX_DIM / Math.max(decoded.width, decoded.height));
  const cw = Math.max(1, Math.round(decoded.width * scale));
  const ch = Math.max(1, Math.round(decoded.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    decoded.close();
    throw new Error("Браузер не смог обработать изображение. Попробуйте другое фото.");
  }
  ctx.drawImage(decoded.source, 0, 0, cw, ch);
  decoded.close();

  const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
  if (!dataUrl.startsWith("data:image/")) {
    throw new Error("Не удалось обработать изображение. Попробуйте другое фото.");
  }

  return { dataUrl, width: cw, height: ch, ratio: cw / ch, name: file.name };
}
