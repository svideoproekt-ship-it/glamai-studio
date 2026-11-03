import ZAI from "z-ai-web-dev-sdk";
import { getAiProvider } from "@/lib/ai-provider";
import { ensureYandexConfig, yandexVision } from "@/lib/yandex-ai";
import { visionChat, type VisionRequest } from "@/lib/zai-vision";

/**
 * Провайдер-независимое обращение к vision-модели.
 *
 * - Движок Z.AI: как раньше — glm-4.6v / glm-4.6v-flash (см. zai-vision.ts).
 * - Движок Яндекс: мультимодальный YandexGPT; список моделей игнорируется,
 *   берётся gpt://<folder>/yandexgpt/latest (можно заменить через YC_TEXT_MODEL).
 */
export async function visionChatAny(req: VisionRequest): Promise<string> {
  if (getAiProvider() === "yandex") {
    const cfg = ensureYandexConfig();
    return yandexVision(cfg, { text: req.text, images: req.images });
  }
  const zai = await ZAI.create();
  return visionChat(zai, req);
}
