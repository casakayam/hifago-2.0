import { createHmac } from "node:crypto";

// Feature 31 (docs/specs/07-connexion-inscription-complete.md §8) — le seed admin
// (admin@hifago.test, supabase/seed.sql) porte désormais un facteur TOTP enrôlé (secret fixe, test
// uniquement) puisque is_admin() exige l'AAL2. Générateur RFC 6238 minimal — pas de dépendance
// externe pour un besoin aussi borné (un seul compte, un seul secret connu).
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// Doit rester identique à la valeur insérée dans supabase/seed.sql (auth.mfa_factors.secret) pour
// admin@hifago.test — jamais un vrai secret, la base locale est recréée à chaque `db reset`.
export const ADMIN_TOTP_SECRET = "MUFUB2W7HB62XKO323JGYVPWPE7OJHI7";

function base32Decode(base32: string): Buffer {
  let bits = "";
  for (const char of base32.replace(/=+$/, "")) {
    const value = BASE32_ALPHABET.indexOf(char.toUpperCase());
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

export function generateTotp(secret: string, timestamp = Date.now()): string {
  const key = base32Decode(secret);
  const counter = Math.floor(timestamp / 1000 / 30);
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", key).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    (((hmac[offset] & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8) |
      (hmac[offset + 3] & 0xff)) %
    1000000;
  return code.toString().padStart(6, "0");
}
