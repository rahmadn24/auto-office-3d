import { timingSafeEqual } from 'node:crypto';

/**
 * Auth token (PRD §6.5 / Fase 12) — Brain bisa diakses dua kelas klien:
 *
 *   privileged : operator (Theater) — boleh kontrol run, founder chat, CS inbox/quote.
 *   public     : widget CS di halaman demo — hanya `cs:widget_message`.
 *
 * `BRAIN_AUTH_TOKEN` kosong = semua privileged (dev lokal/e2e). Di VPS token
 * diisi dan Caddy menyuntik `Authorization: Bearer <token>` untuk host office,
 * sementara host publik (cs.<domain>) meneruskan apa adanya → socket tanpa
 * token otomatis unprivileged.
 */

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Cocokkan nilai header Authorization (`Bearer x` / `Basic user:x`). */
export function isAuthorizedHeader(
  authorization: string | string[] | undefined,
  expected: string | undefined,
): boolean {
  if (!expected) return true;
  const value = Array.isArray(authorization) ? authorization[0] : authorization;
  if (!value) return false;
  if (value.startsWith('Bearer ')) return safeEqual(value.slice(7).trim(), expected);
  if (value.startsWith('Basic ')) {
    try {
      const decoded = Buffer.from(value.slice(6).trim(), 'base64').toString('utf8');
      const sep = decoded.indexOf(':');
      // Password basic-auth = token (user bebas, biasanya `founder`).
      return sep >= 0 && safeEqual(decoded.slice(sep + 1), expected);
    } catch {
      return false;
    }
  }
  // Dukung token mentah (mis. header kustom dari reverse proxy).
  return safeEqual(value.trim(), expected);
}

/** Handshake socket.io: `auth.token` (browser) atau header reverse proxy. */
export function isAuthorizedHandshake(
  handshake: {
    auth?: unknown;
    headers?: Record<string, string | string[] | undefined>;
  },
  expected: string | undefined,
): boolean {
  if (!expected) return true;
  const auth = handshake.auth as { token?: unknown } | undefined;
  if (auth && typeof auth.token === 'string' && safeEqual(auth.token, expected)) return true;
  return isAuthorizedHeader(handshake.headers?.authorization, expected);
}
