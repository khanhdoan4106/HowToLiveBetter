#!/usr/bin/env node
/**
 * Sinh sw.js (service worker cho đọc offline) với danh sách file lưu sẵn lấy từ repo.
 *
 *   node tools/tao-sw.mjs           # ghi lại sw.js
 *   node tools/tao-sw.mjs --check   # chỉ so, sw.js cũ thì thoát mã 1 (CI dùng)
 *
 * Danh sách gồm trang, README, bảng thuật ngữ, updates.json, manifest, biểu tượng, og.png,
 * toàn bộ book/*.md và docs/*.md (trừ docs/引用对照.md và docs/核实记录/, trang không đọc tới).
 *
 * Phiên bản bộ nhớ đệm chỉ đổi khi DANH SÁCH file đổi (thêm/bớt chương, bài dài, biểu tượng),
 * không đổi khi sửa nội dung. Nội dung luôn mới nhờ chiến lược "lấy mạng trước" trong sw.js:
 * có mạng thì lấy bản trên máy chủ và cập nhật bản lưu, mất mạng mới dùng bản lưu.
 * Vì vậy sửa chữ trong book/ không cần chạy lại script này.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'sw.js');
const CHECK = process.argv.includes('--check');
const EXCLUDE_DOCS = new Set(['引用对照.md']);

const md = dir => readdirSync(join(ROOT, dir), { withFileTypes: true })
  .filter(d => d.isFile() && d.name.endsWith('.md') && !EXCLUDE_DOCS.has(d.name))
  .map(d => `${dir}/${d.name}`)
  .sort();

const fixed = [
  './', 'index.html', 'selfcheck.html', 'README.md', 'thuat-ngu.md', 'updates.json',
  'manifest.webmanifest', 'og.png',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];
for (const f of fixed.slice(1)) if (!existsSync(join(ROOT, f))) throw new Error(`thiếu file ${f}`);

const files = [...fixed, ...md('book'), ...md('docs')];
const version = createHash('sha256').update(files.join('\n')).digest('hex').slice(0, 10);

const text = `// File này do tools/tao-sw.mjs sinh ra, đừng sửa tay. Sửa template trong script rồi chạy lại.
// Đọc offline cho trang tra cứu: lưu sẵn trang và nội dung sách khi cài, sau đó
// - trang, .md, .json: lấy mạng trước, lưu lại bản mới; mất mạng thì dùng bản đã lưu;
// - ảnh, biểu tượng, manifest: dùng bản đã lưu trước, chưa có thì lấy mạng.
// Chỉ xử lý request GET cùng nguồn; request ra ngoài (font, GitHub, link nguồn) đi thẳng mạng.
const CACHE = 'hltb-${version}';
const FILES = ${JSON.stringify(files, null, 2)};

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // cache: 'reload' để không lấy nhầm bản cũ trong bộ nhớ đệm HTTP của trình duyệt.
    // Từng file một: một file lỗi không làm hỏng cả lần cài.
    await Promise.all(FILES.map(async f => {
      try {
        const res = await fetch(new Request(f, { cache: 'reload' }));
        if (res.ok) await cache.put(f, res);
      } catch (e) { /* bỏ qua, lần sau có mạng sẽ lưu */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('hltb-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

const FRESH = /\\.(md|json|html)$/;

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const fresh = req.mode === 'navigate' || FRESH.test(url.pathname) || url.pathname.endsWith('/');
  event.respondWith(fresh ? networkFirst(req) : cacheFirst(req));
});

async function networkFirst(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(stripSearch(req), res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') {
      const page = await cache.match(new URL(req.url).pathname.endsWith('selfcheck.html') ? 'selfcheck.html' : 'index.html');
      if (page) return page;
    }
    throw e;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(stripSearch(req), res.clone());
  return res;
}

// Trang mở với ?q=… hay ?sec=… vẫn là cùng một file, lưu một bản theo đường dẫn
function stripSearch(req) {
  const url = new URL(req.url);
  url.search = '';
  return url.href;
}
`;

if (CHECK) {
  const cur = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (cur !== text) { console.error('sw.js đã cũ (danh sách file đổi), chạy: node tools/tao-sw.mjs'); process.exit(1); }
  console.log(`sw.js khớp: ${files.length} file, phiên bản ${version}`);
} else {
  writeFileSync(OUT, text, 'utf8');
  console.log(`Đã ghi sw.js: ${files.length} file, phiên bản ${version}`);
}
