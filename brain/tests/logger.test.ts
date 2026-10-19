import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { createLogger, resolveLogLevel } from '../src/logger';

/**
 * Logging terstruktur (Fase 12 — kartu 12.6): level dari env LOG_LEVEL dengan
 * fallback aman, output JSON satu baris (name/level/time/msg + field).
 */

function capture(): { chunks: string[]; stream: Writable } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(String(chunk));
      cb();
    },
  });
  return { chunks, stream };
}

describe('logger terstruktur (pino)', () => {
  it('resolveLogLevel menerima level valid (case-insensitive) dan fallback info', () => {
    expect(resolveLogLevel('debug')).toBe('debug');
    expect(resolveLogLevel('WARN')).toBe('warn');
    expect(resolveLogLevel(' Silent ')).toBe('silent');
    expect(resolveLogLevel('verbose')).toBe('info');
    expect(resolveLogLevel('')).toBe('info');
    expect(resolveLogLevel(undefined)).toBe('info');
  });

  it('menulis JSON satu baris dengan name/level/time/msg + field konteks', () => {
    const { chunks, stream } = capture();
    const log = createLogger({ name: 'test-suite', level: 'info', destination: stream });
    log.info({ runId: 'run_1', agent: 'pm' }, 'run dimulai');

    expect(chunks).toHaveLength(1);
    const parsed = JSON.parse(chunks[0] ?? '{}') as Record<string, unknown>;
    expect(parsed.name).toBe('test-suite');
    expect(parsed.msg).toBe('run dimulai');
    expect(parsed.level).toBe(30);
    expect(parsed.runId).toBe('run_1');
    expect(parsed.agent).toBe('pm');
    // isoTime → timestamp ISO 8601 valid.
    expect(new Date(String(parsed.time)).toISOString()).toBe(parsed.time);
    // base: undefined → tidak ada pid/hostname (ringkas untuk docker logs).
    expect(parsed.pid).toBeUndefined();
    expect(parsed.hostname).toBeUndefined();
  });

  it('level env LOG_LEVEL memfilter log di bawahnya', () => {
    const { chunks, stream } = capture();
    const log = createLogger({ level: 'error', destination: stream });
    log.info('tidak boleh tampil');
    log.debug('tidak boleh tampil');
    expect(chunks).toHaveLength(0);
    log.error('tampil');
    expect(chunks).toHaveLength(1);
    expect((JSON.parse(chunks[0] ?? '{}') as { msg: string }).msg).toBe('tampil');
  });
});
