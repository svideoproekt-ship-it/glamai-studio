"use client";

import { Brush, Droplets, Paintbrush, Pencil, Sparkles, Wind } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { BRUSHES, OVERALLS } from "@/lib/makeup";

const ICONS: Record<string, LucideIcon> = {
  fluffy: Brush,
  flat: Paintbrush,
  sponge: Droplets,
  pencil: Pencil,
  fan: Wind,
  spoolie: Sparkles,
};

interface BrushPanelProps {
  brushes: string[];
  onToggle: (id: string) => void;
  overall: number;
  onOverall: (id: number) => void;
}

export function BrushPanel({ brushes, onToggle, overall, onOverall }: BrushPanelProps) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2">
        {BRUSHES.map((b) => {
          const Icon = ICONS[b.id] ?? Brush;
          const active = brushes.includes(b.id);
          return (
            <button
              type="button"
              key={b.id}
              onClick={() => onToggle(b.id)}
              aria-pressed={active}
              title={b.hint}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors",
                active
                  ? "border-[#D4AF37]/60 bg-[#241e10] text-[#E8CF7A]"
                  : "border-border/60 bg-secondary/30 text-muted-foreground hover:border-[#D4AF37]/40 hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="leading-tight">{b.label}</span>
            </button>
          );
        })}
      </div>

      <div>
        <p className="mb-1.5 text-xs text-muted-foreground">Стиль образа</p>
        <div className="grid grid-cols-4 gap-1.5">
          {OVERALLS.map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => onOverall(s.id)}
              aria-pressed={overall === s.id}
              className={cn(
                "h-8 rounded-lg border text-xs transition-colors",
                overall === s.id
                  ? "border-[#D4AF37]/60 bg-[#241e10] text-[#E8CF7A]"
                  : "border-border/60 bg-secondary/30 text-muted-foreground hover:border-[#D4AF37]/40 hover:text-foreground"
              )}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
