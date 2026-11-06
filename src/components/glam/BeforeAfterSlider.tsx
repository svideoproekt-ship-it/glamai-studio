"use client";

import { useCallback, useRef, useState } from "react";
import { ChevronsLeftRight } from "lucide-react";

interface BeforeAfterSliderProps {
  before: string;
  after: string;
  alt?: string;
}

export function BeforeAfterSlider({ before, after, alt = "Макияж" }: BeforeAfterSliderProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const [pos, setPos] = useState(50);

  const update = useCallback((clientX: number) => {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    const p = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(100, Math.max(0, p)));
  }, []);

  return (
    <div className="mx-auto w-full max-w-md">
      <div className="rounded-[22px] bg-[#064A28] p-1.5 shadow-[0_14px_44px_rgba(3,40,22,0.5)] ring-1 ring-[#8CE99A]/30">
        <div
          ref={containerRef}
          role="slider"
          tabIndex={0}
          aria-label="Сравнение до и после макияжа"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pos)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - 5));
            if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + 5));
          }}
          onPointerDown={(e) => {
            draggingRef.current = true;
            containerRef.current?.setPointerCapture(e.pointerId);
            update(e.clientX);
          }}
          onPointerMove={(e) => {
            if (draggingRef.current) update(e.clientX);
          }}
          onPointerUp={() => {
            draggingRef.current = false;
          }}
          onPointerCancel={() => {
            draggingRef.current = false;
          }}
          className="relative w-full cursor-ew-resize touch-none select-none overflow-hidden rounded-[18px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#8CE99A]"
        >
          {/* После (полностью) */}
          <img src={after} alt={alt} className="block w-full" draggable={false} />

          {/* До (обрезается шторкой) */}
          <img
            src={before}
            alt="До макияжа"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
          />

          {/* Подписи */}
          <span className="pointer-events-none absolute left-3 top-3 rounded-full bg-[#04281A]/85 px-2.5 py-0.5 text-[11px] font-semibold tracking-widest text-[#F8F1E1] backdrop-blur-sm">
            ДО
          </span>
          <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-gradient-to-r from-[#008B8B] to-[#16B8A6] px-2.5 py-0.5 text-[11px] font-semibold tracking-widest text-white shadow-md">
            ПОСЛЕ
          </span>

          {/* Шторка */}
          <div
            className="pointer-events-none absolute inset-y-0"
            style={{ left: `calc(${pos}% - 1px)` }}
          >
            <div className="h-full w-0.5 bg-white/95 shadow-[0_0_12px_rgba(4,40,26,0.6)]" />
            <div className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2">
              <span
                aria-hidden
                className="handle-pulse absolute inset-0 rounded-full"
              />
              <div className="relative rounded-full border border-[#8CE99A]/60 bg-white p-1.5 text-[#008B8B] shadow-lg transition-transform">
                <ChevronsLeftRight className="h-4 w-4" />
              </div>
            </div>
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-sm text-muted-foreground">
        Тяните шторку влево-вправо, чтобы сравнить результат
      </p>
    </div>
  );
}
