'use strict';

const assert = require('node:assert');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createApp } = require('../app');

const PASS = 'test-password-1';
const ROOT = path.join(__dirname, '..', '..');

// Крошечные настоящие JPEG: 3×2 и 2×3 пикселя
const JPEG_WIDE = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAACAAMDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnaKKK5j2z/9k=', 'base64');
const JPEG_TALL = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnaKKK5j2z/9k=', 'base64');

// Минимальный MP4: ftyp и moov с описанием дорожки нужного кодека
function mp4(codec) {
  const box = (type, ...kids) => {
    const body = Buffer.concat(kids);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + body.length, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, body]);
  };
  const entry = Buffer.alloc(16);
  entry.writeUInt32BE(16, 0);
  entry.write(codec, 4, 'latin1');
  const stsdHead = Buffer.alloc(8);
  stsdHead.writeUInt32BE(1, 4);
  const stsd = box('stsd', stsdHead, entry);
  const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0isomavc1', 'latin1'));
  const moov = box('moov', box('trak', box('mdia', box('minf', box('stbl', stsd)))));
  return Buffer.concat([ftyp, moov, box('mdat', Buffer.alloc(64, 7))]);
}

function start(extra) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rigs-test-'));
  const app = createApp(Object.assign({ dbFile: ':memory:', dataDir: dataDir, siteRoot: ROOT, adminPassword: PASS }, extra || {}));
  const server = http.createServer((req, res) => app.handle(req, res));
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => {
    const base = 'http://127.0.0.1:' + server.address().port;
    const close = server.close.bind(server);
    const stop = () => { close(); server.closeAllConnections(); fs.rmSync(dataDir, { recursive: true, force: true }); };
    resolve({ app, server, base, dataDir, stop });
  }));
}

// Простой клиент со своими cookie, как отдельный браузер
function client(base) {
  const jar = {};
  async function req(method, url, opts) {
    opts = opts || {};
    const headers = Object.assign({}, opts.headers || {});
    const cookie = Object.keys(jar).map(k => k + '=' + jar[k]).join('; ');
    if (cookie) headers.cookie = cookie;
    let body;
    if (opts.json) { headers['content-type'] = 'application/json'; body = JSON.stringify(opts.json); }
    if (opts.form) { headers['content-type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(opts.form).toString(); }
    if (opts.raw) { headers['content-type'] = opts.type; body = opts.raw; }
    const res = await fetch(base + url, { method, headers, body, redirect: 'manual' });
    (res.headers.getSetCookie ? res.headers.getSetCookie() : []).forEach(c => {
      const kv = c.split(';')[0];
      const i = kv.indexOf('=');
      if (/Max-Age=0/.test(c)) delete jar[kv.slice(0, i)]; else jar[kv.slice(0, i)] = kv.slice(i + 1);
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch (e) {}
    return { status: res.status, headers: res.headers, text, data };
  }
  return { req, jar };
}

async function adminLogin(base) {
  const c = client(base);
  const r = await c.req('POST', '/admin/login', { form: { password: PASS } });
  assert.strictEqual(r.status, 303);
  const page = await c.req('GET', '/admin/new');
  c.csrf = /name="_csrf" value="([^"]+)"/.exec(page.text)[1];
  c.post = (url, form) => c.req('POST', url, { form: Object.assign({ _csrf: c.csrf }, form || {}) });
  c.api = (url, json) => c.req('POST', url, { json: json, headers: { 'x-csrf-token': c.csrf } });
  c.upload = (url, buf, type) => c.req('POST', url, { raw: buf, type: type || 'image/jpeg', headers: { 'x-csrf-token': c.csrf } });
  // Фото целиком: большое и маленькое, как делает браузер
  c.photo = async buf => {
    const r1 = await c.upload('/admin/api/media', buf || JPEG_WIDE);
    assert.strictEqual(r1.status, 200, r1.text);
    const r2 = await c.upload('/admin/api/media/' + r1.data.id + '/sm', buf || JPEG_WIDE);
    assert.strictEqual(r2.status, 200, r2.text);
    return r1.data;
  };
  return c;
}

async function createClass(admin, school, title) {
  const r = await admin.post('/admin/new', { school, title, year: '2026', duration_min: '45' });
  assert.strictEqual(r.status, 303);
  return /\/admin\/c\/(\d+)/.exec(r.headers.get('location'))[1];
}

module.exports = { PASS, ROOT, JPEG_WIDE, JPEG_TALL, mp4, start, client, adminLogin, createClass };
