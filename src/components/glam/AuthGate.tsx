"use client";

// AuthGate — ворота приложения: пока мастер не вошёл через Telegram, студия не
// показывается. После входа держит контекст профиля (остаток генераций) и
// модалку paywall, которую открывает /api/tryon ответом 402.
//
// Вход — одним нажатием через Telegram Mini App: страница, открытая кнопкой
// бота «Открыть студию», получает подписанные initData, сервер /api/auth/miniapp
// проверяет подпись и выдаёт сессию. Определяем Telegram не по User-Agent,
// а по факту: подключаем официальный скрипт telegram-web-app.js и смотрим
// initData — он непустой только внутри вебвью Telegram. Коды, SMS и
// oauth-подтверждения не нужны. Виджет Login (oauth) остаётся только для
// обычного браузера — внутри Telegram он намеренно не показывается, чтобы
// никто не ушёл в капризный oauth-поток с «подтверждением на телефоне».

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, Loader2, LogIn, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import QRCode from "qrcode";
import { APP_VERSION } from "@/lib/version";
import { PLAN_PRICES } from "@/lib/plan";
import { RETAIL_PACKS, type PackId } from "@/lib/tariffs";
import { payInfoComplete, payQrPayload, type PayInfo } from "@/lib/pay";
import { cn } from "@/lib/utils";
import {
  type Lang,
  LANGS,
  genCount,
  isLang,
  packTitle,
  pickClientLang,
  planTitle,
  saveLang,
  t,
} from "@/lib/i18n";

export interface GlamProfile {
  telegramId: number;
  name: string;
  username: string | null;
  plan: string;
  planLabel: string;
  /** Активна ли сейчас подписка (для плашки в шапке) */
  subscriptionActive: boolean;
  subscriptionUntil: string | null;
  mode: "trial" | "sub";
  remaining: number;
  total: number;
  /** Бонусные генерации — входят в total (v41). */
  bonus?: number;
  /** v49: бесплатных осталось (без купленных) */
  trialRemaining?: number;
  /** v49: купленный баланс (генерации пакетов) */
  paidRemaining?: number;
  /** Студия-партнёр, которая привела пользователя (v41): для кнопки «Записаться». */
  studio?: {
    slug: string;
    name: string;
    bookingUrl: string | null;
    note: string | null;
  } | null;
}

interface MeResponse {
  authed: boolean;
  botUsername?: string;
  ownerTg?: string;
  pay?: PayInfo;
  dbError?: boolean;
  dbHint?: string;
  profile?: GlamProfile;
}

interface PaywallPayload {
  title?: string;
  message?: string;
}

/** Где открыта студия:
 *  unknown   — ещё не решили (скрипт Telegram грузится, доли секунды);
 *  webapp    — мини-приложение Telegram: есть подписанные initData, входит само;
 *  tgbrowser — внутренний браузер Telegram без initData (открыли ссылку,
 *              а не кнопку бота) — показываем подсказку про кнопку;
 *  regular   — обычный браузер — показываем виджет Telegram Login. */
type TgEnv = "unknown" | "webapp" | "tgbrowser" | "regular";

/** Минимальный тип официального скрипта telegram-web-app.js */
interface TgWebApp {
  initData?: string;
  ready?: () => void;
  expand?: () => void;
  /** Открыть t.me-ссылку силами самого Telegram (без перехвата Unigram и пр.) */
  openTelegramLink?: (url: string) => void;
  /** Разобранные (НЕ подписанные) данные приложения: здесь живёт start_param —
   *  метка источника студии t.me/<bot>?start=studio_<slug> (v41), и язык
   *  приложения Telegram клиента (v49 — стартовый выбор языка интерфейса). */
  initDataUnsafe?: {
    start_param?: string;
    user?: { language_code?: string } | null;
  } | null;
  /** «android»/«ios» — телефон, «tdesktop»/«macos»/«web» — компьютер */
  platform?: string;
  /** Покрасить шапку и фон Telegram в цвет студии: без этого сверху и снизу
   *  остаются чёрные полосы системных панелей («траурная рамка») */
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
  /** v49: открыть счёт Telegram Stars — встроенное окно оплаты внутри
   *  Telegram. callback(status) срабатывает при закрытии окна: "paid"/
   *  "cancelled"/"failed" — после любого исхода обновляем остаток. */
  openInvoice?: (url: string, callback?: (status: string) => void) => void;
}

function getTelegramWebApp(): TgWebApp | null {
  if (typeof window === "undefined") return null;
  return (window as unknown as { Telegram?: { WebApp?: TgWebApp } }).Telegram?.WebApp ?? null;
}

function isTelegramClient(): boolean {
  if (typeof window === "undefined") return false;
  // Внутренний браузер Telegram (iOS/Android/Desktop) обычно помечает UA,
  // но надеемся не на него, а на initData — это только запасной признак.
  return /Telegram/i.test(window.navigator.userAgent);
}

