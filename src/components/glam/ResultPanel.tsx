"use client";

import { useEffect, useState } from "react";
import {
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Eye,
  Info,
  Link2,
  RotateCcw,
  Share2,
  Sparkles,
  ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  isIosDevice,
  isTelegramWebView,
  openExternal,
  saveImageFile,
  shareImage,
} from "@/lib/download";
import { openTelegramChat, useAuth } from "./AuthGate";
import { TransferSheet } from "./TransferSheet";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { BeforeAfterSlider } from "./BeforeAfterSlider";
import { ZoomViewer, EYES_FOCUS, type ZoomFocus } from "./ZoomViewer";

const STATUSES = [
  "Изучаем черты лица…",
  "Подбираем оттенки…",
  "Наносим тени…",
  "Прорисовываем стрелки…",
  "Смешиваем текстуры…",
  "Финальный штрих…",
];

const DOT_COLORS = ["#B98A2E", "#D4A437", "#F6B93B"];

/** v41: карточка записи в студию-источник под готовым образом.
 *  Образ уже выбран — это самый горячий момент для записи к мастеру. */
function StudioBookingCard() {
  const { profile } = useAuth();
  const studio = profile?.studio;
  if (!studio) return null;
  return (
    <div
      className="rounded-2xl border border-[#F6B93B]/45 bg-[#06301B]/70 p-4"
      data-testid="studio-booking-result"
    >
      <p className="text-sm font-bold text-[#F8F1E1]">
        Образ выбран — запишитесь в «{studio.name}»
      </p>
      <p className="mt-1 text-xs leading-relaxed text-[#F8F1E1]/75">
        Визажист студии воплотит этот образ. Первые 5 примерок — за счёт GlamAI Studio.
      </p>
      {studio.bookingUrl && (
        <Button
          className="glam-btn mt-3 h-10 w-full text-sm font-bold"
          onClick={() => void openExternal(studio.bookingUrl as string)}
          data-testid="studio-book-result"
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
          Записаться в «{studio.name}»
        </Button>
      )}
    </div>
  );
}

interface ResultPanelProps {
  loading: boolean;
  original: string | null;
  result: string | null;
  usedPrompt: string | null;
  usedDescription: string | null;
  /** Публичный API Z.AI: результат — портрет по описанию внешности, не правка фото */
  portraitMode?: boolean;
  /** Ссылка на чат владельца в MAX (необязательно) — для листа передачи фото */
  maxLink?: string;
  onReset: () => void;
}

