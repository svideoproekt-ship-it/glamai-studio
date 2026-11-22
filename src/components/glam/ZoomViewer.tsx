"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
// v44 (доработка 44.1): лупа для деталей макияжа. Стрелки, подводка и
// растяжка тонов на портрете шириной с экран — примерно 1 пиксель: без
// увеличения их просто не видно. Этот просмотрщик даёт честный зум до 4x
// (нативное разрешение картинки — около 1000 px по ширине), поэтому «две
// стрелки» реально рассмотреть: мастер показывает детали клиентке, школа —
// ученицам.
//
// Управление:
//   • два пальца — масштаб (пинч), один палец — передвинуть фото;
//   • двойное нажатие — приблизить к точке нажатия / вернуть как было;
//   • на компьютере — колесо мыши, двойной клик, перетаскивание;
//   • кнопки +/−/сброс внизу — для тех, кому жесты неудобны;
//   • системная кнопка «Назад» в шапке Telegram тоже закрывает лупу.
//
// Почему жесты построены на сырых touch-событиях (44.1): в части WebView
// Telegram Pointer Events отдают только первый палец, а iOS перехватывает
// пинч под «зум страницы». Touch-события работают во всех WebView, зум
// страницы блокируем meta viewport + перехватом gesturestart, а свайпы
// Telegram на время лупы отключаем (disableVerticalSwipes).

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

