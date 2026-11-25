'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Readable } = require('node:stream');
const { JPEG_WIDE, JPEG_TALL, start, adminLogin, createClass } = require('./helpers');

test('фото в S3: перенос, прежние ссылки, замена, удаление и отказ хранилища', async t => {
  const objects = new Map();
  let unavailable = false;
  const cloud = {
    writable: false,
    async put(key, data) {
      if (unavailable) throw new Error('S3 unavailable');
      objects.set(key, data);
    },
    async get(key, options, head) {
      const data = objects.get(key);
      if (!data) throw Object.assign(new Error('Not found'), { $metadata: { httpStatusCode: 404 } });
      const body = head ? undefined : Readable.from([data]);
      if (body) body.transformToByteArray = async () => data;
      return { Body: body, ContentLength: data.length };
    },
    async remove(key) { objects.delete(key); }
  };
  const site = await start({ photoS3: cloud });
  t.after(site.stop);
  const admin = await adminLogin(site.base);
  const id = +await createClass(admin, 'Школа', '11А');
  const { photos } = site.app;
  const uploadUrl = '/admin/api/media/pk/' + id;
  const full = await admin.upload(uploadUrl + '?path=Фото/1.jpg', JPEG_WIDE);
  assert.equal(full.status, 200);
  const pid = full.data.id;
  const smallUrl = uploadUrl + '/' + pid + '/sm';
  assert.equal((await admin.upload(smallUrl, JPEG_TALL)).status, 200);
  const url = site.base + '/f/' + photos.album(id).slug + '/p/' + pid;
  const localFull = photos.file(id, pid + '.jpg');

  async function checkImage(suffix, jpeg) {
    const response = await fetch(url + suffix);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
  }

  assert.equal((await photos.migrateCloud()).copied, 2);
  assert.equal((await photos.migrateCloud()).copied, 0);
  assert.equal(fs.existsSync(localFull), true);
  const fullKey = photos.object(pid, 'full').object_key;
  objects.set(fullKey, JPEG_TALL);
  await assert.rejects(photos.migrateCloud(true), /Копия не совпадает/);
  assert.equal(fs.existsSync(localFull), true);
  objects.set(fullKey, JPEG_WIDE);
  assert.equal((await photos.migrateCloud(true)).pruned, 2);
  assert.equal(fs.existsSync(localFull), false);
  assert.equal(photos.ready(id).length, 1);
  await checkImage('.jpg', JPEG_WIDE);
  await checkImage('-sm.jpg', JPEG_TALL);
  const head = await fetch(url + '.jpg', { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), String(JPEG_WIDE.length));

  cloud.writable = true;
  unavailable = true;
  assert.equal((await admin.upload(uploadUrl + '?path=Фото/1.jpg', JPEG_TALL)).status, 503);
  assert.equal(photos.ready(id).length, 1);
  await checkImage('.jpg', JPEG_WIDE);

  unavailable = false;
  const replacement = await admin.upload(uploadUrl + '?path=Фото/1.jpg', JPEG_TALL);
  assert.equal(replacement.data.id, pid);
  assert.equal(photos.ready(id).length, 0);
  assert.equal((await admin.upload(smallUrl + '?ver=' + full.data.ver, JPEG_TALL)).status, 409);
  assert.equal((await admin.upload(smallUrl + '?ver=' + replacement.data.ver, JPEG_WIDE)).status, 200);
  assert.equal(photos.ready(id).length, 1);
  assert.equal(fs.existsSync(localFull), false);
  await checkImage('.jpg', JPEG_TALL);
  await checkImage('-sm.jpg', JPEG_WIDE);
  await photos.cleanCloud();
  assert.equal(objects.size, 2);

  await admin.post('/admin/c/' + id + '/photos/delphoto', { photo: pid });
  assert.equal((await fetch(url + '.jpg')).status, 404);
  await photos.cleanCloud();
  assert.equal(objects.size, 0);
});
