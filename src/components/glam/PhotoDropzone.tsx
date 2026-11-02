"use client";

import { useCallback, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { prepareImage } from "@/lib/client-image";

export interface PhotoValue {
  dataUrl: string;
  ratio: number;
  name: string;
}

interface PhotoDropzoneProps {
  title: string;
  hint: string;
  value: PhotoValue | null;
  onChange: (value: PhotoValue | null) => void;
  onError?: (message: string) => void;
}

export function PhotoDropzone({ title, hint, value, onChange, onError }: PhotoDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      setBusy(true);
      try {
        const prepared = await prepareImage(file);
        onChange({ dataUrl: prepared.dataUrl, ratio: prepared.ratio, name: prepared.name });
      } catch (e) {
        onError?.(e instanceof Error ? e.message : "Не удалось загрузить изображение");
      } finally {
        setBusy(false);
      }
    },
    [onChange, onError]
  );

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold tracking-wide text-foreground/90">{title}</h3>
        {value && (
          <button
            type="button"
            onClick={() => onChange(null)}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-xs text-muted-foreground transition-colors hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
            Убрать
          </button>
        )}
      </div>

      {value ? (
        <div className="relative overflow-hidden rounded-xl border border-[#D4AF37]/25">
          <img
            src={value.dataUrl}
            alt={title}
            className="block max-h-72 w-full object-cover"
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent px-3 pb-1.5 pt-7">
            <p className="truncate text-[11px] text-white/80">{value.name}</p>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void handleFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex w-full cursor-pointer flex-col items-center gap-2 rounded-xl border border-dashed border-[#D4AF37]/40 bg-[#141419]/60 px-4 py-7 text-center transition-colors hover:border-[#D4AF37]/70 hover:bg-[#1a1710]",
            dragOver && "border-[#E8CF7A] bg-[#241e10] ring-1 ring-[#D4AF37]/50"
          )}
        >
          {busy ? (
            <Loader2 className="h-7 w-7 animate-spin text-[#D4AF37]" />
          ) : (
            <ImagePlus className="h-7 w-7 text-[#D4AF37]" />
          )}
          <span className="text-sm text-foreground/90">Перетащите фото сюда</span>
          <span className="text-xs text-muted-foreground">
            или нажмите, чтобы выбрать файл · {hint}
          </span>
        </button>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
