"use client";

import { useEffect, useState } from "react";
import { ChevronDown, Download, Info, RotateCcw, Sparkles } from "lucide-react";
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

const DOT_COLORS = ["#008B8B", "#16B8A6", "#F6B93B"];

interface ResultPanelProps {
  loading: boolean;
  original: string | null;
  result: string | null;
  usedPrompt: string | null;
  usedDescription: string | null;
  /** Публичный API Z.AI: результат — портрет по описанию внешности, не правка фото */
  portraitMode?: boolean;
  onReset: () => void;
}

export function ResultPanel({
  loading,
  original,
  result,
  usedPrompt,
  usedDescription,
  portraitMode,
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
          className="twinkle absolute right-8 top-10 h-3 w-3 text-[#9B6EF3]"
          style={{ animationDuration: "2.9s", animationDelay: "-0.9s" }}
        />
        <Sparkles
          aria-hidden
          className="twinkle absolute bottom-8 left-10 h-3 w-3 text-[#008B8B]"
          style={{ animationDuration: "2.5s", animationDelay: "-1.6s" }}
        />
        <Sparkles
          aria-hidden
          className="twinkle absolute bottom-14 right-6 h-4 w-4 text-[#8CE99A]"
          style={{ animationDuration: "3.3s", animationDelay: "-0.4s" }}
        />

        {/* Радужное коническое кольцо */}
        <div className="relative h-16 w-16">
          <div className="conic-loader absolute inset-0 rounded-full" />
          <div className="absolute inset-0 flex items-center justify-center">
            <Sparkles className="float-y h-6 w-6 text-[#008B8B]" />
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

  if (!result) {
    return (
      <div className="green-window mx-auto flex aspect-[3/4] w-full max-w-md flex-col items-center justify-center gap-4 rounded-2xl px-6 text-center">
        <div className="float-y rounded-full bg-gradient-to-br from-[#8CE99A]/25 via-[#16B8A6]/20 to-[#9B6EF3]/20 p-4 shadow-inner">
          <Sparkles className="h-8 w-8 text-[#8CE99A]" />
        </div>
        <p className="font-serif text-2xl text-[#F8F1E1]">Результат появится здесь</p>
        <ol className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#8CE99A]/25 text-xs font-bold text-[#DFF7E6]">
              1
            </span>
            Загрузите фото модели или клиента
          </li>
          <li className="flex items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#9B6EF3]/25 text-xs font-bold text-[#D9CCFF]">
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
      {portraitMode && (
        <div className="mx-auto flex w-full max-w-md items-start gap-2.5 rounded-xl border border-amber-300/70 bg-amber-50 p-3 text-left">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-[11px] leading-relaxed text-amber-800">
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
          <Button className="glam-btn h-10 font-semibold">
            <Download className="h-4 w-4" />
            Скачать образ
          </Button>
        </a>
        <Button
          variant="ghost"
          className="text-muted-foreground hover:text-white"
          onClick={onReset}
        >
          <RotateCcw className="h-4 w-4" />
          Новый образ
        </Button>
      </div>

      {usedDescription && (
        <Collapsible className="mx-auto w-full max-w-md">
          <CollapsibleTrigger className="group mx-auto flex h-8 items-center gap-1.5 rounded-md px-3 text-xs text-muted-foreground transition-colors hover:text-[#F8F1E1]">
            Что ИИ увидел на референсе
            <ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="custom-scroll mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[#C9EED8]/25 bg-[#043E21]/80 p-3 text-left text-[11px] leading-relaxed text-[#CFEEDB]">
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
            <pre className="custom-scroll mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg border border-[#C9EED8]/25 bg-[#043E21]/80 p-3 text-left text-[11px] leading-relaxed text-[#CFEEDB]">
              {usedPrompt}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
