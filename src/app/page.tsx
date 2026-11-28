"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, LogOut, MessageCircle, Send, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/hooks/use-toast";
import { PhotoDropzone, type PhotoValue } from "@/components/glam/PhotoDropzone";
import { StylePanel } from "@/components/glam/StylePanel";
import { FacePanel } from "@/components/glam/FacePanel";
import { EyePanel } from "@/components/glam/EyePanel";
import { ResultPanel } from "@/components/glam/ResultPanel";
import {
  defaultEyes,
  defaultFace,
  type EyeAreaId,
  type EyeAreaState,
  type FaceProductId,
  type ProductState,
} from "@/lib/makeup";
import AuthGate, { openTelegramChat, useAuth, useLang } from "@/components/glam/AuthGate";
import { genCount, planTitle, t } from "@/lib/i18n";
import { STARS_FIVE74 } from "@/lib/tariffs";
import { LangPicker } from "@/components/glam/AuthGate";

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
        className="blob absolute -left-24 -top-24 h-[420px] w-[420px] rounded-full bg-[#B9F6CF]/10 blur-3xl"
        style={{ animationDuration: "22s" }}
      />
      <div
        className="blob absolute -right-32 top-1/4 h-[460px] w-[460px] rounded-full bg-[#E9C46A]/10 blur-3xl"
        style={{ animationDuration: "27s", animationDelay: "-7s" }}
      />
      <div
        className="blob absolute -bottom-36 left-1/4 h-[420px] w-[420px] rounded-full bg-[#F6B93B]/10 blur-3xl"
        style={{ animationDuration: "24s", animationDelay: "-13s" }}
      />
      <div
        className="blob absolute bottom-1/3 right-1/3 h-[300px] w-[300px] rounded-full bg-white/8 blur-3xl"
        style={{ animationDuration: "20s", animationDelay: "-4s" }}
      />
    </div>
  );
}

const MONTH_LOCALE: Record<string, string> = { ru: "ru-RU", en: "en-US", de: "de-DE", fr: "fr-FR" };

function fmtUntil(iso: string | null, lang: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(MONTH_LOCALE[lang] ?? "ru-RU", {
    day: "numeric",
    month: "short",
  });
}

