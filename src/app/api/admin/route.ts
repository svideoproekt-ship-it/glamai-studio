// Админ-API для ручных продаж: вход по паролю, список пользователей,
// выдача/продление подписки, сброс триала.
//
// Сценарий: мастер платит переводом → владелец открывает /admin →
// «Выдать подписку» по @username или telegram id. ЮKassa подключим позже.

import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE, signAdmin, verifyAdmin } from "@/lib/auth";
import { getPayInfo } from "@/lib/pay";
import {
  adminStats,
  grantBonus,
  grantPlan,
  importStudios,
  listPayRequests,
  listPayments,
  listStudios,
  listUsers,
  paymentsStats,
  resetTrial,
  revokeSubscription,
  setPayRequestStatus,
  setStudioActive,
  startStats,
  upsertStudio,
} from "@/lib/store";
import { suggestWebhookSecret, tgCall, webhookSecret } from "@/lib/telegram";

export const runtime = "nodejs";

const COOKIE_OPTS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 12 * 3600,
};

function unauthorized(): NextResponse {
  return NextResponse.json({ ok: false, error: "Требуется вход в админ-панель." }, { status: 401 });
}

export async function GET(req: NextRequest) {
  if (!verifyAdmin(req.cookies.get(ADMIN_COOKIE)?.value, process.env.ADMIN_SECRET ?? "")) {
    return unauthorized();
  }
  try {
    const [users, stats, requests, studios, starts, payments, payStats] = await Promise.all([
      listUsers(200),
      adminStats(),
      listPayRequests(20),
      listStudios(100),
      startStats(12),
      listPayments(20),
      paymentsStats(),
    ]);
    // pay — публичные реквизиты оплаты (для QR), requests — заявки на подписку,
    // studios — студии-партнёры v41, starts — панель открытий v47,
    // payments/payStats — Stars-платежи v49.
    // botUsername — для сборки ссылок
    // t.me/<bot>?start=studio_<slug> для кнопки на сайте студии.
    return NextResponse.json({
      ok: true,
      users,
      stats,
      pay: getPayInfo(),
      requests,
      studios,
      starts,
      payments,
      payStats,
      webhookSecretSet: webhookSecret().length > 0,
      botUsername: process.env.TELEGRAM_BOT_USERNAME?.trim() ?? "",
    });
  } catch (err) {
    console.error("[admin] ошибка БД:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { ok: false, error: "База недоступна: проверьте DATABASE_URL и сделайте Redeploy." },
      { status: 503 }
    );
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    secret?: string;
    user?: string;
    plan?: string;
    days?: number;
    id?: number;
    amount?: number;
    name?: string;
    slug?: string;
    bookingUrl?: string;
    note?: string;
    active?: boolean;
    items?: unknown[];
  };
  const adminSecret = process.env.ADMIN_SECRET?.trim() ?? "";

  // Вход по паролю → подписанная админ-cookie
  if (body.action === "login") {
    if (!adminSecret || body.secret?.trim() !== adminSecret) {
      return NextResponse.json({ ok: false, error: "Неверный пароль." }, { status: 401 });
    }
    const res = NextResponse.json({ ok: true });
    res.cookies.set(ADMIN_COOKIE, signAdmin(adminSecret), COOKIE_OPTS);
    return res;
  }

  if (!verifyAdmin(req.cookies.get(ADMIN_COOKIE)?.value, adminSecret)) {
    return unauthorized();
  }

  try {
    if (body.action === "grant") {
      const plan = body.plan === "salon" ? "salon" : "start";
      const grant = await grantPlan(body.user ?? "", plan, Number(body.days) || 30);
      if (grant === null) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Пользователь не найден. В поле нужен @username или Telegram ID мастера — они видны в таблице ниже (это НЕ сумма оплаты). Мастер должен хотя бы раз войти на сайт.",
          },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true, id: grant.id, untilIso: grant.untilIso });
    }
    if (body.action === "revoke") {
      const id = await revokeSubscription(body.user ?? "");
      if (id === null) {
        return NextResponse.json({ ok: false, error: "Пользователь не найден." }, { status: 404 });
      }
      return NextResponse.json({ ok: true, id });
    }
    if (body.action === "reset_trial") {
      const id = await resetTrial(body.user ?? "");
      if (id === null) {
        return NextResponse.json({ ok: false, error: "Пользователь не найден." }, { status: 404 });
      }
      return NextResponse.json({ ok: true, id });
    }
    if (body.action === "grant_bonus") {
      // Добор «+5 генераций»: поднимает пробный потолок клиентки — для «догрева»
      // перед записью (v41). Отдельный лимит: не более 50 за раз.
      const result = await grantBonus(body.user ?? "", Number(body.amount) || 5);
      if (result === null) {
        return NextResponse.json(
          { ok: false, error: "Пользователь не найден (нужен @username или ID из таблицы)." },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true, id: result.id, bonusTotal: result.bonusTotal });
    }
    if (body.action === "studio_create") {
      // Создание/обновление студии-партнёра: слаг нормализуется на сервере.
      const studio = await upsertStudio({
        slug: body.slug ?? "",
        name: body.name ?? "",
        bookingUrl: body.bookingUrl ?? null,
        note: body.note ?? null,
      });
      if (studio === null) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Нужны название студии и слаг (латиница/цифры/дефис, хотя бы одна буква или цифра).",
          },
          { status: 400 }
        );
      }
      return NextResponse.json({ ok: true, studio });
    }
    if (body.action === "studio_toggle") {
      const done = await setStudioActive(body.slug ?? "", body.active !== false);
      if (!done) {
        return NextResponse.json({ ok: false, error: "Студия не найдена." }, { status: 404 });
      }
      return NextResponse.json({ ok: true, slug: body.slug, active: body.active !== false });
    }
    if (body.action === "studio_import") {
      // Массовое добавление студий (v48): список строк/JSON из штурм-файлов.
      const rawItems = Array.isArray(body.items) ? body.items : [];
      if (rawItems.length === 0) {
        return NextResponse.json(
          { ok: false, error: "Список пустой: нужны строки «Название | слаг» или JSON-массив." },
          { status: 400 }
        );
      }
      if (rawItems.length > 200) {
        return NextResponse.json(
          { ok: false, error: "Больше 200 строк за раз не принять — раздели список на части." },
          { status: 400 }
        );
      }
      const rows: { name: string; slug: string; bookingUrl: string | null; note: string | null }[] = [];
      for (const it of rawItems) {
        const o = (it ?? {}) as Record<string, unknown>;
        rows.push({
          name: typeof o.name === "string" ? o.name : "",
          slug: typeof o.slug === "string" ? o.slug : "",
          bookingUrl: typeof o.bookingUrl === "string" ? o.bookingUrl : null,
          note: typeof o.note === "string" ? o.note : null,
        });
      }
      const report = await importStudios(rows);
      return NextResponse.json({ ok: true, report });
    }
    if (body.action === "request_done" || body.action === "request_dismiss") {
      const id = Number(body.id);
      if (!Number.isFinite(id)) {
        return NextResponse.json({ ok: false, error: "Не указана заявка." }, { status: 400 });
      }
      const done = await setPayRequestStatus(id, body.action === "request_done" ? "done" : "dismissed");
      if (!done) {
        return NextResponse.json({ ok: false, error: "Заявка не найдена или уже обработана." }, { status: 404 });
      }
      return NextResponse.json({ ok: true, id });
    }
    if (body.action === "webhook_setup") {
      // v49: подключаем приём платежей — setWebhook на /api/telegram/webhook.
      // Адрес: публичный адрес этой админки (origin запроса) либо APP_URL.
      const secret = webhookSecret();
      if (!secret) {
        return NextResponse.json({
          ok: false,
          needSecret: true,
          suggest: suggestWebhookSecret(),
          error:
            "Сначала добавь в Vercel переменную TELEGRAM_WEBHOOK_SECRET (значение ниже), сделай Redeploy и нажми кнопку ещё раз.",
        });
      }
      const origin =
        process.env.APP_URL?.trim() ||
        req.headers.get("origin") ||
        new URL(req.url).origin;
      const base = origin.replace(/\/$/, "");
      if (!/^https:\/\//.test(base)) {
        return NextResponse.json({
          ok: false,
          error: "Webhook требует https. Открой админку по публичному адресу Vercel и нажми кнопку там.",
        });
      }
      const hookUrl = `${base}/api/telegram/webhook`;
      const set = await tgCall("setWebhook", {
        url: hookUrl,
        secret_token: secret,
        allowed_updates: ["pre_checkout_query", "message"],
        drop_pending_updates: false,
      });
      if (!set.ok) {
        return NextResponse.json(
          { ok: false, error: `Telegram не принял webhook: ${set.description ?? "неизвестная ошибка"}` },
          { status: 502 }
        );
      }
      const info = await tgCall("getWebhookInfo", {});
      return NextResponse.json({ ok: true, url: hookUrl, info: info.result ?? null });
    }
    if (body.action === "webhook_info") {
      const info = await tgCall("getWebhookInfo", {});
      return NextResponse.json({ ok: true, info: info.result ?? null });
    }
    return NextResponse.json({ ok: false, error: "Неизвестное действие." }, { status: 400 });
  } catch (err) {
    console.error("[admin] ошибка:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Операция не удалась, попробуйте ещё раз." }, { status: 500 });
  }
}
