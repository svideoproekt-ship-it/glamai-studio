"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Sparkles } from "lucide-react";
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

type Mode = "prompt" | "reference";

interface TryonResponse {
  success: boolean;
  image?: string;
  prompt?: string;
  description?: string | null;
  error?: string;
}

interface HealthCheck {
  name: string;
  ok: boolean;
  hint: string;
}

export default function Home() {
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
      toast({ title: "Образ готов ✨", description: "Сравните «до и после» и сохраните." });
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
  ]);

  const resetResult = useCallback(() => {
    setResult(null);
    setUsedPrompt(null);
    setUsedDescription(null);
  }, []);

  // Галочка «быстрый режим» — один и тот же элемент в обеих вкладках
  const fastModeToggle = (
    <label className="flex cursor-pointer select-none items-start gap-2 text-xs text-muted-foreground">
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
    <Button className="gold-btn h-12 w-full text-base font-semibold" onClick={generate} disabled={loading}>
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
      {/* Шапка */}
      <header className="sticky top-0 z-40 border-b border-[#D4AF37]/15 bg-[#0a0a0d]/85 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full border border-[#D4AF37]/40 bg-[#1a1710] p-2">
              <Sparkles className="h-5 w-5 text-[#D4AF37]" aria-hidden />
            </div>
            <div>
              <p className="font-serif text-xl font-semibold leading-none tracking-wide">
                <span className="gold-text">GlamAI Studio</span>
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                ИИ-визажист для студии макияжа
              </p>
            </div>
          </div>
          <span className="hidden rounded-full border border-[#D4AF37]/30 px-3 py-1 text-[11px] text-[#E8CF7A] sm:inline-block">
            Фото не сохраняются · обработка в момент запроса
          </span>
        </div>
      </header>

      {/* Баннер диагностики: показывается, только если конфиг ИИ не настроен */}
      {configIssue && (
        <div className="border-b border-amber-500/30 bg-amber-500/10">
          <div className="mx-auto flex w-full max-w-6xl items-start gap-3 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
            <div className="text-sm text-amber-100/90">
              <p className="font-semibold">ИИ не настроен — генерация пока не сработает</p>
              <p className="mt-1 text-amber-100/70">{configIssue}</p>
              <p className="mt-1 text-amber-100/70">
                Подробная диагностика: откройте{" "}
                <a href="/api/health" target="_blank" className="underline hover:text-amber-50">
                  /api/health
                </a>{" "}
                (после исправления — /api/health?ping=1, он проверит и сам ключ).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setConfigIssue(null)}
              className="ml-auto shrink-0 rounded-md px-2 py-1 text-xs text-amber-100/60 hover:text-amber-50"
            >
              Скрыть
            </button>
          </div>
        </div>
      )}

      {/* Рабочая область */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="grid items-start gap-6 lg:grid-cols-[430px_1fr]">
          {/* Левая колонка — настройки */}
          <div>
            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="w-full">
              <TabsList className="grid w-full grid-cols-2 bg-secondary/60">
                <TabsTrigger
                  value="prompt"
                  className="data-[state=active]:border data-[state=active]:border-[#D4AF37]/40 data-[state=active]:bg-[#241e10] data-[state=active]:text-[#E8CF7A]"
                >
                  Промпт и палитра
                </TabsTrigger>
                <TabsTrigger
                  value="reference"
                  className="data-[state=active]:border data-[state=active]:border-[#D4AF37]/40 data-[state=active]:bg-[#241e10] data-[state=active]:text-[#E8CF7A]"
                >
                  Перенос с референса
                </TabsTrigger>
              </TabsList>

              {/* Режим 1: промпт и палитра */}
              <TabsContent value="prompt" className="mt-4 space-y-4">
                <section className="rounded-2xl border border-[#D4AF37]/15 bg-[#141419]/90 p-4 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
                  <PhotoDropzone
                    title="Фото модели"
                    hint="лицо крупным планом, JPEG/PNG"
                    value={modelPhoto}
                    onChange={setModelPhoto}
                    onError={showError}
                  />
                </section>

                <section className="rounded-2xl border border-[#D4AF37]/15 bg-[#141419]/90 p-4 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
                  <h2 className="mb-1 font-serif text-base font-semibold tracking-wide text-[#E8CF7A]">
                    Палитра
                  </h2>
                  <p className="mb-3 text-xs text-muted-foreground">
                    Включите продукт и выберите оттенок — ИИ подберёт максимально близкий
                    вариант. Выключенные продукты остаются без макияжа.
                  </p>
                  <PalettePanel products={products} onPatch={patchProduct} />
                </section>

                <section className="rounded-2xl border border-[#D4AF37]/15 bg-[#141419]/90 p-4 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
                  <h2 className="mb-1 font-serif text-base font-semibold tracking-wide text-[#E8CF7A]">
                    Кисти и инструменты
                  </h2>
                  <p className="mb-3 text-xs text-muted-foreground">
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

                <section className="rounded-2xl border border-[#D4AF37]/15 bg-[#141419]/90 p-4 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
                  <h2 className="mb-3 font-serif text-base font-semibold tracking-wide text-[#E8CF7A]">
                    Промпт
                  </h2>
                  <Textarea
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    maxLength={800}
                    rows={3}
                    placeholder="Например: лёгкие смоки-айз в бронзовых тонах, акцент на глаза, нюдовые губы, сияющая кожа…"
                    className="resize-none border-[#D4AF37]/20 bg-[#101014] focus-visible:ring-[#D4AF37]/60"
                    aria-label="Описание образа"
                  />
                  <p className="mt-2 text-[11px] text-muted-foreground">
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
                <section className="rounded-2xl border border-[#D4AF37]/15 bg-[#141419]/90 p-4 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
                  <PhotoDropzone
                    title="Оригинал — фото клиента"
                    hint="чьё лицо будет в макияже"
                    value={modelPhoto}
                    onChange={setModelPhoto}
                    onError={showError}
                  />
                </section>

                <section className="rounded-2xl border border-[#D4AF37]/15 bg-[#141419]/90 p-4 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
                  <PhotoDropzone
                    title="Референс макияжа"
                    hint="образец: чей макияж переносим"
                    value={refPhoto}
                    onChange={setRefPhoto}
                    onError={showError}
                  />
                </section>

                <section className="rounded-2xl border border-[#D4AF37]/15 bg-[#141419]/90 p-4 shadow-[0_8px_30px_rgba(0,0,0,0.35)]">
                  <h2 className="mb-3 font-serif text-base font-semibold tracking-wide text-[#E8CF7A]">
                    Комментарий для ИИ
                  </h2>
                  <Textarea
                    value={refComment}
                    onChange={(e) => setRefComment(e.target.value)}
                    maxLength={800}
                    rows={3}
                    placeholder="Необязательно: например, «сделай губы чуть светлее, а стрелки — тоньше»"
                    className="resize-none border-[#D4AF37]/20 bg-[#101014] focus-visible:ring-[#D4AF37]/60"
                    aria-label="Комментарий к переносу"
                  />
                  <p className="mt-2 text-[11px] text-muted-foreground">
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
              onRegenerate={generate}
              onReset={resetResult}
            />
          </div>
        </div>
      </main>

      {/* Подвал */}
      <footer className="mt-auto border-t border-[#D4AF37]/15 py-4">
        <p className="text-center text-xs text-muted-foreground">
          GlamAI Studio · Виртуальная примерка макияжа · Фото обрабатываются в момент запроса
          и не сохраняются на сервере
        </p>
      </footer>
    </div>
  );
}
