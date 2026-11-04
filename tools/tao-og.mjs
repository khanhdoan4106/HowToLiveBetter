#!/usr/bin/env node
/**
 * Tạo ảnh chia sẻ og.png (1200×630) từ tools/og.html.
 *
 * Cài lần đầu:
 *   npm i -D playwright
 *   npx playwright install chromium
 *
 * Chạy lại mỗi khi số mục hoặc chữ trên ảnh đổi:
 *   node tools/tao-og.mjs
 *
 * Nếu Playwright nằm ở nơi khác, đặt biến môi trường PLAYWRIGHT_PATH trỏ tới
 * thư mục package (hoặc để NODE_PATH trỏ tới node_modules có playwright-core).
 *
 * Ảnh ghi ra og.png ở thư mục gốc repo, không commit ảnh chụp kiểm tra nào khác.
 */
import { createRequire } from 'node:module';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'tools', 'og.html');
const OUT = join(ROOT, 'og.png');
const W = 1200, H = 630;

const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const name of ['playwright', 'playwright-core']) {
    try { return require(name); } catch (e) { /* thử tiếp */ }
  }
  if (process.env.PLAYWRIGHT_PATH) {
    try { return require(process.env.PLAYWRIGHT_PATH); } catch (e) { /* thử tiếp */ }
  }
  throw new Error(
    'Không tìm thấy Playwright. Cài: npm i -D playwright && npx playwright install chromium\n' +
    'Hoặc đặt PLAYWRIGHT_PATH trỏ tới thư mục package playwright/playwright-core.'
  );
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(SRC).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: W, height: H } });
} finally {
  await browser.close();
}

const buf = readFileSync(OUT);
const width = buf.readUInt32BE(16), height = buf.readUInt32BE(20);
if (width !== W || height !== H) throw new Error(`og.png là ${width}×${height}, mong đợi ${W}×${H}`);
const kb = statSync(OUT).size / 1024;
if (kb > 300) throw new Error(`og.png nặng ${kb.toFixed(1)} KB, vượt 300 KB`);
console.log(`og.png: ${width}×${height}, ${kb.toFixed(1)} KB`);
