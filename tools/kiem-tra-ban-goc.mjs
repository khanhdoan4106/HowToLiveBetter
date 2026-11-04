#!/usr/bin/env node
/**
 * Kiểm tra repo gốc eternity4719/HowToLiveBetter có thay đổi trong book/ và docs/
 * kể từ mốc bản dịch hay không. Chỉ báo, không sửa gì.
 *
 * Chạy:
 *   node tools/kiem-tra-ban-goc.mjs
 *   node tools/kiem-tra-ban-goc.mjs --milestone 5201667        # thử bằng mốc cũ
 *   node tools/kiem-tra-ban-goc.mjs --out issue.md             # ghi nội dung issue
 *   node tools/kiem-tra-ban-goc.mjs --github-output "$GITHUB_OUTPUT"
 *
 * Không có thay đổi: in "Không có thay đổi", thoát mã 0.
 * Có thay đổi: in Markdown (dùng làm nội dung issue), thoát mã 0.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UPSTREAM = 'https://github.com/eternity4719/HowToLiveBetter.git';
const MILESTONE_FILE = join(ROOT, 'tools', 'mốc-bản-gốc.txt');
const LABEL = 'ban-goc-doi';
// Không tính các file chỉ để đối chiếu/ghi chép nội bộ của repo gốc.
const EXCLUDES = [':(exclude)docs/核实记录', ':(exclude)docs/引用对照.md'];

function arg(name) {
  const i = process.argv.indexOf(name);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw r.error;
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} thất bại:\n${r.stderr || r.stdout}`);
  }
  return r.stdout;
}

function gitHas(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' }).status === 0;
}

function show(cwd, ref, path) {
  const r = spawnSync('git', ['show', `${ref}:${path}`], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return r.status === 0 ? r.stdout : '';
}

/** Các dòng tiêu đề mục: "### 49. ..." (trong book) hoặc "### ..." (trong docs). */
function parseHeadings(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^###\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const body = m[1];
    const num = /^(\d+)[.、]\s*(.*)$/.exec(body);
    out.push({
      raw: body,
      num: num ? num[1] : null,
      title: num ? num[2] : body,
    });
  }
  return out;
}

function where(path, heading) {
  const base = path.split('/').pop().replace(/\.md$/, '');
  const chapter = /^(\d+)-(.+)$/.exec(base);
  const place = chapter ? `chương ${Number(chapter[1])} (${chapter[2]})` : `\`${path}\``;
  return heading.num ? `${place} · mục ${heading.num}` : place;
}

function mdCell(s) {
  return String(s).replace(/\|/g, '\\|');
}

