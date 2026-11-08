"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, LogOut, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { PhotoDropzone, type PhotoValue } from "@/components/glam/PhotoDropzone";
import { PalettePanel } from "@/components/glam/PalettePanel";
import { BrushPanel } from "@/components/glam/BrushPanel";
import { ResultPanel } from "@/components/glam/ResultPanel";
import {
  defaultProducts,
  type ProductId,
  type ProductState,
} from "@/lib/makeup";
import AuthGate, { useAuth } from "@/components/glam/AuthGate";

type Mode = "prompt" | "reference";

interface TryonResponse {
  success: boolean;
  image?: string;
  prompt?: string;
  description?: string | null;
  error?: string;
  /** "portrait" — публичный API Z.AI: результат — портрет по описанию внешности */
  pipeline?: "edit" | "portrait";
}

interface HealthCheck {
  name: string;
  ok: boolean;
  hint: string;
}

/** Плавающие цветные пятна на фоне — живая атмосфера студии */
function BackgroundDecor() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div
        className="blob absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-[#B9F6CF]/30 blur-3xl"
        style={{ animationDuration: "22s" }}
      />
      <div
        className="blob absolute -right-32 top-1/4 h-[460px] w-[460px] rounded-full bg-[#9B6EF3]/15 blur-3xl"
        style={{ animationDuration: "27s", animationDelay: "-7s" }}
      />
      <div
        className="blob absolute -bottom-36 left-1/4 h-[420px] w-[420px] rounded-full bg-[#F6B93B]/16 blur-3xl"
        style={{ animationDuration: "24s", animationDelay: "-13s" }}
      />
      <div
        className="blob absolute bottom-1/3 right-1/3 h-[300px] w-[300px] rounded-full bg-white/12 blur-3xl"
        style={{ animationDuration: "20s", animationDelay: "-4s" }}
      />
    </div>
  );
}

function fmtUntil(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
}

/** Заголовок секции с цветным маркером */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-1 flex items-center gap-2 font-serif text-xl font-bold tracking-wide text-[#F8F1E1]">
      <span
        aria-hidden
        className="inline-block h-5 w-1.5 rounded-full bg-gradient-to-b from-[#8CE99A] via-[#16B8A6] to-[#F6B93B]"
      />
      {children}
    </h2>
  );
}

export default function Home() {
  return (
    <AuthGate>
      <Studio />
    </AuthGate>
  );
}

