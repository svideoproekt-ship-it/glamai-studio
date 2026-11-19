"use client";

// БЛОК 1 «Стиль, образ»: пять кнопок — из выбранного образа ИИ в дальнейшем
// наносит палитру красок (стиль задаёт плотность и характер всего макияжа).

import { cn } from "@/lib/utils";
import { STYLES } from "@/lib/makeup";

interface StylePanelProps {
  style: number;
  onChange: (id: number) => void;
}

export function StylePanel({ style, onChange }: StylePanelProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {STYLES.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onChange(s.id)}
          aria-pressed={style === s.id}
          data-testid={`style-${s.id}`}
          className={cn(
            "h-12 rounded-full border px-5 text-2xl font-semibold transition-all active:scale-95",
            style === s.id
              ? "border-transparent bg-gradient-to-r from-[#008B8B] to-[#16B8A6] text-white shadow-md shadow-[#032916]/40"
              : "border-[#F8F1E1]/45 bg-[#F8F1E1]/45 text-[#6F4E37]/85 hover:bg-[#F8F1E1]/70 hover:text-[#6F4E37]"
          )}
        >
          {s.label}
        </button>
      ))}
    </div>
  );
}
