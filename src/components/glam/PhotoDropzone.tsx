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
        <h3 className="flex items-center gap-2 text-xl font-bold tracking-wide text-[#F8F1E1]">
          {title}
        </h3>
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
        <div className="green-window pop-in rounded-xl p-1">
          <img
            src={value.dataUrl}
            alt={title}
            className="block max-h-72 w-full rounded-lg object-cover"
          />
          <p className="truncate px-2 pb-1 pt-1.5 text-[11px] text-muted-foreground">
            {value.name}
          </p>
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
            "flex w-full cursor-pointer flex-col items-center gap-2.5 rounded-2xl px-4 py-8 text-center transition-all duration-200 hover:shadow-lg hover:shadow-[#032916]/50",
            "border-2 border-dashed border-[#8CE99A]/55 bg-[#043E21]/60",
            dragOver &&
              "scale-[1.02] border-[#8CE99A] bg-[#04512B]/80 shadow-xl shadow-[#032916]/60 ring-4 ring-[#8CE99A]/25"
          )}
        >
          <div
            className={cn(
              "rounded-2xl bg-gradient-to-br from-[#8CE99A]/25 via-[#16B8A6]/20 to-[#9B6EF3]/20 p-3",
              !busy && "float-y",
              dragOver && !busy && "wiggle"
            )}
          >
            {busy ? (
              <Loader2 className="h-7 w-7 animate-spin text-[#8CE99A]" />
            ) : (
              <ImagePlus className="h-7 w-7 text-[#8CE99A]" />
            )}
          </div>
          <span className="text-base font-semibold text-[#F8F1E1]">
            {dragOver ? "Отпускайте — загружаем!" : "Перетащите фото сюда"}
          </span>
          <span className="text-sm text-muted-foreground">
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