function Studio() {
  const { profile, refresh, openPaywall } = useAuth();
  const [mode, setMode] = useState<Mode>("prompt");
  const [modelPhoto, setModelPhoto] = useState<PhotoValue | null>(null);
  const [refPhoto, setRefPhoto] = useState<PhotoValue | null>(null);
  const [products, setProducts] = useState<Record<ProductId, ProductState>>(defaultProducts);
  const [brushes, setBrushes] = useState<string[]>(["fluffy"]);
  const [overall, setOverall] = useState<number>(2);
  const [promptText, setPromptText] = useState("");
  const [refComment, setRefComment] = useState("");
  const [fastMode, setFastMode] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [usedPrompt, setUsedPrompt] = useState<string | null>(null);
  const [usedDescription, setUsedDescription] = useState<string | null>(null);
  const [portraitMode, setPortraitMode] = useState(false);
  const [configIssue, setConfigIssue] = useState<string | null>(null);

  // При открытии страницы тихо проверяем конфигурацию ИИ: если ключ не настроен,
  // показываем баннер сразу — пользователь не тратит время на неудачную генерацию.
  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((r) => r.json())
      .then((d: { status?: string; checks?: HealthCheck[] }) => {
        if (cancelled || d.status !== "config-error") return;
        const failed = d.checks?.filter((c) => !c.ok) ?? [];
        setConfigIssue(failed.map((c) => c.hint).join(" ") || "Ключ доступа к ИИ не настроен.");
      })
      .catch(() => {
        // сервер недоступен — покажем ошибку при попытке генерации
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const patchProduct = useCallback((id: ProductId, patch: Partial<ProductState>) => {
    setProducts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const toggleBrush = useCallback((id: string) => {
    setBrushes((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]
    );
  }, []);

  const showError = useCallback((message: string) => {
    toast({ title: "Не получилось", description: message, variant: "destructive" });
  }, []);

  const generate = useCallback(async () => {
    if (loading) return;

    if (!modelPhoto) {
      showError(
        mode === "reference"
          ? "Загрузите оригинальное фото клиента."
          : "Загрузите фото модели."
      );
      return;
    }
    if (mode === "reference" && !refPhoto) {
      showError("Загрузите референс — фото с образцом макияжа.");
      return;
    }
    if (mode === "prompt") {
      const anyEnabled = Object.values(products).some((p) => p.enabled);
      if (!anyEnabled && !promptText.trim()) {
        showError(
          "Соберите образ в палитре (включите хотя бы один продукт) или опишите его словами."
        );
        return;
      }
    }

    setLoading(true);
    setResult(null);
    setUsedPrompt(null);
    setUsedDescription(null);
    setPortraitMode(false);

    try {
      const res = await fetch("/api/tryon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          modelPhoto: modelPhoto.dataUrl,
          ratio: modelPhoto.ratio,
          referencePhoto: mode === "reference" ? refPhoto?.dataUrl : undefined,
          products: mode === "prompt" ? products : undefined,
          brushes: mode === "prompt" ? brushes : undefined,
          overall,
          fastMode,
          userPrompt: mode === "prompt" ? promptText : refComment,
        }),
      });

      // Лимит исчерпан — сервер возвращает 402 с paywall: открываем окно тарифов
      if (res.status === 402) {
        try {
          const pay = (await res.json()) as { error?: string };
          openPaywall({ message: pay.error });
        } catch {
          openPaywall({});
        }
        void refresh();
        return;
      }
      if (res.status === 401) {
        throw new Error("Сессия истекла — обновите страницу и войдите через Telegram заново.");
      }

      // Платформа может вернуть не JSON (HTML-страницу ошибки Vercel/прокси) —
      // тогда парсинг падает с криптичной ошибкой. Ловим и объясняем по-русски.
      const rawText = await res.text();
      let data: TryonResponse;
      try {
        data = JSON.parse(rawText) as TryonResponse;
      } catch {
        if (res.status === 502 || res.status === 503 || res.status === 504) {
          throw new Error(
            "Сервер не успел обработать запрос (таймаут платформы). Попробуйте ещё раз — обычно вторая попытка проходит."
          );
        }
        if (res.status === 413) {
          throw new Error("Фото слишком большое для отправки. Уменьшите размер файла и попробуйте снова.");
        }
        throw new Error(`Сервис вернул ошибку ${res.status}. Попробуйте ещё раз чуть позже.`);
      }
      if (!res.ok || !data.success || !data.image) {
        throw new Error(data.error || "Сервис ИИ временно недоступен, попробуйте позже.");
      }

      setResult(data.image);
      setUsedPrompt(data.prompt ?? null);
      setUsedDescription(data.description ?? null);
      setPortraitMode(data.pipeline === "portrait");
      toast({ title: "Образ готов ✨", description: "Сравните «до и после» и сохраните." });
      void refresh(); // обновляем счётчик оставшихся генераций
    } catch (e) {
      showError(e instanceof Error ? e.message : "Неизвестная ошибка");
    } finally {
      setLoading(false);
    }
  }, [
    loading,
    mode,
    modelPhoto,
    refPhoto,
    products,
    brushes,
    overall,
    fastMode,
    promptText,
    refComment,
    showError,
    openPaywall,
    refresh,
  ]);

  const logout = useCallback(async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } catch {
      /* всё равно уводим на перезагрузку */
    }
    window.location.href = "/";
  }, []);

  const resetResult = useCallback(() => {
    setResult(null);
    setUsedPrompt(null);
    setUsedDescription(null);
    setPortraitMode(false);
  }, []);

  // Галочка «быстрый режим» — один и тот же элемент в обеих вкладках
  const fastModeToggle = (
    <label className="flex cursor-pointer select-none items-start gap-2 text-[13px] text-muted-foreground">
      <Checkbox
        checked={fastMode}
        onCheckedChange={(v) => setFastMode(v === true)}
        className="mt-0.5"
        aria-label="Быстрый режим без проверки качества"
      />
      <span>
        Быстрый режим — без проверки качества. Тратит в 4 раза меньше лимита ИИ;
        включайте, если ловите «слишком много запросов».
      </span>
    </label>
  );

  const generateButton = (
    <Button className="glam-btn h-12 w-full text-lg font-bold" onClick={generate} disabled={loading}>
      {loading ? (
        <>
          <Loader2 className="h-5 w-5 animate-spin" />
          ИИ наносит макияж…
        </>
      ) : (
        <>
          <Sparkles className="h-5 w-5" />
          Создать образ
        </>
      )}
    </Button>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <BackgroundDecor />

      {/* Шапка */}
      <header className="sticky top-0 z-40 bg-[#08512C]/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="rounded-2xl bg-gradient-to-br from-[#008B8B] via-[#16B8A6] to-[#F6B93B] p-2 shadow-lg shadow-teal-200/50">
                <Sparkles className="h-5 w-5 text-white" aria-hidden />
              </div>
              <Sparkles
                aria-hidden
                className="twinkle absolute -right-2 -top-2 h-3.5 w-3.5 text-[#F6B93B]"
                style={{ animationDuration: "2.2s" }}
              />
              <Sparkles
                aria-hidden
                className="twinkle absolute -bottom-1.5 -left-2 h-2.5 w-2.5 text-[#9B6EF3]"
                style={{ animationDuration: "3s", animationDelay: "-1.2s" }}
              />
            </div>
            <div>
              <p className="font-serif text-lg font-semibold leading-none tracking-wide sm:text-xl">
                <span className="brand-text">GlamAI Studio</span>
              </p>
              <p className="mt-1 hidden text-[11px] text-muted-foreground sm:block">
                ИИ-визажист для студии макияжа
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-[#F8F1E1]/35 bg-white/10 px-3 py-1 text-[11px] text-[#F8F1E1] lg:inline-block">
              Фото не сохраняются · обработка в момент запроса
            </span>
            {profile && (
              <span
                className="shrink-0 whitespace-nowrap rounded-full border border-[#8CE99A]/45 bg-[#008B8B]/35 px-3 py-1 text-[11px] font-semibold text-[#F8F1E1]"
                data-testid="quota-chip"
              >
                {profile.subscriptionActive
                  ? `${profile.planLabel} · до ${fmtUntil(profile.subscriptionUntil)}`
                  : `Пробные: ${profile.remaining} из ${profile.total}`}
              </span>
            )}
            <button
              type="button"
              onClick={() => void logout()}
              title="Выйти"
              aria-label="Выйти"
              className="rounded-full border border-[#F8F1E1]/35 bg-white/10 p-1.5 text-[#F8F1E1] transition-colors hover:bg-white/20"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
        {/* Радужная линия под шапкой */}
        <div aria-hidden className="rainbow-line h-[2px] w-full opacity-70" />
      </header>

      {/* Баннер диагностики: показывается, только если конфиг ИИ не настроен */}
      {configIssue && (
        <div className="border-b border-amber-300/70 bg-amber-50/90 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl items-start gap-3 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
            <div className="text-sm text-amber-900">
              <p className="font-semibold">ИИ не настроен — генерация пока не сработает</p>
              <p className="mt-1 text-amber-800">{configIssue}</p>
              <p className="mt-1 text-amber-800">
                Подробная диагностика: откройте{" "}
                <a href="/api/health" target="_blank" className="underline hover:text-amber-950">
                  /api/health
                </a>{" "}
                (после исправления — /api/health?ping=1, он проверит и сам ключ).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfigIssue(null)}
              className="ml-auto shrink-0 rounded-md px-2 py-1 text-xs text-amber-700 hover:text-amber-950"
            >
              Скрыть
            </button>
          </div>
        </div>
      )}

      {/* Рабочая область */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {/* Остаток бесплатных генераций — крупно, видно на любом экране */}
        {profile && !profile.subscriptionActive && (
          <div
            className="mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-2xl border border-[#8CE99A]/40 bg-[#043E21]/60 px-4 py-3 text-sm text-[#F8F1E1]"
            data-testid="trial-banner"
          >
            <Sparkles className="h-4 w-4 shrink-0 text-[#F6B93B]" aria-hidden />
            <p className="min-w-0 flex-1">
              Бесплатно: <b>{profile.remaining} из {profile.total}</b> образов
              {profile.remaining > 0
                ? " — без карты. Дальше — подписка от 690 ₽/мес."
                : " — пробные образы закончились."}
            </p>
            {profile.remaining === 0 && (
              <Button
                size="sm"
                onClick={() => openPaywall()}
                className="glam-btn shrink-0 font-bold"
                data-testid="open-paywall"
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                Выбрать тариф
              </Button>
            )}
          </div>
        )}
        <div className="grid items-start gap-6 lg:grid-cols-[430px_1fr]">
          {/* Левая колонка — настройки */}
          <div>
            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="w-full">
              <TabsList className="grid h-14 w-full grid-cols-2 rounded-full border border-[#F8F1E1]/30 bg-[#043E21]/70 p-1.5 shadow-sm">
                <TabsTrigger
                  value="prompt"
                  className="rounded-full text-base font-semibold transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#008B8B] data-[state=active]:to-[#16B8A6] data-[state=active]:text-white data-[state=active]:shadow-md"
                >
                  Промпт и палитра
                </TabsTrigger>
                <TabsTrigger
                  value="reference"
                  className="rounded-full text-base font-semibold transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#008B8B] data-[state=active]:to-[#16B8A6] data-[state=active]:text-white data-[state=active]:shadow-md"
                >
                  Перенос с референса
                </TabsTrigger>
              </TabsList>

              {/* Режим 1: промпт и палитра */}
              <TabsContent value="prompt" className="mt-4 space-y-4">
                <section className="green-card pop-in rounded-2xl p-4">
                  <PhotoDropzone
                    title="Фото модели"
                    hint="лицо крупным планом, JPEG/PNG"
                    value={modelPhoto}
                    onChange={setModelPhoto}
                    onError={showError}
                  />
                </section>

                <section
                  className="green-card pop-in rounded-2xl p-4"
                  style={{ animationDelay: "90ms" }}
                >
                  <SectionTitle>Палитра</SectionTitle>
                  <p className="mb-3 text-sm text-muted-foreground">
                    Включите продукт и выберите оттенок — ИИ подберёт максимально близкий
                    вариант. Выключенные продукты остаются без макияжа.
                  </p>
                  <PalettePanel products={products} onPatch={patchProduct} />
                </section>

                <section
                  className="green-card pop-in rounded-2xl p-4"
                  style={{ animationDelay: "180ms" }}
                >
                  <SectionTitle>Кисти и инструменты</SectionTitle>
                  <p className="mb-3 text-sm text-muted-foreground">
                    Кисти задают технику нанесения (растушёвка, чёткость), а не цвет. Цвет —
                    в палитре.
                  </p>
                  <BrushPanel
                    brushes={brushes}
                    onToggle={toggleBrush}
                    overall={overall}
                    onOverall={setOverall}
                  />
                </section>

                <section
                  className="green-card pop-in rounded-2xl p-4"
                  style={{ animationDelay: "270ms" }}
                >
                  <SectionTitle>Промпт</SectionTitle>
                  <Textarea
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    maxLength={800}
                    rows={3}
                    placeholder="Например: лёгкие смоки-айз в бронзовых тонах, акцент на глаза, нюдовые губы, сияющая кожа…"
                    className="resize-none border-[#6F4E37]/35 bg-[#F8F1E1]/95 text-base text-[#6F4E37] placeholder:text-[#6F4E37]/55 focus-visible:ring-[#8CE99A]/70"
                    aria-label="Описание образа"
                  />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Слова из промпта ИИ объединит с выбранными оттенками. Генерация занимает
                    20–60 секунд.
                  </p>
                  <div className="mt-3 space-y-2.5">
                    {fastModeToggle}
                    {generateButton}
                  </div>
                </section>
              </TabsContent>

              {/* Режим 2: перенос с референса */}
              <TabsContent value="reference" className="mt-4 space-y-4">
                <section className="green-card pop-in rounded-2xl p-4">
                  <PhotoDropzone
                    title="Оригинал — фото клиента"
                    hint="чьё лицо будет в макияже"
                    value={modelPhoto}
                    onChange={setModelPhoto}
                    onError={showError}
                  />
                </section>

                <section
                  className="green-card pop-in rounded-2xl p-4"
                  style={{ animationDelay: "90ms" }}
                >
                  <PhotoDropzone
                    title="Референс макияжа"
                    hint="образец: чей макияж переносим"
                    value={refPhoto}
                    onChange={setRefPhoto}
                    onError={showError}
                  />
                </section>

                <section
                  className="green-card pop-in rounded-2xl p-4"
                  style={{ animationDelay: "180ms" }}
                >
                  <SectionTitle>Комментарий для ИИ</SectionTitle>
                  <Textarea
                    value={refComment}
                    onChange={(e) => setRefComment(e.target.value)}
                    maxLength={800}
                    rows={3}
                    placeholder="Необязательно: например, «сделай губы чуть светлее, а стрелки — тоньше»"
                    className="resize-none border-[#6F4E37]/35 bg-[#F8F1E1]/95 text-base text-[#6F4E37] placeholder:text-[#6F4E37]/55 focus-visible:ring-[#8CE99A]/70"
                    aria-label="Комментарий к переносу"
                  />
                  <p className="mt-2 text-sm text-muted-foreground">
                    ИИ возьмёт макияж с референса и адаптирует его под черты лица на оригинале.
                  </p>
                  <div className="mt-3 space-y-2.5">
                    {fastModeToggle}
                    {generateButton}
                  </div>
                </section>
              </TabsContent>
            </Tabs>
          </div>

          {/* Правая колонка — результат */}
          <div className="lg:sticky lg:top-20">
            <ResultPanel
              loading={loading}
              original={modelPhoto?.dataUrl ?? null}
              result={result}
              usedPrompt={usedPrompt}
              usedDescription={usedDescription}
              portraitMode={portraitMode}
              onReset={resetResult}
            />
          </div>
        </div>
      </main>

      {/* Подвал */}
      <footer className="mt-auto border-t border-[#F8F1E1]/20 py-4">
        <p className="text-center text-sm text-muted-foreground">
          GlamAI Studio · Виртуальная примерка макияжа · Фото обрабатываются в момент запроса
          и не сохраняются на сервере
        </p>
      </footer>
    </div>
  );
}
