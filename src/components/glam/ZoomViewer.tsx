"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
// v44: лупа для деталей макияжа. Стрелки, подводка и растяжка тонов на
// портрете шириной с экран — примерно 1 пиксель: без увеличения их просто
// не видно. Этот просмотрщик даёт честный зум до 4x (нативное разрешение
// картинки — около 1000 px по ширине), поэтому «две стрелки» реально
// рассмотреть: мастер показывает детали клиентке, школа — ученицам.
//
// Управление:
//   • два пальца — масштаб (пинч), один палец — передвинуть фото;
//   • двойное нажатие — приблизить к точке нажатия / вернуть как было;
//   • на компьютере — колесо мыши, двойной клик, перетаскивание;
//   • кнопки +/−/сброс внизу — для тех, кому жесты неудобны.

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const EYE_DEFAULT = { scale: 2.8, fx: 0.5, fy: 0.33 };

export interface ZoomFocus {
  scale: number;
  /** Точка фокуса в долях фото: 0.5 — центр, 0.33 — примерно уровень глаз */
  fx: number;
  fy: number;
}

interface ZoomViewerProps {
  src: string;
  alt: string;
  /** Открывать сразу увеличенным (например, пресет «Глаза крупно») */
  focus?: ZoomFocus | null;
  /** Текст внизу окна (например, подсказка про сохранение) */
  footer?: string | null;
  onClose: () => void;
}

interface View {
  scale: number;
  tx: number;
  ty: number;
}

const IDENTITY: View = { scale: 1, tx: 0, ty: 0 };

