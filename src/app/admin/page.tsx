"use client";

// Админ-панель ручных продаж: /admin
// Вход по ADMIN_SECRET. Здесь владелец видит мастеров и выдаёт/продлевает
// подписки после ручной оплаты (перевод → «Выдать подписку»).

import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { KeyRound, Loader2, RefreshCw, Sparkles, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PLAN_PRICES, planLabel } from "@/lib/plan";
import { saveImageFile } from "@/lib/download";
import { payQrPayload, type PayInfo } from "@/lib/pay";
import { formatImportReport, parseStudioList, type StudioImportReport } from "@/lib/studio-import";

interface AdminUser {
  telegramId: number;
  username: string | null;
  firstName: string | null;
  plan: string;
  trialUsed: number;
  monthlyUsed: number;
  monthlyResetYm: string | null;
  subscriptionUntil: string | null;
  studioSlug: string | null;
  studioName: string | null;
  bonusGenerations: number;
  lastSeenAt: string;
  generationsTotal: number;
}

interface StudioRow {
  slug: string;
  name: string;
  bookingUrl: string | null;
  note: string | null;
  active: boolean;
  invited: number;
}

interface Stats {
  total: number;
  paying: number;
  generations: number;
}

interface StartParamRow {
  param: string;
  opens: number;
  unique: number;
  attributed: number;
}

interface StartEventRow {
  telegramId: number;
  username: string | null;
  firstName: string | null;
  startParam: string;
  attributed: boolean;
  createdAt: string;
}

interface StartStats {
  totalOpens: number;
  uniqueUsers: number;
  opens7d: number;
  byParam: StartParamRow[];
  recent: StartEventRow[];
}

interface PayRequest {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  plan: string;
  createdAt: string;
}

// v49: Stars-платежи и сводка по ним
interface PaymentRow {
  id: number;
  telegramId: number;
  username: string | null;
  firstName: string | null;
  pack: string;
  generations: number;
  stars: number;
  rub: number;
  createdAt: string;
}

interface PaymentsStats {
  total: number;
  stars: number;
  rub: number;
  generations: number;
  buyers: number;
  byPack: Array<{ pack: string; count: number; stars: number }>;
}

interface WebhookInfo {
  url?: string;
  pending_update_count?: number;
  last_error_message?: string;
  last_error_date?: number;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "2-digit" });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ru-RU", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function planBadge(plan: string, untilIso: string | null): { text: string; cls: string } {
  const active = untilIso && new Date(untilIso).getTime() > Date.now();
  if (plan === "start") {
    return active
      ? { text: "Старт", cls: "bg-[#B98A2E]/30 text-[#F3E2B9]" }
      : { text: "Старт (истекла)", cls: "bg-white/15 text-[#F8F1E1]/70" };
  }
  if (plan === "salon") {
    return active
      ? { text: "Салон", cls: "bg-[#B8860B]/85 text-white" }
      : { text: "Салон (истекла)", cls: "bg-white/15 text-[#F8F1E1]/70" };
  }
  return { text: "Пробный", cls: "bg-white/15 text-[#F8F1E1]" };
}

