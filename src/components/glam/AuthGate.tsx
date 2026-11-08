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
import { APP_VERSION } from "@/lib/version";

export interface GlamProfile {
  name: string;
  username: string | null;
  plan: string;
  planLabel: string;
  subscriptionActive: boolean;
  subscriptionUntil: string | null;
  mode: "trial" | "sub";
  remaining: number;
  total: number;
}

interface MeResponse {
  authed: boolean;
  botUsername?: string;
  ownerTg?: string;
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

interface AuthContextValue {
  profile: GlamProfile | null;
  /** Обновить профиль (остаток генераций) после успешной генерации */
  refresh: () => Promise<void>;
  /** Открыть модалку оплаты (вызывается при 402 от /api/tryon) */
  openPaywall: (payload?: PaywallPayload) => void;
}

const AuthContext = createContext<AuthContextValue>({
  profile: null,
  refresh: async () => {},
  openPaywall: () => {},
});

/** Хук для UI внутри студии: профиль, обновление остатка, paywall. */
export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export default function AuthGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "out" | "in">("loading");
  const [me, setMe] = useState<MeResponse | null>(null);
  const [paywall, setPaywall] = useState<PaywallPayload | null>(null);
  const [tgEnv, setTgEnv] = useState<TgEnv>("unknown");
  const [miniError, setMiniError] = useState<string | null>(null);

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
      try {
        tg.ready?.();
        tg.expand?.();
      } catch {
        /* не критично */
      }
      try {
        const res = await fetch("/api/auth/miniapp", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ initData }),
        });
        if (res.ok) {
          await refresh();
          return;
        }
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        setMiniError(
          data.message ??
            "Telegram не подтвердил вход. Закрой студию и открой её через кнопку бота ещё раз."
        );
      } catch {
        setMiniError(
          "Не удалось связаться с сервером входа. Проверь интернет и открой студию через кнопку бота ещё раз."
        );
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
    () => ({ profile: me?.profile ?? null, refresh, openPaywall }),
    [me, refresh, openPaywall]
  );

  if (status === "loading") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-[#8CE99A]" aria-hidden />
        <p className="text-sm text-muted-foreground">Загружаем студию…</p>
      </div>
    );
  }

  if (status === "out") {
    return <LoginScreen me={me} tgEnv={tgEnv} miniError={miniError} />;
  }

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
      <PaywallDialog payload={paywall} onClose={() => setPaywall(null)} ownerTg={me?.ownerTg ?? ""} />
    </AuthContext.Provider>
  );
}

// ---------- Экран входа ----------

const AUTH_ERRORS: Record<string, string> = {
  config:
    "Вход не настроен на сервере: не заданы TELEGRAM_BOT_TOKEN или AUTH_SECRET. Инструкция — в README-DEPLOY-RU.md.",
  telegram: "Telegram не подтвердил вход (подпись не сошлась). Попробуйте ещё раз.",
  db: "База подписок недоступна. Если вы только что задали DATABASE_URL — сделайте Redeploy.",
};

