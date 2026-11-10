// Отправка готового образа мастеру в чат с ботом — САМЫЙ НАДЁЖНЫЙ способ
// «скачать» на телефоне: WebView Telegram не умеет скачивать файлы (клики
// молча теряются), а вот сообщение от бота приходит всегда. Мастер открывает
// чат с ботом → долгое нажатие на фото → «Сохранить в галерею» или сразу
// «Переслать» клиенту.
//
// Безопасность: chat_id берём ИЗ ПОДПИСАННОЙ СЕССИИ, образ — картинка в
// пределах лимита Bot API (10 МБ на фото). Токен бота наружу не отдаётся.

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

export const runtime = "nodejs";

const MAX_DATAURL_CHARS = 4_000_000; // ~3 МБ изображения в base64
const ALLOWED = /^data:image\/(png|jpe?g|webp);base64,/;

export async function POST(req: NextRequest) {
  const tid = verifySession(req.cookies.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET ?? "");
  if (tid === null) {
    return NextResponse.json({ ok: false, error: "Сессия истекла — войдите заново." }, { status: 401 });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    return NextResponse.json(
      { ok: false, error: "Бот не настроен на сервере (нет TELEGRAM_BOT_TOKEN)." },
      { status: 503 }
    );
  }

  const body = (await req.json().catch(() => ({}))) as { image?: string };
  const dataUrl = typeof body.image === "string" ? body.image : "";
  if (!dataUrl || !ALLOWED.test(dataUrl)) {
    return NextResponse.json({ ok: false, error: "Картинка не передана или неверного формата." }, { status: 400 });
  }
  if (dataUrl.length > MAX_DATAURL_CHARS) {
    return NextResponse.json(
      { ok: false, error: "Образ слишком большой для отправки — сохраните через «Скачать файлом» на компьютере." },
      { status: 413 }
    );
  }

  const meta = dataUrl.slice(0, 30);
  const mime = meta.startsWith("data:image/jpeg") ? "image/jpeg" : meta.startsWith("data:image/webp") ? "image/webp" : "image/png";
  const ext = mime === "image/jpeg" ? "jpg" : mime === "image/webp" ? "webp" : "png";

  try {
    const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
    if (bytes.length === 0) {
      return NextResponse.json({ ok: false, error: "Пустая картинка." }, { status: 400 });
    }

    const form = new FormData();
    form.append("chat_id", String(tid));
    form.append("caption", "Образ GlamAI Studio 💄\nСохранить: долгое нажатие → «Сохранить в галерею». Переслать клиенту: «Переслать».");
    form.append("photo", new Blob([new Uint8Array(bytes)], { type: mime }), `glamai-look-${Date.now()}.${ext}`);

    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: "POST",
      body: form,
    });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error_code?: number; description?: string };

    if (!res.ok || !data.ok) {
      if (data.error_code === 403) {
        return NextResponse.json(
          { ok: false, error: "Бот не может написать вам: откройте бота в Telegram и нажмите «Старт» (или кнопку «Открыть студию»), затем попробуйте ещё раз." },
          { status: 403 }
        );
      }
      if (data.error_code === 429) {
        return NextResponse.json(
          { ok: false, error: "Слишком часто: подождите минуту и попробуйте снова." },
          { status: 429 }
        );
      }
      console.error("[send-image] Bot API:", data.description ?? res.status);
      return NextResponse.json({ ok: false, error: "Telegram не принял фото, попробуйте ещё раз." }, { status: 502 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[send-image] ошибка:", err instanceof Error ? err.message : err);
    return NextResponse.json({ ok: false, error: "Не удалось отправить, попробуйте ещё раз." }, { status: 500 });
  }
}
