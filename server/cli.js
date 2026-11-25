'use strict';

// npm run password — задать пароль админки
// npm run backup   — копия базы и загруженных файлов в data/backups
// npm run demo     — пересобрать демо-страницу class.html из шаблона сервера

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { randomUUID } = require('node:crypto');

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const dbFile = path.join(dataDir, 'rigs.db');
const cmd = process.argv[2];

function ask(q, hidden) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = function (s) { if (s.indexOf(q) === 0) rl.output.write(s); };
    }
    rl.question(q, a => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a); });
  });
}

async function password() {
  const { Store } = require('./lib/db');
  const { Auth } = require('./lib/auth');
  const store = new Store(dbFile);
  const auth = new Auth(store);
  const a = await ask('Новый пароль админки: ', true);
  if (a.length < 8) { console.log('Минимум 8 символов'); process.exit(1); }
  const b = await ask('Ещё раз: ', true);
  if (a !== b) { console.log('Пароли не совпадают'); process.exit(1); }
  auth.setPassword(a);
  store.close();
  console.log('Пароль сохранён. Все старые входы в админку сброшены.');
}

function backup() {
  const { Store } = require('./lib/db');
  const store = new Store(dbFile);
  const dir = path.join(dataDir, 'backups');
  const stamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, '-');
  const file = path.join(dir, 'rigs-' + stamp + '.db');
  if (fs.existsSync(file)) fs.unlinkSync(file);
  store.backup(file);
  store.close();
  // Храним последние 30 копий
  const old = fs.readdirSync(dir).filter(f => /^rigs-.*\.db$/.test(f)).sort();
  old.slice(0, Math.max(0, old.length - 30)).forEach(f => fs.unlinkSync(path.join(dir, f)));
  // Загруженные фото и видео: докладываем в копию только новые, файлы не меняются
  const src = path.join(dataDir, 'media');
  const dst = path.join(dir, 'media');
  let copied = 0;
  if (fs.existsSync(src)) {
    fs.mkdirSync(dst, { recursive: true });
    fs.readdirSync(src).filter(f => !f.endsWith('.part')).forEach(f => {
      if (fs.existsSync(path.join(dst, f))) return;
      fs.copyFileSync(path.join(src, f), path.join(dst, f));
      copied++;
    });
  }
  // Файл убрали с сайта: храним его копию ещё 30 дней (столько живут копии базы), потом удаляем,
  // иначе заменённые видео и фото копились бы на диске вечно
  let dropped = 0;
  if (fs.existsSync(dst)) {
    const goneFile = path.join(dir, 'gone.json');
    let gone = {};
    try { gone = JSON.parse(fs.readFileSync(goneFile, 'utf8')) || {}; } catch (e) {}
    const now = Date.now();
    const keep = 30 * 24 * 60 * 60 * 1000;
    const next = {};
    fs.readdirSync(dst).forEach(f => {
      if (fs.existsSync(path.join(src, f))) return;
      const since = gone[f] || now;
      if (now - since > keep) { fs.unlinkSync(path.join(dst, f)); dropped++; }
      else next[f] = since;
    });
    fs.writeFileSync(goneFile, JSON.stringify(next));
  }
  console.log('Бэкап: ' + file + (copied ? ', новых файлов: ' + copied : '') + (dropped ? ', удалено старых: ' + dropped : ''));
}

function demo() {
  const { visibleOptions } = require('./lib/voting');
  const { classPage } = require('./views/klass');
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed', 'catalog.json'), 'utf8'));
  const cls = { school: 'Школа', title: '11 класс', year: 2026, hidden: [] };
  const out = classPage({
    cls: cls, opts: visibleOptions(catalog, cls), status: 'open', state: null, result: null, base: '', demo: true,
    meta: {
      title: 'Выбор альбома · RIGSARTHUR SCHOOL ALBUMS',
      ogTitle: 'Выбор альбома вашего класса',
      image: 'https://rigsarthur.ru/assets/og-class.jpg',
      url: 'https://rigsarthur.ru/class.html'
    }
  });
  const file = path.join(__dirname, '..', 'class.html');
  fs.writeFileSync(file, out);
  console.log('Собрано: ' + file);
}

async function photosS3() {
  const action = process.argv[3];
  if (!['check', 'copy', 'prune'].includes(action)) {
    throw new Error('Использование: node cli.js photos-s3 check | copy [ID класса] | prune [ID класса]');
  }
  const { photoS3 } = require('./lib/photo-s3');
  const cloud = photoS3(process.env);
  if (!cloud) throw new Error('Сначала настройте S3');
  if (action === 'check') {
    const key = '_connection-test/' + randomUUID() + '.txt';
    const data = Buffer.from('Rigsarthur S3 test\\n');
    await cloud.put(key, data, 'text/plain');
    console.log('Загрузка OK');
    try {
      const result = await cloud.get(key);
      if (!data.equals(Buffer.from(await result.Body.transformToByteArray()))) throw new Error('Тестовый файл изменился');
      console.log('Скачивание OK, файл совпадает');
    } finally {
      await cloud.remove(key);
      console.log('Удаление OK');
    }
    return;
  }

  const classId = process.argv[4] === undefined ? null : Number(process.argv[4]);
  if (classId !== null && (!Number.isSafeInteger(classId) || classId < 1)) throw new Error('Укажите числовой ID класса');
  if (!fs.existsSync(dbFile)) throw new Error('Не найдена база: ' + dbFile);
  const { Store } = require('./lib/db');
  const { Photos } = require('./lib/photos');
  const store = new Store(dbFile);
  try {
    if (classId !== null && !store.db.prepare('SELECT id FROM classes WHERE id = ?').get(classId)) {
      throw new Error('Класс не найден: ' + classId);
    }
    const photos = new Photos(store, path.join(dataDir, 'photos'), cloud);
    const report = await photos.migrateCloud(action === 'prune', classId);
    console.log('Скопировано: %d. Удалено с диска: %d (%d байт). Пропущено: %d.',
      report.copied, report.pruned, report.freedBytes, report.skipped);
    if (report.skipped) process.exitCode = 1;
  } finally {
    store.close();
  }
}

const cmds = { password: password, backup: backup, demo: demo, 'photos-s3': photosS3 };
if (!cmds[cmd]) {
  console.log('Команды: password, backup, demo, photos-s3');
  process.exit(1);
}
Promise.resolve(cmds[cmd]()).catch(e => { console.error(e); process.exit(1); });
