#!/usr/bin/env node
/**
 * Sinh updates.json cho nhãn "mới thêm / đã sửa" và bộ lọc "Cập nhật gần đây" trên trang tra cứu.
 *
 * Bản dịch giữ đúng số chương, số mục của bản gốc, nên dùng luôn updates.json của repo gốc
 * ở commit mốc (tools/mốc-bản-gốc.txt): ở đó đã ghi mục nào thêm ngày nào, mục nào sửa nội dung
 * ngày nào (chỉ sửa câu chữ thì không tính). Chỉ lấy các thay đổi từ ngày SINCE trở đi, tức là
 * sau bản gốc mà bản dịch đầu tiên dựa vào, để người đọc bản Việt không thấy nhãn cho những
 * thay đổi đã có sẵn từ lúc dịch.
 *
 * Chạy sau mỗi lần đồng bộ với bản gốc (sau khi đã cập nhật tools/mốc-bản-gốc.txt):
 *   node tools/cap-nhat-moi.mjs           # ghi lại updates.json
 *   node tools/cap-nhat-moi.mjs --check   # chỉ so, khác thì thoát mã 1
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM = 'https://github.com/eternity4719/HowToLiveBetter.git';
const OUT = join(ROOT, 'updates.json');
const CHECK = process.argv.includes('--check');
// Bản dịch đầu tiên dựa trên bản gốc ngày 2026-11-03 (commit 5201667).
const SINCE = '2026-11-04';
const FIELD_VI = {
  标题: 'tiêu đề', 成本: 'chi phí', 说人话: 'nói dễ hiểu', 收益: 'lợi ích', 证据等级: 'mức kiểm chứng', 备注: 'ghi chú',
};

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} thất bại:\n${r.stderr || r.stdout}`);
  return r.stdout;
}

const milestone = readFileSync(join(ROOT, 'tools', 'mốc-bản-gốc.txt'), 'utf8').trim();
if (!/^[0-9a-f]{7,40}$/.test(milestone)) throw new Error(`mốc không hợp lệ: ${milestone}`);

const tmp = mkdtempSync(join(tmpdir(), 'ban-goc-'));
let upstream;
try {
  git(['clone', '--quiet', '--filter=blob:none', '--no-checkout', UPSTREAM, tmp]);
  upstream = JSON.parse(git(['show', `${milestone}:updates.json`], tmp));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

// Các mục có trong bản dịch, để không ghi nhãn cho mục không tồn tại
const have = new Set();
for (const f of readdirSync(join(ROOT, 'book')).filter(f => f.endsWith('.md'))) {
  const sec = parseInt(f, 10);
  for (const m of readFileSync(join(ROOT, 'book', f), 'utf8').matchAll(/^### (\d+)\. /gm)) have.add(`${sec}-${m[1]}`);
}

const items = {};
let missing = 0;
for (const [key, u] of Object.entries(upstream.items || {})) {
  const date = u.added || u.changed;
  if (!date || date < SINCE) continue;
  if (!have.has(key)) { missing++; continue; }
  items[key] = u.added ? { added: u.added }
    : { changed: u.changed, fields: (u.fields || []).map(f => FIELD_VI[f] || f) };
}
if (missing) console.error(`Bỏ qua ${missing} mục có trong bản gốc nhưng chưa có trong bản dịch (chưa đồng bộ?)`);

const sorted = Object.fromEntries(Object.entries(items).sort(([a], [b]) => {
  const [sa, na] = a.split('-').map(Number), [sb, nb] = b.split('-').map(Number);
  return sa - sb || na - nb;
}));
const text = '{"since":"' + SINCE + '","base":"' + milestone + '","items":{\n'
  + Object.entries(sorted).map(([k, v]) => JSON.stringify(k) + ':' + JSON.stringify(v)).join(',\n')
  + '\n}}\n';

const added = Object.values(sorted).filter(v => v.added).length;
const changed = Object.keys(sorted).length - added;
if (CHECK) {
  let cur = '';
  try { cur = readFileSync(OUT, 'utf8'); } catch {}
  if (cur !== text) { console.error('updates.json đã cũ, chạy: node tools/cap-nhat-moi.mjs'); process.exit(1); }
  console.log(`updates.json khớp mốc ${milestone.slice(0, 7)}: ${added} mục mới thêm, ${changed} mục đã sửa.`);
} else {
  writeFileSync(OUT, text, 'utf8');
  console.log(`Đã ghi updates.json theo mốc ${milestone.slice(0, 7)}: ${added} mục mới thêm, ${changed} mục đã sửa (từ ${SINCE}).`);
}