function LoginScreen({
  me,
  tgEnv,
  miniError,
}: {
  me: MeResponse | null;
  tgEnv: TgEnv;
  miniError: string | null;
}) {
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
      <div className="flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50/95 p-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          Вход не настроен: задайте переменные <b>TELEGRAM_BOT_USERNAME</b>,{" "}
          <b>TELEGRAM_BOT_TOKEN</b> и <b>AUTH_SECRET</b> (инструкция — в README-DEPLOY-RU.md)
          и сделайте Redeploy.
        </span>
      </div>
    );
  } else if (tgEnv === "webapp") {
    // Внутри Telegram: вход идёт сам, кнопки не показываем — только прогресс
    action = (
      <div className="flex flex-col items-center gap-2 py-2">
        {miniError ? (
          <div className="flex w-full items-start gap-2 rounded-xl bg-amber-50/95 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{miniError}</span>
          </div>
        ) : (
          <>
            <Loader2 className="h-5 w-5 animate-spin text-[#8CE99A]" aria-hidden />
            <p className="text-sm text-muted-foreground">Входим через Telegram…</p>
            {slowHint && (
              <p className="mt-1 rounded-xl bg-amber-50/95 p-3 text-xs text-amber-900">
                Вход затянулся. Закрой студию и открой её через бота ещё раз
                (кнопка «Открыть студию»), либо открой сайт в обычном браузере.
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
      <div className="flex items-start gap-2 rounded-xl bg-amber-50/95 p-3 text-sm text-amber-900">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          Студия открылась внутри Telegram без автоматического входа. Закрой этот экран
          и в чате с ботом нажми кнопку <b>«Открыть студию»</b> (внизу слева от поля ввода) —
          тогда вход пройдёт сам, без кодов и подтверждений.
        </span>
      </div>
    );
  } else if (tgEnv === "regular") {
    action = (
      <div className="flex flex-col items-center gap-3" ref={widgetRef}>
        {/* Здесь появится кнопка Telegram Login (iframe виджета) */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          Загружаем кнопку входа Telegram…
        </div>
      </div>
    );
  } else {
    action = (
      <div className="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Определяем способ входа…
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="green-card pop-in w-full max-w-md rounded-3xl p-6 sm:p-8">
        <div className="mb-5 flex items-center gap-3">
          <div className="relative">
            <div className="rounded-2xl bg-gradient-to-br from-[#008B8B] via-[#16B8A6] to-[#F6B93B] p-2 shadow-lg shadow-teal-200/50">
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
            <p className="mt-1 text-xs text-muted-foreground">ИИ-визажист для студии макияжа</p>
          </div>
        </div>

        <h1 className="font-serif text-2xl font-bold leading-snug text-[#F8F1E1]">
          Примерка макияжа для ваших клиенток — за 30 секунд
        </h1>
        <ul className="mt-4 space-y-2 text-sm text-[#F8F1E1]/85">
          <li className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#F6B93B]" aria-hidden />
            5 бесплатных образов — без карты и обязательств
          </li>
          <li className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#F6B93B]" aria-hidden />
            Палитра профессиональных оттенков или перенос макияжа с референса
          </li>
          <li className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#F6B93B]" aria-hidden />
            Лицо клиента сохраняется, фото не хранятся на сервере
          </li>
          <li className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-[#F6B93B]" aria-hidden />
            Показывайте клиентке варианты до встречи — она приходит с готовым решением
          </li>
        </ul>

        {authError && (
          <div className="mt-5 flex items-start gap-2 rounded-xl border border-amber-300/60 bg-amber-50/95 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <span>{AUTH_ERRORS[authError] ?? "Не удалось войти. Попробуйте ещё раз."}</span>
          </div>
        )}

        <div className="mt-6">
          {action}
          {botUsername && (
            <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground">
              <LogIn className="h-3.5 w-3.5" aria-hidden />
              Вход подтверждает, что вы мастер. Клиентские фото не сохраняются.
            </p>
          )}
          {me?.dbHint && (
            <p className="mt-3 rounded-xl bg-amber-50/95 p-3 text-xs text-amber-900">{me.dbHint}</p>
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

function PaywallDialog({
  payload,
  onClose,
  ownerTg,
}: {
  payload: PaywallPayload | null;
  onClose: () => void;
  ownerTg: string;
}) {
  const tgLink = ownerTg
    ? `https://t.me/${ownerTg.replace(/^@/, "")}?text=${encodeURIComponent(
        "Здравствуйте! Хочу оформить подписку GlamAI Studio."
      )}`
    : "";

  return (
    <Dialog open={payload !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="green-card max-w-lg rounded-3xl border-[#F8F1E1]/25 p-6 sm:p-7">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl font-bold text-[#F8F1E1]">
            {payload?.title ?? "Пробные образы закончились"}
          </DialogTitle>
          <DialogDescription className="text-sm text-[#F8F1E1]/80">
            {payload?.message ??
              "Оформите подписку — и продолжите показывать клиенткам образы без ограничений триала."}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-[#8CE99A]/40 bg-[#043E21]/70 p-4">
            <p className="font-serif text-lg font-bold text-[#F8F1E1]">Старт</p>
            <p className="mt-1 font-serif text-2xl font-bold text-[#8CE99A]">690 ₽<span className="text-sm font-normal text-[#F8F1E1]/70"> / мес</span></p>
            <ul className="mt-2 space-y-1 text-sm text-[#F8F1E1]/85">
              <li>· до 60 образов в месяц</li>
              <li>· палитра + референсы</li>
              <li>· цена первых 100 мастеров</li>
            </ul>
          </div>
          <div className="rounded-2xl border border-[#F6B93B]/50 bg-[#043E21]/70 p-4">
            <p className="font-serif text-lg font-bold text-[#F8F1E1]">Салон</p>
            <p className="mt-1 font-serif text-2xl font-bold text-[#F6B93B]">2 490 ₽<span className="text-sm font-normal text-[#F8F1E1]/70"> / мес</span></p>
            <ul className="mt-2 space-y-1 text-sm text-[#F8F1E1]/85">
              <li>· до 200 образов в месяц</li>
              <li>· для студии и нескольких мастеров</li>
              <li>· цена первых 100 мастеров</li>
            </ul>
          </div>
        </div>

        {tgLink ? (
          <a href={tgLink} target="_blank" rel="noreferrer" className="mt-4 block">
            <Button className="glam-btn h-12 w-full text-base font-bold">
              <Sparkles className="h-5 w-5" aria-hidden />
              Оплатить в Telegram — активируем за 5 минут
            </Button>
          </a>
        ) : (
          <p className="mt-4 rounded-xl bg-amber-50/95 p-3 text-sm text-amber-900">
            Канал оплаты не настроен: задайте OWNER_TG_USERNAME (ваш Telegram) на сервере.
          </p>
        )}
        <p className="mt-2 text-center text-xs text-muted-foreground">
          Оплата переводом с чеком. Автооплата картами (ЮKassa) — скоро.
        </p>
      </DialogContent>
    </Dialog>
  );
}