export function ZoomViewer({ src, alt, focus = null, footer = null, onClose }: ZoomViewerProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  // Держим текущее значение в ref — обработчикам жестов не нужны пересоздания
  const viewRef = useRef<View>(IDENTITY);
  const [view, setView] = useState<View>(IDENTITY);
  // Во время жеста анимация отключена, чтобы пинч не «резиновал»
  const gesturing = useRef(false);
  // v44-фикс: панель результата живёт внутри блока с анимацией .reveal —
  // её постоянный transform делает position: fixed «привязанным» к родителю,
  // а не к экрану. Портал в body выносит лупу из-под влияния трансформаций.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const apply = useCallback((v: View) => {
    viewRef.current = v;
    setView(v);
  }, []);

  // Базовый (без трансформации) размер картинки и размер контейнера.
  // getBoundingClientRect включает текущий scale, поэтому делим на него.
  const metrics = useCallback((curScale: number) => {
    const img = imgRef.current;
    const box = boxRef.current;
    if (!img || !box) return null;
    const r = img.getBoundingClientRect();
    if (r.width === 0 || curScale === 0) return null;
    return {
      bw: r.width / curScale,
      bh: r.height / curScale,
      W: box.clientWidth,
      H: box.clientHeight,
    };
  }, []);

  /** Не даём фото улететь за края: запас панорамы = излишек масштаба */
  const clamp = useCallback(
    (oldScale: number, s: number, tx: number, ty: number): View => {
      const m = metrics(oldScale);
      if (!m) return { scale: s, tx, ty };
      const maxX = Math.max(0, (m.bw * s - m.W) / 2);
      const maxY = Math.max(0, (m.bh * s - m.H) / 2);
      return {
        scale: s,
        tx: Math.min(maxX, Math.max(-maxX, tx)),
        ty: Math.min(maxY, Math.max(-maxY, ty)),
      };
    },
    [metrics],
  );

  /** Приближение к точке (px, py — координаты внутри контейнера) */
  const zoomAt = useCallback(
    (px: number, py: number, target: number) => {
      const v = viewRef.current;
      const m = metrics(v.scale);
      if (!m) return;
      const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, target));
      // координаты точки фото (относительно центра) под пальцем
      const x = (px - m.W / 2 - v.tx) / v.scale;
      const y = (py - m.H / 2 - v.ty) / v.scale;
      const ntx = px - m.W / 2 - x * s;
      const nty = py - m.H / 2 - y * s;
      apply(clamp(v.scale, s, ntx, nty));
    },
    [apply, clamp, metrics],
  );

  /** Центрирование точки фото (fx, fy в долях 0..1) при заданном масштабе */
  const focusOn = useCallback(
    (fx: number, fy: number, s: number) => {
      const m = metrics(viewRef.current.scale);
      if (!m) return;
      const x = (fx - 0.5) * m.bw;
      const y = (fy - 0.5) * m.bh;
      apply(clamp(viewRef.current.scale, s, -x * s, -y * s));
    },
    [apply, clamp, metrics],
  );

  const reset = useCallback(() => apply(IDENTITY), [apply]);

  // Стартовый фокус (пресет «Глаза крупно»): ждём, пока картинка реально
  // отрисуется (данные или сеть), иначе замер размера даст нули и зум не
  // применится
  useEffect(() => {
    if (!mounted || !focus) return;
    const img = imgRef.current;
    if (!img) return;
    const run = () => focusOn(focus.fx, focus.fy, focus.scale);
    if (img.complete && img.naturalWidth > 0) {
      const t = setTimeout(run, 50);
      return () => clearTimeout(t);
    }
    img.addEventListener("load", run, { once: true });
    return () => img.removeEventListener("load", run);
  }, [mounted, focus, focusOn]);

  // Блокируем прокрутку страницы, пока открыта лупа; закрываем по Escape
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Жесты: единый обработчик Pointer Events (палец + мышь), нативные
  // слушатели с passive:false — иначе браузер сам перехватит касания
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;

    const pointers = new Map<number, { x: number; y: number }>();
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    let panLast: { x: number; y: number } | null = null;
    let lastTap = { time: 0, x: 0, y: 0 };

    const rel = (e: PointerEvent) => {
      const r = box.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);

    const onDown = (e: PointerEvent) => {
      const p = rel(e);
      pointers.set(e.pointerId, p);
      gesturing.current = true;
      if (pointers.size === 1) {
        panLast = p;
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStartDist = dist(a, b);
        pinchStartScale = viewRef.current.scale;
        panLast = null;
      }
      try {
        box.setPointerCapture(e.pointerId);
      } catch {
        /* не критично */
      }
    };

    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      const p = rel(e);
      pointers.set(e.pointerId, p);

      if (pointers.size >= 2 && pinchStartDist > 0) {
        const [a, b] = [...pointers.values()];
        const d = dist(a, b);
        const s = pinchStartScale * (d / pinchStartDist);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        // зум вокруг середины между пальцами, без анимации
        const v = viewRef.current;
        const m = metrics(v.scale);
        if (m) {
          const cl = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
          const x = (mid.x - m.W / 2 - v.tx) / v.scale;
          const y = (mid.y - m.H / 2 - v.ty) / v.scale;
          apply(clamp(v.scale, cl, mid.x - m.W / 2 - x * cl, mid.y - m.H / 2 - y * cl));
        }
        return;
      }

      // один палец — панорама (на масштабе 1 всё равно зажмётся в 0)
      if (panLast && pointers.size === 1) {
        const v = viewRef.current;
        const ntx = v.tx + (p.x - panLast.x);
        const nty = v.ty + (p.y - panLast.y);
        panLast = p;
        apply(clamp(v.scale, v.scale, ntx, nty));
      }
    };

    const onUp = (e: PointerEvent) => {
      const p = rel(e);
      const was = pointers.size;
      pointers.delete(e.pointerId);
      if (pointers.size === 0) {
        gesturing.current = false;
        panLast = null;
        pinchStartDist = 0;
        // двойное нажатие пальцем — приблизить/вернуть (для мыши есть dblclick)
        if (was === 1 && e.pointerType !== "mouse") {
          const now = Date.now();
          const moved = Math.hypot(p.x - lastTap.x, p.y - lastTap.y);
          if (now - lastTap.time < 320 && moved < 28) {
            const v = viewRef.current;
            if (v.scale > 1.25) reset();
            else zoomAt(p.x, p.y, 2.5);
            lastTap = { time: 0, x: 0, y: 0 };
          } else {
            lastTap = { time: now, x: p.x, y: p.y };
          }
        }
      } else if (pointers.size === 1) {
        // из пинча остался один палец — начинаем панораму заново
        pinchStartDist = 0;
        panLast = [...pointers.values()][0];
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = box.getBoundingClientRect();
      const v = viewRef.current;
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      zoomAt(e.clientX - r.left, e.clientY - r.top, v.scale * factor);
    };

    const onDblClick = (e: MouseEvent) => {
      const r = box.getBoundingClientRect();
      const v = viewRef.current;
      if (v.scale > 1.25) reset();
      else zoomAt(e.clientX - r.left, e.clientY - r.top, 2.5);
    };

    // touchmove с passive:false — iOS иначе тянет страницу за фото
    const onTouchMove = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault();
    };

    box.addEventListener("pointerdown", onDown);
    box.addEventListener("pointermove", onMove);
    box.addEventListener("pointerup", onUp);
    box.addEventListener("pointercancel", onUp);
    box.addEventListener("wheel", onWheel, { passive: false });
    box.addEventListener("dblclick", onDblClick);
    box.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      box.removeEventListener("pointerdown", onDown);
      box.removeEventListener("pointermove", onMove);
      box.removeEventListener("pointerup", onUp);
      box.removeEventListener("pointercancel", onUp);
      box.removeEventListener("wheel", onWheel);
      box.removeEventListener("dblclick", onDblClick);
      box.removeEventListener("touchmove", onTouchMove);
    };
  }, [apply, clamp, metrics, reset, zoomAt]);

  const stepZoom = (factor: number) => {
    const m = metrics(viewRef.current.scale);
    if (!m) return;
    zoomAt(m.W / 2, m.H / 2, viewRef.current.scale * factor);
  };

  const scaled = view.scale > 1.02;

  // Пока портал не готов (первый кадр на клиенте) — ничего не рисуем
  if (!mounted) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-black/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Просмотр образа с увеличением"
      data-testid="zoom-viewer"
    >
      {/* Шапка: подпись и явный выход — чёрный экран больше не «ловушка» */}
      <div className="flex items-center justify-between px-4 pt-4">
        <p className="text-sm font-semibold text-[#F8F1E1]/90">
          Лупа деталей {scaled && <span className="ml-1 text-[#F6B93B]">×{view.scale.toFixed(1)}</span>}
        </p>
        <button
          type="button"
          aria-label="Закрыть просмотр"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white"
          onClick={onClose}
          data-testid="zoom-close"
        >
          <X className="h-6 w-6" aria-hidden />
        </button>
      </div>

      {/* Поле жестов: вся площадь — картинка по центру */}
      <div
        ref={boxRef}
        className="relative flex flex-1 touch-none select-none items-center justify-center overflow-hidden"
        style={{ touchAction: "none", WebkitTouchCallout: "default", overscrollBehavior: "contain" }}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          className="max-h-[68vh] max-w-full rounded-xl shadow-2xl"
          style={{
            transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
            transition: gesturing.current ? "none" : "transform 0.22s ease-out",
            willChange: "transform",
          }}
          draggable={false}
          data-testid="zoom-image"
        />
      </div>

      {/* Кнопки масштаба: для тех, кому жесты неудобны */}
      <div className="flex items-center justify-center gap-2 px-4 pb-2">
        <Button
          variant="outline"
          size="icon"
          className="h-10 w-10 rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20"
          aria-label="Уменьшить"
          onClick={() => stepZoom(1 / 1.4)}
          disabled={!scaled}
          data-testid="zoom-out"
        >
          <Minus className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-10 w-10 rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20"
          aria-label="Сбросить масштаб"
          onClick={reset}
          disabled={!scaled}
          data-testid="zoom-reset"
        >
          <Maximize className="h-4 w-4" aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="h-10 w-10 rounded-full border-white/25 bg-white/10 text-white hover:bg-white/20"
          aria-label="Увеличить"
          onClick={() => stepZoom(1.4)}
          disabled={view.scale >= MAX_SCALE - 0.01}
          data-testid="zoom-in"
        >
          <Plus className="h-4 w-4" aria-hidden />
        </Button>
      </div>

      <p className="px-6 pb-3 text-center text-xs leading-relaxed text-[#F8F1E1]/70">
        Двумя пальцами — масштаб, одним — передвинуть. Двойное нажатие —
        приблизить место касания. {footer ? footer : ""}
      </p>
      {footer && <div className="pb-4" />}
    </div>,
    document.body,
  );
}

/** Пресет «Глаза крупно»: уровень глаз в портрете — примерно треть от верха */
export const EYES_FOCUS = EYE_DEFAULT;
