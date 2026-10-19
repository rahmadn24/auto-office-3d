import { pino, type DestinationStream, type Logger } from 'pino';

/**
 * Structured logging (PRD §7 Fase 12) — JSON satu baris per log, level dari
 * env `LOG_LEVEL` (default `info`), tanpa pid/hostname agar ringkas dibaca di
 * `docker logs` / `journalctl` saat soak berhari-hari.
 *
 * Nilai level tidak valid tidak membuat daemon gagal boot — fallback ke `info`
 * (env lain tetap fail-fast lewat `config.ts`; logging tidak boleh jadi blocker).
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent';

const LEVELS: readonly LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'];

export function resolveLogLevel(raw: string | undefined = process.env.LOG_LEVEL): LogLevel {
  const value = (raw ?? '').trim().toLowerCase();
  return (LEVELS as readonly string[]).includes(value) ? (value as LogLevel) : 'info';
}

export interface LoggerOptions {
  /** Nama logger (`brain`, `cs`, `socket`, …) — muncul di field `name`. */
  name?: string;
  /** Override level (default: env LOG_LEVEL). */
  level?: LogLevel;
  /** Stream tujuan (dipakai test); default stdout. */
  destination?: DestinationStream;
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  return pino(
    {
      name: opts.name ?? 'brain',
      level: opts.level ?? resolveLogLevel(),
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    opts.destination,
  );
}

/** Logger root Brain — dipakai jalur server/worker utama. */
export const logger = createLogger();
