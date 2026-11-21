"use client";

// БЛОК 3 «Глаза»: ресницы (форма стрелок + тушь), брови (форма), веки
// (техника нанесения) — у каждой области свой список вариантов, своя палитра
// и плотность. Здесь же «Инструменты» — кисти для работы с глазами.

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  EYE_AREA_IDS,
  EYE_OPTION_CATALOGS,
  EYE_TOOLS,
  PRODUCTS,
  type EyeAreaId,
  type EyeAreaState,
  type ProductId,
} from "@/lib/makeup";
import { FinishChips, IntensityChips, OptionChip, SwatchPicker, ToolPicker } from "./ConstructorBits";

/** Метаданные области: подпись, акцент, палитра какого продукта использовать */
const AREA_META: Record<
  EyeAreaId,
  { label: string; desc: string; accent: string; palette: ProductId; withFinish: boolean }
> = {
  lashes: { label: "Ресницы", desc: "стрелки и тушь", accent: "#7FA8C9", palette: "eyeliner", withFinish: false },
  brows: { label: "Брови", desc: "форма и оттенок", accent: "#A9714B", palette: "brows", withFinish: false },
  lids: { label: "Веки", desc: "техника теней и оттенок", accent: "#B76E79", palette: "eyeshadow", withFinish: true },
};

interface EyePanelProps {
  eyes: Record<EyeAreaId, EyeAreaState>;
  onPatch: (id: EyeAreaId, patch: Partial<EyeAreaState>) => void;
  tools: string[];
  onToggleTool: (id: string) => void;
}

export function EyePanel({ eyes, onPatch, tools, onToggleTool }: EyePanelProps) {
  return (
    <div className="space-y-3">
      {EYE_AREA_IDS.map((id) => {
        const meta = AREA_META[id];
        const def = PRODUCTS.find((p) => p.id === meta.palette);
        const state = eyes[id];
        const options = EYE_OPTION_CATALOGS[id];
        if (!def) return null;
        return (
          <div
            key={id}
            className={cn(
              "pop-in rounded-xl border p-3 transition-all duration-300",
              !state.enabled && "border-[#E9DCC3] bg-[#F8F1E1]"
            )}
            data-testid={`eye-${id}`}
            style={{
              ...(state.enabled
                ? {
                    borderColor: `${meta.accent}88`,
                    background: `linear-gradient(100deg, ${meta.accent}30, #F8F1E1 58%)`,
                    boxShadow: `0 4px 18px ${meta.accent}33`,
                  }
                : {}),
            }}
          >
            <div className="flex items-center gap-3">
              <span
                key={state.enabled ? state.color : "off"}
                aria-hidden
                className={cn(
                  "h-10 w-10 shrink-0 rounded-full border border-white/60 shadow-inner transition-transform",
                  state.enabled && "swatch-pop scale-110"
                )}
                style={{
                  backgroundColor: state.color,
                  ...(state.enabled
                    ? { boxShadow: `0 0 0 3px ${meta.accent}2e, inset 0 1px 3px rgba(255,255,255,0.4)` }
                    : {}),
                }}
              />
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "text-[28px] font-bold leading-tight",
                    state.enabled ? "text-[#6F4E37]" : "text-[#6F4E37]/80"
                  )}
                >
                  {meta.label}
                </div>
                <div
                  className={cn(
                    "truncate text-sm",
                    state.enabled ? "text-[#6F4E37]/75" : "text-[#6F4E37]/60"
                  )}
                >
                  {meta.desc}
                </div>
              </div>
              <Switch
                checked={state.enabled}
                onCheckedChange={(checked) => onPatch(id, { enabled: checked })}
                aria-label={`Включить: ${meta.label}`}
              />
            </div>

            {state.enabled && (
              <div
                className="pop-in mt-3 space-y-2.5 pt-3"
                style={{ borderTop: `1px solid ${meta.accent}30` }}
              >
                <div>
                  <p className="mb-1.5 text-sm text-[#6F4E37]/70">
                    {id === "lashes" ? "Форма стрелок" : id === "brows" ? "Форма бровей" : "Техника нанесения"}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {options.map((o) => (
                      <OptionChip
                        key={o.id}
                        active={state.option === o.id}
                        onClick={() => onPatch(id, { option: o.id })}
                        title={o.label}
                        testId={`eye-${id}-option-${o.id}`}
                      >
                        {o.label}
                      </OptionChip>
                    ))}
                  </div>
                </div>
                <SwatchPicker
                  swatches={def.swatches}
                  color={state.color}
                  accent={meta.accent}
                  onChange={(hex) => onPatch(id, { color: hex })}
                  label={meta.label}
                />
                <IntensityChips
                  value={state.intensity}
                  onChange={(v) => onPatch(id, { intensity: v })}
                />
                {meta.withFinish && (
                  <FinishChips
                    finishes={def.finishes ?? []}
                    value={state.finish}
                    onChange={(f) => onPatch(id, { finish: f })}
                  />
                )}
              </div>
            )}
          </div>
        );
      })}

      <ToolPicker
        toolIds={EYE_TOOLS}
        selected={tools}
        onToggle={onToggleTool}
        title="Инструменты"
        testId="eye-tools"
      />
    </div>
  );
}
