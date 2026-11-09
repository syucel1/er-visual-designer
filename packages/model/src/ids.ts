/**
 * Sortable unique IDs (ULID-style: 48-bit time + 80 bits of randomness, Crockford base32).
 * Prefixed by element kind for readability in files and logs: t_ table, c_ column, r_ relationship, p_ project.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.getRandomValues) c.getRandomValues(out);
  else for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

export function ulid(now = Date.now()): string {
  let time = '';
  let t = now;
  for (let i = 0; i < 10; i++) {
    time = ALPHABET[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const bytes = randomBytes(16);
  let rand = '';
  for (let i = 0; i < 16; i++) rand += ALPHABET[bytes[i]! % 32];
  return time + rand;
}

export const newId = (prefix: 't' | 'c' | 'r' | 'p') => `${prefix}_${ulid()}`;
