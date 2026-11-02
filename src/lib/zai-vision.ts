import ZAI from "z-ai-web-dev-sdk";

/**
 * Единый помощник для обращения к vision-моделям (glm-4.6v и родственные).
 *
 * Почему нужен: у Z.AI два разных шлюза, и у них РАЗНЫЕ пути для vision:
 *  - Внутренний шлюз: только POST /chat/completions/vision (обычный путь
 *    принимает строки text и отбрасывает картинки с ошибкой 1210).
 *  - Публичный api.z.ai: путь /chat/completions/vision НЕ существует (404),
 *    картинки передаются через обычный POST /chat/completions содержимым
 *    вида [{type:"text"}, {type:"image_url"}].
 *
 * Поэтому пробуем SDK-метод createVision, а при 404 автоматически повторяем
 * через обычный create. Если модель недоступна на аккаунте — перебираем
 * список моделей (glm-4.6v платная, glm-4.6v-flash бесплатная).
 */

type Zai = Awaited<ReturnType<typeof ZAI.create>>;

type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

interface ChatResponseLike {
  choices?: Array<{
    message?: { content?: string | Array<{ type?: string; text?: string }> };
  }>;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Шлюз отвечает 404 — путь отсутствует (так ведёт себя публичный api.z.ai). */
export function isRouteMissing(err: unknown): boolean {
  const t = errText(err).toLowerCase();
  return t.includes("status 404") || /\b404\b/.test(t);
}

/** Модели нет на аккаунте/платформе — пробуем следующую из списка. */
function isModelMissing(err: unknown): boolean {
  const t = errText(err).toLowerCase();
  return (
    t.includes("1211") ||
    t.includes("模型不存在") ||
    t.includes("модель недоступна") ||
    /model.{0,24}(not|no)\s+(exist|found|available)/.test(t) ||
    /(unknown|invalid|unsupported)\s+model/.test(t)
  );
}

function extractText(res: ChatResponseLike): string {
  const raw = res?.choices?.[0]?.message?.content;
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) {
    return raw
      .map((p) => (typeof p?.text === "string" ? p.text : ""))
      .join(" ")
      .trim();
  }
  return "";
}

export interface VisionRequest {
  /** Инструкция для модели (что искать на картинках). */
  text: string;
  /** Изображения в виде data URL (data:image/...;base64,...). */
  images: string[];
  /** Порядок моделей: первая платная/точная, далее бесплатная. */
  models?: string[];
}

const DEFAULT_MODELS = ["glm-4.6v", "glm-4.6v-flash"];

export async function visionChat(zai: Zai, req: VisionRequest): Promise<string> {
  const envModel = process.env.ZAI_VISION_MODEL?.trim();
  const models: string[] = envModel
    ? [envModel]
    : req.models && req.models.length > 0
      ? req.models
      : DEFAULT_MODELS;

  const content: ChatContentPart[] = [
    { type: "text", text: req.text },
    ...req.images.map((url) => ({ type: "image_url" as const, image_url: { url } })),
  ];
  const messages = [{ role: "user" as const, content }];

  let lastErr: unknown = null;
  // Флаг: createVision недоступен (публичный API) — дальше пробуем только обычный путь
  let visionRouteBroken = false;

  for (const model of models) {
    if (!visionRouteBroken) {
      // Попытка A: путь /chat/completions/vision (внутренний шлюз)
      try {
        const res = (await zai.chat.completions.createVision({
          model,
          messages,
          thinking: { type: "disabled" },
        })) as ChatResponseLike;
        const text = extractText(res);
        if (text) return text;
        lastErr = new Error("Vision-модель вернула пустой ответ.");
      } catch (e) {
        lastErr = e;
        if (isRouteMissing(e)) {
          visionRouteBroken = true;
        } else if (isModelMissing(e)) {
          continue; // следующая модель из списка
        } else {
          throw e; // 429, таймаут, ключ — наверх, там свои ретраи и подсказки
        }
      }
    }

    // Попытка B: обычный /chat/completions с image_url (публичный API).
    // У SDK тип create требует content-строку — приводим мультимодальное тело явно.
    try {
      const body = { model, messages, thinking: { type: "disabled" as const } };
      const res = (await zai.chat.completions.create(
        body as unknown as Parameters<typeof zai.chat.completions.create>[0]
      )) as ChatResponseLike;
      const text = extractText(res);
      if (text) return text;
      lastErr = new Error("Vision-модель вернула пустой ответ.");
    } catch (e) {
      lastErr = e;
      if (isModelMissing(e)) continue;
      throw e;
    }
  }

  throw lastErr ?? new Error("Vision-модель недоступна.");
}
