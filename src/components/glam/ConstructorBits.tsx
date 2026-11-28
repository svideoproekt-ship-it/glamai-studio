"use client";

// Общие детали конструктора v36: чипы выбора, палитра оттенков, плотность,
// финиш и раскрывающаяся панель «Инструменты». Используется в блоках
// «Лицо» (FacePanel) и «Глаза» (EyePanel).

import {
  Brush,
  ChevronDown,
  Droplets,
  Paintbrush,
  Pencil,
  Plus,
  Sparkles,
  Wind,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import {
  BRUSHES,
  type FinishId,
  type FinishOption,
  type Swatch,
} from "@/lib/makeup";
import {
  brushHint,
  brushLabel,
  customShadeLabel,
  finishLabel,
  intensityLabel,
  swatchName,
} from "@/lib/i18n";
import { useLang } from "./AuthGate";

const TOOL_ICONS: Record<string, LucideIcon> = {
  fluffy: Brush,
  flat: Paintbrush,
  sponge: Droplets,
  pencil: Pencil,
  fan: Wind,
  spoolie: Sparkles,
};

/** Цветная подсветка активных инструментов (без тревожного красного) */
const TOOL_COLORS: Record<string, string> = {
  fluffy: "#4E7D6B",
  flat: "#FF7A59",
  sponge: "#B76E79",
  pencil: "#7FA8C9",
  fan: "#A8C686",
  spoolie: "#F6B93B",
};

/** Кнопка-чип: вариант области, плотность, финиш */
export function OptionChip({
  active,
  onClick,
  children,
  title,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "h-12 rounded-full border px-4 text-xl font-semibold transition-all active:scale-95",
        active
          ? "border-transparent bg-gradient-to-r from-[#D4A437] to-[#F6B93B] text-[#043E21] shadow-md shadow-[#032916]/40"
          : "border-[#6F4E37]/30 bg-white/90 text-[#6F4E37] hover:border-[#6F4E37]/60 hover:bg-white"
      )}
    >
      {children}
    </button>
  );
}

/** Палитра оттенков + «свой оттенок» (пипетка) */
export function SwatchPicker({
  swatches,
  color,
  accent,
  onChange,
  label,
}: {
  swatches: Swatch[];
  color: string;
  accent: string;
  onChange: (hex: string) => void;
  label: string;
}) {
  const { lang } = useLang();
  const selected = swatches.find((s) => s.hex.toLowerCase() === color.toLowerCase());
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {swatches.map((s) => {
        const isSel = s.hex.toLowerCase() === color.toLowerCase();
        return (
          <button
            key={`${s.hex}${isSel ? "-sel" : ""}`}
            type="button"
            title={swatchName(lang, s)}
            aria-label={`${label}: ${swatchName(lang, s)}`}
            onClick={() => onChange(s.hex)}
            className={cn(
              "h-9 w-9 rounded-full border border-white/50 transition-transform duration-150 hover:scale-115 active:scale-90",
              isSel && "swatch-pop scale-110"
            )}
            style={{
              backgroundColor: s.hex,
              ...(isSel ? { boxShadow: `0 0 0 2px #fff, 0 0 0 4.5px ${accent}` } : {}),
            }}
          />
        );
      })}
      <label
        className="relative ml-1 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-dashed transition-colors hover:scale-110"
        style={{ borderColor: `${accent}99` }}
        title={customShadeLabel(lang)}
      >
        <input
          type="color"
          value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : accent}
          onChange={(e) => onChange(e.target.value)}
          className="color-chip absolute inset-0 h-full w-full rounded-full opacity-0"
          aria-label={`${customShadeLabel(lang)}: ${label}`}
        />
        <Plus
          className="pointer-events-none h-5 w-5 transition-transform duration-300 hover:rotate-90"
          style={{ color: accent }}
        />
      </label>
      <span className="ml-auto text-sm text-[#6F4E37]/70">
        {selected ? swatchName(lang, selected) : customShadeLabel(lang)}
      </span>
    </div>
  );
}

/** Плотность нанесения: лёгкий / средний / яркий */
export function IntensityChips({
  value,
  onChange,
}: {
  value: 1 | 2 | 3;
  onChange: (v: 1 | 2 | 3) => void;
}) {
  const { lang } = useLang();
  return (
    <div className="flex flex-wrap gap-1.5">
      {([1, 2, 3] as const).map((i) => (
        <OptionChip
          key={i}
          active={value === i}
          onClick={() => onChange(i)}
          testId={`intensity-${i}`}
        >
          {intensityLabel(lang, i)}
        </OptionChip>
      ))}
    </div>
  );
}

/** Финиш: матовый / сатиновый / глянцевый / мерцающий — у кого есть */
export function FinishChips({
  finishes,
  value,
  onChange,
}: {
  finishes: FinishOption[];
  value?: FinishId;
  onChange: (f: FinishId) => void;
}) {
  const { lang } = useLang();
  if (!finishes.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {finishes.map((f) => (
        <OptionChip key={f.id} active={value === f.id} onClick={() => onChange(f.id)}>
          {finishLabel(lang, f.id)}
        </OptionChip>
      ))}
    </div>
  );
}

/** Раскрывающаяся панель «Инструменты»: мультивыбор кистей/спонжа */
export function ToolPicker({
  toolIds,
  selected,
  onToggle,
  title,
  testId,
}: {
  toolIds: string[];
  selected: string[];
  onToggle: (id: string) => void;
  title: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const { lang } = useLang();
  const activeCount = toolIds.filter((id) => selected.includes(id)).length;
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-xl border border-[#E9DCC3] bg-[#F8F1E1]"
    >
      <CollapsibleTrigger
        data-testid={testId}
        className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-xl font-semibold text-[#6F4E37]/85 transition-colors hover:text-[#6F4E37]"
      >
        <Wrench className="h-5 w-5 shrink-0" aria-hidden />
        <span className="flex-1 leading-tight">{title}</span>
        {activeCount > 0 && (
          <span className="rounded-full bg-[#D4A437]/20 px-2.5 py-0.5 text-sm font-bold text-[#8A6414]">
            {activeCount}
          </span>
        )}
        <ChevronDown
          className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="flex flex-wrap gap-1.5 px-4 pb-3">
          {toolIds.map((id) => {
            const def = BRUSHES.find((b) => b.id === id);
            if (!def) return null;
            const Icon = TOOL_ICONS[id] ?? Brush;
            const active = selected.includes(id);
            const color = TOOL_COLORS[id] ?? "#B98A2E";
            return (
              <button
                key={id}
                type="button"
                onClick={() => onToggle(id)}
                aria-pressed={active}
                title={brushHint(lang, id)}
                className={cn(
                  "flex h-11 items-center gap-2 rounded-full border px-4 text-lg font-semibold transition-all active:scale-95",
                  active
                    ? "border-transparent text-[#6F4E37] shadow-sm"
                    : "border-[#6F4E37]/30 bg-white/70 text-[#6F4E37]/80 hover:bg-white"
                )}
                style={
                  active
                    ? {
                        background: `linear-gradient(100deg, ${color}30, #F8F1E1 62%)`,
                        borderColor: `${color}66`,
                      }
                    : {}
                }
              >
                <Icon
                  className="h-4 w-4 shrink-0"
                  style={active ? { color } : undefined}
                  aria-hidden
                />
                {brushLabel(lang, id)}
              </button>
            );
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
