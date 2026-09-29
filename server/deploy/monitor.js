#!/usr/bin/env node
'use strict';
// Сторож сайта: проверяет rigsarthur.ru и пишет в Telegram своим ботом.
// Токен бота хранится только на сервере, в /etc/rigs-monitor.env (читает только root).
//
//   rigs-monitor setup   — один раз: сохранить токен и узнать, куда писать (токен берётся из TG_TOKEN)
//   rigs-monitor check   — сайт, сертификат, место на диске, бэкап (cron каждые 5 минут)
//   rigs-monitor russia  — открывается ли сайт с российских точек check-host.net (cron каждые 30 минут)
//   rigs-monitor daily   — утренняя сводка «всё работает» (cron раз в день)
//   rigs-monitor test    — прислать пробное сообщение
//
// Пишет только когда что-то сломалось и когда починилось, плюс сводка утром.
// Если сводка не пришла — сервер лежит целиком (тогда сторож молчит вместе с ним).

const fs = require('fs');
const tls = require('tls');
const path = require('path');

const SITE = 'https://rigsarthur.ru/';
const HOST = 'rigsarthur.ru';
const APP = 'http://127.0.0.1:3000/';
const MARK = 'RIGSARTHUR';
const ENV_FILE = '/etc/rigs-monitor.env';
const STATE_DIR = '/var/lib/rigs-monitor';
const STATE_FILE = path.join(STATE_DIR, 'state.json');
const BACKUPS = '/srv/rigsalbums/server/data/backups';
const CERT_DAYS = 14;          // предупредить, если сертификату осталось меньше
const DISK_FREE = 0.15;        // и если свободно меньше 15% диска
const BACKUP_HOURS = 30;       // бэкап ночной — старше 30 часов значит не сделался
const FAILS_TO_ALERT = 2;      // сколько проверок подряд должно упасть, чтобы не будить из-за секундного сбоя

function readEnv() {
  const env = {};
  try {
    fs.readFileSync(ENV_FILE, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2];
    });
  } catch (e) {}
  return env;
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) || {}; } catch (e) { return {}; }
}
function writeState(s) {
  fs.mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 1));
  fs.renameSync(tmp, STATE_FILE);
}

async function get(url, opts, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms || 15000);
  try {
    return await fetch(url, Object.assign({ signal: ctl.signal, redirect: 'manual' }, opts || {}));
  } finally {
    clearTimeout(t);
  }
}
const why = e => (e && e.name === 'AbortError') ? 'нет ответа 15 с' : (e && e.cause && e.cause.code) || (e && e.message) || String(e);

async function tg(env, text) {
  if (!env.TG_TOKEN || !env.TG_CHAT) throw new Error('нет TG_TOKEN или TG_CHAT в ' + ENV_FILE);
  const r = await get('https://api.telegram.org/bot' + env.TG_TOKEN + '/sendMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: env.TG_CHAT, text: text, disable_web_page_preview: true })
  }, 20000);
  if (!r.ok) throw new Error('Telegram ответил ' + r.status);
}

// ---------- Проверки: каждая возвращает { ok, text } ----------

async function checkSite() {
  try {
    const r = await get(SITE);
    const body = await r.text();
    if (r.status === 200 && body.includes(MARK)) return { ok: true, text: 'сайт открывается' };
    return { ok: false, text: 'сайт отвечает ' + r.status + (await appHint()) };
  } catch (e) {
    return { ok: false, text: 'сайт не открывается (' + why(e) + ')' + (await appHint()) };
  }
}
// Подсказка, где сломалось: сам сайт (служба rigsalbums) или nginx перед ним
async function appHint() {
  try {
    const r = await get(APP, null, 5000);
    return r.status < 500 ? '; служба сайта жива — смотреть nginx' : '; служба сайта отвечает ' + r.status;
  } catch (e) {
    return '; служба сайта не отвечает — systemctl status rigsalbums';
  }
}

function checkCert() {
  return new Promise(resolve => {
    const done = res => { try { sock.destroy(); } catch (e) {} resolve(res); };
    const sock = tls.connect({ host: HOST, port: 443, servername: HOST, timeout: 15000 }, () => {
      const c = sock.getPeerCertificate();
      if (!c || !c.valid_to) return done({ ok: false, text: 'не удалось прочитать сертификат' });
      const days = Math.floor((new Date(c.valid_to) - Date.now()) / 864e5);
      done({ ok: days >= CERT_DAYS, days: days, text: 'сертификат: осталось ' + days + ' дн.' });
    });
    sock.on('timeout', () => done({ ok: false, text: 'сертификат: нет ответа' }));
    sock.on('error', e => done({ ok: false, text: 'сертификат: ' + why(e) }));
  });
}

function checkDisk() {
  const s = fs.statfsSync('/');
  const free = s.bavail * s.bsize, total = s.blocks * s.bsize;
  const gb = n => (n / 1073741824).toFixed(1);
  return { ok: free / total >= DISK_FREE, text: 'диск: свободно ' + gb(free) + ' из ' + gb(total) + ' ГБ' };
}

function checkBackup() {
  let last = 0;
  try {
    fs.readdirSync(BACKUPS).filter(f => /^rigs-.*\.db$/.test(f)).forEach(f => {
      last = Math.max(last, fs.statSync(path.join(BACKUPS, f)).mtimeMs);
    });
  } catch (e) {}
  if (!last) return { ok: false, text: 'бэкап: ещё ни одного' };
  const h = Math.round((Date.now() - last) / 36e5);
  return { ok: h <= BACKUP_HOURS, text: 'бэкап: ' + (h < 1 ? 'меньше часа' : h + ' ч') + ' назад' };
}