/** Заголовок секции с цветным маркером */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-1 flex items-center gap-2 font-serif text-xl font-bold tracking-wide text-[#F8F1E1]">
      <span
        aria-hidden
        className="inline-block h-5 w-1.5 rounded-full bg-gradient-to-b from-[#B98A2E] via-[#D4A437] to-[#F6B93B]"
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
  const { profile, refresh, openPaywall, ownerTg, maxLink } = useAuth();
  const { lang } = useLang();
  const [mode, setMode] = useState<Mode>("prompt");
  const [modelPhoto, setModelPhoto] = useState<PhotoValue | null>(null);
  const [refPhoto, setRefPhoto] = useState<PhotoValue | null>(null);
  // Конструктор v36: три блока — «Стиль, образ» → «Лицо» → «Глаза»
  const [style, setStyle] = useState(2);
  const [face, setFace] = useState<Record<FaceProductId, ProductState>>(defaultFace);
  const [eyes, setEyes] = useState<Record<EyeAreaId, EyeAreaState>>(defaultEyes);
  const [faceTools, setFaceTools] = useState<string[]>(["sponge"]);
  const [eyeTools, setEyeTools] = useState<string[]>(["fluffy"]);
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
        setConfigIssue(failed.map((c) => c.hint).join(" ") || t("ru", "err.service"));
      })
      .catch(() => {
        // сервер недоступен — покажем ошибку при попытке генерации
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const patchFace = useCallback((id: FaceProductId, patch: Partial<ProductState>) => {
    setFace((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const patchEyes = useCallback((id: EyeAreaId, patch: Partial<EyeAreaState>) => {
    setEyes((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  const toggleFaceTool = useCallback((id: string) => {
    setFaceTools((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]
    );
  }, []);

  const toggleEyeTool = useCallback((id: string) => {
    setEyeTools((prev) =>
      prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]
    );
  }, []);

  const showError = useCallback(
    (message: string) => {
      toast({ title: t(lang, "toast.failTitle"), description: message, variant: "destructive" });
    },
    [lang]
  );

  const generate = useCallback(async () => {
    if (loading) return;

    if (!modelPhoto) {
      showError(
        mode === "reference" ? t(lang, "err.noModelRef") : t(lang, "err.noModelPrompt")
      );
      return;
    }
    if (mode === "reference" && !refPhoto) {
      showError(t(lang, "err.noRef"));
      return;
    }
    if (mode === "prompt") {
      const anyEnabled =
        Object.values(face).some((p) => p.enabled) ||
        Object.values(eyes).some((e) => e.enabled);
      if (!anyEnabled && !promptText.trim()) {
        showError(t(lang, "err.noSelection"));
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
          style,
          face,
          eyes,
          faceTools,
          eyeTools,
          fastMode,
          userPrompt: mode === "prompt" ? promptText : refComment,
        }),
      });

      // Лимит исчерпан — сервер возвращает 402 с paywall: открываем окно тарифов
      if (res.status === 402) {
        try {
          const pay = (await res.json()) as {
            error?: string;
            allowance?: { reason?: string };
          };
          const key = pay.allowance?.reason === "quota_exhausted" ? "pw.paywallQuota" : "pw.paywallTrial";
          openPaywall({ message: t(lang, key) });
        } catch {
          openPaywall({});
        }
        void refresh();
        return;
      }
      if (res.status === 401) {
        throw new Error(t(lang, "err.session"));
      }

      // Платформа может вернуть не JSON (HTML-страницу ошибки Vercel/прокси) —
      // тогда парсинг падает с криптичной ошибкой. Ловим и объясняем по-русски.
      const rawText = await res.text();
      let data: TryonResponse;
      try {
        data = JSON.parse(rawText) as TryonResponse;
      } catch {
        if (res.status === 502 || res.status === 503 || res.status === 504) {
          throw new Error(t(lang, "err.timeout"));
        }
        if (res.status === 413) {
          throw new Error(t(lang, "err.tooLarge"));
        }
        throw new Error(t(lang, "err.http", { code: res.status }));
      }
      if (!res.ok || !data.success || !data.image) {
        throw new Error(data.error || t(lang, "err.service"));
      }

      setResult(data.image);
      setUsedPrompt(data.prompt ?? null);
      setUsedDescription(data.description ?? null);
      setPortraitMode(data.pipeline === "portrait");
      toast({ title: t(lang, "toast.readyTitle"), description: t(lang, "toast.readyDesc") });
      void refresh(); // обновляем счётчик оставшихся генераций
    } catch (e) {
      showError(e instanceof Error ? e.message : t(lang, "err.unknown"));
    } finally {
      setLoading(false);
    }
  }, [
    loading,
    mode,
    modelPhoto,
    refPhoto,
    style,
    face,
    eyes,
    faceTools,
    eyeTools,
    promptText,
    refComment,
    showError,
    openPaywall,
    refresh,
    lang,
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
        aria-label={t(lang, "gen.fastModeAria")}
      />
      <span>{t(lang, "gen.fastMode")}</span>
    </label>
  );

  const generateButton = (
    <Button className="glam-btn h-12 w-full text-lg font-bold" onClick={generate} disabled={loading}>
      {loading ? (
        <>
          <Loader2 className="h-5 w-5 animate-spin" />
          {t(lang, "gen.loading")}
        </>
      ) : (
        <>
          <Sparkles className="h-5 w-5" />
          {t(lang, "gen.btn")}
        </>
      )}
    </Button>
  );

  return (
    <div className="flex min-h-screen flex-col">
      <BackgroundDecor />

      {/* Шапка */}
      <header className="sticky top-0 z-40 bg-[#032B16]/90 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="rounded-2xl bg-gradient-to-br from-[#B98A2E] via-[#D4A437] to-[#F6B93B] p-2 shadow-lg shadow-[#D4A437]/30">
                <Sparkles className="h-5 w-5 text-white" aria-hidden />
              </div>
              <Sparkles
                aria-hidden
                className="twinkle absolute -right-2 -top-2 h-3.5 w-3.5 text-[#F6B93B]"
                style={{ animationDuration: "2.2s" }}
              />
              <Sparkles
                aria-hidden
                className="twinkle absolute -bottom-1.5 -left-2 h-2.5 w-2.5 text-[#E9C46A]"
                style={{ animationDuration: "3s", animationDelay: "-1.2s" }}
              />
            </div>
            <div>
              <p className="font-serif text-lg font-semibold leading-none tracking-wide sm:text-xl">
                <span className="brand-text">GlamAI Studio</span>
              </p>
              <p className="mt-1 hidden text-[11px] text-muted-foreground sm:block">
                {t(lang, "app.tagline")}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-[#F8F1E1]/35 bg-white/10 px-3 py-1 text-[11px] text-[#F8F1E1] lg:inline-block">
              {t(lang, "app.privacyChip")}
            </span>
            {profile && (
              <span
                className="shrink-0 whitespace-nowrap rounded-full border border-[#F6B93B]/45 bg-[#D4A437]/15 px-3 py-1 text-[11px] font-semibold text-[#F8F1E1]"
                data-testid="quota-chip"
              >
                {profile.subscriptionActive
                  ? `${planTitle(lang, profile.plan)} · ${t(lang, "app.until", { d: fmtUntil(profile.subscriptionUntil, lang) })}`
                  : t(lang, "app.trialChip", { n: profile.remaining, t: profile.total })}
              </span>
            )}
            <button
              type="button"
              onClick={() => void logout()}
              title={t(lang, "app.logout")}
              aria-label={t(lang, "app.logout")}
              className="rounded-full border border-[#F8F1E1]/35 bg-white/10 p-1.5 text-[#F8F1E1] transition-colors hover:bg-white/20"
            >
              <LogOut className="h-3.5 w-3.5" aria-hidden />
            </button>
            <LangPicker compact />
          </div>
        </div>
        {/* Шампань-линия под шапкой */}
        <div aria-hidden className="rainbow-line h-[2px] w-full opacity-70" />
      </header>

      {/* Баннер диагностики: показывается, только если конфиг ИИ не настроен */}
      {configIssue && (
        <div className="border-b border-[#F6B93B]/40 bg-[#2E2210]/95 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl items-start gap-3 px-4 py-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#F6B93B]" />
            <div className="text-sm text-[#F3E2B9]">
              <p className="font-semibold">{t(lang, "err.configBanner")}</p>
              <p className="mt-1 text-[#E3D0A6]">{configIssue}</p>
              <p className="mt-1 text-[#E3D0A6]">{t(lang, "err.diag")}</p>
            </div>
            <button
              type="button"
              onClick={() => setConfigIssue(null)}
              className="ml-auto shrink-0 rounded-md px-2 py-1 text-xs text-[#D9C48F] hover:text-[#F8F1E1]"
            >
              {t(lang, "err.hide")}
            </button>
          </div>
        </div>
      )}

      {/* Рабочая область */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {/* v41: студия-источник — приветствие и быстрый доступ к записи */}
        {profile?.studio && (
          <div
            className="mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-2xl border border-[#F6B93B]/45 bg-[#06301B]/60 px-4 py-3 text-sm text-[#F8F1E1]"
            data-testid="studio-strip"
          >
            <Sparkles className="h-4 w-4 shrink-0 text-[#F6B93B]" aria-hidden />
            <p className="min-w-0 flex-1">
              {t(lang, "strip.invited", { name: profile.studio.name })}
            </p>
            {profile.studio.bookingUrl && (
              <a
                href={profile.studio.bookingUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0"
              >
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 border-[#F6B93B]/50 text-[#F8F1E1] hover:bg-white/10"
                  data-testid="studio-book-strip"
                >
                  {t(lang, "strip.book")}
                </Button>
              </a>
            )}
          </div>
        )}
        {/* Остаток бесплатных генераций — крупно, видно на любом экране */}
        {profile && !profile.subscriptionActive && (
          <div
            className="mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-2 rounded-2xl border border-[#F8F1E1]/15 bg-[#032B16]/75 px-4 py-3 text-sm text-[#F8F1E1]"
            data-testid="trial-banner"
          >
            <Sparkles className="h-4 w-4 shrink-0 text-[#F6B93B]" aria-hidden />
            <p className="min-w-0 flex-1">
              {profile.remaining > 0
                ? t(lang, "banner.free", { n: profile.remaining, t: profile.total }) +
                  t(lang, "banner.hasLeft", { stars: STARS_FIVE74 })
                : t(lang, "banner.free", { n: profile.remaining, t: profile.total }) +
                  t(lang, "banner.expired")}
            </p>
            {profile.remaining === 0 && profile.studio?.bookingUrl && (
              <a
                href={profile.studio.bookingUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0"
              >
                <Button
                  size="sm"
                  className="glam-btn shrink-0 font-bold"
                  data-testid="studio-book-banner"
                >
                  <Sparkles className="h-4 w-4" aria-hidden />
                  {t(lang, "banner.bookIn", { name: profile.studio.name })}
                </Button>
              </a>
            )}
            {profile.remaining === 0 && (
              <Button
                size="sm"
                variant={profile.studio?.bookingUrl ? "outline" : "default"}
                onClick={() => openPaywall()}
                className={
                  profile.studio?.bookingUrl
                    ? "shrink-0 border-[#F8F1E1]/30 text-[#F8F1E1] hover:bg-white/10"
                    : "glam-btn shrink-0 font-bold"
                }
                data-testid="open-paywall"
              >
                <Sparkles className="h-4 w-4" aria-hidden />
                {t(lang, "banner.choose")}
              </Button>
            )}
          </div>
        )}
        <div className="grid items-start gap-6 lg:grid-cols-[430px_1fr]">
          {/* Левая колонка — настройки */}
          <div>
            <Tabs value={mode} onValueChange={(v) => setMode(v as Mode)} className="w-full">
              <TabsList className="grid h-14 w-full grid-cols-2 rounded-full border border-[#F8F1E1]/20 bg-[#032B16]/85 p-1.5 shadow-sm">
                <TabsTrigger
                  value="prompt"
                  className="rounded-full text-base font-semibold transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#D4A437] data-[state=active]:to-[#F6B93B] data-[state=active]:text-[#043E21] data-[state=active]:shadow-md"
                >
                  {t(lang, "tab.prompt")}
                </TabsTrigger>
                <TabsTrigger
                  value="reference"
                  className="rounded-full text-base font-semibold transition-all data-[state=active]:bg-gradient-to-r data-[state=active]:from-[#D4A437] data-[state=active]:to-[#F6B93B] data-[state=active]:text-[#043E21] data-[state=active]:shadow-md"
                >
                  {t(lang, "tab.reference")}
                </TabsTrigger>
              </TabsList>

              {/* Режим 1: промпт и палитра */}
              <TabsContent value="prompt" className="mt-4 space-y-4">
                <section className="green-card pop-in rounded-2xl p-4">
                  <PhotoDropzone
                    title={t(lang, "dz.model.title")}
                    hint={t(lang, "dz.model.hint")}
                    value={modelPhoto}
                    onChange={setModelPhoto}
                    onError={showError}
                  />
                </section>

                {/* БЛОК 1 «Стиль, образ» — сразу после фото клиента */}
                <section
                  className="green-card pop-in rounded-2xl p-4"
                  style={{ animationDelay: "45ms" }}
                >
                  <SectionTitle>{t(lang, "sec.style")}</SectionTitle>
                  <p className="mb-3 text-sm text-muted-foreground">
                    {t(lang, "sec.styleHint")}
                  </p>
                  <StylePanel style={style} onChange={setStyle} />
                </section>

                {/* БЛОК 2 «Лицо» */}
                <section
                  className="green-card pop-in rounded-2xl p-4"
                  style={{ animationDelay: "90ms" }}
                >
                  <SectionTitle>{t(lang, "sec.face")}</SectionTitle>
                  <p className="mb-3 text-sm text-muted-foreground">
                    {t(lang, "sec.faceHint")}
                  </p>
                  <FacePanel
                    face={face}
                    onPatch={patchFace}
                    tools={faceTools}
                    onToggleTool={toggleFaceTool}
                  />
                </section>

                {/* БЛОК 3 «Глаза» */}
                <section
                  className="green-card pop-in rounded-2xl p-4"
                  style={{ animationDelay: "135ms" }}
                >
                  <SectionTitle>{t(lang, "sec.eyes")}</SectionTitle>
                  <p className="mb-3 text-sm text-muted-foreground">
                    {t(lang, "sec.eyesHint")}
                  </p>
                  <EyePanel
                    eyes={eyes}
                    onPatch={patchEyes}
                    tools={eyeTools}
                    onToggleTool={toggleEyeTool}
                  />
                </section>

                <section
                  className="green-card pop-in rounded-2xl p-4"
                  style={{ animationDelay: "180ms" }}
                >
                  <SectionTitle>{t(lang, "sec.prompt")}</SectionTitle>
                  <Textarea
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    maxLength={800}
                    rows={3}
                    placeholder={t(lang, "prompt.placeholder")}
                    className="resize-none border-[#6F4E37]/35 bg-[#F8F1E1]/95 text-base text-[#6F4E37] placeholder:text-[#6F4E37]/55 focus-visible:ring-[#F6B93B]/60"
                    aria-label={t(lang, "sec.prompt")}
                  />
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t(lang, "prompt.hint")}
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
                    title={t(lang, "dz.original.title")}
                    hint={t(lang, "dz.original.hint")}
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
                    title={t(lang, "dz.reference.title")}
                    hint={t(lang, "dz.reference.hint")}
                    value={refPhoto}
                    onChange={setRefPhoto}
                    onError={showError}
                  />
                </section>

                <section
                  className="green-card pop-in rounded-2xl p-4"
                  style={{ animationDelay: "180ms" }}
                >
                  <SectionTitle>{t(lang, "sec.comment")}</SectionTitle>
                  <Textarea
                    value={refComment}
                    onChange={(e) => setRefComment(e.target.value)}
                    maxLength={800}
                    rows={3}
                    placeholder={t(lang, "comment.placeholder")}
                    className="resize-none border-[#6F4E37]/35 bg-[#F8F1E1]/95 text-base text-[#6F4E37] placeholder:text-[#6F4E37]/55 focus-visible:ring-[#F6B93B]/60"
                    aria-label={t(lang, "sec.comment")}
                  />
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t(lang, "comment.hint")}
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
              maxLink={maxLink}
              onReset={resetResult}
            />
          </div>
        </div>
      </main>

      {/* Подвал */}
      <footer className="mt-auto border-t border-[#F8F1E1]/20 py-4">
        {/* Подвал — только связь с владельцем («написать сообщение»). Передача
            фото клиенту живёт в панели результата (кнопка «Передать фото
            клиенту») — ссылка в подвале не может вложить файл в чат, поэтому
            дубль здесь только вводил в заблуждение. */}
        {(ownerTg || maxLink) && (
          <div
            className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-center gap-2 px-4"
            data-testid="contacts-strip"
          >
            <p className="text-sm text-muted-foreground">{t(lang, "footer.contact")}</p>
            {ownerTg && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 border-[#F8F1E1]/30 text-[#F8F1E1] hover:bg-white/10"
                onClick={() =>
                  openTelegramChat(`https://t.me/${ownerTg.replace(/^@/, "")}`)
                }
                data-testid="contact-telegram"
              >
                <Send className="h-3.5 w-3.5" aria-hidden />
                Telegram
              </Button>
            )}
            {maxLink && (
              <a href={maxLink} target="_blank" rel="noreferrer" data-testid="contact-max">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 border-[#F8F1E1]/30 text-[#F8F1E1] hover:bg-white/10"
                >
                  <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                  MAX
                </Button>
              </a>
            )}
          </div>
        )}
        <p className="mt-3 text-center text-sm text-muted-foreground">
          {t(lang, "footer.legal")}
        </p>
      </footer>
    </div>
  );
}
