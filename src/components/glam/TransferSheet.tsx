"use client";

// Лист «Передать фото клиенту» — открывается, когда системное меню «Поделиться»
// недоступно (WebView Telegram его прячет). Здесь три честных пути:
//   1) ссылка на фото (v40) — доносит образ до клиента в ЛЮБОЙ мессенджер:
//      клиент открывает страницу и сохраняет фото одной кнопкой;
//   2) бот пришлёт фото в чат мастера → «Переслать» клиенту (внутри Telegram);
//   3) сохранить фото на устройство → вложить скрепкой в WhatsApp/MAX/письмо.
// Глубокие ссылки (wa.me, max.ru, mailto) не могут вложить файл — так устроены
// все мессенджеры; зато ССЫЛКУ на фото они передают без проблем, поэтому
// как только ссылка создана, тексты для WhatsApp/почты сразу содержат её.

import { Link2, Mail, MessageCircle, Paperclip, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openExternal } from "@/lib/download";
import { t } from "@/lib/i18n";
import { useLang } from "./AuthGate";

interface TransferSheetProps {
  open: boolean;
  onClose: () => void;
  sending: boolean;
  maxLink: string;
  /** Ссылка на фото /f/<id>, если уже создана для этого образа */
  linkUrl: string | null;
  linkBusy: boolean;
  /** Внутри Telegram: надёжные пути — ссылка и бот → чат.
   *  В обычном браузере доступно прямое сохранение на устройство. */
  telegramMode: boolean;
  onBotSend: () => void;
  onSaveDevice: () => void;
  onCreateLink: () => void;
}

export function TransferSheet({
  open,
  onClose,
  sending,
  maxLink,
  linkUrl,
  linkBusy,
  telegramMode,
  onBotSend,
  onSaveDevice,
  onCreateLink,
}: TransferSheetProps) {
  const { lang } = useLang();
  if (!open) return null;

  const linkText = linkUrl
    ? t(lang, "ts.shareText", { url: linkUrl })
    : t(lang, "ts.shareTextNoLink");
  const waHref = `https://wa.me/?text=${encodeURIComponent(linkText)}`;
  const mailBody = linkUrl
    ? t(lang, "ts.mailBody", { url: linkUrl })
    : t(lang, "ts.mailBodyNoLink");
  const mailHref = `mailto:?subject=${encodeURIComponent(
    t(lang, "ts.mailSubject")
  )}&body=${encodeURIComponent(mailBody)}`;

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-black/75 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t(lang, "res.transferAria")}
      data-testid="transfer-sheet"
    >
      <div
        className="green-window pop-in max-h-[92vh] w-full max-w-md overflow-y-auto rounded-t-2xl p-5 pb-9"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <p className="font-serif text-lg text-[#F8F1E1]">
            {t(lang, "res.transferTitle")}
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            aria-label={t(lang, "ts.closeAria")}
            className="h-8 px-2 text-muted-foreground hover:text-white"
            data-testid="transfer-sheet-close"
          >
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>

        {/* 1. Ссылка на фото — универсальный путь: доходит в любой мессенджер,
            клиент сохраняет фото одной кнопкой на странице */}
        <div className="mt-4 flex items-start gap-2.5">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#D4A437]/25 text-xs font-bold text-[#F3E2B9]">
            1
          </span>
          <div className="flex-1">
            <Button
              className="glam-btn h-11 w-full font-semibold"
              onClick={onCreateLink}
              disabled={linkBusy}
              data-testid="sheet-make-link"
            >
              <Link2 className="h-4 w-4" aria-hidden />
              {linkBusy
                ? t(lang, "res.linkBusy")
                : linkUrl
                  ? t(lang, "ts.linkReadyShort")
                  : t(lang, "ts.linkForClient")}
            </Button>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              {t(lang, "ts.linkHint")}
            </p>
            {linkUrl && (
              <p className="mt-2 break-all rounded-lg border border-[#F8F1E1]/15 bg-[#032B16]/80 p-2 text-[11px] leading-relaxed text-[#E7DFC9]">
                {linkUrl}
              </p>
            )}
          </div>
        </div>

        {/* 2. Внутри Telegram: бот кладёт фото в чат — оттуда «Переслать»
            клиенту или сохранить в галерею штатным меню Telegram.
            В обычном браузере: прямое сохранение файла на устройство. */}
        <div className="mt-4 flex items-start gap-2.5">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#B76E79]/25 text-xs font-bold text-[#F0D3D8]">
            2
          </span>
          <div className="flex-1">
            {telegramMode ? (
              <>
                <Button
                  variant="outline"
                  className="h-11 w-full border-[#F8F1E1]/30 text-[#F8F1E1] hover:bg-white/10"
                  onClick={onBotSend}
                  disabled={sending}
                  data-testid="sheet-bot-send"
                >
                  <Send className="h-4 w-4" aria-hidden />
                  {sending ? t(lang, "ts.sending") : t(lang, "ts.sendBot")}
                </Button>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {t(lang, "ts.botHint")}
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
                  <Paperclip className="h-4 w-4" aria-hidden />
                  {t(lang, "ts.saveDevice")}
                </Button>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {t(lang, "ts.saveDeviceHint")}
                </p>
              </>
            )}
          </div>
        </div>

        {/* 3. Открыть мессенджер: при наличии ссылки текст сообщения уже
            содержит её — файл вкладывать больше не обязательно */}
        <div className="mt-4 flex items-start gap-2.5">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F6B93B]/25 text-xs font-bold text-[#F8DFA8]">
            3
          </span>
          <div className="flex-1">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {linkUrl
                ? t(lang, "ts.dupLink")
                : telegramMode
                  ? t(lang, "ts.dupFile")
                  : t(lang, "ts.openChat")}
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
                {t(lang, "ts.mail")}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
