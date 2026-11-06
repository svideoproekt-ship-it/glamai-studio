/**
 * Выбор «движка» ИИ (провайдера).
 *
 * Доступны три варианта:
 *  - "proxy"  — OpenAI-совместимый прокси-шлюз (оплата в рублях): модели-редакторы
 *    картинок (Nano Banana, GPT Image, Seedream…) — ПРАВКА ФОТО с сохранением лица.
 *  - "yandex" — Yandex Cloud AI Studio: YandexGPT (текст + понимание фото)
 *    и YandexART (генерация изображений, портрет по описанию). Оплата в рублях.
 *  - "zai"    — Z.AI: glm-модели (текст, vision, генерация картинок). Оплата в долларах.
 *
 * Правило выбора (упрощает жизнь пользователю):
 *  1) если AI_PROVIDER явно задан ("proxy" / "yandex" / "zai") — используем его;
 *  2) иначе если заданы PROXY_API_KEY и PROXY_BASE_URL — работаем через прокси;
 *  3) иначе если заданы YC_API_KEY и YC_FOLDER_ID — работаем через Яндекс;
 *  4) иначе — Z.AI (прежнее поведение).
 */

export type AiProvider = "zai" | "yandex" | "proxy";

export function getAiProvider(): AiProvider {
  const forced = String(process.env.AI_PROVIDER ?? "")
    .trim()
    .toLowerCase();
  if (forced === "proxy" || forced === "proxyapi" || forced === "прокси") return "proxy";
  if (forced === "yandex" || forced === "yc" || forced === "яндекс") return "yandex";
  if (forced === "zai" || forced === "z.ai") return "zai";

  const pKey = Boolean(process.env.PROXY_API_KEY?.trim());
  const pUrl = Boolean(process.env.PROXY_BASE_URL?.trim());
  if (pKey && pUrl) return "proxy";

  const yKey = Boolean(process.env.YC_API_KEY?.trim());
  const yFolder = Boolean(process.env.YC_FOLDER_ID?.trim());
  if (yKey && yFolder) return "yandex";
  return "zai";
}

export function providerLabel(p: AiProvider): string {
  return p === "proxy"
    ? "Прокси-шлюз (правка фото с сохранением лица)"
    : p === "yandex"
    ? "Яндекс (Yandex Cloud AI Studio)"
    : "Z.AI";
}