// Российские точки check-host.net. Это дата-центры: общий сбой или блокировку по всей России заметят,
// а блокировку у одного домашнего или мобильного провайдера — не всегда
async function checkRussia() {
  const H = { Accept: 'application/json' };
  try {
    const list = await (await get('https://check-host.net/nodes/hosts', { headers: H })).json();
    const nodes = Object.keys(list.nodes || {}).filter(n => (list.nodes[n].location || [])[0] === 'ru');
    if (!nodes.length) return { ok: null, text: 'Россия: нет точек проверки' };
    const q = nodes.map(n => '&node=' + encodeURIComponent(n)).join('');
    const start = await (await get('https://check-host.net/check-http?host=' + encodeURIComponent(SITE) + q, { headers: H })).json();
    if (!start.request_id) return { ok: null, text: 'Россия: check-host не принял проверку' };
    let res = {};
    for (let i = 0; i < 8; i++) {
      await new Promise(r => setTimeout(r, 4000));
      res = await (await get('https://check-host.net/check-result/' + start.request_id, { headers: H })).json();
      if (nodes.every(n => res[n] !== null && res[n] !== undefined)) break;
    }
    const done = nodes.filter(n => Array.isArray(res[n]) && Array.isArray(res[n][0]));
    if (!done.length) return { ok: null, text: 'Россия: check-host не ответил' };
    const bad = done.filter(n => !(res[n][0][0] === 1 && String(res[n][0][3]) === '200'));
    const city = n => ((list.nodes[n].location || [])[2] || n);
    if (bad.length * 2 < done.length) return { ok: true, text: 'из России открывается (' + (done.length - bad.length) + ' из ' + done.length + ')' };
    return { ok: false, text: 'из России НЕ открывается: ' + bad.map(city).join(', ') };
  } catch (e) {
    // Упал сам check-host — это не повод будить
    return { ok: null, text: 'Россия: check-host недоступен (' + why(e) + ')' };
  }
}

// Пишем только при смене состояния: сломалось (после FAILS_TO_ALERT проверок подряд) или починилось
async function apply(env, state, key, res) {
  if (res.ok === null) return;                 // проверку не удалось провести — ничего не решаем
  const s = state[key] || { fails: 0, alerted: false };
  if (res.ok) {
    if (s.alerted) await tg(env, '🟢 Снова в порядке: ' + res.text);
    state[key] = { fails: 0, alerted: false };
    return;
  }
  s.fails++;
  const need = key === 'site' || key === 'russia' ? FAILS_TO_ALERT : 1;
  if (!s.alerted && s.fails >= need) {
    await tg(env, '🔴 ' + res.text + '\n' + SITE);
    s.alerted = true;
  }
  state[key] = s;
}

async function main() {
  const cmd = process.argv[2] || 'check';
  if (cmd === 'setup') return setup();
  const env = readEnv();
  const state = readState();
  if (cmd === 'test') {
    await tg(env, '👋 Сторож rigsarthur.ru на связи. Буду писать, если сайт сломается.');
    return console.log('Отправлено.');
  }
  if (cmd === 'check') {
    const [site, cert] = await Promise.all([checkSite(), checkCert()]);
    await apply(env, state, 'site', site);
    await apply(env, state, 'cert', cert);
    await apply(env, state, 'disk', checkDisk());
    await apply(env, state, 'backup', checkBackup());
  } else if (cmd === 'russia') {
    await apply(env, state, 'russia', await checkRussia());
  } else if (cmd === 'daily') {
    const all = [await checkSite(), await checkRussia(), await checkCert(), checkDisk(), checkBackup()];
    const bad = all.filter(r => r.ok === false);
    const head = bad.length ? '⚠️ rigsarthur.ru: есть проблемы' : '✅ rigsarthur.ru работает';
    await tg(env, head + '\n' + all.map(r => (r.ok === false ? '• ❗ ' : '• ') + r.text).join('\n'));
  } else {
    console.log('Команды: setup, check, russia, daily, test');
    process.exitCode = 2;
    return;
  }
  writeState(state);
}

// Токен приходит в переменной TG_TOKEN (read -s, чтобы не остался в истории),
// чат берём из последнего сообщения, которое написали боту
async function setup() {
  const token = (process.env.TG_TOKEN || '').trim();
  if (!/^\d+:[\w-]{30,}$/.test(token)) {
    console.error('Токен не похож на токен бота. Скопируй его из @BotFather целиком.');
    process.exit(1);
  }
  const r = await get('https://api.telegram.org/bot' + token + '/getUpdates', null, 20000);
  const data = await r.json().catch(() => ({}));
  if (!data.ok) {
    console.error('Telegram не принял токен (' + r.status + '). Проверь, что скопирован целиком.');
    process.exit(1);
  }
  const msgs = (data.result || []).map(u => u.message || u.edited_message).filter(m => m && m.chat);
  if (!msgs.length) {
    console.error('Бот пока не видит сообщений. Напиши своему боту любое сообщение в Telegram и повтори.');
    process.exit(1);
  }
  const chat = msgs[msgs.length - 1].chat;
  fs.writeFileSync(ENV_FILE, 'TG_TOKEN=' + token + '\nTG_CHAT=' + chat.id + '\n', { mode: 0o600 });
  fs.chmodSync(ENV_FILE, 0o600);
  await tg({ TG_TOKEN: token, TG_CHAT: String(chat.id) }, '👋 Сторож rigsarthur.ru на связи. Буду писать, если сайт сломается.');
  console.log('Готово: пишу в чат ' + (chat.first_name || chat.title || chat.id) + '. Проверь Telegram.');
}

main().catch(e => {
  console.error(new Date().toISOString(), why(e));
  process.exitCode = 1;
});