function main() {
  const milestoneArg = arg('--milestone');
  const outFile = arg('--out');
  const githubOutput = arg('--github-output');

  const milestone = (milestoneArg ?? readFileSync(MILESTONE_FILE, 'utf8')).trim().toLowerCase();
  if (!/^[0-9a-f]{7,40}$/.test(milestone)) {
    throw new Error(`Mốc không hợp lệ: "${milestone}" (cần hash commit, xem ${MILESTONE_FILE})`);
  }

  const tmp = mkdtempSync(join(tmpdir(), 'kiem-tra-ban-goc-'));
  const repo = join(tmp, 'upstream');

  try {
    git(['clone', '--quiet', '--no-checkout', '--single-branch', '--branch', 'main', UPSTREAM, repo], tmp);

    if (!gitHas(['cat-file', '-e', `${milestone}^{commit}`], repo)) {
      // Mốc cũ nằm ngoài lịch sử clone được (hiếm): thử lấy thẳng commit đó.
      git(['fetch', '--quiet', 'origin', milestone], repo);
    }

    const head = git(['rev-parse', 'HEAD'], repo).trim();
    const [headShort, headDate, ...headSubjectParts] = git(
      ['log', '-1', '--format=%h%x09%ci%x09%s', 'HEAD'],
      repo,
    ).trim().split('\t');
    const headSubject = headSubjectParts.join('\t');

    const changed = git(
      ['diff', '--name-only', '-z', milestone, 'HEAD', '--', 'book', 'docs', ...EXCLUDES],
      repo,
    ).split('\0').filter(Boolean);

    if (changed.length === 0) {
      console.log('Không có thay đổi');
      if (githubOutput) appendFileSync(githubOutput, 'changed=false\n');
      if (outFile) writeFileSync(outFile, '', 'utf8');
      return;
    }

    const rows = [];
    const addedAll = [];
    const removedAll = [];
    const renamedAll = [];
    const contentOnly = [];

    for (const file of changed) {
      const oldHeadings = parseHeadings(show(repo, milestone, file));
      const newHeadings = parseHeadings(show(repo, 'HEAD', file));
      const oldRaws = new Set(oldHeadings.map((h) => h.raw));
      const newRaws = new Set(newHeadings.map((h) => h.raw));

      const added = newHeadings.filter((h) => !oldRaws.has(h.raw));
      const removed = oldHeadings.filter((h) => !newRaws.has(h.raw));

      const removedByNum = new Map();
      for (const h of removed) if (h.num) removedByNum.set(h.num, h);

      const renamed = [];
      const addedOnly = [];
      for (const h of added) {
        const before = h.num ? removedByNum.get(h.num) : null;
        if (before) {
          renamed.push({ before, after: h });
          removedByNum.delete(h.num);
        } else {
          addedOnly.push(h);
        }
      }
      const renamedBefore = new Set(renamed.map((r) => r.before.raw));
      const removedOnly = removed.filter((h) => !renamedBefore.has(h.raw));

      for (const h of addedOnly) addedAll.push({ file, heading: h });
      for (const h of removedOnly) removedAll.push({ file, heading: h });
      for (const r of renamed) renamedAll.push({ file, ...r });

      rows.push({
        file,
        added: addedOnly.length,
        removed: removedOnly.length,
        renamed: renamed.length,
      });

      if (addedOnly.length + removedOnly.length + renamed.length === 0) contentOnly.push(file);
    }

    const shortMilestone = milestone.slice(0, 7);
    const title = `Repo gốc có thay đổi từ ${shortMilestone}`;
    const totalAdded = addedAll.length;
    const totalRemoved = removedAll.length;
    const totalRenamed = renamedAll.length;

    const lines = [];
    lines.push(
      `Repo gốc \`eternity4719/HowToLiveBetter\` có thay đổi trong \`book/\` và \`docs/\` kể từ mốc bản dịch.`,
    );
    lines.push('');
    lines.push(`- Mốc đang dùng: \`${milestone}\` (${shortMilestone})`);
    lines.push(`- Repo gốc hiện tại: \`${head}\` (${headDate}) — ${headSubject}`);
    lines.push(`- File thay đổi: **${changed.length}**`);
    lines.push(
      `- Mục thêm: **${totalAdded}**, mục xóa: **${totalRemoved}**, mục đổi tiêu đề: **${totalRenamed}**`,
    );
    lines.push('');
    lines.push('### File thay đổi');
    lines.push('');
    lines.push('| File | Thêm | Xóa | Đổi tiêu đề |');
    lines.push('| --- | ---: | ---: | ---: |');
    for (const row of rows) {
      lines.push(`| \`${row.file}\` | ${row.added} | ${row.removed} | ${row.renamed} |`);
    }
    lines.push('');

    if (addedAll.length) {
      lines.push('### Mục thêm');
      lines.push('');
      for (const { file, heading } of addedAll) {
        lines.push(`- ${where(file, heading)}: ${mdCell(heading.title)}`);
      }
      lines.push('');
    }

    if (removedAll.length) {
      lines.push('### Mục xóa');
      lines.push('');
      for (const { file, heading } of removedAll) {
        lines.push(`- ${where(file, heading)}: ${mdCell(heading.title)}`);
      }
      lines.push('');
    }

    if (renamedAll.length) {
      lines.push('### Mục đổi tiêu đề');
      lines.push('');
      for (const { file, before, after } of renamedAll) {
        lines.push(`- ${where(file, after)}: ${mdCell(before.title)} → ${mdCell(after.title)}`);
      }
      lines.push('');
    }

    if (contentOnly.length) {
      lines.push('### Chỉ sửa nội dung (không đổi tiêu đề mục)');
      lines.push('');
      for (const file of contentOnly) lines.push(`- \`${file}\``);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
    lines.push('Đồng bộ bằng prompt Việc C, sau khi xong cập nhật `tools/mốc-bản-gốc.txt` rồi chạy `node tools/cap-nhat-moi.mjs` để làm mới nhãn "mới thêm / đã sửa" trên trang tra cứu.');
    lines.push('');

    const body = lines.join('\n');
    console.log(body);
    if (outFile) writeFileSync(outFile, body, 'utf8');
    if (githubOutput) {
      appendFileSync(githubOutput, `changed=true\ntitle=${title}\nfiles=${changed.length}\n`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

try {
  main();
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
