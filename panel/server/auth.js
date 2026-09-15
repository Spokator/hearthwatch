// Authentification : mot de passe haché (scrypt) + sessions en mémoire.
import crypto from 'node:crypto';

const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password, stored) {
  const [algo, salt, hash] = String(stored || '').split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = crypto.scryptSync(password, Buffer.from(salt, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(actual, expected);
}

// Compare deux chaînes en temps constant (nom d'utilisateur).
export function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export class Sessions {
  constructor({ ttlMs = 12 * 3600 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.map = new Map();
    setInterval(() => this.#purge(), 10 * 60 * 1000).unref();
  }

  create(user) {
    const token = crypto.randomBytes(32).toString('base64url');
    this.map.set(token, { user, expires: Date.now() + this.ttlMs });
    return token;
  }

  get(token) {
    const s = token && this.map.get(token);
    if (!s) return null;
    if (s.expires < Date.now()) {
      this.map.delete(token);
      return null;
    }
    s.expires = Date.now() + this.ttlMs;
    return s;
  }

  destroy(token) {
    this.map.delete(token);
  }

  // Ferme toutes les sessions d'un compte, sauf éventuellement la session courante.
  destroyUser(userId, keepToken) {
    for (const [t, s] of this.map) if (s.user === userId && t !== keepToken) this.map.delete(t);
  }

  #purge() {
    const now = Date.now();
    for (const [t, s] of this.map) if (s.expires < now) this.map.delete(t);
  }
}
