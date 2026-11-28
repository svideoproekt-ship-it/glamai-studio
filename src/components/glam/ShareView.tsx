"use client";

// Страница фото по ссылке /f/<id> (v40) — её открывает КЛИЕНТ из мессенджера
// (и сам мастер — чтобы сохранить образ в свою галерею). Это обычный браузер,
// НЕ WebView Telegram: штатные средства телефона здесь работают всегда —
// «Поделиться» → «Сохранить изображение» на iPhone, скачивание на Android,
// долгое нажатие на фото — в любом случае. Именно поэтому «Сохранить в
// галерею» внутри студии открывает эту страницу во внешнем браузере.

import { useEffect, useState } from "react";
import { Download, Sparkles, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isIosDevice, saveImageFile, shareImage } from "@/lib/download";
import { type Lang, pickClientLang, t } from "@/lib/i18n";
import { ZoomViewer } from "./ZoomViewer";

function formatDate(iso: string, lang: string): string {
  try {
    return new Date(iso).toLocaleDateString(lang === "en" ? "en-US" : lang === "de" ? "de-DE" : lang === "fr" ? "fr-FR" : "ru-RU", {
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
  // v44: лупа деталей — клиентка тоже может рассмотреть образ вблизи
  const [zoomOpen, setZoomOpen] = useState(false);
  // Публичная страница вне AuthGate — язык определяем сами (браузер клиента).
  const [lang, setLang] = useState<Lang>("ru");
  useEffect(() => {
    setLang(pickClientLang({ browser: navigator.language }));
  }, []);
  const until = formatDate(expiresAtIso, lang);

  const handleSave = async () => {
    if (busy) return;
    setBusy(true);
    setHint(null);
    try {
      // iPhone: системное «Поделиться» — в нём есть «Сохранить изображение»,
      // самый короткий путь в галерею «Фото»
      if (isIosDevice()) {
        const how = await shareImage(imgSrc, t(lang, "sv.shareTitle"));
        if (how === "share") {
          setHint(t(lang, "sv.hintShare"));
          setTimeout(() => setHint(null), 15_000);
          return;
        }
        // share недоступен — упадём в сохранение ниже
      }
      const how = await saveImageFile(imgSrc, `glamai-look-${Date.now()}`, "download-only");
      if (how === "download") {
        setHint(t(lang, "sv.hintDownload"));
      } else {
        setHint(t(lang, "sv.hintHold"));
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
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#F6B93B]/20">
            <Sparkles className="h-5 w-5 text-[#F6B93B]" aria-hidden />
          </span>
          <div>
            <p className="font-serif text-lg leading-tight text-[#F8F1E1]">
              GlamAI Studio
            </p>
            <p className="text-xs text-[#F8F1E1]/60">
              {t(lang, "sv.tagline")}
            </p>
          </div>
        </div>

        <img
          src={imgSrc}
          alt={t(lang, "sv.shareTitle")}
          className="w-full cursor-zoom-in rounded-2xl shadow-2xl"
          onClick={() => setZoomOpen(true)}
          draggable={false}
          data-testid="share-photo"
        />

        <Button
          className="glam-btn mt-5 h-12 w-full font-semibold"
          onClick={() => void handleSave()}
          disabled={busy}
          aria-label={t(lang, "sv.zoomAria2")}
          data-testid="share-save"
        >
          <Download className="h-4 w-4" aria-hidden />
          {busy ? t(lang, "sv.busy") : t(lang, "sv.save")}
        </Button>
        <Button
          variant="outline"
          className="mt-2 h-11 w-full border-[#F8F1E1]/30 bg-transparent text-[#F8F1E1] hover:bg-white/10"
          onClick={() => setZoomOpen(true)}
          aria-label={t(lang, "sv.zoomAria")}
          data-testid="share-zoom"
        >
          <ZoomIn className="h-4 w-4" aria-hidden />
          {t(lang, "sv.zoomAria")}
        </Button>
        <p className="mt-2 text-center text-xs leading-relaxed text-[#F8F1E1]/60">
          {t(lang, "sv.holdAlt")}
        </p>
        {hint && (
          <p className="mt-3 text-center text-sm font-medium leading-relaxed text-[#F6B93B]">
            {hint}
          </p>
        )}

        {/* v45: лупа деталей — двойное нажатие и кнопки +/− работают на фото клиента */}
        {zoomOpen && (
          <ZoomViewer
            src={imgSrc}
            alt={t(lang, "res.altZoom")}
            onClose={() => setZoomOpen(false)}
          />
        )}

        {until && (
          <p className="mt-7 text-center text-[11px] leading-relaxed text-[#F8F1E1]/40">
            {t(lang, "sv.expires", { until })}
          </p>
        )}
      </div>
    </main>
  );
}

/** Ссылка просрочена (7 дней) или неверна — вежливое объяснение вместо ошибки. */
export function ShareViewExpired() {
  const lang = typeof window !== "undefined"
    ? pickClientLang({ browser: navigator.language })
    : "ru";
  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-[#043E21] px-6 text-center">
      <div className="green-window w-full max-w-sm rounded-2xl p-6">
        <p className="font-serif text-xl text-[#F8F1E1]">{t(lang, "sv.expired")}</p>
        <p className="mt-2 text-sm leading-relaxed text-[#F8F1E1]/70">
          {t(lang, "sv.expiredBody")}
        </p>
        <a
          href="/"
          className="mt-4 inline-flex h-10 items-center rounded-xl bg-[#F6B93B]/20 px-4 text-sm font-medium text-[#F6B93B] hover:bg-[#F6B93B]/30"
        >
          {t(lang, "sv.openStudio")}
        </a>
      </div>
    </main>
  );
}
