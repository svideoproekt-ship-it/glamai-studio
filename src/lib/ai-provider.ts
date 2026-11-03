/**
 * Выбор «движка» ИИ (провайдера).
 *
 * Доступны два варианта:
 *  - "yandex" — Yandex Cloud AI Studio: YandexGPT (текст + понимание фото)
 *    и YandexART (генерация изображений). Оплата в рублях.
 *  - "zai"    — Z.AI: glm-модели (текст, vision, генерация картинок). Оплата в долларах.
 *
 * Правило выбора (упрощает жизнь пользователю):
 *  1) если AI_PROVIDER явно задан ("yandex" или "zai") — используем его;
 *  2) иначе если заданы YC_API_KEY и YC_FOLDER_ID — работаем через Яндекс;
 *  3) иначе — Z.AI (прежнее поведение).
 */

export type AiProvider = "zai" | "yandex";

export function getAiProvider(): AiProvider {
  const forced = String(process.env.AI_PROVIDER ?? "")
    .trim()
    .toLowerCase();
  if (forced === "yandex" || forced === "yc" || forced === "яндекс") return "yandex";
  if (forced === "zai" || forced === "z.ai") return "zai";

  const yKey = Boolean(process.env.YC_API_KEY?.trim());
  const yFolder = Boolean(process.env.YC_FOLDER_ID?.trim());
  if (yKey && yFolder) return "yandex";
  return "zai";
}

export function providerLabel(p: AiProvider): string {
  return p === "yandex" ? "Яндекс (Yandex Cloud AI Studio)" : "Z.AI";
}
