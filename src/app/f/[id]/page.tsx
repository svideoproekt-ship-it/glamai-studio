// Страница фото по ссылке (v40): /f/<id> — её открывает КЛИЕНТ из любого
// мессенджера (WhatsApp, MAX, почта, SMS) и сохраняет фото штатными
// средствами телефона. Никакого входа не требуется: адрес неугадываемый
// (18 случайных символов) и живёт 7 дней.
//
// Если ссылка просрочена или неверна — показываем вежливую страницу
// «Ссылка устарела» вместо ошибки сервера.

import type { Metadata } from "next";
import { getPhotoLink } from "@/lib/store";
import { ShareView, ShareViewExpired } from "@/components/glam/ShareView";

// Каждое открытие — свежая проверка срока: кэшировать страницу нельзя,
// иначе после 7 дней клиент увидит «жизни» фото дольше, чем оно есть.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Ваш образ GlamAI Studio",
  description: "Фотография готового образа — сохраните её в галерею телефона.",
  robots: { index: false, follow: false },
};

export default async function PhotoLinkPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let link: Awaited<ReturnType<typeof getPhotoLink>> = null;
  try {
    link = await getPhotoLink(id);
  } catch (err) {
    console.error("[f] база недоступна:", err instanceof Error ? err.message : err);
  }

  if (!link) return <ShareViewExpired />;

  return (
    <ShareView
      imgSrc={`/api/i/${link.id}`}
      expiresAtIso={link.expiresAt.toISOString()}
    />
  );
}
