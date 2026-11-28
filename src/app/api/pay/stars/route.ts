// v49: Создание счёта Telegram Stars для розничных пакетов.
//
// Клиент в paywall нажимает «Оплатить Звёздами» → этот роут по подписанной
// сессии знает, КТО платит (ID из сессии, не из тела запроса — подделать
// нельзя), собирает счёт через createInvoiceLink (валюта XTR, провайдер не
// нужен — Stars принимают встроенным механизмом Telegram) и возвращает
// ссылку. Открытие счёта — WebApp.openInvoice, подтверждение и зачисление —
// /api/telegram/webhook.
//
// payload счёта: "v49.<pack>.<telegramId>" — по нему webhook проверяет,
// что платит тот же человек, что открывал счёт.
//
// v49 (мультиязычность): счёт, который видит клиент в Telegram, собирается
// на ЕГО языке — glam_users.language_code (ru/en/de/fr). Ошибки возвращаются
// с кодом code — текст на клиенте локализует paywall.

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { packById, RETAIL_PACKS, type PackId } from "@/lib/tariffs";
import { getBotToken, tgCall } from "@/lib/telegram";
import { getUser } from "@/lib/store";
import { langFromCode, packTitle, t } from "@/lib/i18n";

export const runtime = "nodejs";

export async function GET() {
  // Прайс-лист для UI: сервер — единственный источник цен.
  return NextResponse.json({ ok: true, packs: RETAIL_PACKS });
}

export async function POST(req: NextRequest) {
  const tid = verifySession(req.cookies.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET ?? "");
  if (tid === null) {
    return NextResponse.json(
      { ok: false, code: "session", message: "Сессия истекла — перезайдите в студию." },
      { status: 401 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as { pack?: string };
  const pack = packById(String(body.pack ?? ""));
  if (!pack) {
    return NextResponse.json(
      { ok: false, code: "pack", message: "Неизвестный пакет." },
      { status: 400 }
    );
  }

  if (!getBotToken()) {
    return NextResponse.json(
      {
        ok: false,
        code: "not_configured",
        message: "Оплата Звёздами не настроена на сервере — оплатите переводом по реквизитам ниже.",
      },
      { status: 500 }
    );
  }

  // Язык клиента: счёт в Telegram показываем на его языке.
  const user = await getUser(tid).catch(() => null);
  const lang = langFromCode(user?.languageCode);
  const title = packTitle(lang, pack.id);

  const res = await tgCall<{ url: string }>("createInvoiceLink", {
    title: `GlamAI Studio — ${title}`,
    description: t(lang, "srv.invoice.desc", { n: pack.generations }),
    payload: `v49.${pack.id as PackId}.${tid}`,
    currency: "XTR",
    prices: [{ label: t(lang, "srv.invoice.price", { title, n: pack.generations }), amount: pack.stars }],
  });

  if (!res.ok || !res.result?.url) {
    console.error("[pay/stars] createInvoiceLink:", res.description ?? "нет ссылки");
    return NextResponse.json(
      {
        ok: false,
        code: "invoice",
        message: "Telegram не дал открыть счёт. Попробуйте ещё раз или оплатите переводом ниже.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ ok: true, url: res.result.url, stars: pack.stars });
}
