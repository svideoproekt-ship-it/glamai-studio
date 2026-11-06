"use client";

import { Plus } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  INTENSITY_LABELS,
  PRODUCTS,
  type FinishId,
  type ProductId,
  type ProductState,
} from "@/lib/makeup";

/** Акцентный цвет каждого продукта — у каждого своя «упаковка» (без тревожного красного) */
const PRODUCT_ACCENTS: Record<string, string> = {
  lips: "#8CE99A",
  eyeshadow: "#9B6EF3",
  eyeliner: "#3E8EF7",
  mascara: "#008B8B",
  brows: "#F59E0B",
  blush: "#FFB4A2",
  contour: "#C08552",
  highlighter: "#F6C445",
};

interface PalettePanelProps {
  products: Record<ProductId, ProductState>;
  onPatch: (id: ProductId, patch: Partial<ProductState>) => void;
}

function Chip({
  active,
  onClick,
  children,
  title,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={cn(
        "h-12 rounded-full border px-5 text-2xl font-semibold transition-all active:scale-95",
        active
          ? "border-transparent bg-gradient-to-r from-[#008B8B] to-[#16B8A6] text-white shadow-md shadow-[#032916]/40"
          : "border-[#6F4E37]/35 bg-white/75 text-[#6F4E37] hover:border-[#6F4E37]/70 hover:bg-white"
      )}
    >
      {children}
    </button>
  );
}

export function PalettePanel({ products, onPatch }: PalettePanelProps) {
  return (
    <div className="custom-scroll max-h-[600px] space-y-3 overflow-y-auto pr-1">
      {PRODUCTS.map((def, idx) => {
        const state = products[def.id];
        if (!state) return null;
        const accent = PRODUCT_ACCENTS[def.id] ?? "#008B8B";
        const selectedIsPreset = def.swatches.some(
          (s) => s.hex.toLowerCase() === state.color.toLowerCase()
        );
        return (
          <div
            key={def.id}
            className={cn(
              "pop-in rounded-xl border p-3 transition-all duration-300",
              !state.enabled && "border-[#F8F1E1]/40 bg-[#F8F1E1]/40"
            )}
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
                onCheckedChange={(checked) => onPatch(def.id, { enabled: checked })}
                aria-label={`Включить: ${def.label}`}
              />
            </div>

            {state.enabled && (
              <div
                className="pop-in mt-3 space-y-2.5 pt-3"
                style={{ borderTop: `1px solid ${accent}30` }}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  {def.swatches.map((s) => {
                    const selected = state.color.toLowerCase() === s.hex.toLowerCase();
                    return (
                      <button
                        key={`${s.hex}${selected ? "-sel" : ""}`}
                        type="button"
                        title={s.name}
                        aria-label={`${def.label}: ${s.name}`}
                        onClick={() => onPatch(def.id, { color: s.hex })}
                        className={cn(
                          "h-9 w-9 rounded-full border border-white/50 transition-transform duration-150 hover:scale-115 active:scale-90",
                          selected && "swatch-pop scale-110"
                        )}
                        style={{
                          backgroundColor: s.hex,
                          ...(selected
                            ? { boxShadow: `0 0 0 2px #fff, 0 0 0 4.5px ${accent}` }
                            : {}),
                        }}
                      />
                    );
                  })}
                  <label
                    className="relative ml-1 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-dashed transition-colors hover:scale-110"
                    style={{ borderColor: `${accent}99` }}
                    title="Свой оттенок"
                  >
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(state.color) ? state.color : accent}
                      onChange={(e) => onPatch(def.id, { color: e.target.value })}
                      className="color-chip absolute inset-0 h-full w-full rounded-full opacity-0"
                      aria-label={`Свой оттенок: ${def.label}`}
                    />
                    <Plus
                      className="pointer-events-none h-5 w-5 transition-transform duration-300 hover:rotate-90"
                      style={{ color: accent }}
                    />
                  </label>
                  <span className="ml-auto text-sm text-[#6F4E37]/70">
                    {selectedIsPreset
                      ? def.swatches.find(
                          (s) => s.hex.toLowerCase() === state.color.toLowerCase()
                        )?.name
                      : "Свой оттенок"}
                  </span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {([1, 2, 3] as const).map((i) => (
                    <Chip
                      key={i}
                      active={state.intensity === i}
                      onClick={() => onPatch(def.id, { intensity: i })}
                    >
                      {INTENSITY_LABELS[i]}
                    </Chip>
                  ))}
                </div>

                {def.finishes && (
                  <div className="flex flex-wrap gap-1.5">
                    {def.finishes.map((f) => (
                      <Chip
                        key={f.id}
                        active={state.finish === f.id}
                        onClick={() => onPatch(def.id, { finish: f.id as FinishId })}
                      >
                        {f.label}
                      </Chip>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
