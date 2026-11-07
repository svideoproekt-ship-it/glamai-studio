// «Ворота» для платных API-эндпоинтов: сессия → пользователь → лимит.
// Используется в /api/tryon: без входа — 401, без остатка — 402 (paywall).

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { getUser, rowAllowance, consumeGeneration } from "@/lib/store";

export interface GateOk {
  ok: true;
  /** 0 — тестовый обход (ALLOW_UNAUTHED=1), реальный telegram id — в остальных случаях */
  tid: number;
}

export interface GateFail {
  ok: false;
  response: NextResponse;
}

export type GateResult = GateOk | GateFail;

function json(data: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(data, { status });
}

export async function gateTryon(req: NextRequest): Promise<GateResult> {
  // Обход для локальной регрессии (тесты гоняют /api/tryon без сессии).
  // На Vercel переменная не задаётся — вход обязателен.
  if (process.env.ALLOW_UNAUTHED === "1") {
    return { ok: true, tid: 0 };
  }

  const secret = process.env.AUTH_SECRET;
  const tid = verifySession(req.cookies.get(SESSION_COOKIE)?.value, secret ?? "");
  if (tid === null) {
    return {
      ok: false,
      response: json(
        {
          success: false,
          authRequired: true,
          error: "Войдите через Telegram — пробный доступ даёт 5 бесплатных образов.",
        },
        401
      ),
    };
  }

  try {
    let user = await getUser(tid);
    if (!user) {
      // Сессия есть, пользователя нет (например, базу пересоздали) — заводим заново
      const { upsertUser } = await import("@/lib/store");
      await upsertUser({ id: tid, firstName: "Мастер" });
      user = await getUser(tid);
      if (!user) throw new Error("не удалось создать пользователя");
    }
    const allowance = rowAllowance(user);
    if (!allowance.allowed) {
      return {
        ok: false,
        response: json(
          {
            success: false,
            paywall: true,
            allowance: {
              mode: allowance.mode,
              planLabel: allowance.planLabel,
              remaining: allowance.remaining,
              total: allowance.total,
              reason: allowance.reason,
            },
            error:
              allowance.reason === "quota_exhausted"
                ? "Месячный лимит тарифа исчерпан. Продлите подписку или перейдите на «Салон»."
                : "Пробные образы закончились. Оформите подписку — и продолжим.",
          },
          402
        ),
      };
    }
    return { ok: true, tid };
  } catch (err) {
    console.error("[gate] db error:", err instanceof Error ? err.message : err);
    return {
      ok: false,
      response: json(
        {
          success: false,
          error:
            "База подписок недоступна. Если вы только что задали DATABASE_URL — сделайте Redeploy и попробуйте снова.",
        },
        503
      ),
    };
  }
}

/** Списывает генерацию после успешного ответа. Ошибки списания не ломают ответ. */
export async function consumeAfterSuccess(tid: number, kind: string): Promise<void> {
  if (tid === 0) return; // тестовый обход
  try {
    await consumeGeneration(tid, kind);
  } catch (err) {
    console.warn("[gate] не удалось списать генерацию:", err instanceof Error ? err.message : err);
  }
}
