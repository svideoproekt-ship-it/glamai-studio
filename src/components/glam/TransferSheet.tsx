"use client";

// Лист «Передать фото клиенту» — открывается, когда системное меню «Поделиться»
// недоступно (WebView Telegram его прячет). Здесь собраны два честных пути,
// которые ДОНОСЯТ файл до клиента:
//   1) бот пришлёт фото в чат мастера → «Переслать» клиенту (Telegram, всегда);
//   2) сохранить фото на устройство → вложить скрепкой в WhatsApp/MAX/письмо.
// Глубокие ссылки (wa.me, max.ru, mailto) не могут вложить файл — так устроены
// все мессенджеры, поэтому кнопки открытия чата идут ПОСЛЕ сохранения фото
// и подписаны честной инструкцией.

import { Mail, MessageCircle, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TransferSheetProps {
  open: boolean;
  onClose: () => void;
  sending: boolean;
  maxLink: string;
  /** Внутри Telegram: единственный надёжный путь — бот → чат.
   *  В обычном браузере доступно прямое сохранение на устройство. */
  telegramMode: boolean;
  onBotSend: () => void;
  onSaveDevice: () => void;
}

/** Открыть внешнюю ссылку так, чтобы её не проглотил WebView Telegram:
 *  внутри Mini App — штатный openLink, в обычном браузере — новая вкладка. */
function openExternal(url: string): void {
  if (typeof window === "undefined") return;
  const app = (
    window as unknown as {
      Telegram?: { WebApp?: { openLink?: (u: string) => void } };
    }
  ).Telegram?.WebApp;
  if (url.startsWith("mailto:")) {
    // mailto openLink не поддерживает — отдаём навигации браузера
    window.location.href = url;
    return;
  }
  if (app?.openLink) {
    try {
      app.openLink(url);
      return;
    } catch {
      /* упадём в обычную навигацию ниже */
    }
  }
  window.open(url, "_blank", "noopener");
}

export function TransferSheet({
  open,
  onClose,
  sending,
  maxLink,
  telegramMode,
  onBotSend,
  onSaveDevice,
}: TransferSheetProps) {
  if (!open) return null;

  const waHref = `https://wa.me/?text=${encodeURIComponent(
    "Вот ваш образ GlamAI Studio 💄 — фото вкладываю следом"
  )}`;
  const mailHref = `mailto:?subject=${encodeURIComponent(
    "Ваш образ GlamAI Studio"
  )}&body=${encodeURIComponent(
    "Здравствуйте!\n\nВаш образ GlamAI Studio — во вложении к письму.\n\nGlamAI Studio"
  )}`;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Передать фото клиенту"
      data-testid="transfer-sheet"
    >
      <div
        className="green-window pop-in max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl p-5 pb-9"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="font-serif text-lg text-[#F8F1E1]">
            Передать фото клиенту
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label="Закрыть"
            className="h-8 px-2 text-muted-foreground hover:text-white"
            data-testid="transfer-sheet-close"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        {/* Внутри Telegram: бот кладёт фото в чат — оттуда «Переслать»
            клиенту или сохранить в галерею штатным меню Telegram.
            В обычном браузере: прямое сохранение файла на устройство. */}
        <div className="mt-4 flex items-start gap-2.5">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#8CE99A]/25 text-xs font-bold text-[#DFF7E6]">
            1
          </span>
          <div className="flex-1">
            {telegramMode ? (
              <>
                <Button
                  className="glam-btn h-11 w-full font-semibold"
                  onClick={onBotSend}
                  disabled={sending}
                  data-testid="sheet-bot-send"
                >
                  <Send className="h-4 w-4" />
                  {sending ? "Отправляем…" : "Отправить ботом в Telegram"}
                </Button>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Фото придёт в чат с ботом, и мы откроем его сами. Оттуда:
                  «Переслать» клиенту — или сохраните фото в галерею через
                  меню фото (Android: три точки → «Сохранить в галерею»;
                  iPhone: «Поделиться» → «Сохранить изображение»), чтобы
                  вложить его в другие мессенджеры.
                </p>
              </>
            ) : (
              <>
                <Button
                  variant="outline"
                  className="h-11 w-full border-[#F8F1E1]/30 text-[#F8F1E1] hover:bg-white/10"
                  onClick={onSaveDevice}
                  data-testid="sheet-save-device"
                >
                  <Paperclip className="h-4 w-4" />
                  Сохранить фото на устройство
                </Button>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Затем в мессенджере или почте нажмите «скрепка» → «Галерея»
                  и выберите сохранённое фото. Ссылка не может вложить файл
                  сама — так устроены все мессенджеры.
                </p>
              </>
            )}
          </div>
        </div>

        {/* Открыть мессенджер: фото вкладывается скрепкой уже в чате */}
        <div className="mt-4 flex items-start gap-2.5">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#9B6EF3]/25 text-xs font-bold text-[#D9CCFF]">
            2
          </span>
          <div className="flex-1">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {telegramMode
                ? "После сохранения в галерею откройте мессенджер и вложите фото скрепкой:"
                : "Открыть чат сразу (фото вкладывается скрепкой в самом чате):"}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-[#F8F1E1]/30 text-[#F8F1E1] hover:bg-white/10"
                onClick={() => openExternal(waHref)}
                data-testid="sheet-whatsapp"
              >
                <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                WhatsApp
              </Button>
              {maxLink && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-[#F8F1E1]/30 text-[#F8F1E1] hover:bg-white/10"
                  onClick={() => openExternal(maxLink)}
                  data-testid="sheet-max"
                >
                  <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                  MAX
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-[#F8F1E1]/30 text-[#F8F1E1] hover:bg-white/10"
                onClick={() => openExternal(mailHref)}
                data-testid="sheet-mail"
              >
                <Mail className="h-3.5 w-3.5" aria-hidden />
                Почта
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
