const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const LENGTH = 20;

/**
 * Cryptographically random block id in core's shape: `blk_` + 20 characters
 * of `[0-9a-z]`. Rejection sampling keeps the alphabet uniform (no modulo bias).
 */
export function createBlockId(): string {
  let out = '';
  const bytes = new Uint8Array(LENGTH * 2);
  while (out.length < LENGTH) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      // 252 = largest multiple of 36 below 256, so byte % 36 stays uniform.
      if (byte < 252) out += ALPHABET[byte % 36];
      if (out.length === LENGTH) break;
    }
  }
  return `blk_${out}`;
}
