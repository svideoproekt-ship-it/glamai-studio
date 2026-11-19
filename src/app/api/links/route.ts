// Создание ссылки на готовый образ (v40): фото сохраняется на сервере
// (Neon) и получает неугадываемый адрес /f/<id>. Ссылку можно отправить
// клиенту в ЛЮБОМ мессенджере — вложения не нужны, а страница фото в
// настоящем браузере сохраняется в галерею штатными средствами телефона.
//
// Безопасность: ссылку создаёт только владелец подписанной сессии
// (как в /api/send-image). Сам адрес ссылки — 18 случайных символов
// base62: перебор невозможен. Фото стирается с сервера через 7 дней
// (PHOTO_LINK_TTL_DAYS).

import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { createPhotoLink, PHOTO_LINK_TTL_DAYS } from "@/lib/store";

export const runtime = "nodejs";

const MAX_DATAURL_CHARS = 4_000_000; // ~3 МБ изображения в base64 (как в /api/send-image)
const ALLOWED = /^data:image\/(png|jpe?g|webp);base64,/;

export async function POST(req: NextRequest) {
  const tid = verifySession(req.cookies.get(SESSION_COOKIE)?.value, process.env.AUTH_SECRET ?? "");
  if (tid === null) {
    return NextResponse.json({ ok: false, error: "Сессия истекла — войдите заново." }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { image?: string };
  const dataUrl = typeof body.image === "string" ? body.image : "";
  if (!dataUrl || !ALLOWED.test(dataUrl)) {
    return NextResponse.json({ ok: false, error: "Картинка не передана или неверного формата." }, { status: 400 });
  }
  if (dataUrl.length > MAX_DATAURL_CHARS) {
    return NextResponse.json(
      { ok: false, error: "Образ слишком большой для ссылки — создайте образ заново, он будет компактнее." },
      { status: 413 }
    );
  }

  try {
    const { id, expiresAt } = await createPhotoLink(dataUrl, tid);
    return NextResponse.json({
      ok: true,
      id,
      expiresAt: expiresAt.toISOString(),
      ttlDays: PHOTO_LINK_TTL_DAYS,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[links] ошибка:", msg);
    if (msg.includes("База данных не настроена")) {
      return NextResponse.json({ ok: false, error: msg }, { status: 503 });
    }
    return NextResponse.json(
      { ok: false, error: "Не удалось создать ссылку, попробуйте ещё раз." },
      { status: 500 }
    );
  }
}
