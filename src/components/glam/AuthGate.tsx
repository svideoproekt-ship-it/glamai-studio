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
import { payInfoComplete, payQrPayload, type PayInfo } from "@/lib/pay";

export interface GlamProfile {
  telegramId: number;
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
  /** «android»/«ios» — телефон, «tdesktop»/«macos»/«web» — компьютер */
  platform?: string;
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
      <PaywallDialog
        payload={paywall}
        onClose={() => setPaywall(null)}
        ownerTg={me?.ownerTg ?? ""}
        pay={me?.pay}
        profile={me?.profile ?? null}
      />
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

const PLANS: Array<{
  key: "start" | "salon";
  title: string;
  accent: string;
  priceCls: string;
  perks: string[];
}> = [
  {
    key: "start",
    title: "Старт",
    accent: "border-[#8CE99A]/40",
    priceCls: "text-[#8CE99A]",
    perks: ["до 60 образов в месяц", "палитра + референсы", "для одного мастера"],
  },
  {
    key: "salon",
    title: "Салон",
    accent: "border-[#F6B93B]/50",
    priceCls: "text-[#F6B93B]",
    perks: ["до 200 образов в месяц", "для студии и нескольких мастеров", "приоритетная помощь"],
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
}: {
  payload: PaywallPayload | null;
  onClose: () => void;
  ownerTg: string;
  pay?: PayInfo;
  profile: GlamProfile | null;
}) {
  const [copied, setCopied] = useState<"phone" | "card" | null>(null);
  const [qrData, setQrData] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(false);
  const [isMobile, setIsMobile] = useState(true);
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

  // Ссылка в чат владельца с готовым текстом заявки — у каждого тарифа своя
  const tgLink = (planKey: "start" | "salon") => {
    if (!ownerTg) return "";
    const price = PLAN_PRICES[planKey];
    const me = [
      profile?.username ? `@${profile.username}` : null,
      profile?.telegramId ? `ID ${profile.telegramId}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    const text =
      `Здравствуйте! Хочу подписку «${planKey === "start" ? "Старт" : "Салон"}" ` +
      `GlamAI Studio — ${fmtRub(price)} ₽/мес${me ? `. Я: ${me}` : ""}. ` +
      `Сейчас переведу оплату по реквизитам и пришлю сюда скриншот чека.`;
    return `https://t.me/${ownerTg.replace(/^@/, "")}?text=${encodeURIComponent(text)}`;
  };

  return (
    <Dialog open={payload !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="green-card max-h-[92vh] max-w-lg overflow-y-auto rounded-3xl border-[#F8F1E1]/25 p-6 sm:p-7">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl font-bold text-[#F8F1E1]">
            {payload?.title ?? "Пробные образы закончились"}
          </DialogTitle>
          <DialogDescription className="text-sm text-[#F8F1E1]/80">
            {payload?.message ??
              "Выберите тариф, переведите оплату по реквизитам и отправьте чек в чат — включу подписку."}
          </DialogDescription>
        </DialogHeader>

        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          {PLANS.map((p) => (
            <div key={p.key} className={`rounded-2xl border bg-[#043E21]/70 p-4 ${p.accent}`}>
              <p className="font-serif text-lg font-bold text-[#F8F1E1]">{p.title}</p>
              <p className="mt-1 font-serif text-2xl font-bold text-[#F8F1E1]">
                <span className={p.priceCls}>{fmtRub(PLAN_PRICES[p.key])} ₽</span>
                <span className="text-sm font-normal text-[#F8F1E1]/70"> / мес</span>
              </p>
              <ul className="mt-2 space-y-1 text-sm text-[#F8F1E1]/85">
                {p.perks.map((perk) => (
                  <li key={perk}>· {perk}</li>
                ))}
              </ul>
              {tgLink(p.key) ? (
                <a
                  href={tgLink(p.key)}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 block"
                  onClick={() => {
                    // Заявка на подписку летит в /admin владельца: ID подставится сам.
                    // Fire-and-forget c keepalive — не мешаем открытию чата.
                    void fetch("/api/pay-request", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ plan: p.key }),
                      keepalive: true,
                    }).catch(() => {});
                  }}
                >
                  <Button className="glam-btn h-10 w-full text-sm font-bold" data-testid={`pay-${p.key}`}>
                    <Sparkles className="h-4 w-4" aria-hidden />
                    Выбрать {p.title} — {fmtRub(PLAN_PRICES[p.key])} ₽
                  </Button>
                </a>
              ) : null}
            </div>
          ))}
        </div>

        {/* Реквизиты: клиент видит КУДА и СКОЛЬКО переводить */}
        <div className="mt-3 rounded-2xl border border-[#F8F1E1]/20 bg-[#06301B]/80 p-4" data-testid="pay-requisites">
          <p className="text-sm font-bold text-[#F8F1E1]">Как оплатить</p>
          {pay?.link && (
            <a href={pay.link} target="_blank" rel="noreferrer" className="mt-3 block" data-testid="pay-sbp-link">
              <Button className="glam-btn h-11 w-full text-sm font-bold">
                Оплатить переводом по ссылке (СБП)
              </Button>
            </a>
          )}
          {requisitesReady && pay ? (
            <>
              <ol className="mt-2 space-y-1 text-sm text-[#F8F1E1]/85">
                {pay.link ? (
                  <>
                    <li>1. Нажмите кнопку выше — банк сам подставит сумму, подтвердите перевод.</li>
                    <li>2. Нажмите «Выбрать тариф» — откроется чат, отправьте скриншот чека.</li>
                    <li>3. Подписка включается вручную, обычно за 5–15 минут.</li>
                  </>
                ) : pay.phone ? (
                  <>
                    <li>1. В приложении СВОЕГО банка выберите «Перевести по номеру телефона (СБП)».</li>
                    <li>2. Введите номер телефона ниже, сумма — как у выбранного тарифа. Банк покажет имя получателя для проверки.</li>
                    <li>3. Нажмите «Выбрать тариф» — откроется чат, отправьте скриншот чека.</li>
                    <li>4. Подписка включается вручную, обычно за 5–15 минут.</li>
                  </>
                ) : (
                  <>
                    <li>1. Переведите сумму за месяц по реквизитам ниже.</li>
                    <li>2. Нажмите «Выбрать тариф» — откроется чат, отправьте скриншот чека.</li>
                    <li>3. Подписка включается вручную, обычно за 5–15 минут.</li>
                  </>
                )}
              </ol>
              <div className="mt-3 space-y-1.5 text-sm text-[#F8F1E1]">
                {pay.bank && (
                  <p>
                    <span className="text-[#F8F1E1]/60">Банк:</span> {pay.bank}
                  </p>
                )}
                {pay.holder && (
                  <p>
                    <span className="text-[#F8F1E1]/60">Получатель:</span> {pay.holder}
                  </p>
                )}
                {pay.phone && (
                  <div className="flex items-center gap-2">
                    <p>
                      <span className="text-[#F8F1E1]/60">Телефон (СБП):</span>{" "}
                      <b className="font-mono tracking-wider">{pay.phone}</b>
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void copyText(pay.phone, "phone")}
                      className="h-7 shrink-0 border-[#F8F1E1]/30 px-2 text-xs text-[#F8F1E1] hover:bg-white/10"
                      aria-label="Скопировать телефон"
                    >
                      {copied === "phone" ? "Скопировано ✓" : "Копировать"}
                    </Button>
                  </div>
                )}
                {pay.card && (
                  <div className="flex items-center gap-2">
                    <p>
                      <span className="text-[#F8F1E1]/60">Карта:</span>{" "}
                      <b className="font-mono tracking-wider">{pay.card}</b>
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void copyText(pay.card, "card")}
                      className="h-7 shrink-0 border-[#F8F1E1]/30 px-2 text-xs text-[#F8F1E1] hover:bg-white/10"
                      aria-label="Скопировать номер карты"
                    >
                      {copied === "card" ? "Скопировано ✓" : "Копировать"}
                    </Button>
                  </div>
                )}
              </div>
            </>
          ) : (
            <ol className="mt-2 space-y-1 text-sm text-[#F8F1E1]/85">
              {pay?.link ? (
                <li>1. Нажмите кнопку выше — банк сам подставит сумму, подтвердите перевод.</li>
              ) : (
                <li>1. Нажмите «Выбрать тариф» — откроется чат с владельцем студии.</li>
              )}
              <li>
                2. {pay?.link ? "Пришлите скриншот чека в чат с владельцем." : "Вам пришлют реквизиты для перевода."}
              </li>
              <li>3. После оплаты подписку включат за 5–15 минут.</li>
            </ol>
          )}
          {/* QR-код оплаты: со ссылки банка или с телефона СБП */}
          {qrPayload && (
            <div className="mt-3 rounded-xl border border-[#F8F1E1]/15 bg-[#043E21]/60 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-[#F8F1E1]">QR-код для оплаты</p>
                {isMobile && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setShowQr((v) => !v)}
                    className="h-7 shrink-0 border-[#F8F1E1]/30 px-2 text-xs text-[#F8F1E1] hover:bg-white/10"
                    data-testid="pay-qr-toggle"
                  >
                    {showQr ? "Скрыть QR-код" : "Показать QR-код"}
                  </Button>
                )}
              </div>
              {showQr && qrData && (
                <div className="mt-2 flex flex-col items-center gap-2" data-testid="pay-qr">
                  <span className="rounded-2xl bg-white p-2 shadow">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrData} alt="QR-код для оплаты" className="h-40 w-40" />
                  </span>
                  <p className="text-center text-xs text-[#F8F1E1]/70" data-testid="pay-qr-caption">
                    {pay?.link
                      ? "С другого телефона или с компьютера: наведите камеру — банк откроется сразу с переводом."
                      : "С другого телефона или с компьютера: наведите камеру — появится номер для перевода по СБП, вставьте его в своём банке."}
                  </p>
                </div>
              )}
            </div>
          )}
          {!requisitesReady && (
            <p className="mt-2 rounded-xl bg-amber-50/95 p-2.5 text-xs text-amber-900">
              Реквизиты не заданы на сервере. Владелец: добавьте PAYMENT_PHONE (перевод
              по СБП) и/или PAYMENT_BANK, PAYMENT_CARD_NUMBER, PAYMENT_CARD_OWNER в Vercel →
              Settings → Environment Variables и сделайте Redeploy — реквизиты появятся здесь.
            </p>
          )}
        </div>

        <p className="mt-2 text-center text-xs text-muted-foreground">
          Оплата переводом с чеком. Автооплата картами (ЮKassa) — скоро.
        </p>
      </DialogContent>
    </Dialog>
  );
}
