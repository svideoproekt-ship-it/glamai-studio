"use client";

// Страница фото по ссылке /f/<id> (v40) — её открывает КЛИЕНТ из мессенджера
// (и сам мастер — чтобы сохранить образ в свою галерею). Это обычный браузер,
// НЕ WebView Telegram: штатные средства телефона здесь работают всегда —
// «Поделиться» → «Сохранить изображение» на iPhone, скачивание на Android,
// долгое нажатие на фото — в любом случае. Именно поэтому «Сохранить в
// галерею» внутри студии открывает эту страницу во внешнем браузере.

import { useState } from "react";
import { Download, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isIosDevice, saveImageFile, shareImage } from "@/lib/download";

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
    });
  } catch {
    return "";
  }
}

export function ShareView({
  imgSrc,
  expiresAtIso,
}: {
  imgSrc: string;
  expiresAtIso: string;
}) {
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const until = formatDate(expiresAtIso);

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
    setHint(null);
    try {
      // iPhone: системное «Поделиться» — в нём есть «Сохранить изображение»,
      // самый короткий путь в галерею «Фото»
      if (isIosDevice()) {
        const how = await shareImage(imgSrc, "Ваш образ GlamAI Studio");
        if (how === "share") {
          setHint("В меню выберите «Сохранить изображение» — фото попадёт в галерею.");
          setTimeout(() => setHint(null), 15_000);
          return;
        }
        // share недоступен — упадём в сохранение ниже
      }
      const how = await saveImageFile(imgSrc, `glamai-look-${Date.now()}`, "download-only");
      if (how === "download") {
        setHint("Фото скачано — оно в «Загрузках» и уже видно в галерее телефона.");
      } else {
        setHint("Если меню не открылось — просто удерживайте палец на фото и выберите «Сохранить».");
      }
      setTimeout(() => setHint(null), 15_000);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#043E21] px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-5 flex items-center gap-2.5">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#8CE99A]/20">
            <Sparkles className="h-5 w-5 text-[#8CE99A]" aria-hidden />
          </span>
          <div>
            <p className="font-serif text-lg leading-tight text-[#F8F1E1]">
              GlamAI Studio
            </p>
            <p className="text-xs text-[#F8F1E1]/60">
              Ваш готовый образ от визажиста
            </p>
          </div>
        </div>

        <img
          src={imgSrc}
          alt="Ваш образ GlamAI Studio"
          className="w-full rounded-2xl shadow-2xl"
          draggable={false}
          data-testid="share-photo"
        />

        <Button
          className="glam-btn mt-5 h-12 w-full font-semibold"
          onClick={() => void handleSave()}
          disabled={busy}
          aria-label="Сохранить фото в галерею телефона"
          data-testid="share-save"
        >
          <Download className="h-4 w-4" aria-hidden />
          {busy ? "Готовим…" : "Сохранить фото"}
        </Button>
        <p className="mt-2 text-center text-xs leading-relaxed text-[#F8F1E1]/60">
          Либо просто удерживайте палец на фото и выберите
          «Сохранить в галерею» / «Добавить в Фото».
        </p>
        {hint && (
          <p className="mt-3 text-center text-sm font-medium leading-relaxed text-[#8CE99A]">
            {hint}
          </p>
        )}

        {until && (
          <p className="mt-7 text-center text-[11px] leading-relaxed text-[#F8F1E1]/40">
            Фото доступно по этой ссылке до {until} — потом оно автоматически
            стирается с сервера. Успейте сохранить.
          </p>
        )}
      </div>
    </main>
  );
}

/** Ссылка просрочена (7 дней) или неверна — вежливое объяснение вместо ошибки. */
export function ShareViewExpired() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#043E21] px-6 text-center">
      <div className="green-window w-full max-w-sm rounded-2xl p-6">
        <p className="font-serif text-xl text-[#F8F1E1]">Ссылка устарела</p>
        <p className="mt-2 text-sm leading-relaxed text-[#F8F1E1]/70">
          Фото по ссылке хранится 7 дней, потом автоматически стирается — мы
          бережём личные фотографии. Попросите мастера отправить свежую ссылку:
          новый образ создаётся за минуту.
        </p>
        <a
          href="/"
          className="mt-4 inline-flex h-10 items-center rounded-xl bg-[#8CE99A]/20 px-4 text-sm font-medium text-[#8CE99A] hover:bg-[#8CE99A]/30"
        >
          Открыть студию
        </a>
      </div>
    </main>
  );
}
