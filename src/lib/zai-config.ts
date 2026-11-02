import { existsSync, writeFileSync } from "fs";
import { homedir, platform } from "os";
import { join } from "path";

/**
 * Настройка доступа к AI API для деплоя (Vercel) и локального запуска.
 *
 * SDK z-ai-web-dev-sdk читает конфиг ТОЛЬКО из файла `.z-ai-config` и ищет его в:
 *   1) process.cwd()          — текущая папка проекта;
 *   2) os.homedir()           — домашняя папка;
 *   3) /etc/.z-ai-config      — системная (только Linux).
 *
 * Раньше файл писался только в /tmp, а HOME подменялся на /tmp. На Windows это
 * не работает: os.homedir() там использует USERPROFILE (не HOME), а папки /tmp
 * нет — из-за этого приложение «вообще отказывало»: SDK не находил конфиг.
 *
 * Теперь стратегия такая:
 *   1) пишем .z-ai-config в папку проекта (process.cwd()) — это первый путь,
 *      который проверяет SDK; работает на Windows, macOS и Linux локально;
 *   2) если запись в папку проекта не удалась (Vercel: файловая система
 *      read-only) — пишем в /tmp и подменяем HOME на /tmp (на Linux
 *      os.homedir() читает HOME, поэтому SDK найдёт файл).
 *
 * Ключ не попадает в git: `.z-ai-config` и `.env` внесены в .gitignore.
 */

export interface ZaiConfigStatus {
  /** Найден ли уже валидный конфиг одним из путей SDK */
  configFound: boolean;
  /** Где найден (для диагностики) */
  configPath: string | null;
  /** Заданы ли переменные окружения */
  envKeySet: boolean;
  envUrlSet: boolean;
  /** Куда в итоге записали конфиг (или null — запись не требовалась/не удалась) */
  writtenTo: string | null;
  /** Ошибка записи, если была */
  writeError: string | null;
  platform: string;
  home: string;
  cwd: string;
}

const CONFIG_NAME = ".z-ai-config";

function configCandidates(): string[] {
  return [
    join(process.cwd(), CONFIG_NAME),
    join(homedir(), CONFIG_NAME),
    "/etc/.z-ai-config",
  ];
}

/** Проверка всех мест, где SDK ищет конфиг. */
export function findZaiConfig(): { found: boolean; path: string | null } {
  for (const p of configCandidates()) {
    try {
      if (existsSync(p)) return { found: true, path: p };
    } catch {
      // ignore
    }
  }
  return { found: false, path: null };
}

/**
 * Готовит конфиг для SDK из переменных окружения.
 * Вызывается перед ZAI.create() в API-роутах.
 */
export function ensureZaiConfig(): void {
  const apiKey = process.env.ZAI_API_KEY;
  const baseUrl = process.env.ZAI_BASE_URL;

  // В песочнице/локально переменные не заданы — ничего не делаем:
  // SDK найдёт уже существующий конфиг.
  if (!apiKey || !baseUrl) return;

  // Частая ошибка: в .env остался текст-заполнитель вместо настоящего ключа —
  // такой конфиг не пишем, чтобы приложение показало точную причину.
  if (/вставьте|placeholder|your[_-]?key|пример/i.test(apiKey)) {
    console.warn(
      "[zai-config] ZAI_API_KEY выглядит как текст-заполнитель из .env.example — впишите настоящий ключ."
    );
    return;
  }

  // Конфиг уже доступен SDK (пользователь создал вручную или записали раньше) — не трогаем.
  const existing = findZaiConfig();
  if (existing.found) return;

  const payload = JSON.stringify({ baseUrl, apiKey });

  // Шаг 1: папка проекта — работает локально на любой ОС.
  try {
    writeFileSync(join(process.cwd(), CONFIG_NAME), payload, { mode: 0o600 });
    console.log("[zai-config] конфиг записан в папку проекта:", process.cwd());
    return;
  } catch (err) {
    console.warn(
      "[zai-config] запись в папку проекта не удалась:",
      err instanceof Error ? err.message : err
    );
  }

  // Шаг 2: /tmp + подмена HOME (Vercel: read-only FS, но /tmp доступен и Linux).
  try {
    process.env.HOME = "/tmp";
    writeFileSync(join("/tmp", CONFIG_NAME), payload, { mode: 0o600 });
    console.log("[zai-config] конфиг записан в /tmp/.z-ai-config (fallback)");
  } catch (err) {
    console.error("[zai-config] не удалось записать конфиг никуда:", err);
  }
}

/** Полный отчёт для диагностического эндпоинта /api/health. Никаких секретов. */
export function zaiConfigStatus(): ZaiConfigStatus {
  const apiKey = process.env.ZAI_API_KEY;
  const baseUrl = process.env.ZAI_BASE_URL;
  const existing = findZaiConfig();

  return {
    configFound: existing.found,
    configPath: existing.path,
    envKeySet: Boolean(apiKey),
    envUrlSet: Boolean(baseUrl),
    writtenTo: null,
    writeError: null,
    platform: platform(),
    home: homedir(),
    cwd: process.cwd(),
  };
}
