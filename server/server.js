'use strict';

const http = require('http');
const path = require('path');
const { createApp } = require('./app');

const env = process.env;
const app = createApp({
  dataDir: env.DATA_DIR || path.join(__dirname, 'data'),
  siteRoot: env.SITE_ROOT || path.join(__dirname, '..'),
  siteUrl: env.SITE_URL || '',
  trustProxy: env.TRUST_PROXY === '1',
  cookieSecure: env.COOKIE_SECURE === '1',
  adminPassword: env.ADMIN_PASSWORD || ''
});

const port = parseInt(env.PORT || '3000', 10);
const host = env.HOST || '127.0.0.1';

const server = http.createServer((req, res) => { app.handle(req, res); });
server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;
// Видео с телефона по мобильному интернету может грузиться несколько минут
server.requestTimeout = 15 * 60 * 1000;

server.listen(port, host, () => {
  console.log('RIGSARTHUR: http://' + (host === '0.0.0.0' ? 'localhost' : host) + ':' + port);
  console.log('Админка: http://' + (host === '0.0.0.0' ? 'localhost' : host) + ':' + port + '/admin');
  if (!app.auth.hasPassword()) console.log('Пароль админки не задан: npm run password');
});

function stop() {
  server.close(() => { app.store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 5000).unref();
}
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
