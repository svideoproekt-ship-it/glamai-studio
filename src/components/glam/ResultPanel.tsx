"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Download, Info, Loader2, RefreshCw, RotateCcw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { BeforeAfterSlider } from "./BeforeAfterSlider";

const STATUSES = [
  "Изучаем черты лица…",
  "Подбираем оттенки…",
  "Наносим тени…",
  "Прорисовываем стрелки…",
  "Смешиваем текстуры…",
  "Финальный штрих…",
];

interface ResultPanelProps {
  loading: boolean;
  original: string | null;
  result: string | null;
  usedPrompt: string | null;
  usedDescription: string | null;
  /** Публичный API Z.AI: результат — портрет по описанию внешности, не правка фото */
  portraitMode?: boolean;
  onRegenerate: () => void;
  onReset: () => void;
}

export function ResultPanel({
  loading,
  original,
  result,
  usedPrompt,
  usedDescription,
  portraitMode,
  onRegenerate,
  onReset,
}: ResultPanelProps) {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!loading) return;
    setTick(0);
    const t = setInterval(() => setTick((x) => x + 1), 2800);
    return () => clearInterval(t);
  }, [loading]);

  if (loading) {
    const status = STATUSES[tick % STATUSES.length];
    return (
      <div
        aria-live="polite"
        className="shimmer mx-auto flex aspect-[3/4] w-full max-w-md flex-col items-center justify-center gap-4 rounded-2xl border border-[#D4AF37]/25 bg-[#141419]"
      >
        <div className="relative">
          <Sparkles className="absolute -right-3 -top-2 h-5 w-5 animate-pulse text-[#E8CF7A]" />
          <Loader2 className="h-11 w-11 animate-spin text-[#D4AF37]" />
        </div>
        <div className="text-center">
          <p className="font-serif text-lg text-[#E8CF7A]">{status}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Обычно занимает 20–60 секунд
          </p>
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="mx-auto flex aspect-[3/4] w-full max-w-md flex-col items-center justify-center gap-4 rounded-2xl border border-dashed border-[#D4AF37]/25 bg-[#101014]/60 px-6 text-center">
        <div className="rounded-full border border-[#D4AF37]/40 bg-[#1a1710] p-4">
          <Sparkles className="h-8 w-8 text-[#D4AF37]" />
        </div>
        <p className="font-serif text-xl text-foreground/90">Результат появится здесь</p>
        <ol className="space-y-1.5 text-xs text-muted-foreground">
          <li>1. Загрузите фото модели или клиента</li>
          <li>2. Соберите образ в палитре или с референсом</li>
          <li>3. Сравните «до и после» и сохраните</li>
        </ol>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {portraitMode && (
        <div className="mx-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-left">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-[11px] leading-relaxed text-amber-100/80">
            Режим портрета: тариф Z.AI на вашем сервере не поддерживает правку фотографии,
            поэтому образ создан как фотореалистичный портрет по описанию внешности с вашего
            фото. Лицо может немного отличаться от оригинала.
          </p>
        </div>
      )}
      <BeforeAfterSlider before={original ?? result} after={result} alt="Образ GlamAI" />

      <div className="flex flex-wrap items-center justify-center gap-2">
        <a
          href={result}
          download={`glamai-look-${Date.now()}.png`}
          aria-label="Скачать образ PNG"
        >
          <Button className="gold-btn h-10 font-semibold">
            <Download className="h-4 w-4" />
            Скачать образ
          </Button>
        </a>
        <Button
          variant="outline"
          className="border-[#D4AF37]/40 bg-transparent hover:bg-[#241e10] hover:text-[#E8CF7A]"
          onClick={onRegenerate}
        >
          <RefreshCw className="h-4 w-4" />
          Ещё вариант
        </Button>
        <Button
          variant="ghost"
          className="text-muted-foreground hover:text-foreground"
          onClick={onReset}
        >
          <RotateCcw className="h-4 w-4" />
          Новый образ
        </Button>
      </div>

      {usedDescription && (
        <Collapsible className="mx-auto w-full max-w-md">
          <CollapsibleTrigger className="group mx-auto flex h-8 items-center gap-1.5 rounded-md px-3 text-xs text-muted-foreground transition-colors hover:text-[#E8CF7A]">
            Что ИИ увидел на референсе
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="custom-scroll mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-[#101014] p-3 text-left text-[11px] leading-relaxed text-muted-foreground">
              {usedDescription}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}

      {usedPrompt && (
        <Collapsible className="mx-auto w-full max-w-md">
          <CollapsibleTrigger className="group mx-auto flex h-8 items-center gap-1.5 rounded-md px-3 text-xs text-muted-foreground transition-colors hover:text-[#E8CF7A]">
            Использованный промпт
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="custom-scroll mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg border border-border/60 bg-[#101014] p-3 text-left text-[11px] leading-relaxed text-muted-foreground">
              {usedPrompt}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
