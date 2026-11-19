"use client";

// БЛОК 2 «Лицо»: помада, румяна, скульптор, хайлайтер — у каждого продукта
// своя палитра оттенков, плотность и финиш. Здесь же кнопка «Инструменты» —
// именно те, которые используются при работе с лицом.

import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  FACE_PRODUCT_IDS,
  FACE_TOOLS,
  PRODUCTS,
  type FaceProductId,
  type ProductState,
} from "@/lib/makeup";
import { FinishChips, IntensityChips, SwatchPicker, ToolPicker } from "./ConstructorBits";

/** Акцентный цвет каждого продукта — у каждого своя «упаковка» (без тревожного красного) */
const PRODUCT_ACCENTS: Record<string, string> = {
  lips: "#8CE99A",
  blush: "#FFB4A2",
  contour: "#C08552",
  highlighter: "#F6C445",
};

interface FacePanelProps {
  face: Record<FaceProductId, ProductState>;
  onPatch: (id: FaceProductId, patch: Partial<ProductState>) => void;
  tools: string[];
  onToggleTool: (id: string) => void;
}

export function FacePanel({ face, onPatch, tools, onToggleTool }: FacePanelProps) {
  return (
    <div className="space-y-3">
      {FACE_PRODUCT_IDS.map((id, idx) => {
        const def = PRODUCTS.find((p) => p.id === id);
        if (!def) return null;
        const state = face[id];
        const accent = PRODUCT_ACCENTS[id] ?? "#008B8B";
        return (
          <div
            key={id}
            className={cn(
              "pop-in rounded-xl border p-3 transition-all duration-300",
              !state.enabled && "border-[#F8F1E1]/40 bg-[#F8F1E1]/40"
            )}
            data-testid={`face-${id}`}
            style={{
              animationDelay: `${idx * 60}ms`,
              ...(state.enabled
                ? {
                    borderColor: `${accent}88`,
                    background: `linear-gradient(100deg, ${accent}30, #F8F1E1 58%)`,
                    boxShadow: `0 4px 18px ${accent}33`,
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
                    ? { boxShadow: `0 0 0 3px ${accent}2e, inset 0 1px 3px rgba(255,255,255,0.4)` }
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
                  {def.label}
                </div>
                <div
                  className={cn(
                    "truncate text-sm",
                    state.enabled ? "text-[#6F4E37]/75" : "text-[#6F4E37]/60"
                  )}
                >
                  {def.desc}
                </div>
              </div>
              <Switch
                checked={state.enabled}
                onCheckedChange={(checked) => onPatch(id, { enabled: checked })}
                aria-label={`Включить: ${def.label}`}
              />
            </div>

            {state.enabled && (
              <div
                className="pop-in mt-3 space-y-2.5 pt-3"
                style={{ borderTop: `1px solid ${accent}30` }}
              >
                <SwatchPicker
                  swatches={def.swatches}
                  color={state.color}
                  accent={accent}
                  onChange={(hex) => onPatch(id, { color: hex })}
                  label={def.label}
                />
                <IntensityChips
                  value={state.intensity}
                  onChange={(v) => onPatch(id, { intensity: v })}
                />
                <FinishChips
                  finishes={def.finishes ?? []}
                  value={state.finish}
                  onChange={(f) => onPatch(id, { finish: f })}
                />
              </div>
            )}
          </div>
        );
      })}

      <ToolPicker
        toolIds={FACE_TOOLS}
        selected={tools}
        onToggle={onToggleTool}
        title="Инструменты"
        testId="face-tools"
      />
    </div>
  );
}
