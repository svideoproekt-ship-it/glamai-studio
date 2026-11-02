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
        "h-7 rounded-md border px-2.5 text-xs transition-colors",
        active
          ? "border-[#D4AF37]/60 bg-[#241e10] text-[#E8CF7A]"
          : "border-border/60 text-muted-foreground hover:border-[#D4AF37]/40 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

export function PalettePanel({ products, onPatch }: PalettePanelProps) {
  return (
    <div className="custom-scroll max-h-[460px] space-y-2.5 overflow-y-auto pr-1">
      {PRODUCTS.map((def) => {
        const state = products[def.id];
        if (!state) return null;
        const selectedIsPreset = def.swatches.some(
          (s) => s.hex.toLowerCase() === state.color.toLowerCase()
        );
        return (
          <div
            key={def.id}
            className={cn(
              "rounded-xl border p-3 transition-colors",
              state.enabled
                ? "border-[#D4AF37]/40 bg-[#1a1710]/70"
                : "border-border/70 bg-secondary/30"
            )}
          >
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="h-7 w-7 shrink-0 rounded-full border border-white/25 shadow-inner"
                style={{ backgroundColor: state.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{def.label}</div>
                <div className="truncate text-xs text-muted-foreground">{def.desc}</div>
              </div>
              <Switch
                checked={state.enabled}
                onCheckedChange={(checked) => onPatch(def.id, { enabled: checked })}
                aria-label={`Включить: ${def.label}`}
              />
            </div>

            {state.enabled && (
              <div className="mt-3 space-y-2.5 border-t border-[#D4AF37]/15 pt-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {def.swatches.map((s) => (
                    <button
                      key={s.hex}
                      type="button"
                      title={s.name}
                      aria-label={`${def.label}: ${s.name}`}
                      onClick={() => onPatch(def.id, { color: s.hex })}
                      className={cn(
                        "h-7 w-7 rounded-full border border-white/20 transition-transform hover:scale-110",
                        state.color.toLowerCase() === s.hex.toLowerCase() &&
                          "ring-2 ring-[#E8CF7A] ring-offset-2 ring-offset-[#141419]"
                      )}
                      style={{ backgroundColor: s.hex }}
                    />
                  ))}
                  <label
                    className="relative ml-1 flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-dashed border-[#D4AF37]/60"
                    title="Свой оттенок"
                  >
                    <input
                      type="color"
                      value={/^#[0-9a-fA-F]{6}$/.test(state.color) ? state.color : "#d4af37"}
                      onChange={(e) => onPatch(def.id, { color: e.target.value })}
                      className="color-chip absolute inset-0 h-full w-full rounded-full opacity-0"
                      aria-label={`Свой оттенок: ${def.label}`}
                    />
                    <Plus className="pointer-events-none h-3.5 w-3.5 text-[#D4AF37]" />
                  </label>
                  <span className="ml-auto text-[11px] text-muted-foreground">
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
