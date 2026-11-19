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
  if (!open) return null;

  const linkText = linkUrl
    ? `Вот ваш образ GlamAI Studio 💄 — откройте ссылку и сохраните фото: ${linkUrl}`
    : "Вот ваш образ GlamAI Studio 💄 — фото вкладываю следом";
  const waHref = `https://wa.me/?text=${encodeURIComponent(linkText)}`;
  const mailBody = linkUrl
    ? `Здравствуйте!\n\nВаш образ GlamAI Studio — по ссылке (фото доступно 7 дней): ${linkUrl}\n\nGlamAI Studio`
    : "Здравствуйте!\n\nВаш образ GlamAI Studio — во вложении к письму.\n\nGlamAI Studio";
  const mailHref = `mailto:?subject=${encodeURIComponent(
    "Ваш образ GlamAI Studio"
  )}&body=${encodeURIComponent(mailBody)}`;

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

        {/* 1. Ссылка на фото — универсальный путь: доходит в любой мессенджер,
            клиент сохраняет фото одной кнопкой на странице */}
        <div className="mt-4 flex items-start gap-2.5">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#8CE99A]/25 text-xs font-bold text-[#DFF7E6]">
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
                ? "Готовим ссылку…"
                : linkUrl
                  ? "Ссылка готова — она под фото"
                  : "Получить ссылку для клиента"}
            </Button>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
              Ссылка доносит фото до клиента в ЛЮБОЙ мессенджер — WhatsApp,
              MAX, почту: клиент откроет её и сохранит фото одной кнопкой.
              Ссылка живёт 7 дней. После создания она появится под фото —
              скопируйте и вставьте в сообщение.
            </p>
            {linkUrl && (
              <p className="mt-2 break-all rounded-lg border border-[#C9EED8]/25 bg-[#043E21]/70 p-2 text-[11px] leading-relaxed text-[#CFEEDB]">
                {linkUrl}
              </p>
            )}
          </div>
        </div>

        {/* 2. Внутри Telegram: бот кладёт фото в чат — оттуда «Переслать»
            клиенту или сохранить в галерею штатным меню Telegram.
            В обычном браузере: прямое сохранение файла на устройство. */}
        <div className="mt-4 flex items-start gap-2.5">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#9B6EF3]/25 text-xs font-bold text-[#D9CCFF]">
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
                  {sending ? "Отправляем…" : "Отправить ботом в Telegram"}
                </Button>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  Фото придёт в чат с ботом, и мы откроем его сами. Оттуда:
                  «Переслать» клиенту — или сохраните фото в галерею через
                  меню фото (Android: три точки → «Сохранить в галерею»;
                  iPhone: «Поделиться» → «Сохранить изображение»).
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

        {/* 3. Открыть мессенджер: при наличии ссылки текст сообщения уже
            содержит её — файл вкладывать больше не обязательно */}
        <div className="mt-4 flex items-start gap-2.5">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F6B93B]/25 text-xs font-bold text-[#F8DFA8]">
            3
          </span>
          <div className="flex-1">
            <p className="text-xs leading-relaxed text-muted-foreground">
              {linkUrl
                ? "Дублируем ссылку в чат (или вложите само фото после сохранения):"
                : telegramMode
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
