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

/** Цветная подсветка иконок активных кистей (без тревожного красного) */
const BRUSH_COLORS: Record<string, string> = {
  fluffy: "#008B8B",
  flat: "#FF7A59",
  sponge: "#9B6EF3",
  pencil: "#3E8EF7",
  fan: "#8CE99A",
  spoolie: "#F6B93B",
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
      <div className="grid grid-cols-1 gap-2.5">
        {BRUSHES.map((b) => {
          const Icon = ICONS[b.id] ?? Brush;
          const active = brushes.includes(b.id);
          const color = BRUSH_COLORS[b.id] ?? "#008B8B";
          return (
            <button
              type="button"
              key={b.id}
              onClick={() => onToggle(b.id)}
              aria-pressed={active}
              title={b.hint}
              className={cn(
                "flex items-center gap-3 rounded-xl border px-4 py-3 text-left text-2xl font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 active:scale-[0.98]",
                active
                  ? "border-transparent text-[#6F4E37] shadow-sm"
                  : "border-[#F8F1E1]/45 bg-[#F8F1E1]/45 text-[#6F4E37]/85 hover:bg-[#F8F1E1]/70 hover:text-[#6F4E37]"
              )}
              style={
                active
                  ? {
                      background: `linear-gradient(100deg, ${color}30, #F8F1E1 62%)`,
                      borderColor: `${color}66`,
                      boxShadow: `0 3px 14px ${color}33`,
                    }
                  : {}
              }
            >
              <Icon
                className={cn("h-6 w-6 shrink-0 transition-transform", active && "scale-110")}
                style={active ? { color } : undefined}
              />
              <span className="leading-tight">{b.label}</span>
            </button>
          );
        })}
      </div>

      <div>
        <p className="mb-1.5 text-sm text-muted-foreground">Стиль образа</p>
        <div className="grid grid-cols-2 gap-2">
          {OVERALLS.map((s) => (
            <button
              type="button"
              key={s.id}
              onClick={() => onOverall(s.id)}
              aria-pressed={overall === s.id}
              className={cn(
                "h-12 rounded-xl border px-2 text-2xl font-semibold transition-all active:scale-95",
                overall === s.id
                  ? "border-transparent bg-gradient-to-r from-[#008B8B] to-[#16B8A6] text-white shadow-md shadow-[#032916]/40"
                  : "border-[#F8F1E1]/45 bg-[#F8F1E1]/45 text-[#6F4E37]/85 hover:bg-[#F8F1E1]/70 hover:text-[#6F4E37]"
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