export function ResultPanel({
  loading,
  original,
  result,
  usedPrompt,
  usedDescription,
  portraitMode,
  maxLink = "",
  onReset,
}: ResultPanelProps) {
  const [tick, setTick] = useState(0);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [saveHint, setSaveHint] = useState<string | null>(null);
  // v44: лупа деталей (вместо старого лайтбокса) — стрелки, подводка и
  // растяжка тонов на фото шириной с экран не видны, нужен зум. Открывается
  // кнопками «Глаза крупно» / «Рассмотреть детали» и из запасного просмотра.
  const [zoomOpen, setZoomOpen] = useState(false);
  const [zoomFocus, setZoomFocus] = useState<ZoomFocus | null>(null);
  const [zoomFooter, setZoomFooter] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Ссылка на фото /f/<id> (v40) — универсальный путь к клиенту и к галерее
  const [linkUrl, setLinkUrl] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);

  useEffect(() => {
    if (!loading) return;
    setTick(0);
    const t = setInterval(() => setTick((x) => x + 1), 2800);
    return () => clearInterval(t);
  }, [loading]);

  // Новый образ — новая ссылка: старая остаётся жить свои 7 дней на сервере,
  // но панель под фото сбрасываем, чтобы не показать чужой адрес
  useEffect(() => {
    setLinkUrl(null);
  }, [result]);

  if (loading) {
    const status = STATUSES[tick % STATUSES.length];
    return (
      <div
        aria-live="polite"
        className="green-card relative mx-auto flex aspect-[3/4] w-full max-w-md flex-col items-center justify-center gap-5 rounded-2xl"
      >
        {/* Мерцающие искры по углам */}
        <Sparkles
          aria-hidden
          className="twinkle absolute left-6 top-6 h-4 w-4 text-[#F6B93B]"
          style={{ animationDuration: "2.1s" }}
        />
        <Sparkles
          aria-hidden
          className="twinkle absolute right-8 top-10 h-3 w-3 text-[#E9C46A]"
          style={{ animationDuration: "2.9s", animationDelay: "-0.9s" }}
        />
        <Sparkles
          aria-hidden
          className="twinkle absolute bottom-8 left-10 h-3 w-3 text-[#D4A437]"
          style={{ animationDuration: "2.5s", animationDelay: "-1.6s" }}
        />
        <Sparkles
          aria-hidden
          className="twinkle absolute bottom-14 right-6 h-4 w-4 text-[#F6B93B]"
          style={{ animationDuration: "3.3s", animationDelay: "-0.4s" }}
        />

        {/* Радужное коническое кольцо */}
        <div className="relative h-16 w-16">
          <div className="conic-loader absolute inset-0 rounded-full" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Sparkles className="float-y h-6 w-6 text-[#D4A437]" />
          </div>
        </div>

        <div className="text-center">
          <p key={tick} className="fade-swap font-serif text-xl text-[#F8F1E1]">
            {status}
          </p>
          <div className="mt-3 flex items-center justify-center gap-1.5">
            {DOT_COLORS.map((c, i) => (
              <span
                key={i}
                aria-hidden
                className="h-1.5 w-1.5 animate-bounce rounded-full"
                style={{
                  backgroundColor: c,
                  animationDelay: `${i * 0.18}s`,
                  animationDuration: "1s",
                }}
              />
            ))}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Обычно занимает 20–60 секунд
          </p>
        </div>
      </div>
    );
  }

  // «Передать фото клиенту»: где есть системное меню — сразу открываем его
  // с файлом-картинкой: в нём Telegram, WhatsApp, MAX и почта, и фото вложено
  // само. Где меню нет (WebView Telegram его прячет) — открываем лист
  // «Передача фото» с двумя проверенными путями: бот → переслать клиенту,
  // сохранить на устройство → вложить скрепкой. Реакция есть всегда.
  const handleTransfer = async () => {
    if (!result || saving) return;
    setSaving(true);
    setSaveHint(null);
    try {
      const how = await shareImage(result, "Образ GlamAI Studio 💄");
      if (how === "share") return; // системное меню открылось (или мастер закрыл его сам)
      setSheetOpen(true);
    } finally {
      setSaving(false);
    }
  };

  // Ссылка на фото (v40): образ сохраняется на сервере и получает адрес
  // /f/<id>. Ссылка проходит любым мессенджером без вложений, а страница
  // фото в настоящем браузере сохраняется в галерею всегда. Один образ —
  // одна ссылка: повторные нажатия переиспользуют уже созданную.
  const ensureLinkUrl = async (): Promise<string | null> => {
    if (linkUrl) return linkUrl;
    if (!result || linkBusy) return null;
    setLinkBusy(true);
    try {
      const res = await fetch("/api/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: result }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        id?: string;
        error?: string;
      };
      if (!data.ok || !data.id) {
        setSaveHint(data.error ?? "Не удалось создать ссылку, попробуйте ещё раз.");
        setTimeout(() => setSaveHint(null), 15_000);
        return null;
      }
      const url = `${window.location.origin}/f/${data.id}`;
      setLinkUrl(url);
      return url;
    } catch {
      setSaveHint("Не удалось связаться с сервером, попробуйте ещё раз.");
      setTimeout(() => setSaveHint(null), 12_000);
      return null;
    } finally {
      setLinkBusy(false);
    }
  };

  const handleMakeLink = async () => {
    const url = await ensureLinkUrl();
    if (url) {
      setSaveHint(
        "Ссылка готова — отправьте её клиенту в любом мессенджере или откройте сами и нажмите «Сохранить фото»."
      );
      setTimeout(() => setSaveHint(null), 15_000);
    }
  };

  const handleCopyLink = async () => {
    if (!linkUrl) return;
    try {
      await navigator.clipboard.writeText(linkUrl);
      setSaveHint("Ссылка скопирована — вставьте её в сообщение клиенту.");
    } catch {
      // Clipboard API бывает недоступен — резервный путь через textarea
      const ta = document.createElement("textarea");
      ta.value = linkUrl;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setSaveHint("Ссылка скопирована — вставьте её в сообщение клиенту.");
      } catch {
        setSaveHint(linkUrl); // покажем ссылку — её можно выделить руками
      }
      ta.remove();
    }
    setTimeout(() => setSaveHint(null), 12_000);
  };

  // Бот пришлёт фото в чат с мастером — работает на любом устройстве, ведь
  // WebView Telegram не умеет скачивать. После отправки сами открываем чат:
  // оттуда «Переслать» клиенту или сохранить фото в галерею штатным меню.
  const handleSendToTg = async () => {
    if (!result || sending) return;
    setSending(true);
    setSaveHint(null);
    try {
      const res = await fetch("/api/send-image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: result }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        botUsername?: string;
      };
      if (!data.ok) {
        setSaveHint(data.error ?? "Не удалось отправить, попробуйте ещё раз.");
      } else {
        setSheetOpen(false);
        setSaveHint(
          "Фото в чате с ботом — открыли его для вас: «Переслать» клиенту или сохранить в галерею через меню фото."
        );
        if (data.botUsername) {
          openTelegramChat(`https://t.me/${data.botUsername}`);
        }
      }
      setTimeout(() => setSaveHint(null), 15_000);
    } catch {
      setSaveHint("Не удалось связаться с сервером, попробуйте ещё раз.");
      setTimeout(() => setSaveHint(null), 12_000);
    } finally {
      setSending(false);
    }
  };

  // Запасной крупный просмотр (когда и ссылка, и бот недоступны): в v44 это
  // лупа с зумом, и подсказка про сохранение внизу
  const openFallbackViewer = () => {
    setZoomFocus(null);
    setZoomFooter(
      "Удерживайте палец на фото — телефон предложит «Сохранить» (срабатывает не везде). Надёжнее всего — «Получить ссылку»: фото откроется в браузере с кнопкой «Сохранить фото»."
    );
    setZoomOpen(true);
  };

  // Запрос к /api/send-image: бот кладёт фото в чат мастера и сообщает свой
  // username. Общий для «Сохранить в галерею» и листа передачи.
  const sendViaBot = async (): Promise<{
    ok: boolean;
    botUsername?: string;
    error?: string;
  }> => {
    const res = await fetch("/api/send-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ image: result }),
    });
    return (await res.json().catch(() => ({}))) as {
      ok: boolean;
      botUsername?: string;
      error?: string;
    };
  };

  const openBotChat = (botUsername?: string): void => {
    if (botUsername) openTelegramChat(`https://t.me/${botUsername}`);
  };

  const botSaveHint = (): string =>
    isIosDevice()
      ? "Фото уже в чате с ботом — открыли его для вас. Нажмите на фото → «Поделиться» → «Сохранить изображение» — фото окажется в галерее."
      : "Фото уже в чате с ботом — открыли его для вас. Откройте фото на весь экран → меню (три точки) → «Сохранить в галерею».";

  // «Сохранить в галерею»: гарантированный путь к фото в галерее телефона.
  // В WebView Telegram ни скачивание, ни долгое нажатие не работают —
  // поэтому (v40) открываем фото по ссылке /f/<id> в НАСТОЯЩЕМ браузере
  // (Telegram.WebApp.openLink): там «Сохранить» работает всегда. Запасной
  // путь — бот кладёт фото в чат, Telegram сохраняет из чата нативно.
  const handleSaveGallery = async (fromSheet = false) => {
    if (!result || saving || sending) return;
    if (fromSheet) setSheetOpen(false);

    if (isTelegramWebView()) {
      setSending(true);
      setSaveHint(null);
      try {
        // Самый надёжный путь (v40): настоящий браузер, не WebView Telegram.
        // Создаём ссылку на фото и открываем страницу /f/<id> снаружи — там
        // «Сохранить фото» и долгое нажатие работают на любом телефоне.
        const url = await ensureLinkUrl();
        if (url) {
          openExternal(url);
          setSaveHint(
            isIosDevice()
              ? "Открыли фото в браузере: нажмите «Сохранить фото» — или удерживайте палец на фото → «Добавить в Фото». Этой же ссылкой можно отправить фото клиенту."
              : "Открыли фото в браузере: нажмите «Сохранить фото» — оно окажется в галерее. Этой же ссылкой можно отправить фото клиенту."
          );
          setTimeout(() => setSaveHint(null), 25_000);
          return;
        }
        // Ссылку создать не вышло (причина уже показана) — запасной путь: бот
        const data = await sendViaBot();
        if (!data.ok) {
          setSaveHint(
            data.error ??
              "Не удалось отправить, попробуйте ещё раз."
          );
          // запасной путь, если бот не настроен: лупа с зумом
          openFallbackViewer();
          return;
        }
        setSaveHint(botSaveHint());
        openBotChat(data.botUsername);
      } catch {
        setSaveHint("Не удалось связаться с сервером, попробуйте ещё раз.");
        openFallbackViewer();
      } finally {
        setSending(false);
      }
      return;
    }

    // Обычный браузер: iPhone — системное «Поделиться» (в нём есть
    // «Сохранить изображение» — самый короткий путь в галерею «Фото»);
    // Android и ПК — прямое скачивание файла.
    setSaving(true);
    setSaveHint(null);
    try {
      if (isIosDevice()) {
        const how = await shareImage(result, "Образ GlamAI Studio 💄");
        if (how === "share") {
          setSaveHint(
            "В меню выберите «Сохранить изображение» — фото попадёт в галерею."
          );
          setTimeout(() => setSaveHint(null), 12_000);
          return;
        }
        // share недоступен — упадём в скачивание ниже
      }
      const how = await saveImageFile(result, `glamai-look-${Date.now()}`, "download-only");
      if (how === "download") {
        setSaveHint(
          "Фото в «Загрузках» — оно видно в галерее, и его можно вложить в сообщение мессенджера."
        );
        setTimeout(() => setSaveHint(null), 12_000);
      } else if (how === "tab" || how === "opened-raw") {
        setSaveHint(
          "Прямое скачивание здесь недоступно — открыли фото крупно: удерживайте палец → «Сохранить в галерею»."
        );
        setTimeout(() => setSaveHint(null), 15_000);
      }
    } finally {
      setSaving(false);
    }
  };

  if (!result) {
    return (
      <div className="green-window mx-auto flex aspect-[3/4] w-full max-w-md flex-col items-center justify-center gap-4 rounded-2xl px-6 text-center">
        <div className="float-y rounded-full bg-gradient-to-br from-[#F6B93B]/20 via-[#E9C46A]/15 to-[#D4A437]/15 p-4 shadow-inner">
          <Sparkles className="h-8 w-8 text-[#F6B93B]" />
        </div>
        <p className="font-serif text-2xl text-[#F8F1E1]">Результат появится здесь</p>
        <ol className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#D4A437]/25 text-xs font-bold text-[#F3E2B9]">
              1
            </span>
            Загрузите фото модели или клиента
          </li>
          <li className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#B76E79]/25 text-xs font-bold text-[#F0D3D8]">
              2
            </span>
            Соберите образ в палитре или с референсом
          </li>
          <li className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#F6B93B]/25 text-xs font-bold text-[#F8DFA8]">
              3
            </span>
            Сравните «до и после» и сохраните
          </li>
        </ol>
      </div>
    );
  }

  return (
    <div key={result} className="reveal space-y-4">
      {/* v41: студия-источник — сразу под готовым образом: образ выбран,
          момент максимальной готовности к записи */}
      <StudioBookingCard />
      {portraitMode && (
        <div className="mx-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border border-[#F6B93B]/40 bg-[#2E2210]/95 p-3 text-left">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-[#F6B93B]" />
          <p className="text-[11px] leading-relaxed text-[#E3D0A6]">
            Режим портрета: тариф Z.AI на вашем сервере не поддерживает правку фотографии,
            поэтому образ создан как фотореалистичный портрет по описанию внешности с вашего
            фото. Лицо может немного отличаться от оригинала.
          </p>
        </div>
      )}
      <BeforeAfterSlider before={original ?? result} after={result} alt="Образ GlamAI" />

      {/* v44: лупа деталей — стрелки, подводка и растяжка тонов видны только
          вблизи. Пресет «Глаза крупно» сразу открывает зум на уровень глаз —
          это главный аргумент для мастеров и школ. */}
      <div className="mx-auto flex w-full max-w-md flex-wrap items-center justify-center gap-2">
        <Button
          className="glam-btn h-10 font-semibold"
          onClick={() => {
            setZoomFooter(null);
            setZoomFocus(EYES_FOCUS);
            setZoomOpen(true);
          }}
          aria-label="Увеличить область глаз"
          data-testid="zoom-eyes"
        >
          <Eye className="h-4 w-4" aria-hidden />
          Глаза крупно
        </Button>
        <Button
          variant="outline"
          className="h-10 border-[#F8F1E1]/30 text-[#F8F1E1] hover:bg-white/10"
          onClick={() => {
            setZoomFooter(null);
            setZoomFocus(null);
            setZoomOpen(true);
          }}
          aria-label="Рассмотреть детали образа"
          data-testid="zoom-details"
        >
          <ZoomIn className="h-4 w-4" aria-hidden />
          Рассмотреть детали
        </Button>
      </div>
      <p className="mx-auto max-w-md text-center text-xs leading-relaxed text-muted-foreground">
        Стрелки, подводка и растяжка тонов лучше всего видны вблизи —
        увеличьте фото двумя пальцами или двойным нажатием.
      </p>

      {/* Единый блок передачи: без дублей. Первичная кнопка — системное
          «Поделиться» с файлом (там Telegram/WhatsApp/MAX/почта), иначе —
          лист с ботом и сохранением. «Сохранить в галерею» — отдельный путь. */}
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm font-medium text-[#F8F1E1]/90">Передайте образ клиенту</p>
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            className="glam-btn h-10 font-semibold"
            onClick={() => void handleTransfer()}
            disabled={saving || sending}
            aria-label="Передать фото клиенту"
            data-testid="transfer-look"
          >
            <Share2 className="h-4 w-4" />
            Передать фото клиенту
          </Button>
          <Button
            variant="outline"
            className="h-10 border-[#F8F1E1]/30 text-[#F8F1E1] hover:bg-white/10"
            onClick={() => void handleMakeLink()}
            disabled={saving || sending || linkBusy}
            aria-label="Получить ссылку на фото для клиента"
            data-testid="make-link"
          >
            <Link2 className="h-4 w-4" />
            {linkBusy ? "Готовим ссылку…" : linkUrl ? "Ссылка готова" : "Получить ссылку"}
          </Button>
          <Button
            variant="outline"
            className="h-10 border-[#F8F1E1]/30 text-[#F8F1E1] hover:bg-white/10"
            onClick={() => void handleSaveGallery(false)}
            disabled={saving || sending}
            aria-label="Сохранить образ в галерею устройства"
            data-testid="download-look"
          >
            <Download className="h-4 w-4" />
            Сохранить в галерею
          </Button>
          <Button
            variant="ghost"
            className="text-muted-foreground hover:text-white"
            onClick={onReset}
          >
            <RotateCcw className="h-4 w-4" />
            Новый образ
          </Button>
        </div>
        {linkUrl && (
          <div
            className="w-full max-w-md rounded-xl border border-[#F8F1E1]/15 bg-[#032B16]/80 p-3"
            data-testid="link-panel"
          >
            <p className="text-xs font-medium text-[#F8F1E1]/85">
              Ссылка на фото (действует 7 дней):
            </p>
            <p className="mt-1 break-all text-[11px] leading-relaxed text-[#E7DFC9]">
              {linkUrl}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                className="glam-btn h-8"
                onClick={() => void handleCopyLink()}
                data-testid="link-copy"
              >
                <Copy className="h-3.5 w-3.5" aria-hidden />
                Скопировать
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-[#F8F1E1]/30 text-[#F8F1E1] hover:bg-white/10"
                onClick={() => openExternal(linkUrl)}
                data-testid="link-open"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                Открыть в браузере
              </Button>
            </div>
          </div>
        )}
        {saveHint && (
          <p className="max-w-md text-center text-xs leading-relaxed text-[#F8F1E1]/75">
            {saveHint}
          </p>
        )}
      </div>

      {usedDescription && (
        <Collapsible className="mx-auto w-full max-w-md">
          <CollapsibleTrigger className="group mx-auto flex h-8 items-center gap-1.5 rounded-md px-3 text-xs text-muted-foreground transition-colors hover:text-[#F8F1E1]">
            Что ИИ увидел на референсе
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="custom-scroll mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[#F8F1E1]/15 bg-[#032B16]/80 p-3 text-left text-[11px] leading-relaxed text-[#E7DFC9]">
              {usedDescription}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}

      {usedPrompt && (
        <Collapsible className="mx-auto w-full max-w-md">
          <CollapsibleTrigger className="group mx-auto flex h-8 items-center gap-1.5 rounded-md px-3 text-xs text-muted-foreground transition-colors hover:text-[#F8F1E1]">
            Использованный промпт
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="custom-scroll mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[#F8F1E1]/15 bg-[#032B16]/80 p-3 text-left text-[11px] leading-relaxed text-[#E7DFC9]">
              {usedPrompt}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Лист передачи фото — для сред без системного меню (WebView Telegram):
          ссылка → бот → переслать клиенту, сохранить → вложить скрепкой,
          чаты WhatsApp/MAX/почта (с ссылкой в тексте сообщения) */}
      <TransferSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        sending={sending}
        maxLink={maxLink}
        linkUrl={linkUrl}
        linkBusy={linkBusy}
        telegramMode={isTelegramWebView()}
        onBotSend={() => void handleSendToTg()}
        onSaveDevice={() => void handleSaveGallery(true)}
        onCreateLink={() => {
          setSheetOpen(false);
          void handleMakeLink();
        }}
      />

      {/* v44: лупа деталей — и «Рассмотреть детали», и пресет «Глаза крупно»,
          и запасной просмотр из потока сохранения (с подсказкой внизу).
          Долгое нажатие на фото сохраняет родное меню телефона. */}
      {zoomOpen && result && (
        <ZoomViewer
          src={result}
          alt="Образ GlamAI Studio крупным планом"
          focus={zoomFocus}
          footer={zoomFooter}
          onClose={() => setZoomOpen(false)}
        />
      )}
    </div>
  );
}
