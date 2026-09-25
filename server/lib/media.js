'use strict';

// Загруженные фото и видео. Фото ужимает сам браузер перед отправкой,
// сервер только проверяет файл и сохраняет его как есть

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ID_RE = /^[a-z0-9]{16}$/;
const FILE_RE = /^([a-z0-9]{16})(-sm|-lg)?\.(jpg|mp4)$/;
const IMAGE_MAX = 15 * 1024 * 1024;
const VIDEO_MAX = 400 * 1024 * 1024;
const GRACE = 24 * 60 * 60 * 1000;

function newId() {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const b = crypto.randomBytes(16);
  let s = '';
  for (let i = 0; i < 16; i++) s += abc[b[i] % abc.length];
  return s;
}

function fail(status, message) {
  return Object.assign(new Error(message), { status: status, expose: true });
}

// Тело запроса целиком в память, с лимитом. Лишнее не копим, соединение
// закроет обработчик ошибок после ответа 413
function readAll(req, limit) {
  return new Promise((resolve, reject) => {
    const len = +req.headers['content-length'];
    if (len && len > limit) return reject(fail(413, 'Файл слишком большой'));
    let size = 0, over = false;
    const chunks = [];
    req.on('data', ch => {
      if (over) return;
      size += ch.length;
      if (size > limit) { over = true; chunks.length = 0; reject(fail(413, 'Файл слишком большой')); return; }
      chunks.push(ch);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
}

// Размеры JPEG из заголовка кадра (маркеры SOF)
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xFF || buf[1] !== 0xD8) return null;
  let off = 2;
  while (off + 4 < buf.length) {
    if (buf[off] !== 0xFF) { off++; continue; }
    const marker = buf[off + 1];
    if (marker === 0xFF) { off++; continue; }
    if (marker === 0xD8 || marker === 0x01 || (marker >= 0xD0 && marker <= 0xD7)) { off += 2; continue; }
    if (marker === 0xD9 || marker === 0xDA) return null;
    const len = buf.readUInt16BE(off + 2);
    const isSof = marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC;
    if (isSof && off + 9 < buf.length) {
      return { h: buf.readUInt16BE(off + 5), w: buf.readUInt16BE(off + 7) };
    }
    off += 2 + len;
  }
  return null;
}

// Кодек видео: идём по коробкам MP4/MOV до описания дорожки (stsd)
function videoCodec(file) {
  const fd = fs.openSync(file, 'r');
  const size = fs.fstatSync(fd).size;
  const head = Buffer.alloc(16);
  const found = [];
  function box(pos) {
    if (fs.readSync(fd, head, 0, 16, pos) < 8) return null;
    let len = head.readUInt32BE(0);
    const type = head.toString('latin1', 4, 8);
    let hdr = 8;
    if (len === 1) { len = Number(head.readBigUInt64BE(8)); hdr = 16; }
    else if (len === 0) len = size - pos;
    if (len < hdr) return null;
    return { type: type, start: pos, len: len, body: pos + hdr };
  }
  function walk(from, to, depth) {
    let pos = from;
    while (pos + 8 <= to && depth < 8) {
      const b = box(pos);
      if (!b) return;
      if (['moov', 'trak', 'mdia', 'minf', 'stbl'].indexOf(b.type) !== -1) walk(b.body, b.start + b.len, depth + 1);
      else if (b.type === 'stsd') {
        const e = Buffer.alloc(16);
        fs.readSync(fd, e, 0, 16, b.body + 8);
        found.push(e.toString('latin1', 4, 8));
      }
      pos = b.start + b.len;
    }
  }
  try {
    const first = box(0);
    if (!first || first.type !== 'ftyp') return { ok: false };
    walk(0, size, 0);
  } finally {
    fs.closeSync(fd);
  }
  let codec = 'unknown';
  if (found.some(f => f === 'avc1' || f === 'avc3')) codec = 'avc';
  else if (found.some(f => f === 'hvc1' || f === 'hev1')) codec = 'hevc';
  return { ok: true, codec: codec };
}

class Media {
  constructor(store, dir) {
    this.store = store;
    this.dir = dir;
    fs.mkdirSync(dir, { recursive: true });
  }

  file(name) { return path.join(this.dir, name); }

  // Большая версия фото: создаёт запись и возвращает её
  async saveImage(req) {
    const buf = await readAll(req, IMAGE_MAX);
    const size = jpegSize(buf);
    if (!size || !size.w || !size.h) throw fail(400, 'Это не похоже на фото в формате JPEG');
    if (size.w > 6000 || size.h > 6000) throw fail(400, 'Фото слишком большое по размеру');
    const id = newId();
    fs.writeFileSync(this.file(id + '-lg.jpg'), buf);
    this.store.addMedia({ id: id, kind: 'image', ext: 'jpg', w: size.w, h: size.h, bytes: buf.length });
    return { id: id, w: size.w, h: size.h };
  }

  // Маленькая версия того же фото для превью и плиток
  async saveSmall(id, req) {
    const m = this.store.getMedia(id);
    if (!m || m.kind !== 'image') throw fail(404, 'Фото не найдено');
    const buf = await readAll(req, IMAGE_MAX);
    if (!jpegSize(buf)) throw fail(400, 'Это не похоже на фото в формате JPEG');
    fs.writeFileSync(this.file(id + '-sm.jpg'), buf);
    return { ok: true };
  }

  // Видео пишем на диск потоком: оно может весить сотни мегабайт
  saveVideo(req) {
    return new Promise((resolve, reject) => {
      const len = +req.headers['content-length'];
      if (len && len > VIDEO_MAX) return reject(fail(413, 'Видео больше 400 МБ, его лучше укоротить'));
      const id = newId();
      const part = this.file(id + '.part');
      const out = fs.createWriteStream(part);
      let size = 0, failed = false;
      const stop = err => {
        if (failed) return;
        failed = true;
        req.unpipe(out);
        out.destroy();
        fs.unlink(part, () => {});
        reject(err);
      };
      req.on('data', ch => {
        size += ch.length;
        if (size > VIDEO_MAX) stop(fail(413, 'Видео больше 400 МБ, его лучше укоротить'));
      });
      req.on('aborted', () => stop(fail(400, 'Загрузка прервалась')));
      req.on('error', stop);
      out.on('error', stop);
      out.on('finish', () => {
        if (failed) return;
        let info;
        try { info = videoCodec(part); } catch (e) { info = { ok: false }; }
        if (!info.ok) { fs.unlink(part, () => {}); return reject(fail(400, 'Это не похоже на видео MP4 или MOV')); }
        fs.renameSync(part, this.file(id + '.mp4'));
        const note = info.codec === 'hevc' ? 'hevc' : '';
        this.store.addMedia({ id: id, kind: 'video', ext: 'mp4', bytes: size, note: note });
        resolve({ id: id, codec: info.codec, bytes: size });
      });
      req.pipe(out);
    });
  }

  // Путь для страниц сайта: media/<id>-sm.jpg и так далее
  image(id) {
    const m = this.store.getMedia(id);
    if (!m || m.kind !== 'image') return null;
    const hasSm = fs.existsSync(this.file(id + '-sm.jpg'));
    return {
      media: id,
      sm: 'media/' + id + (hasSm ? '-sm' : '-lg') + '.jpg',
      lg: 'media/' + id + '-lg.jpg',
      w: m.w, h: m.h
    };
  }

  video(id) {
    const m = this.store.getMedia(id);
    if (!m || m.kind !== 'video') return null;
    return { media: id, video: 'media/' + id + '.mp4', note: m.note };
  }

  // Удаляем файлы, на которые больше ничего не ссылается. Свежие не трогаем:
  // они могли только что загрузиться и ещё ждут, куда их поставят
  gc() {
    const refs = this.store.mediaRefs();
    const now = Date.now();
    let removed = 0;
    this.store.listMedia().forEach(m => {
      if (refs.has(m.id) || now - m.created_at < GRACE) return;
      ['-sm.jpg', '-lg.jpg', '.mp4'].forEach(s => { try { fs.unlinkSync(this.file(m.id + s)); } catch (e) {} });
      this.store.deleteMedia(m.id);
      removed++;
    });
    // Недокачанные видео старше суток
    try {
      fs.readdirSync(this.dir).filter(f => f.endsWith('.part')).forEach(f => {
        const st = fs.statSync(this.file(f));
        if (now - st.mtimeMs > GRACE) fs.unlinkSync(this.file(f));
      });
    } catch (e) {}
    return removed;
  }
}

module.exports = { Media, jpegSize, videoCodec, ID_RE, FILE_RE, newId };