export default function AdminPage() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [starts, setStarts] = useState<StartStats | null>(null);
  const [pay, setPay] = useState<PayInfo | null>(null);
  const [requests, setRequests] = useState<PayRequest[]>([]);
  const [studios, setStudios] = useState<StudioRow[]>([]);
  const [botUsername, setBotUsername] = useState("");
  const [qrData, setQrData] = useState<string | null>(null);
  const [grantUser, setGrantUser] = useState("");
  const [grantPlan, setGrantPlan] = useState<"start" | "salon">("start");
  const [grantDays, setGrantDays] = useState("30");
  // Форма студии-партнёра (v41)
  const [studioName, setStudioName] = useState("");
  const [studioSlug, setStudioSlug] = useState("");
  const [studioUrl, setStudioUrl] = useState("");
  const [studioNote, setStudioNote] = useState("");
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);
  // Массовое добавление студий (v48)
  const [importText, setImportText] = useState("");
  const [importCount, setImportCount] = useState(0);
  const [importReport, setImportReport] = useState<string | null>(null);
  // v49: Stars-платежи и webhook
  const [payments, setPayments] = useState<PaymentRow[]>([]);
  const [payStats, setPayStats] = useState<PaymentsStats | null>(null);
  const [webhookSecretSet, setWebhookSecretSet] = useState(false);
  const [webhookInfo, setWebhookInfo] = useState<WebhookInfo | null>(null);
  const [webhookNote, setWebhookNote] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/admin", { cache: "no-store" });
      if (res.status === 401) {
        setAuthed(false);
        return;
      }
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Не удалось загрузить список");
      setUsers(data.users ?? []);
      setStats(data.stats ?? null);
      setStarts(data.starts ?? null);
      setPay(data.pay ?? null);
      setRequests(data.requests ?? []);
      setStudios(data.studios ?? []);
      setPayments(data.payments ?? []);
      setPayStats(data.payStats ?? null);
      setWebhookSecretSet(data.webhookSecretSet ?? false);
      setBotUsername(data.botUsername ?? "");
      setAuthed(true);
    } catch (e) {
      setAuthed(false);
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // v49: подключить приём платежей — setWebhook на /api/telegram/webhook.
  // Первый запуск может подсказать секрет для Vercel (кладём в буфер обмена).
  const setupWebhook = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    setWebhookNote(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "webhook_setup" }),
      });
      const data = await res.json();
      if (data.needSecret) {
        setWebhookNote(data.error ?? "Задай TELEGRAM_WEBHOOK_SECRET на Vercel.");
        try {
          await navigator.clipboard.writeText(String(data.suggest ?? ""));
        } catch {
          /* буфер недоступен — значение видно в подсказке */
        }
        return;
      }
      if (!data.ok) throw new Error(data.error ?? "Не удалось подключить webhook");
      setWebhookInfo(data.info ?? null);
      setWebhookNote(`Webhook подключён: ${data.url ?? ""}`);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка операции");
    } finally {
      setBusy(false);
    }
  };

  // v49: посмотреть текущий статус webhook (Telegram отвечает getWebhookInfo)
  const checkWebhook = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "webhook_info" }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Не удалось получить статус");
      setWebhookInfo(data.info ?? null);
      setWebhookNote(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка операции");
    } finally {
      setBusy(false);
    }
  };

  // QR-код оплаты для печати: ссылка банка или телефон СБП — то же,
  // что видит клиент в paywall
  useEffect(() => {
    const payload = pay ? payQrPayload(pay) : "";
    if (!payload) {
      setQrData(null);
      return;
    }
    let alive = true;
    QRCode.toDataURL(payload, {
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
  }, [pay]);

  const login = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "login", secret: password }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Не удалось войти");
      setPassword("");
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка входа");
    } finally {
      setBusy(false);
    }
  };

  const act = async (
    body: Record<string, unknown>,
    okMsg: string | ((data: { untilIso?: string | null; studio?: { name?: string }; bonusTotal?: number; report?: StudioImportReport }) => string)
  ) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Операция не удалась");
      setNotice(typeof okMsg === "function" ? okMsg(data) : okMsg);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка операции");
    } finally {
      setBusy(false);
    }
  };

  // Массовое добавление студий (v48): список из штурм-файлов — одна кнопка.
  const runImport = async () => {
    const parsed = parseStudioList(importText);
    if (parsed.items.length === 0) {
      setImportReport(null);
      setError(parsed.errors[0] ?? "Не нашёл ни одной студии — нужен формат «Название | слаг».");
      return;
    }
    await act(
      { action: "studio_import", items: parsed.items },
      (d) => {
        const report: StudioImportReport =
          d.report ?? { added: [], updated: [], fixed: [], skipped: [] };
        setImportReport(formatImportReport(report, parsed.errors));
        const parts = [
          `добавлено: ${report.added.length}`,
          `обновлено: ${report.updated.length}`,
        ];
        if (report.fixed.length) parts.push(`слагов починено: ${report.fixed.length}`);
        if (report.skipped.length) parts.push(`пропущено: ${report.skipped.length}`);
        return "Готово — " + parts.join(", ") + ". Список студий обновился ниже.";
      }
    );
  };

  // Выдача по заявке в один клик: ID уже известен (пришёл из paywall по
  // подписанной сессии), владельцу остаётся сверить чек и нажать кнопку
  const handleRequestGrant = async (r: PayRequest) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "grant",
          user: String(r.telegramId),
          plan: r.plan === "salon" ? "salon" : "start",
          days: Number(grantDays) || 30,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Не удалось выдать подписку");
      await fetch("/api/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "request_done", id: r.id }),
      });
      const until = data.untilIso
        ? new Date(data.untilIso).toLocaleDateString("ru-RU", {
            day: "numeric",
            month: "long",
            year: "numeric",
          })
        : "";
      setNotice(`Подписка выдана ✅${until ? ` — действует до ${until}` : ""}`);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка операции");
    } finally {
      setBusy(false);
    }
  };

  // Сумма к оплате пересчитывается на лету: цена тарифа × срок (пропорционально месяцу)
  const grantDaysNum = Number(grantDays) || 30;
  const grantMonths = grantDaysNum / 30;
  const grantTotal = Math.round(PLAN_PRICES[grantPlan] * grantMonths);
  const monthsLabel =
    grantDaysNum === 30 ? "1 мес" : grantDaysNum === 90 ? "3 мес" : `${grantDaysNum}/30 мес`;

  return (
    <div className="min-h-screen bg-[#043E21] px-4 py-8 text-[#F8F1E1]">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-6 flex items-center gap-3">
          <div className="rounded-2xl bg-gradient-to-br from-[#B98A2E] via-[#D4A437] to-[#F6B93B] p-2">
            <Sparkles className="h-5 w-5 text-white" aria-hidden />
          </div>
          <div>
            <h1 className="font-serif text-2xl font-bold">GlamAI Studio · админка</h1>
            <p className="text-sm text-[#F8F1E1]/70">Ручные продажи: выдача подписок после оплаты</p>
          </div>
          {authed && (
            <Button
              variant="outline"
              size="sm"
              className="ml-auto border-[#F8F1E1]/30 text-[#F8F1E1] hover:bg-white/10"
              onClick={() => void loadList()}
              disabled={busy}
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Обновить
            </Button>
          )}
        </header>

        {authed === null && (
          <p className="flex items-center gap-2 text-sm text-[#F8F1E1]/70">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Проверяем доступ…
          </p>
        )}

        {authed === false && (
          <div className="green-card mx-auto max-w-sm rounded-3xl p-6">
            <label className="mb-2 block text-sm font-semibold" htmlFor="admin-pass">
              Пароль администратора (ADMIN_SECRET)
            </label>
            <div className="flex gap-2">
              <Input
                id="admin-pass"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void login()}
                placeholder="Пароль из переменной ADMIN_SECRET"
                className="border-[#6F4E37]/35 bg-[#F8F1E1]/95 text-[#6F4E37]"
              />
              <Button className="glam-btn shrink-0" onClick={() => void login()} disabled={busy}>
                <KeyRound className="h-4 w-4" aria-hidden />
                Войти
              </Button>
            </div>
          </div>
        )}

        {authed === true && (
          <>
            {stats && (
              <div className="mb-5 grid grid-cols-3 gap-3 text-center">
                <div className="green-card rounded-2xl p-3">
                  <p className="font-serif text-2xl font-bold">{stats.total}</p>
                  <p className="text-xs text-[#F8F1E1]/70">мастеров зашло</p>
                </div>
                <div className="green-card rounded-2xl p-3">
                  <p className="font-serif text-2xl font-bold">{stats.paying}</p>
                  <p className="text-xs text-[#F8F1E1]/70">с активной подпиской</p>
                </div>
                <div className="green-card rounded-2xl p-3">
                  <p className="font-serif text-2xl font-bold">{stats.generations}</p>
                  <p className="text-xs text-[#F8F1E1]/70">генераций всего</p>
                </div>
              </div>
            )}

            {starts && (
              <section className="green-card mb-5 rounded-3xl p-5" data-testid="starts-panel">
                <h2 className="mb-1 font-serif text-lg font-bold">Открытия бота</h2>
                <p className="mb-3 text-sm text-[#F8F1E1]/75">
                  Каждое открытие приложения пишется в базу. Открытий нет — ссылки из писем не
                  открывают; открытия есть, а генераций нет — клиентка не доходит до примерки.
                </p>
                <div className="mb-4 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-2xl bg-white/10 p-3">
                    <p className="font-serif text-2xl font-bold">{starts.totalOpens}</p>
                    <p className="text-xs text-[#F8F1E1]/70">открытий всего</p>
                  </div>
                  <div className="rounded-2xl bg-white/10 p-3">
                    <p className="font-serif text-2xl font-bold">{starts.uniqueUsers}</p>
                    <p className="text-xs text-[#F8F1E1]/70">уникальных людей</p>
                  </div>
                  <div className="rounded-2xl bg-white/10 p-3">
                    <p className="font-serif text-2xl font-bold">{starts.opens7d}</p>
                    <p className="text-xs text-[#F8F1E1]/70">за последние 7 дней</p>
                  </div>
                </div>
                {starts.byParam.length > 0 && (
                  <div className="mb-4">
                    <p className="mb-2 text-sm font-semibold">Откуда приходят (метки ссылок):</p>
                    <ul className="space-y-1 text-sm">
                      {starts.byParam.map((p) => (
                        <li
                          key={p.param || "direct"}
                          className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-white/5 px-3 py-1.5"
                        >
                          <span className="font-mono text-xs text-[#F6B93B]">
                            {p.param === "" ? "без метки — открыли бота напрямую" : p.param}
                          </span>
                          <span className="text-xs text-[#F8F1E1]/85">
                            {p.opens} откр. · {p.unique} чел.
                            {p.attributed > 0 ? ` · привязано ${p.attributed}` : ""}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-[#F8F1E1]/60">
                      Если у метки studio_… нет ни одного «привязано» — студии с таким слагом ещё
                      нет в списке «Студии» ниже. Создай её с тем же слагом — привязка начнёт
                      работать, и у клиенток появится кнопка «Записаться».
                    </p>
                  </div>
                )}
                {starts.recent.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-semibold">Последние открытия:</p>
                    <ul className="space-y-1 text-sm text-[#F8F1E1]/85">
                      {starts.recent.map((e, i) => {
                        const who = e.firstName || (e.username ? `@${e.username}` : `id ${e.telegramId}`);
                        const notLinked =
                          e.startParam.startsWith("studio_") && !e.attributed
                            ? " · студия не привязана"
                            : "";
                        return (
                          <li key={`${e.telegramId}-${e.createdAt}-${i}`}>
                            {fmtDateTime(e.createdAt)} — {who}
                            {" · "}
                            <span className="font-mono text-xs">
                              {e.startParam === "" ? "без метки" : e.startParam}
                            </span>
                            {notLinked}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}
              </section>
            )}

            <section className="green-card mb-5 rounded-3xl p-5" data-testid="payments-panel">
              <h2 className="mb-1 font-serif text-lg font-bold">Платежи Звёздами</h2>
              <p className="mb-3 text-sm text-[#F8F1E1]/75">
                Автооплата в боте: клиент платит Звёздами Telegram — генерации зачисляются
                мгновенно, без чеков и ручного включения. Переводы по реквизитам
                («Старт», «Салон») остаются ручными — их включай кнопкой «Выдать подписку».
              </p>

              {payStats && payStats.total > 0 ? (
                <>
                  <div className="mb-4 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
                    <div className="rounded-2xl bg-white/10 p-3">
                      <p className="font-serif text-2xl font-bold">{payStats.total}</p>
                      <p className="text-xs text-[#F8F1E1]/70">платежей</p>
                    </div>
                    <div className="rounded-2xl bg-white/10 p-3">
                      <p className="font-serif text-2xl font-bold">{payStats.stars}</p>
                      <p className="text-xs text-[#F8F1E1]/70">звёзд получено</p>
                    </div>
                    <div className="rounded-2xl bg-white/10 p-3">
                      <p className="font-serif text-2xl font-bold">
                        {Math.round(payStats.rub).toLocaleString("ru-RU")} ₽
                      </p>
                      <p className="text-xs text-[#F8F1E1]/70">сумма пакетов</p>
                    </div>
                    <div className="rounded-2xl bg-white/10 p-3">
                      <p className="font-serif text-2xl font-bold">{payStats.buyers}</p>
                      <p className="text-xs text-[#F8F1E1]/70">покупателей</p>
                    </div>
                  </div>
                  {payStats.byPack.length > 0 && (
                    <ul className="mb-4 space-y-1 text-sm">
                      {payStats.byPack.map((p) => (
                        <li
                          key={p.pack}
                          className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-white/5 px-3 py-1.5"
                        >
                          <span className="font-mono text-xs text-[#F6B93B]">{p.pack}</span>
                          <span className="text-xs text-[#F8F1E1]/85">
                            {p.count} шт · {p.stars} ★
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <p className="mb-4 rounded-2xl bg-white/10 p-3 text-sm text-[#F8F1E1]/85">
                  Платежей пока нет. Подключи приём платежей ниже — после этого кнопки
                  «Оплатить Звёздами» заработают, и первые продажи появятся здесь.
                </p>
              )}

              <div className="mb-4 rounded-2xl bg-white/10 p-3">
                <p className="text-sm font-semibold">
                  Приём платежей (webhook):{" "}
                  {webhookSecretSet ? (
                    <span className="text-[#9FD8A0]">секрет задан</span>
                  ) : (
                    <span className="text-[#F6B93B]">секрет НЕ задан</span>
                  )}
                </p>
                {webhookNote && (
                  <p className="mt-1 break-all rounded-lg bg-[#2E2210]/90 p-2 text-xs text-[#F8F1E1]/90">
                    {webhookNote}
                  </p>
                )}
                {webhookInfo?.url && (
                  <p className="mt-1 break-all font-mono text-xs text-[#F6B93B]">
                    {webhookInfo.url}
                    {webhookInfo.pending_update_count
                      ? ` · в очереди: ${webhookInfo.pending_update_count}`
                      : ""}
                    {webhookInfo.last_error_message
                      ? ` · последняя ошибка: ${webhookInfo.last_error_message}`
                      : ""}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button
                    className="glam-btn h-10 text-sm font-bold"
                    onClick={() => void setupWebhook()}
                    disabled={busy}
                    data-testid="webhook-setup"
                  >
                    Подключить приём платежей
                  </Button>
                  <Button
                    variant="outline"
                    className="h-10 border-[#F8F1E1]/30 text-sm text-[#F8F1E1] hover:bg-white/10"
                    onClick={() => void checkWebhook()}
                    disabled={busy}
                    data-testid="webhook-check"
                  >
                    Проверить статус
                  </Button>
                </div>
                {!webhookSecretSet && (
                  <p className="mt-2 text-xs leading-relaxed text-[#F8F1E1]/70">
                    Шаги: 1) нажми «Подключить» — подсказка выдаст строку вида glamwh_… (и
                    положит её в буфер); 2) добавь её на Vercel как переменную
                    TELEGRAM_WEBHOOK_SECRET и сделай Redeploy; 3) нажми «Подключить» ещё раз.
                    Всё: приём платежей работает.
                  </p>
                )}
              </div>

              {payments.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-semibold">Последние платежи:</p>
                  <ul className="space-y-1 text-sm text-[#F8F1E1]/85">
                    {payments.map((p) => {
                      const who =
                        p.firstName || (p.username ? `@${p.username}` : `id ${p.telegramId}`);
                      return (
                        <li
                          key={p.id}
                          className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg bg-white/5 px-3 py-1.5"
                        >
                          <span>
                            {fmtDateTime(p.createdAt)} — {who}
                          </span>
                          <span className="text-xs text-[#F8F1E1]/85">
                            {p.pack} · {p.generations} ген. · {p.stars} ★
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </section>

            <section className="green-card mb-5 rounded-3xl p-5">
              <h2 className="mb-3 font-serif text-lg font-bold">Выдать / продлить подписку</h2>
              <p className="mb-3 text-sm text-[#F8F1E1]/75">
                После оплаты: укажите @username или Telegram ID мастера (он должен хотя бы раз
                войти на сайт), выберите тариф и срок. Дата подписки продлевается к текущему сроку.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={grantUser}
                  onChange={(e) => setGrantUser(e.target.value)}
                  placeholder="@username или 123456789 (НЕ сумма)"
                  className="w-56 border-[#6F4E37]/35 bg-[#F8F1E1]/95 text-[#6F4E37]"
                  aria-label="Пользователь"
                />
                <select
                  value={grantPlan}
                  onChange={(e) => setGrantPlan(e.target.value as "start" | "salon")}
                  className="h-9 rounded-md border border-[#6F4E37]/35 bg-[#F8F1E1]/95 px-3 text-sm text-[#6F4E37]"
                  aria-label="Тариф"
                >
                  <option value="start">Старт — 690 ₽/мес</option>
                  <option value="salon">Салон — 2 490 ₽/мес</option>
                </select>
                <select
                  value={grantDays}
                  onChange={(e) => setGrantDays(e.target.value)}
                  className="h-9 rounded-md border border-[#6F4E37]/35 bg-[#F8F1E1]/95 px-3 text-sm text-[#6F4E37]"
                  aria-label="Срок"
                >
                  <option value="7">7 дней</option>
                  <option value="30">30 дней</option>
                  <option value="90">90 дней</option>
                </select>
                <Button
                  className="glam-btn"
                  disabled={busy || !grantUser.trim()}
                  onClick={() =>
                    void act(
                      { action: "grant", user: grantUser, plan: grantPlan, days: Number(grantDays) },
                      (d) => {
                        const until = d.untilIso
                          ? new Date(d.untilIso).toLocaleDateString("ru-RU", {
                              day: "numeric",
                              month: "long",
                              year: "numeric",
                            })
                          : "";
                        return `Подписка выдана ✅${until ? ` — действует до ${until}` : ""}`;
                      }
                    )
                  }
                >
                  Выдать
                </Button>
              </div>
              {/* Сумма к оплате: пересчитывается вместе с тарифом и сроком */}
              <p className="mt-2 text-sm text-[#F8F1E1]/80" data-testid="price-hint">
                К оплате:{" "}
                <b className="font-serif text-lg text-[#F6B93B]">
                  {grantTotal.toLocaleString("ru-RU")} ₽
                </b>{" "}
                — {planLabel(grantPlan)} на {grantDaysNum} дн. (= {monthsLabel} ×{" "}
                {PLAN_PRICES[grantPlan].toLocaleString("ru-RU")} ₽)
              </p>
              <p className="mt-1 text-xs text-[#F8F1E1]/60" data-testid="where-until-hint">
                Где смотреть продление: колонка «Подписка до» в таблице ниже; у мастера в шапке
                студии появится «{planLabel(grantPlan)} · до …».
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="border-[#F8F1E1]/30 text-[#F8F1E1] hover:bg-white/10"
                  disabled={busy || !grantUser.trim()}
                  onClick={() =>
                    void act({ action: "reset_trial", user: grantUser }, "Пробный лимит сброшен")
                  }
                >
                  Сбросить пробный лимит
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-[#F6B93B]/50 text-[#F8DFA8] hover:bg-white/10"
                  disabled={busy || !grantUser.trim()}
                  onClick={() =>
                    void act(
                      { action: "grant_bonus", user: grantUser, amount: 5 },
                      (d) => `Бонусные +5 генераций выданы (итого бонусных: ${d.bonusTotal ?? ""})`
                    )
                  }
                  data-testid="grant-bonus"
                >
                  Выдать +5 генераций
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-[#E25C4A]/45 text-[#F2B8AE] hover:bg-[#E25C4A]/15"
                  disabled={busy || !grantUser.trim()}
                  onClick={() =>
                    void act(
                      { action: "revoke", user: grantUser },
                      "Подписка отключена — мастер вернулся на пробный тариф"
                    )
                  }
                  data-testid="revoke-sub"
                >
                  <XCircle className="h-4 w-4" aria-hidden />
                  Отключить подписку
                </Button>
                <span className="text-xs text-[#F8F1E1]/60">
                  (тем же полем выше — @username или ID)
                </span>
              </div>
            </section>

            {/* Студии-партнёры (v41): баннер на сайте студии ведёт в бота со
                ссылкой-меткой ?start=studio_<slug> — источник запоминается. */}
            <section className="green-card mb-5 rounded-3xl p-5" data-testid="studios">
              <h2 className="mb-1 font-serif text-lg font-bold">Студии-партнёры</h2>
              <p className="mb-3 text-sm text-[#F8F1E1]/75">
                Добавь студию — получишь ссылку-метку для кнопки на её сайте.
                Клиентка, пришедшая по такой ссылке, привязывается к студии навсегда:
                бот показывает ей «Записаться» с контактами студии — и на экране,
                когда пробные образы кончились. Случайные посетительницы не расходуют
                квоту студии — они на нашем бесплатном лимите.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={studioName}
                  onChange={(e) => setStudioName(e.target.value)}
                  placeholder="Название студии (Роза Бьюти)"
                  className="w-52 border-[#6F4E37]/35 bg-[#F8F1E1]/95 text-[#6F4E37]"
                  aria-label="Название студии"
                />
                <Input
                  value={studioSlug}
                  onChange={(e) => setStudioSlug(e.target.value)}
                  placeholder="слаг: roza-beauty"
                  className="w-44 border-[#6F4E37]/35 bg-[#F8F1E1]/95 text-[#6F4E37]"
                  aria-label="Слаг студии"
                />
                <Input
                  value={studioUrl}
                  onChange={(e) => setStudioUrl(e.target.value)}
                  placeholder="ссылка записи: https://… (необязательно)"
                  className="w-64 border-[#6F4E37]/35 bg-[#F8F1E1]/95 text-[#6F4E37]"
                  aria-label="Ссылка для записи"
                />
                <Button
                  className="glam-btn shrink-0"
                  disabled={busy || !studioName.trim() || !studioSlug.trim()}
                  onClick={() =>
                    void act(
                      {
                        action: "studio_create",
                        name: studioName,
                        slug: studioSlug,
                        bookingUrl: studioUrl,
                        note: studioNote,
                      },
                      (d) => {
                        setStudioNote("");
                        return `Студия «${d.studio?.name ?? studioName}» сохранена — ссылка-метка ниже`;
                      }
                    )
                  }
                  data-testid="studio-create"
                >
                  Сохранить студию
                </Button>
              </div>
              <Input
                value={studioNote}
                onChange={(e) => setStudioNote(e.target.value)}
                placeholder="Заметка для клиентки (если нет ссылки записи): «Запись по телефону +7…»"
                className="mt-2 border-[#6F4E37]/35 bg-[#F8F1E1]/95 text-[#6F4E37]"
                aria-label="Заметка студии"
              />

              {/* Быстрое добавление списком (v48): все студии штурма за один раз */}
              <div className="mt-3 rounded-xl border border-[#F8F1E1]/15 bg-[#06301B]/70 p-3">
                <p className="mb-1 text-sm font-semibold">Быстрое добавление списком</p>
                <p className="mb-2 text-xs text-[#F8F1E1]/70">
                  Вставь список из штурм-файлов: по строке «Название | слаг | ссылка записи | заметка»
                  (после слага всё необязательно) или JSON. Существующие студии обновятся без дублей,
                  а слаг с приставкой studio-… починится автоматически — ссылки из писем
                  ?start=studio_… начнут привязывать клиенток.
                </p>
                <textarea
                  value={importText}
                  onChange={(e) => {
                    setImportText(e.target.value);
                    setImportCount(parseStudioList(e.target.value).items.length);
                  }}
                  rows={6}
                  placeholder={"Школа красоты Бьюти Культ | cult-nsk\nАвторская студия Светланы Дунаевой | dunaeva-nsk\nСтудия Alsu Visage | alsu-ekb"}
                  className="w-full rounded-lg border border-[#6F4E37]/35 bg-[#F8F1E1]/95 p-2 font-mono text-xs text-[#6F4E37]"
                  aria-label="Список студий для импорта"
                  data-testid="studio-import-text"
                />
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <Button
                    className="glam-btn shrink-0"
                    disabled={busy || !importText.trim()}
                    onClick={() => void runImport()}
                    data-testid="studio-import-run"
                  >
                    {busy ? (
                      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                    ) : (
                      <Sparkles className="h-4 w-4" aria-hidden />
                    )}
                    Добавить из списка
                  </Button>
                  <span className="text-xs text-[#F8F1E1]/60">
                    {importCount > 0 ? `строк распознано: ${importCount}` : "формат: Название | слаг"}
                  </span>
                </div>
                {importReport && (
                  <pre
                    className="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-black/30 p-2 text-xs text-[#E7DFC9]"
                    data-testid="studio-import-report"
                  >
                    {importReport}
                  </pre>
                )}
              </div>

              {studios.length > 0 && (
                <div className="mt-4 space-y-2">
                  {studios.map((s) => {
                    const link = botUsername
                      ? `https://t.me/${botUsername.replace(/^@/, "")}?start=studio_${s.slug}`
                      : "";
                    return (
                      <div
                        key={s.slug}
                        className="rounded-xl border border-[#F8F1E1]/15 bg-[#06301B]/70 p-3"
                        data-testid={`studio-row-${s.slug}`}
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-semibold">{s.name}</p>
                          <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs">
                            @{s.slug}
                          </span>
                          <span
                            className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                              s.active
                                ? "bg-[#B98A2E]/30 text-[#F3E2B9]"
                                : "bg-white/15 text-[#F8F1E1]/70"
                            }`}
                          >
                            {s.active ? "активна" : "выключена"}
                          </span>
                          <span className="text-xs text-[#F8F1E1]/70">
                            привязано: {s.invited}
                          </span>
                          <div className="ml-auto flex flex-wrap gap-2">
                            {link && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="border-[#F8F1E1]/30 text-[#F8F1E1] hover:bg-white/10"
                                onClick={() => {
                                  void navigator.clipboard?.writeText(link).catch(() => {});
                                  setCopiedSlug(s.slug);
                                  setTimeout(() => setCopiedSlug(null), 2000);
                                }}
                                data-testid={`studio-copy-${s.slug}`}
                              >
                                {copiedSlug === s.slug ? "Скопировано ✓" : "Скопировать ссылку для сайта"}
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              className="border-[#F8F1E1]/30 text-[#F8F1E1] hover:bg-white/10"
                              disabled={busy}
                              onClick={() =>
                                void act(
                                  { action: "studio_toggle", slug: s.slug, active: !s.active },
                                  s.active
                                    ? `Студия «${s.name}» выключена — новые привязки прекращены`
                                    : `Студия «${s.name}» снова активна`
                                )
                              }
                              data-testid={`studio-toggle-${s.slug}`}
                            >
                              {s.active ? "Выключить" : "Включить"}
                            </Button>
                          </div>
                        </div>
                        <p className="mt-1.5 break-all text-xs text-[#E7DFC9]">
                          {link || "Задай TELEGRAM_BOT_USERNAME на Vercel — и ссылка появится"}
                        </p>
                        {s.bookingUrl && (
                          <p className="mt-0.5 text-xs text-[#F8F1E1]/60">
                            Запись: {s.bookingUrl}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* Заявки на подписку: клиент нажал «Выбрать тариф» — ID уже здесь */}
            {requests.length > 0 && (
              <section className="green-card mb-5 rounded-3xl p-5" data-testid="pay-requests">
                <h2 className="mb-1 font-serif text-lg font-bold">Заявки на подписку</h2>
                <p className="mb-3 text-sm text-[#F8F1E1]/75">
                  Мастер нажал «Выбрать тариф» — его ID уже здесь. Сверьте чек в чате и выдавайте
                  одной кнопкой. Срок берётся из поля «Срок» выше, цена пересчитана автоматически.
                </p>
                <div className="space-y-2">
                  {requests.map((r) => {
                    const planKey = r.plan === "salon" ? "salon" : "start";
                    const price = Math.round((PLAN_PRICES[planKey] * (Number(grantDays) || 30)) / 30);
                    return (
                      <div
                        key={r.id}
                        className="flex flex-wrap items-center gap-2 rounded-xl border border-[#F8F1E1]/15 bg-[#06301B]/70 p-3"
                        data-testid={`req-row-${r.id}`}
                      >
                        <div className="min-w-40">
                          <p className="text-sm font-semibold">{r.firstName ?? "Мастер"}</p>
                          <p className="text-xs text-[#F8F1E1]/60">
                            {r.username ? `@${r.username} · ` : ""}ID {r.telegramId} ·{" "}
                            {fmtDateTime(r.createdAt)}
                          </p>
                        </div>
                        <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold">
                          {planKey === "salon" ? "Салон" : "Старт"}
                        </span>
                        <div className="ml-auto flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            className="glam-btn"
                            disabled={busy}
                            onClick={() => void handleRequestGrant(r)}
                            data-testid={`req-grant-${r.id}`}
                          >
                            Выдать · {grantDaysNum} дн. · {price.toLocaleString("ru-RU")} ₽
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="border-[#F8F1E1]/30 text-[#F8F1E1] hover:bg-white/10"
                            disabled={busy}
                            onClick={() =>
                              void act({ action: "request_dismiss", id: r.id }, "Заявка скрыта")
                            }
                            data-testid={`req-dismiss-${r.id}`}
                          >
                            Скрыть
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {/* QR-код оплаты: тот же, что в paywall; можно скачать PNG и распечатать */}
            {pay && payQrPayload(pay) ? (
              <section className="green-card mb-5 rounded-3xl p-5" data-testid="admin-qr">
                <h2 className="mb-2 font-serif text-lg font-bold">QR-код оплаты</h2>
                <div className="flex flex-wrap items-start gap-4">
                  {qrData && (
                    <span className="rounded-2xl bg-white p-2 shadow">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={qrData} alt="QR-код для оплаты" className="h-44 w-44" />
                    </span>
                  )}
                  <div className="max-w-sm text-sm text-[#F8F1E1]/80">
                    <p>
                      Мастер наводит камеру телефона — {pay.link ? "откроется банк сразу с переводом" : "появится номер для перевода по СБП"}. QR
                      можно распечатать и повесить в студии, вставить в пост или отправить мастеру в чате.
                    </p>
                    {qrData && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-3 border-[#F8F1E1]/30 text-[#F8F1E1] hover:bg-white/10"
                        data-testid="download-qr"
                        onClick={() => {
                          void saveImageFile(qrData, "glamai-oplata-qr");
                        }}
                      >
                        Скачать PNG для печати
                      </Button>
                    )}
                  </div>
                </div>
              </section>
            ) : null}

            {error && (
              <p className="mb-4 rounded-xl border border-[#E25C4A]/45 bg-[#2E1512]/95 p-3 text-sm text-[#F2B8AE]">
                {error}
              </p>
            )}
            {notice && (
              <p className="mb-4 rounded-xl border border-[#8CE99A]/30 bg-[#0B2E1C]/90 p-3 text-sm text-[#C9EED8]">
                {notice}
              </p>
            )}

            <section className="green-card overflow-hidden rounded-3xl">
              <p className="px-4 pt-3 text-xs text-[#F8F1E1]/60">
                Подсказка: нажми на @username или ID в строке мастера — он подставится в поле
                «Выдать» выше. Сумма (690 ₽) в это поле не вводится — она считается сама.
              </p>
              <div className="max-h-[60vh] overflow-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="sticky top-0 bg-[#043E21] text-xs uppercase tracking-wide text-[#F8F1E1]/60">
                    <tr>
                      <th className="px-4 py-3">Мастер</th>
                      <th className="px-3 py-3">Тариф</th>
                      <th className="px-3 py-3">Триал</th>
                      <th className="px-3 py-3">Месяц</th>
                      <th className="px-3 py-3">Подписка до</th>
                      <th className="px-3 py-3">Генераций</th>
                      <th className="px-3 py-3">Студия</th>
                      <th className="px-3 py-3">Был(а)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-6 text-center text-[#F8F1E1]/60">
                          Пока никто не входил
                        </td>
                      </tr>
                    )}
                    {users.map((u) => {
                      const badge = planBadge(u.plan, u.subscriptionUntil);
                      return (
                        <tr key={u.telegramId} className="border-t border-[#F8F1E1]/10">
                          <td className="px-4 py-3">
                            <p className="font-semibold">{u.firstName ?? "—"}</p>
                            <button
                              type="button"
                              onClick={() =>
                                setGrantUser(u.username ? `@${u.username}` : String(u.telegramId))
                              }
                              className="text-left text-xs text-[#F6B93B] underline-offset-2 hover:underline"
                              title="Подставить в поле выдачи"
                              data-testid={`pick-user-${u.telegramId}`}
                            >
                              {u.username ? `@${u.username}` : ""} · {u.telegramId}
                            </button>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge.cls}`}>
                              {badge.text}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            {u.trialUsed} / {5 + (u.bonusGenerations ?? 0)}
                            {(u.bonusGenerations ?? 0) > 0 && (
                              <span
                                className="ml-1 rounded-full bg-[#F6B93B]/25 px-1.5 py-0.5 text-[10px] font-semibold text-[#F8DFA8]"
                                title="Бонусные генерации (добор)"
                              >
                                +{u.bonusGenerations}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-3">
                            {u.monthlyUsed}
                            {u.monthlyResetYm ? ` · ${u.monthlyResetYm}` : ""}
                          </td>
                          <td className="px-3 py-3">{fmtDate(u.subscriptionUntil)}</td>
                          <td className="px-3 py-3">{u.generationsTotal}</td>
                          <td className="px-3 py-3 text-xs text-[#F8F1E1]/80">
                            {u.studioName ? u.studioName : <span className="text-[#F8F1E1]/40">—</span>}
                          </td>
                          <td className="px-3 py-3 text-xs text-[#F8F1E1]/70">
                            {fmtDate(u.lastSeenAt)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
