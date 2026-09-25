'use strict';

const crypto = require('crypto');
const { token, sha256 } = require('./util');

const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;

function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 });
  return 'scrypt$' + salt.toString('base64') + '$' + hash.toString('base64');
}

function verifyPassword(pw, stored) {
  const p = String(stored || '').split('$');
  if (p.length !== 3 || p[0] !== 'scrypt') return false;
  const salt = Buffer.from(p[1], 'base64');
  const want = Buffer.from(p[2], 'base64');
  const got = crypto.scryptSync(String(pw), salt, want.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(want, got);
}

// Счётчик попыток по ключу (IP) в скользящем окне
class Limiter {
  constructor(max, windowMs) {
    this.max = max;
    this.win = windowMs;
    this.hits = new Map();
  }

  hit(key) {
    const now = Date.now();
    const list = (this.hits.get(key) || []).filter(t => now - t < this.win);
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 5000) this.sweep();
    return list.length <= this.max;
  }

  blocked(key) {
    const now = Date.now();
    return (this.hits.get(key) || []).filter(t => now - t < this.win).length >= this.max;
  }

  reset(key) { this.hits.delete(key); }

  sweep() {
    const now = Date.now();
    this.hits.forEach((list, k) => { if (!list.some(t => now - t < this.win)) this.hits.delete(k); });
  }
}

class Auth {
  constructor(store) {
    this.store = store;
    this.secret = store.getSetting('secret');
    if (!this.secret) {
      this.secret = token(32);
      store.setSetting('secret', this.secret);
    }
    this.logins = new Limiter(8, 15 * 60 * 1000);
  }

  hasPassword() { return !!this.store.getSetting('password'); }

  setPassword(pw) {
    this.store.setSetting('password', hashPassword(pw));
    this.store.deleteAllSessions();
  }

  check(pw) { return verifyPassword(pw, this.store.getSetting('password')); }

  // В cookie лежит токен, в базе только его хэш
  login() {
    const t = token(32);
    this.store.purgeSessions();
    this.store.createSession(sha256(t), SESSION_TTL);
    return t;
  }

  session(t) {
    if (!t) return null;
    const s = this.store.getSession(sha256(t));
    return s ? { id: s.id, csrf: this.csrf(s.id) } : null;
  }

  logout(t) { if (t) this.store.deleteSession(sha256(t)); }

  csrf(sessionId) {
    return crypto.createHmac('sha256', this.secret).update('csrf:' + sessionId).digest('base64url');
  }

  csrfOk(sess, value) {
    if (!sess || typeof value !== 'string') return false;
    const a = Buffer.from(sess.csrf);
    const b = Buffer.from(value);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}

module.exports = { Auth, Limiter, hashPassword, verifyPassword, SESSION_TTL };