/** Открыть чат t.me так, чтобы ссылку не перехватили сторонние клиенты
 *  (Unigram и пр.): внутри Telegram — штатный openTelegramLink, чат
 *  откроется в самом приложении; на телефоне в обычном браузере — t.me
 *  (его подхватит приложение Telegram); на ПК в обычном браузере —
 *  Telegram Web. Используется и paywall-ом, и блоком «Связаться». */
export function openTelegramChat(tmeUrl: string): void {
  if (typeof window === "undefined") return;
  const app = getTelegramWebApp();
  if (app?.openTelegramLink) {
    try {
      app.openTelegramLink(tmeUrl);
      return;
    } catch {
      /* упадём в обычную навигацию ниже */
    }
  }
  const platform = app?.platform ?? "";
  const mobile =
    /android|ios/i.test(platform) ||
    window.matchMedia("(max-width: 767px)").matches;
  if (mobile) {
    window.open(tmeUrl, "_blank", "noopener");
    return;
  }
  const owner = /t\.me\/([^/?#]+)/.exec(tmeUrl)?.[1];
  window.open(
    owner ? `https://web.telegram.org/k/#@${owner}` : tmeUrl,
    "_blank",
    "noopener"
  );
}

/** Красим панели Telegram под цвет студии и раскрываем на весь экран.
 *  Убирает чёрные прямоугольники сверху/снизу в мобильной версии. */
function decorateTelegram(app: TgWebApp | null): void {
  if (!app) return;
  try {
    app.ready?.();
    app.expand?.();
  } catch {
    /* не критично */
  }
  try {
    app.setHeaderColor?.("#043E21");
    app.setBackgroundColor?.("#043E21");
    app.setBottomBarColor?.("#043E21");
  } catch {
    /* старые клиенты Telegram без этих методов — просто останутся чёрные панели */
  }
}

interface AuthContextValue {
  profile: GlamProfile | null;
  /** Обновить профиль (остаток генераций) после успешной генерации */
  refresh: () => Promise<void>;
  /** Открыть модалку оплаты (вызывается при 402 от /api/tryon) */
  openPaywall: (payload?: PaywallPayload) => void;
  /** @username владельца (без @) — блок «Связаться» в подвале студии */
  ownerTg: string;
  /** Ссылка на профиль владельца в MAX — туда же, если задана на Vercel */
  maxLink: string;
}

const AuthContext = createContext<AuthContextValue>({
  profile: null,
  refresh: async () => {},
  openPaywall: () => {},
  ownerTg: "",
  maxLink: "",
});

/** Хук для UI внутри студии: профиль, обновление остатка, paywall. */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

// ---------- Язык интерфейса (v49: ru/en/de/fr) ----------

interface LangContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
}

const LangContext = createContext<LangContextValue>({ lang: "ru", setLang: () => {} });

/** Хук перевода: const { lang } = useLang(); const txt = tr("login.h1"). */
export function useLang(): LangContextValue {
  return useContext(LangContext);
}

/** Переключатель RU/EN/DE/FR — пилюли в шапке, на входе и в пейволле. */
export function LangPicker({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useLang();
  return (
    <div
      className="flex items-center gap-1 rounded-full border border-[#F8F1E1]/25 bg-[#032B16]/70 p-0.5"
      role="group"
      aria-label={t(lang, "lang.label")}
    >
      {LANGS.map((l) => (
        <button
          key={l.id}
          type="button"
          onClick={() => setLang(l.id)}
          aria-pressed={lang === l.id}
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide transition-all",
            lang === l.id
              ? "bg-gradient-to-r from-[#D4A437] to-[#F6B93B] text-[#043E21]"
              : "text-[#F8F1E1]/65 hover:text-[#F8F1E1]"
          )}
          data-testid={`lang-${l.id}`}
        >
          {l.label}
          {compact ? "" : `· ${l.id === "ru" ? "Рус" : l.id === "en" ? "Eng" : l.id === "de" ? "Deu" : "Fra"}`}
        </button>
      ))}
    </div>
  );
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "out" | "in">("loading");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [paywall, setPaywall] = useState<PaywallPayload | null>(null);
  const [tgEnv, setTgEnv] = useState<TgEnv>("unknown");
  const [miniError, setMiniError] = useState<string | null>(null);
  // v49: язык интерфейса. До монтирования — русский (самая массовая аудитория);
  // после — определяем по localStorage → Telegram → браузеру.
  const [lang, setLangState] = useState<Lang>("ru");

  useEffect(() => {
    const tgLang = getTelegramWebApp()?.initDataUnsafe?.user?.language_code ?? null;
    const browser = typeof navigator !== "undefined" ? navigator.language : null;
    setLangState(pickClientLang({ telegram: tgLang, browser }));
  }, []);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    saveLang(next);
    // Язык приложения Telegram сообщаем серверу — на нём придут webhook/cron
    // (до первого входа поле пустое, это не страшно).
    const app = getTelegramWebApp();
    if (app?.initDataUnsafe?.user && isLang(next)) {
      void fetch("/api/auth/lang", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lang: next }),
      }).catch(() => {});
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = (await res.json()) as MeResponse;
      setMe(data);
      setStatus(data.authed && data.profile ? "in" : "out");
    } catch {
      setStatus("out");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/auth/me", { cache: "no-store" });
      const data = (await res.json()) as MeResponse;
      if (data.authed && data.profile) {
        setMe(data);
        setStatus("in");
      } else {
        setStatus("out");
      }
    } catch {
      /* остаётся прежний профиль — не критично */
    }
  }, []);

  const openPaywall = useCallback((payload?: PaywallPayload) => {
    setPaywall(payload ?? {});
  }, []);

  // ---------- Вход одним нажатием (Telegram Mini App) ----------
  const miniAppLogin = useCallback(
    async (tg: TgWebApp) => {
      const initData = tg.initData ?? "";
      if (!initData) return;
      decorateTelegram(tg);
      // Метка источника: ссылка студии t.me/<bot>?start=studio_<slug> оставляет
      // start_param в initDataUnsafe — передаём на сервер для атрибуции (v41).
      const startParam = (tg.initDataUnsafe?.start_param ?? "").slice(0, 64);
      try {
        const res = await fetch("/api/auth/miniapp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData, startParam }),
        });
        if (res.ok) {
          await refresh();
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        void data;
        setMiniError("retry");
      } catch {
        setMiniError("network");
      }
    },
    [refresh]
  );

  // Скрипт telegram-web-app.js безопасен и в обычном браузере: подключаем всегда
  // и решаем по факту — есть initData (мини-приложение Telegram) или нет.
  useEffect(() => {
    const withoutWebApp = () => setTgEnv(isTelegramClient() ? "tgbrowser" : "regular");
    const apply = () => {
      const app = getTelegramWebApp();
      if (app?.initData) {
        setTgEnv("webapp");
        void miniAppLogin(app);
      } else {
        // Красим панели даже без initData (внутренний браузер Telegram без входа)
        decorateTelegram(app);
        withoutWebApp();
      }
    };
    const src = "https://telegram.org/js/telegram-web-app.js";
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing) {
      if (getTelegramWebApp()) {
        apply();
      } else {
        existing.addEventListener("load", apply, { once: true });
      }
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = apply;
    s.onerror = withoutWebApp;
    document.head.appendChild(s);
  }, [miniAppLogin]);

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      profile: me?.profile ?? null,
      refresh,
      openPaywall,
      ownerTg: me?.ownerTg ?? "",
      maxLink: me?.pay?.maxLink ?? "",
    }),
    [me, refresh, openPaywall]
  );

  if (status === "loading") {
    return (
      <LangContext.Provider value={{ lang, setLang }}>
        <div className="flex min-h-screen flex-col items-center justify-center gap-3">
          <Loader2 className="h-7 w-7 animate-spin text-[#F6B93B]" aria-hidden />
          <p className="text-sm text-muted-foreground">{t(lang, "login.loading")}</p>
        </div>
      </LangContext.Provider>
    );
  }

  if (status === "out") {
    return (
      <LangContext.Provider value={{ lang, setLang }}>
        <LoginScreen me={me} tgEnv={tgEnv} miniError={miniError} />
      </LangContext.Provider>
    );
  }

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      <AuthContext.Provider value={contextValue}>
        {children}
        <PaywallDialog
          payload={paywall}
          onClose={() => setPaywall(null)}
          ownerTg={me?.ownerTg ?? ""}
          pay={me?.pay}
          profile={me?.profile ?? null}
          refresh={refresh}
        />
      </AuthContext.Provider>
    </LangContext.Provider>
  );
}

