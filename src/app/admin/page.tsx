"use client";

// Админ-панель ручных продаж: /admin
// Вход по ADMIN_SECRET. Здесь владелец видит мастеров и выдаёт/продлевает
// подписки после ручной оплаты (перевод → «Выдать подписку»).

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface AdminUser {
  telegramId: number;
  username: string | null;
  firstName: string | null;
  plan: string;
  trialUsed: number;
  monthlyUsed: number;
  monthlyResetYm: string | null;
  subscriptionUntil: string | null;
  lastSeenAt: string;
  generationsTotal: number;
}

interface Stats {
  total: number;
  paying: number;
  generations: number;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "2-digit" });
}

function planBadge(plan: string, untilIso: string | null): { text: string; cls: string } {
  const active = untilIso && new Date(untilIso).getTime() > Date.now();
  if (plan === "start") {
    return active
      ? { text: "Старт", cls: "bg-[#008B8B]/80 text-white" }
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
  const [grantUser, setGrantUser] = useState("");
  const [grantPlan, setGrantPlan] = useState<"start" | "salon">("start");
  const [grantDays, setGrantDays] = useState("30");

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
      setAuthed(true);
    } catch (e) {
      setAuthed(false);
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

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

  const act = async (body: Record<string, unknown>, okMsg: string) => {
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
      setNotice(okMsg);
      await loadList();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка операции");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#043E21] px-4 py-8 text-[#F8F1E1]">
      <div className="mx-auto w-full max-w-5xl">
        <header className="mb-6 flex items-center gap-3">
          <div className="rounded-2xl bg-gradient-to-br from-[#008B8B] via-[#16B8A6] to-[#F6B93B] p-2">
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
                  placeholder="@username или 123456789"
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
                      "Подписка выдана ✅"
                    )
                  }
                >
                  Выдать
                </Button>
              </div>
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
                <span className="text-xs text-[#F8F1E1]/60">
                  (тем же полем выше — @username или ID)
                </span>
              </div>
            </section>

            {error && (
              <p className="mb-4 rounded-xl border border-red-300/60 bg-red-50/95 p-3 text-sm text-red-900">
                {error}
              </p>
            )}
            {notice && (
              <p className="mb-4 rounded-xl border border-emerald-300/60 bg-emerald-50/95 p-3 text-sm text-emerald-900">
                {notice}
              </p>
            )}

            <section className="green-card overflow-hidden rounded-3xl">
              <div className="max-h-[60vh] overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 bg-[#043E21] text-xs uppercase tracking-wide text-[#F8F1E1]/60">
                    <tr>
                      <th className="px-4 py-3">Мастер</th>
                      <th className="px-3 py-3">Тариф</th>
                      <th className="px-3 py-3">Триал</th>
                      <th className="px-3 py-3">Месяц</th>
                      <th className="px-3 py-3">Подписка до</th>
                      <th className="px-3 py-3">Генераций</th>
                      <th className="px-3 py-3">Был(а)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-4 py-6 text-center text-[#F8F1E1]/60">
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
                            <p className="text-xs text-[#F8F1E1]/60">
                              {u.username ? `@${u.username}` : ""} · {u.telegramId}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${badge.cls}`}>
                              {badge.text}
                            </span>
                          </td>
                          <td className="px-3 py-3">{u.trialUsed} / 5</td>
                          <td className="px-3 py-3">
                            {u.monthlyUsed}
                            {u.monthlyResetYm ? ` · ${u.monthlyResetYm}` : ""}
                          </td>
                          <td className="px-3 py-3">{fmtDate(u.subscriptionUntil)}</td>
                          <td className="px-3 py-3">{u.generationsTotal}</td>
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
