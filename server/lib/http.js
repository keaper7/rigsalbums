'use strict';

const fs = require('fs');
const path = require('path');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8'
};

// Текстовые файлы каждый раз сверяются с сервером, картинки и шрифты кэшируются на неделю
const REVALIDATE = ['.html', '.css', '.js', '.json', '.webmanifest', '.txt'];

function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i < 1) return;
    const k = p.slice(0, i).trim();
    const v = p.slice(i + 1).trim();
    try { out[k] = decodeURIComponent(v); } catch (e) { out[k] = v; }
  });
  return out;
}

function setCookie(res, name, value, o) {
  o = o || {};
  let c = name + '=' + encodeURIComponent(value) + '; Path=' + (o.path || '/');
  if (o.maxAge !== undefined) c += '; Max-Age=' + Math.floor(o.maxAge);
  if (o.httpOnly !== false) c += '; HttpOnly';
  c += '; SameSite=' + (o.sameSite || 'Lax');
  if (o.secure) c += '; Secure';
  const prev = res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie', (Array.isArray(prev) ? prev : prev ? [prev] : []).concat(c));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let over = false;
    req.on('data', ch => {
      if (over) return;
      size += ch.length;
      if (size > limit) {
        over = true;
        chunks.length = 0;
        reject(Object.assign(new Error('Слишком большой запрос'), { status: 413 }));
        return;
      }
      chunks.push(ch);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

// Форма: повторяющиеся поля собираются в массив
function parseForm(str) {
  const out = {};
  new URLSearchParams(str).forEach((v, k) => {
    if (k in out) out[k] = [].concat(out[k], v);
    else out[k] = v;
  });
  return out;
}

function send(res, status, body, type, headers) {
  if (res.headersSent) return;
  const h = Object.assign({ 'Content-Type': type || 'text/html; charset=utf-8' }, headers || {});
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  h['Content-Length'] = buf.length;
  res.writeHead(status, h);
  res.end(res.req && res.req.method === 'HEAD' ? undefined : buf);
}

function json(res, status, obj) {
  send(res, status, JSON.stringify(obj), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store' });
}

function redirect(res, location, status) {
  if (res.headersSent) return;
  res.writeHead(status || 303, { Location: location, 'Content-Length': 0 });
  res.end();
}

// Раздача файлов сайта с поддержкой Range: без неё Safari не проигрывает видео
function serveStatic(root, req, res, pathname, deny, opts) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { return false; }
  if (rel.indexOf('\0') !== -1) return false;
  if (rel.endsWith('/')) rel += 'index.html';
  const parts = rel.split('/').filter(Boolean);
  if (parts.some(p => p.charAt(0) === '.')) return false;
  if (parts.length && deny.indexOf(parts[0]) !== -1) return false;
  const file = path.join(root, ...parts);
  if (file !== root && !file.startsWith(root + path.sep)) return false;
  const ext = path.extname(file).toLowerCase();
  if (!TYPES[ext]) return false;
  let st;
  try { st = fs.statSync(file); } catch (e) { return false; }
  if (!st.isFile()) return false;

  const etag = 'W/"' + st.size.toString(36) + '-' + Math.floor(st.mtimeMs).toString(36) + '"';
  const headers = {
    'Content-Type': TYPES[ext],
    'ETag': etag,
    'Last-Modified': st.mtime.toUTCString(),
    'Cache-Control': opts && opts.cache ? opts.cache : REVALIDATE.indexOf(ext) !== -1 ? 'no-cache' : 'public, max-age=604800',
    'Accept-Ranges': 'bytes'
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }

  let start = 0, end = st.size - 1, status = 200;
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && st.size) {
    if (range[1] === '') { start = Math.max(0, st.size - Number(range[2])); }
    else { start = Number(range[1]); if (range[2] !== '') end = Math.min(end, Number(range[2])); }
    if (start > end || start >= st.size) {
      res.writeHead(416, { 'Content-Range': 'bytes */' + st.size });
      res.end();
      return true;
    }
    status = 206;
    headers['Content-Range'] = 'bytes ' + start + '-' + end + '/' + st.size;
  }
  headers['Content-Length'] = st.size ? end - start + 1 : 0;
  res.writeHead(status, headers);
  if (req.method === 'HEAD' || !st.size) { res.end(); return true; }
  fs.createReadStream(file, { start: start, end: end }).on('error', () => res.destroy()).pipe(res);
  return true;
}

// Маршруты вида /admin/c/:id
class Router {
  constructor() { this.routes = []; }

  add(method, pattern, handler, opts) {
    const keys = [];
    const re = new RegExp('^' + pattern.replace(/\/:([a-z]+)/g, (m, k) => { keys.push(k); return '/([^/]+)'; }) + '/?$');
    this.routes.push({ method: method, re: re, keys: keys, handler: handler, raw: !!(opts && opts.raw) });
  }

  get(p, h) { this.add('GET', p, h); }
  post(p, h, opts) { this.add('POST', p, h, opts); }

  find(method, pathname) {
    const m = method === 'HEAD' ? 'GET' : method;
    let allowed = false;
    for (const r of this.routes) {
      const hit = r.re.exec(pathname);
      if (!hit) continue;
      if (r.method !== m) { allowed = true; continue; }
      const params = {};
      r.keys.forEach((k, i) => {
        try { params[k] = decodeURIComponent(hit[i + 1]); } catch (e) { params[k] = hit[i + 1]; }
      });
      return { handler: r.handler, params: params, raw: r.raw };
    }
    return allowed ? { notAllowed: true } : null;
  }
}

module.exports = { parseCookies, setCookie, readBody, parseForm, send, json, redirect, serveStatic, Router, TYPES };