// ---------- Экран входа ----------

function LoginScreen({
  me,
  tgEnv,
  miniError,
}: {
  me: MeResponse | null;
  tgEnv: TgEnv;
  /** Ключ проблемы авто-входа: "retry" | "network" — текст локализуется в рендере. */
  miniError: string | null;
}) {
  const { lang } = useLang();
  const widgetRef = useRef<HTMLDivElement>(null);
  const authError = typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("auth_error")
    : null;
  const botUsername = me?.botUsername ?? "";

  // Если авто-вход через Mini App затянулся (сеть и т.п.) — через 8 секунд
  // показываем подсказку вместо бесконечной карусели
  const [slowHint, setSlowHint] = useState(false);
  useEffect(() => {
    if (tgEnv !== "webapp") return;
    const t = setTimeout(() => setSlowHint(true), 8000);
    return () => clearTimeout(t);
  }, [tgEnv]);

  // Официальный виджет Telegram Login — ТОЛЬКО для обычного браузера.
  // Бот и домен сайта должны быть связаны в @BotFather (/setdomain).
  useEffect(() => {
    if (tgEnv !== "regular") return;
    const host = widgetRef.current;
    if (!host || !botUsername) return;
    host.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.async = true;
    script.setAttribute("data-telegram-login", botUsername);
    script.setAttribute("data-size", "large");
    script.setAttribute("data-radius", "12");
    script.setAttribute("data-userpic", "false");
    script.setAttribute("data-request-access", "write");
    script.setAttribute("data-auth-url", `${window.location.origin}/api/auth/telegram`);
    host.appendChild(script);
  }, [botUsername, tgEnv]);

  let action: React.ReactNode;
  if (!botUsername) {
    action = (
      <div className="flex items-start gap-2 rounded-xl border border-[#F6B93B]/40 bg-[#2E2210]/95 p-3 text-sm text-[#F3E2B9]">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{t(lang, "login.noConfig")}</span>
      </div>
    );
  } else if (tgEnv === "webapp") {
    // Внутри Telegram: вход идёт сам, кнопки не показываем — только прогресс
    action = (
      <div className="flex flex-col items-center gap-2 py-2">
        {miniError ? (
          <div className="flex w-full items-start gap-2 rounded-xl bg-[#2E2210]/95 p-3 text-sm text-[#F3E2B9]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{t(lang, miniError === "network" ? "login.networkHint" : "login.retryHint")}</span>
          </div>
        ) : (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-[#F6B93B]" aria-hidden />
            <p className="text-sm text-muted-foreground">{t(lang, "login.signingIn")}</p>
            {slowHint && (
              <p className="mt-1 rounded-xl bg-[#2E2210]/95 p-3 text-xs text-[#E3D0A6]">
                {t(lang, "login.slowHint")}
              </p>
            )}
          </>
        )}
      </div>
    );
  } else if (tgEnv === "tgbrowser") {
    // Внутренний браузер Telegram без initData: открыли ссылку, а не кнопку бота.
    // Виджет oauth здесь намеренно не показываем — он и просит подтверждений.
    action = (
      <div className="flex items-start gap-2 rounded-xl bg-[#2E2210]/95 p-3 text-sm text-[#F3E2B9]">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>{t(lang, "login.tgBrowser")}</span>
      </div>
    );
  } else if (tgEnv === "regular") {
    action = (
      <div className="flex flex-col items-center gap-3" ref={widgetRef}>
        {/* Здесь появится кнопка Telegram Login (iframe виджета) */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          {t(lang, "login.loadingBtn")}
        </div>
      </div>
    );
  } else {
    action = (
      <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        {t(lang, "login.detecting")}
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="green-card pop-in w-full max-w-md rounded-3xl p-6 sm:p-8">
        <div className="mb-5 flex items-start justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="rounded-2xl bg-gradient-to-br from-[#B98A2E] via-[#D4A437] to-[#F6B93B] p-2 shadow-lg shadow-[#D4A437]/30">
                <Sparkles className="h-6 w-6 text-white" aria-hidden />
              </div>
              <Sparkles
                aria-hidden
                className="twinkle absolute -right-2 -top-2 h-3.5 w-3.5 text-[#F6B93B]"
                style={{ animationDuration: "2.2s" }}
              />
            </div>
            <div>
              <p className="font-serif text-2xl font-semibold leading-none">
                <span className="brand-text">GlamAI Studio</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{t(lang, "app.tagline")}</p>
            </div>
          </div>
          <LangPicker />
        </div>

        <h1 className="font-serif text-2xl font-bold leading-snug text-[#F8F1E1]">
          {t(lang, "login.h1")}
        </h1>
        <ul className="mt-4 space-y-2 text-sm text-[#F8F1E1]/85">
          {["login.b1", "login.b2", "login.b3", "login.b4"].map((key) => (
            <li key={key} className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#F6B93B]" aria-hidden />
              {t(lang, key)}
            </li>
          ))}
        </ul>

        {authError && (
          <div className="mt-5 flex items-start gap-2 rounded-xl border border-[#F6B93B]/40 bg-[#2E2210]/95 p-3 text-sm text-[#F3E2B9]">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>
              {t(lang, authError === "config" ? "authErr.config" : authError === "telegram" ? "authErr.telegram" : authError === "db" ? "authErr.db" : "authErr.default")}
            </span>
          </div>
        )}

        <div className="mt-6">
          {action}
          {botUsername && (
            <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
              <LogIn className="h-3.5 w-3.5" aria-hidden />
              {t(lang, "login.confirmNote")}
            </p>
          )}
          {me?.dbHint && (
            <p className="mt-3 rounded-xl bg-[#2E2210]/95 p-3 text-xs text-[#E3D0A6]">{me.dbHint}</p>
          )}
        </div>

        {/* Версия сборки: по ней видно, что реально задеплоено на Vercel */}
        <p className="mt-5 text-center text-[10px] uppercase tracking-widest text-[#F8F1E1]/40">
          GlamAI Studio · v{APP_VERSION}
        </p>
      </div>
    </div>
  );
}

// ---------- Paywall ----------

const PLANS: Array<{
  key: "start" | "salon";
  /** Ключ названия в словаре (pw.planStart.title / pw.planSalon.title) */
  titleKey: string;
  accent: string;
  priceCls: string;
  perkKeys: string[];
  /** «/мес» у цены — только у месячного «Салона» */
  perMonth?: boolean;
}> = [
  {
    key: "start",
    titleKey: "pw.planStart.title",
    accent: "border-[#F8F1E1]/25",
    priceCls: "text-[#F8F1E1]",
    perkKeys: ["pw.perk.start1", "pw.perk.start2", "pw.perk.start3"],
  },
  {
    key: "salon",
    titleKey: "pw.planSalon.title",
    accent: "border-[#F6B93B]/50",
    priceCls: "text-[#F6B93B]",
    perkKeys: ["pw.perk.salon1", "pw.perk.salon2", "pw.perk.salon3"],
    perMonth: true,
  },
];

function fmtRub(n: number): string {
  return n.toLocaleString("ru-RU");
}

function PaywallDialog({
  payload,
  onClose,
  ownerTg,
  pay,
  profile,
  refresh,
}: {
  payload: PaywallPayload | null;
  onClose: () => void;
  ownerTg: string;
  pay?: PayInfo;
  profile: GlamProfile | null;
  refresh: () => Promise<void>;
}) {
  const { lang } = useLang();
  const [copied, setCopied] = useState<"phone" | "card" | null>(null);
  const [qrData, setQrData] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [isMobile, setIsMobile] = useState(true);
  const [pcNote, setPcNote] = useState<string | null>(null);
  // v49: покупка пакета Звёздами — какой счёт открываем, что показать в ответ
  const [paying, setPaying] = useState<PackId | null>(null);
  const [packNote, setPackNote] = useState<string | null>(null);
  const requisitesReady = pay ? payInfoComplete(pay) : false;
  const qrPayload = pay ? payQrPayload(pay) : "";
  const isOpen = payload !== null;

  // QR-код генерируем на клиенте из ссылки банка или телефона СБП.
  // На телефоне свёрнут по умолчанию (свой же экран камерой не отсканировать),
  // на компьютере (Telegram Desktop/Web) развёрнут сразу.
  useEffect(() => {
    if (!isOpen || !qrPayload) {
      setQrData(null);
      return;
    }
    let alive = true;
    QRCode.toDataURL(qrPayload, {
      width: 512,
      margin: 2,
      color: { dark: "#043E21", light: "#FFFFFF" },
    })
      .then((url) => {
        if (alive) setQrData(url);
      })
      .catch(() => {
        if (alive) setQrData(null);
      });
    return () => {
      alive = false;
    };
  }, [isOpen, qrPayload]);

  useEffect(() => {
    if (!isOpen) return;
    let mobile = true;
    try {
      const platform = getTelegramWebApp()?.platform ?? "";
      if (platform) mobile = /android|ios/i.test(platform);
      else mobile = window.matchMedia("(max-width: 767px)").matches;
    } catch {
      mobile = true;
    }
    setIsMobile(mobile);
    setShowQr(!mobile);
  }, [isOpen]);

  const copyText = async (value: string, which: "phone" | "card") => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value.replace(/\s/g, ""));
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* буфер обмена недоступен — номер и так виден текстом */
    }
  };

  // Готовый текст заявки — у каждого тарифа свой
  const planMessage = (planKey: "start" | "salon"): string => {
    const price = PLAN_PRICES[planKey];
    const term = planKey === "start" ? "разово (46 генераций)" : "в месяц (170 генераций)";
    const me = [
      profile?.username ? `@${profile.username}` : null,
      profile?.telegramId ? `ID ${profile.telegramId}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    return (
      `Здравствуйте! Хочу тариф «${planKey === "start" ? "Старт" : "Салон"}» ` +
      `GlamAI Studio — ${fmtRub(price)} ₽ ${term}${me ? `. Я: ${me}` : ""}. ` +
      `Сейчас переведу оплату по реквизитам и пришлю сюда скриншот чека.`
    );
  };


  // v49: купить пакет Звёздами Telegram. Сервер создаёт счёт (createInvoiceLink,
  // валюта XTR), мы открываем его через WebApp.openInvoice — окно оплаты внутри
  // Telegram. Зачисление происходит на сервере (webhook successful_payment);
  // после закрытия окна просто обновляем профиль — остаток подтянется.
  const buyStars = async (packId: PackId): Promise<void> => {
    setPaying(packId);
    setPackNote(null);
    try {
      const res = await fetch("/api/pay/stars", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack: packId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        url?: string;
        message?: string;
        code?: string;
      };
      if (!data.ok || !data.url) {
        // Текст ошибки локализуем на клиенте по коду (сервер не знает язык UI).
        const codeKey: Record<string, string> = {
          session: "pw.sessionNote",
          pack: "pw.packErr",
          not_configured: "pw.notConfigured",
          invoice: "pw.invoiceErr",
        };
        setPackNote(
          (data.code && codeKey[data.code] && t(lang, codeKey[data.code])) ||
            data.message ||
            t(lang, "pw.failNote")
        );
        return;
      }
      const app = getTelegramWebApp();
      if (app?.openInvoice) {
        app.openInvoice(data.url, () => {
          // Окно закрылось (оплачено, отменено или ошибка) — остаток обновится,
          // если платёж прошёл. Держим паузу: webhook успевает зачислить.
          setTimeout(() => void refresh(), 1200);
        });
      } else {
        // Старые клиенты Telegram без openInvoice: открываем счёт как ссылку
        window.open(data.url, "_blank", "noopener");
        setPackNote(t(lang, "pw.tabNote"));
        setTimeout(() => void refresh(), 8000);
      }
    } catch {
      setPackNote(t(lang, "pw.netNote"));
    } finally {
      setPaying(null);
    }
  };

  // Открыть чат владельца с готовым текстом заявки — БЕЗ перехвата ссылок.
  // Внутри Telegram используем штатный WebApp.openTelegramLink: Telegram сам
  // откроет чат (на ПК тоже — больше не открывается Unigram и прочие клиенты,
  // перехватившие протокол t.me). В обычном браузере: телефон — t.me
  // (на телефоне обработчик — сам Telegram), ПК — Telegram Web с копированием
  // текста заявки в буфер.
  const handlePlanClick = (planKey: "start" | "salon"): void => {
    // Заявка на подписку летит в /admin владельца: ID подставится сам.
    // Fire-and-forget c keepalive — не мешаем открытию чата.
    void fetch("/api/pay-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan: planKey }),
      keepalive: true,
    }).catch(() => {});

    if (!ownerTg) return;
    const owner = ownerTg.replace(/^@/, "");
    const tme = `https://t.me/${owner}?text=${encodeURIComponent(planMessage(planKey))}`;

    const app = getTelegramWebApp();
    if (app?.openTelegramLink) {
      try {
        app.openTelegramLink(tme);
        return;
      } catch {
        /* упадём в обычную навигацию ниже */
      }
    }
    if (isMobile) {
      window.open(tme, "_blank", "noopener");
      return;
    }
    // ПК в обычном браузере: t.me перехватывается сторонними клиентами (Unigram)
    void navigator.clipboard?.writeText(planMessage(planKey)).catch(() => {});
    setPcNote(t(lang, "pw.pcNote"));
    window.open(`https://web.telegram.org/k/#@${owner}`, "_blank", "noopener");
  };

  return (
    <Dialog open={payload !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="green-card max-h-[92vh] max-w-lg overflow-y-auto rounded-3xl border-[#F8F1E1]/25 p-6 sm:p-7">
        <div className="flex items-start justify-between gap-2">
          <DialogHeader className="min-w-0">
            <DialogTitle className="font-serif text-xl font-bold text-[#F8F1E1]">
              {payload?.title ?? t(lang, "pw.titleDefault")}
            </DialogTitle>
            <DialogDescription className="text-sm text-[#F8F1E1]/80">
              {payload?.message ?? t(lang, "pw.msgDefault")}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-1 shrink-0">
            <LangPicker />
          </div>
        </div>

        {/* v41: студия-источник — на самом горячем моменте ведём к записи,
            а не к оплате: клиентке подписка не нужна, нужен мастер. */}
        {profile?.studio && (
          <div
            className="mt-1 rounded-2xl border border-[#F6B93B]/45 bg-[#06301B]/85 p-4"
            data-testid="studio-booking"
          >
            <p className="text-sm font-bold text-[#F8F1E1]">
              {t(lang, "pw.studioTitle", { name: profile.studio.name })}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-[#F8F1E1]/75">
              {t(lang, "pw.studioDesc")}
            </p>
            {profile.studio.bookingUrl ? (
              <a
                href={profile.studio.bookingUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-3 block"
              >
                <Button className="glam-btn h-11 w-full text-sm font-bold" data-testid="studio-book">
                  <Sparkles className="h-4 w-4" aria-hidden />
                  {t(lang, "banner.bookIn", { name: profile.studio.name })}
                </Button>
              </a>
            ) : profile.studio.note ? (
              <p className="mt-2 rounded-xl bg-white/10 p-2.5 text-xs text-[#F8F1E1]/90">
                {profile.studio.note}
              </p>
            ) : null}
          </div>
        )}

        {/* v49: розничные пакеты — мгновенная оплата Звёздами Telegram.
            Это главный путь: без чатов, чеков и ручного включения. */}
        <div
          className="mt-2 rounded-2xl border border-[#F6B93B]/45 bg-[#043E21]/70 p-4"
          data-testid="stars-packs"
        >
          <p className="font-serif text-lg font-bold text-[#F8F1E1]">
            {t(lang, "pw.packsTitle")}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[#F8F1E1]/75">
            {t(lang, "pw.packsDesc")}
          </p>
          <div className="mt-3 space-y-2">
            {RETAIL_PACKS.map((p) => (
              <div
                key={p.id}
                className={`flex items-center gap-3 rounded-xl border p-3 ${
                  p.best
                    ? "border-[#F6B93B]/50 bg-[#06301B]/85"
                    : "border-[#F8F1E1]/15 bg-[#06301B]/60"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold text-[#F8F1E1]">
                    {packTitle(lang, p.id)}
                    {p.best ? ` · ${t(lang, "pw.pack.best")}` : ""}
                  </p>
                  <p className="mt-0.5 text-xs text-[#F8F1E1]/75">
                    {genCount(lang, p.generations)} · {t(lang, `pw.pack.${p.id}.perk`)}
                  </p>
                </div>
                <Button
                  className="glam-btn h-10 shrink-0 px-3 text-xs font-bold"
                  disabled={paying !== null}
                  onClick={() => void buyStars(p.id)}
                  data-testid={`buy-${p.id}`}
                >
                  <Sparkles className="mr-1 h-3.5 w-3.5" aria-hidden />
                  {paying === p.id
                    ? t(lang, "pw.opening")
                    : lang === "ru"
                      ? `${fmtRub(p.rub)} ₽ · ${p.stars} ★`
                      : `${p.stars} ★`}
                </Button>
              </div>
            ))}
          </div>
          {packNote && (
            <p className="mt-2 rounded-xl border border-[#F8F1E1]/20 bg-[#2E2210]/90 p-2.5 text-xs text-[#F8F1E1]/90">
              {packNote}
            </p>
          )}
          <p className="mt-2 text-xs text-[#F8F1E1]/60">{t(lang, "pw.starsNote")}</p>
        </div>

        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {PLANS.map((p) => (
            <div key={p.key} className={`rounded-2xl border bg-[#043E21]/70 p-4 ${p.accent}`}>
              <p className="font-serif text-lg font-bold text-[#F8F1E1]">{t(lang, p.titleKey)}</p>
              <p className="mt-1 font-serif text-2xl font-bold text-[#F8F1E1]">
                <span className={p.priceCls}>{fmtRub(PLAN_PRICES[p.key])} ₽</span>
                {p.perMonth ? (
                  <span className="text-sm font-normal text-[#F8F1E1]/70"> {t(lang, "pw.perMonth")}</span>
                ) : (
                  <span className="text-sm font-normal text-[#F8F1E1]/70"> {t(lang, "pw.once")}</span>
                )}
              </p>
              <ul className="mt-2 space-y-1 text-sm text-[#F8F1E1]/85">
                {p.perkKeys.map((perkKey) => (
                  <li key={perkKey}>· {t(lang, perkKey)}</li>
                ))}
              </ul>
              {ownerTg ? (
                <Button
                  className="glam-btn h-10 w-full text-sm font-bold"
                  onClick={() => handlePlanClick(p.key)}
                  data-testid={`pay-${p.key}`}
                >
                  <Sparkles className="h-4 w-4" aria-hidden />
                  {t(lang, "pw.choose", { title: t(lang, p.titleKey), price: fmtRub(PLAN_PRICES[p.key]) })}
                </Button>
              ) : null}
            </div>
          ))}
        </div>
        <p className="mt-1 text-center text-xs text-[#F8F1E1]/60">
          {t(lang, "pw.manualNote")}
        </p>

        {/* Подсказка для ПК (обычный браузер): чат откроется в Telegram Web */}
        {pcNote && (
          <p className="mt-2 rounded-xl border border-[#F8F1E1]/20 bg-[#06301B]/80 p-2.5 text-center text-xs text-[#F8F1E1]/85">
            {t(lang, "pw.pcNote")}
          </p>
        )}
        {/* Реквизиты: клиент видит КУДА и СКОЛЬКО переводить */}
        <div className="mt-3 rounded-2xl border border-[#F8F1E1]/20 bg-[#06301B]/80 p-4" data-testid="pay-requisites">
          <p className="text-sm font-bold text-[#F8F1E1]">{t(lang, "req.title")}</p>
          {pay?.link && (
            <a href={pay.link} target="_blank" rel="noreferrer" className="mt-3 block" data-testid="pay-sbp-link">
              <Button className="glam-btn h-11 w-full text-sm font-bold">
                {t(lang, "req.sbpBtn")}
              </Button>
            </a>
          )}
          {requisitesReady && pay ? (
            <>
              <ol className="mt-2 space-y-1 text-sm text-[#F8F1E1]/85">
                {pay.link ? (
                  <>
                    <li>{t(lang, "req.stepLink1")}</li>
                    <li>{t(lang, "req.stepLink2")}</li>
                    <li>{t(lang, "req.stepLink3")}</li>
                  </>
                ) : pay.phone ? (
                  <>
                    <li>{t(lang, "req.stepPhone1")}</li>
                    <li>{t(lang, "req.stepPhone2")}</li>
                    <li>{t(lang, "req.stepPhone3")}</li>
                    <li>{t(lang, "req.stepPhone4")}</li>
                  </>
                ) : (
                  <>
                    <li>{t(lang, "req.stepCard1")}</li>
                    <li>{t(lang, "req.stepCard2")}</li>
                    <li>{t(lang, "req.stepCard3")}</li>
                  </>
                )}
              </ol>
              <div className="mt-3 space-y-1.5 text-sm text-[#F8F1E1]">
                {pay.bank && (
                  <p>
                    <span className="text-[#F8F1E1]/60">{t(lang, "req.bank")}:</span> {pay.bank}
                  </p>
                )}
                {pay.holder && (
                  <p>
                    <span className="text-[#F8F1E1]/60">{t(lang, "req.holder")}:</span> {pay.holder}
                  </p>
                )}
                {pay.phone && (
                  <div className="flex items-center gap-2">
                    <p>
                      <span className="text-[#F8F1E1]/60">{t(lang, "req.phone")}:</span>{" "}
                      <b className="font-mono tracking-wider">{pay.phone}</b>
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void copyText(pay.phone, "phone")}
                      className="h-7 shrink-0 border-[#F8F1E1]/30 px-2 text-xs text-[#F8F1E1] hover:bg-white/10"
                      aria-label={t(lang, "req.copyPhoneAria")}
                    >
                      {copied === "phone" ? t(lang, "req.copied") : t(lang, "req.copy")}
                    </Button>
                  </div>
                )}
                {pay.card && (
                  <div className="flex items-center gap-2">
                    <p>
                      <span className="text-[#F8F1E1]/60">{t(lang, "req.card")}:</span>{" "}
                      <b className="font-mono tracking-wider">{pay.card}</b>
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void copyText(pay.card, "card")}
                      className="h-7 shrink-0 border-[#F8F1E1]/30 px-2 text-xs text-[#F8F1E1] hover:bg-white/10"
                      aria-label={t(lang, "req.copyCardAria")}
                    >
                      {copied === "card" ? t(lang, "req.copied") : t(lang, "req.copy")}
                    </Button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <ol className="mt-2 space-y-1 text-sm text-[#F8F1E1]/85">
              {pay?.link ? (
                <li>{t(lang, "req.stepLink1")}</li>
              ) : (
                <li>{t(lang, "req.stepNone1")}</li>
              )}
              <li>
                2. {pay?.link ? t(lang, "req.stepNone2b") : t(lang, "req.stepNone2")}
              </li>
              <li>3. {t(lang, "req.stepNone3")}</li>
            </ol>
          )}
          {/* QR-код оплаты: со ссылки банка или с телефона СБП */}
          {qrPayload && (
            <div className="mt-3 rounded-xl border border-[#F8F1E1]/15 bg-[#043E21]/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[#F8F1E1]">{t(lang, "req.qrTitle")}</p>
                {isMobile && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowQr((v) => !v)}
                    className="h-7 shrink-0 border-[#F8F1E1]/30 px-2 text-xs text-[#F8F1E1] hover:bg-white/10"
                    data-testid="pay-qr-toggle"
                  >
                    {showQr ? t(lang, "req.qrHide") : t(lang, "req.qrShow")}
                  </Button>
                )}
              </div>
              {showQr && qrData && (
                <div className="mt-2 flex flex-col items-center gap-2" data-testid="pay-qr">
                  <span className="rounded-2xl bg-white p-2 shadow">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrData} alt={t(lang, "req.qrTitle")} className="h-40 w-40" />
                  </span>
                  <p className="text-center text-xs text-[#F8F1E1]/70" data-testid="pay-qr-caption">
                    {pay?.link ? t(lang, "req.qrCapLink") : t(lang, "req.qrCapPhone")}
                  </p>
                </div>
              )}
            </div>
          )}
          {!requisitesReady && (
            <p className="mt-2 rounded-xl bg-[#2E2210]/95 p-2.5 text-xs text-[#E3D0A6]">
              {t(lang, "req.notSet")}
            </p>
          )}
        </div>

        <p className="mt-2 text-center text-xs text-muted-foreground">
          {t(lang, "pw.footer")}
        </p>
      </DialogContent>
    </Dialog>
  );
}