/** Базовые размеры: фото без трансформации и поле жестов */
interface Base {
  bw: number;
  bh: number;
  W: number;
  H: number;
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
  const metrics = useCallback((curScale: number): Base | null => {
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
  const clampWith = useCallback(
    (base: Base, s: number, tx: number, ty: number): View => {
      const maxX = Math.max(0, (base.bw * s - base.W) / 2);
      const maxY = Math.max(0, (base.bh * s - base.H) / 2);
      return {
        scale: s,
        tx: Math.min(maxX, Math.max(-maxX, tx)),
        ty: Math.min(maxY, Math.max(-maxY, ty)),
      };
    },
    [],
  );

  const clamp = useCallback(
    (oldScale: number, s: number, tx: number, ty: number): View => {
      const m = metrics(oldScale);
      if (!m) return { scale: s, tx, ty };
      return clampWith(m, s, tx, ty);
    },
    [clampWith, metrics],
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
      apply(clampWith(m, s, ntx, nty));
    },
    [apply, clampWith, metrics],
  );

  /** Центрирование точки фото (fx, fy в долях 0..1) при заданном масштабе */
  const focusOn = useCallback(
    (fx: number, fy: number, s: number) => {
      const m = metrics(viewRef.current.scale);
      if (!m) return;
      const x = (fx - 0.5) * m.bw;
      const y = (fy - 0.5) * m.bh;
      apply(clampWith(m, s, -x * s, -y * s));
    },
    [apply, clampWith, metrics],
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

  // Telegram: на время лупы отключаем вертикальные свайпы (иначе свайп
  // пальцем сворачивает мини-апп посреди пинча) и подключаем системную
  // кнопку «Назад» — она закрывает лупу. Всё в try/catch: старые клиенты
  // этих методов не знают, и это не страшно.
  useEffect(() => {
    if (!mounted) return;
    const tg = (window as unknown as { Telegram?: { WebApp?: Record<string, unknown> & {
      disableVerticalSwipes?: () => void;
      enableVerticalSwipes?: () => void;
      isVerticalSwipesEnabled?: boolean;
      BackButton?: {
        show?: () => void;
        hide?: () => void;
        onClick?: (cb: () => void) => void;
        offClick?: (cb: () => void) => void;
      };
    } } }).Telegram?.WebApp;
    try {
      tg?.disableVerticalSwipes?.();
      if ("isVerticalSwipesEnabled" in (tg ?? {})) tg!.isVerticalSwipesEnabled = false;
      tg?.BackButton?.show?.();
    } catch {
      /* старый клиент — жесты останутся штатными, это не ломает лупу */
    }
    const onBack = () => onClose();
    try {
      tg?.BackButton?.onClick?.(onBack);
    } catch {
      /* не критично */
    }
    return () => {
      try {
        tg?.enableVerticalSwipes?.();
        if ("isVerticalSwipesEnabled" in (tg ?? {})) tg!.isVerticalSwipesEnabled = true;
        tg?.BackButton?.offClick?.(onBack);
        tg?.BackButton?.hide?.();
      } catch {
        /* не критично */
      }
    };
  }, [mounted, onClose]);

  // Жесты: пальцы — сырые touch-события, мышь — mousedown/wheel/dblclick.
  // Нативные слушатели с passive:false, иначе браузер перехватит касания.
  // ВАЖНО (44.1): эффект должен ждать mounted! До портала boxRef пуст,
  // и слушатели молча не вешались — пинч не работал ни на одном устройстве.
  useEffect(() => {
    if (!mounted) return;
    const box = boxRef.current;
    if (!box) return;

    const touches = new Map<number, { x: number; y: number }>();
    let pinchStartDist = 0;
    let pinchStartScale = 1;
    // Базовые размеры фиксируем на старте жеста: посреди пинча React может
    // ещё не перерисовать картинку, и live-замер даст дрожание якоря
    let gestureBase: Base | null = null;
    let panLast: { x: number; y: number } | null = null;
    let lastTap = { time: 0, x: 0, y: 0 };
    let lastTouchAt = 0;
    let mousePan: { x: number; y: number } | null = null;

    const rel = (clientX: number, clientY: number) => {
      const r = box.getBoundingClientRect();
      return { x: clientX - r.left, y: clientY - r.top };
    };

    const dist = (a: { x: number; y: number }, b: { x: number; y: number }) =>
      Math.hypot(a.x - b.x, a.y - b.y);

    /** Зум вокруг точки mid к целевому масштабу target (внутри жеста) */
    const pinchTo = (mid: { x: number; y: number }, target: number) => {
      const base = gestureBase;
      if (!base) return;
      const v = viewRef.current;
      const cl = Math.min(MAX_SCALE, Math.max(MIN_SCALE, target));
      // координаты точки фото (относительно центра) под серединой пальцев
      const x = (mid.x - base.W / 2 - v.tx) / v.scale;
      const y = (mid.y - base.H / 2 - v.ty) / v.scale;
      apply(clampWith(base, cl, mid.x - base.W / 2 - x * cl, mid.y - base.H / 2 - y * cl));
    };

    const haptic = () => {
      try {
        const tg = (window as unknown as {
          Telegram?: { WebApp?: { HapticFeedback?: { impactOccurred?: (s: string) => void } } };
        }).Telegram?.WebApp;
        tg?.HapticFeedback?.impactOccurred?.("light");
      } catch {
        /* не критично */
      }
    };

    /** Двойное нажатие: приблизить к точке / вернуть как было */
    const doubleTap = (p: { x: number; y: number }) => {
      const now = Date.now();
      const moved = Math.hypot(p.x - lastTap.x, p.y - lastTap.y);
      if (now - lastTap.time < 320 && moved < 30) {
        const v = viewRef.current;
        if (v.scale > 1.25) reset();
        else zoomAt(p.x, p.y, 2.5);
        haptic();
        lastTap = { time: 0, x: 0, y: 0 };
      } else {
        lastTap = { time: now, x: p.x, y: p.y };
      }
    };

    // --- Пальцы ---
    const onTouchStart = (e: TouchEvent) => {
      lastTouchAt = Date.now();
      gesturing.current = true;
      for (const t of Array.from(e.changedTouches)) {
        touches.set(t.identifier, rel(t.clientX, t.clientY));
      }
      if (touches.size >= 2) {
        const [a, b] = [...touches.values()].slice(0, 2);
        const img = imgRef.current;
        const r = img?.getBoundingClientRect();
        if (img && r && r.width > 0) {
          gestureBase = {
            bw: r.width / viewRef.current.scale,
            bh: r.height / viewRef.current.scale,
            W: box.clientWidth,
            H: box.clientHeight,
          };
        } else {
          gestureBase = metrics(viewRef.current.scale);
        }
        pinchStartDist = dist(a, b);
        pinchStartScale = viewRef.current.scale;
        panLast = null;
        lastTap = { time: 0, x: 0, y: 0 }; // пинч сбрасывает счётчик тапов
      } else if (touches.size === 1) {
        panLast = [...touches.values()][0];
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      // блокируем прокрутку страницы и нативный зум — жест наш
      if (e.cancelable) e.preventDefault();
      for (const t of Array.from(e.changedTouches)) {
        if (touches.has(t.identifier)) touches.set(t.identifier, rel(t.clientX, t.clientY));
      }
      if (touches.size >= 2 && pinchStartDist > 0) {
        const [a, b] = [...touches.values()].slice(0, 2);
        const d = dist(a, b);
        if (d > 0) {
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          pinchTo(mid, pinchStartScale * (d / pinchStartDist));
        }
        return;
      }
      if (panLast && touches.size === 1) {
        const p = [...touches.values()][0];
        const v = viewRef.current;
        const dx = p.x - panLast.x;
        const dy = p.y - panLast.y;
        panLast = p;
        apply(clamp(v.scale, v.scale, v.tx + dx, v.ty + dy));
      }
    };

    const finishTouch = (e: TouchEvent, isCancel: boolean) => {
      const ended = Array.from(e.changedTouches).map((t) => rel(t.clientX, t.clientY));
      for (const t of Array.from(e.changedTouches)) touches.delete(t.identifier);
      if (touches.size === 0) {
        gesturing.current = false;
        panLast = null;
        pinchStartDist = 0;
        gestureBase = null;
        if (!isCancel && ended.length > 0) doubleTap(ended[0]);
      } else if (touches.size === 1) {
        // из пинча остался один палец — панорама с его текущего положения
        pinchStartDist = 0;
        gestureBase = null;
        panLast = [...touches.values()][0];
      }
    };

    const onTouchEnd = (e: TouchEvent) => finishTouch(e, false);
    const onTouchCancel = (e: TouchEvent) => finishTouch(e, true);

    // --- Мышь (компьютер). После касания пальцем браузер подсовывает
    // «мышиные» события-призраки — отсекаем их по времени. ---
    const isGhostMouse = () => Date.now() - lastTouchAt < 700;

    const onMouseDown = (e: MouseEvent) => {
      if (isGhostMouse() || e.button !== 0) return;
      mousePan = rel(e.clientX, e.clientY);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!mousePan) return;
      const p = rel(e.clientX, e.clientY);
      const v = viewRef.current;
      const dx = p.x - mousePan.x;
      const dy = p.y - mousePan.y;
      mousePan = p;
      apply(clamp(v.scale, v.scale, v.tx + dx, v.ty + dy));
    };
    const onMouseUp = () => {
      mousePan = null;
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = box.getBoundingClientRect();
      const v = viewRef.current;
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      zoomAt(e.clientX - r.left, e.clientY - r.top, v.scale * factor);
    };

    const onDblClick = (e: MouseEvent) => {
      if (isGhostMouse()) return;
      const r = box.getBoundingClientRect();
      const v = viewRef.current;
      if (v.scale > 1.25) reset();
      else zoomAt(e.clientX - r.left, e.clientY - r.top, 2.5);
    };

    // iOS: нативный «зум страницы» двумя пальцами перехватывает жест ещё до
    // наших событий — глушим его на всё время лупы
    const stopNativeGesture = (e: Event) => e.preventDefault();
    document.addEventListener("gesturestart", stopNativeGesture, { passive: false });
    document.addEventListener("gesturechange", stopNativeGesture, { passive: false });

    box.addEventListener("touchstart", onTouchStart, { passive: false });
    box.addEventListener("touchmove", onTouchMove, { passive: false });
    box.addEventListener("touchend", onTouchEnd);
    box.addEventListener("touchcancel", onTouchCancel);
    box.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    box.addEventListener("wheel", onWheel, { passive: false });
    box.addEventListener("dblclick", onDblClick);

    return () => {
      document.removeEventListener("gesturestart", stopNativeGesture);
      document.removeEventListener("gesturechange", stopNativeGesture);
      box.removeEventListener("touchstart", onTouchStart);
      box.removeEventListener("touchmove", onTouchMove);
      box.removeEventListener("touchend", onTouchEnd);
      box.removeEventListener("touchcancel", onTouchCancel);
      box.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      box.removeEventListener("wheel", onWheel);
      box.removeEventListener("dblclick", onDblClick);
    };
  }, [mounted, apply, clamp, clampWith, metrics, reset, zoomAt]);

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
        style={{ touchAction: "none", overscrollBehavior: "contain" }}
      >
        <img
          ref={imgRef}
          src={src}
          alt={alt}
          className="max-h-[68vh] max-w-full rounded-xl shadow-2xl"
          style={{
            transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
            // Чтение ref здесь сознательное: флаг «идёт жест» переключает
            // анимацию в тот же кадр, когда жест начался/кончился
            // eslint-disable-next-line react-hooks/refs -- см. комментарий выше
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
