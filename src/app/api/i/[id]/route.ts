// Отдача фото по ссылке (v40): GET /api/i/<id> возвращает сам файл картинки.
// Страница /f/<id> показывает это фото в <img> — обычный http-адрес, на
// котором долгое нажатие и «Сохранить картинку» работают в любом браузере
// (в отличие от data:URL, который WebView Telegram глотает молча).
//
// Доступ публичный: адрес содержит 18 случайных символов base62 — угадать
// его нельзя, а срок жизни ссылки ограничен 7 днями.

import { NextRequest, NextResponse } from "next/server";
import { getPhotoLink } from "@/lib/store";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let link: Awaited<ReturnType<typeof getPhotoLink>> = null;
  try {
    link = await getPhotoLink(id);
  } catch (err) {
    console.error("[i] база недоступна:", err instanceof Error ? err.message : err);
    return new NextResponse("Сервис временно недоступен, попробуйте позже", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  if (!link) {
    return new NextResponse("Ссылка устарела или неверна", {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const bytes = Buffer.from(link.data, "base64");
  const ext = link.mime === "image/webp" ? "webp" : link.mime === "image/png" ? "png" : "jpg";
  return new NextResponse(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": link.mime,
      "Content-Length": String(bytes.length),
      // Ссылка живёт 7 дней, кэш на сутки — повторные открытия летают
      "Cache-Control": "public, max-age=86400, immutable",
      "Content-Disposition": `inline; filename="glamai-look.${ext}"`,
    },
  });
}
