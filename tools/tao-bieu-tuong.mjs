#!/usr/bin/env node
/**
 * Tạo biểu tượng ứng dụng (khi "Thêm vào màn hình chính") từ biểu tượng của trang:
 * ô vuông bo góc màu --brand-1 với dấu tích trắng, giống favicon trong index.html.
 *
 *   node tools/tao-bieu-tuong.mjs
 *
 * Ra thư mục icons/:
 *   icon-192.png, icon-512.png       biểu tượng thường (purpose "any")
 *   icon-maskable-512.png            nền kín, dấu tích thu nhỏ vào vùng an toàn (purpose "maskable")
 *   apple-touch-icon.png (180×180)   cho iPhone, iPad
 *
 * Cần Playwright giống tools/tao-og.mjs (npm i -D playwright && npx playwright install chromium,
 * hoặc đặt PLAYWRIGHT_PATH / NODE_PATH).
 */
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'icons');
const BRAND = '#3451b2';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  for (const name of ['playwright', 'playwright-core', process.env.PLAYWRIGHT_PATH].filter(Boolean)) {
    try { return require(name); } catch (e) { /* thử tiếp */ }
  }
  throw new Error('Không tìm thấy Playwright. Cài: npm i -D playwright && npx playwright install chromium');
}

// "any": giống favicon, ô bo góc trên nền trong suốt. "maskable": nền kín toàn ô,
// dấu tích nằm trong vòng tròn an toàn 80% để hệ điều hành cắt tròn hay bo góc đều không mất.
const svg = maskable => maskable
  ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="${BRAND}"/><g transform="translate(32 32) scale(.72) translate(-32 -32)"><path d="M17 33l10 11 20-24" fill="none" stroke="white" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`
  : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${BRAND}"/><path d="M17 33l10 11 20-24" fill="none" stroke="white" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

const JOBS = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  // iOS tự bo góc và không hỗ trợ nền trong suốt, nên dùng bản nền kín
  { file: 'apple-touch-icon.png', size: 180, maskable: true },
];

mkdirSync(OUT, { recursive: true });
const { chromium } = loadPlaywright();
const browser = await chromium.launch();
try {
  for (const j of JOBS) {
    const page = await browser.newPage({ viewport: { width: j.size, height: j.size }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${svg(j.maskable).replace('<svg ', `<svg width="${j.size}" height="${j.size}" `)}</body></html>`);
    await page.screenshot({ path: join(OUT, j.file), omitBackground: true, clip: { x: 0, y: 0, width: j.size, height: j.size } });
    await page.close();
    const buf = readFileSync(join(OUT, j.file));
    const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
    if (w !== j.size || h !== j.size) throw new Error(`${j.file} là ${w}×${h}, mong đợi ${j.size}×${j.size}`);
    console.log(`icons/${j.file}: ${w}×${h}`);
  }
} finally {
  await browser.close();
}
