#!/usr/bin/env node
/**
 * Dựng sách điện tử tiếng Việt (EPUB + PDF) từ README.md, book/*.md và docs/*.md.
 *
 *   node tools/build-ebook.mjs
 *
 * Kết quả:
 *   dist/HowToLiveBetter-vi.epub
 *   dist/HowToLiveBetter-vi.pdf
 *
 * Thứ tự nội dung: trang bìa + ghi công → mục lục chương → book/01…34 → docs/*.md
 * (trừ docs/引用对照.md và docs/核实记录/).
 *
 * Cần: pandoc. Muốn ra PDF thì thêm xelatex và một font có dấu tiếng Việt.
 * Trong CI hai thứ đó do .github/workflows/book.yml cài sẵn.
 *
 * EPUB giữ nguyên chữ Hán (tên sách, phần Nguồn). PDF chỉ gồm tiếng Việt và tiếng Anh:
 * bản thảo đi qua pdfify() để bỏ chữ Hán trước khi dựng.
 *
 * Biến môi trường:
 *   PANDOC         đường dẫn tới pandoc (mặc định: pandoc trong PATH)
 *   BOOK_MAINFONT  font chữ chính của PDF (mặc định tự dò: Noto Serif → Times New Roman → …)
 *   BOOK_SKIP_PDF=1  chỉ dựng EPUB (khi máy chưa có xelatex)
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BOOK_DIR = path.join(ROOT, 'book');
const DOCS_DIR = path.join(ROOT, 'docs');
const DIST = path.join(ROOT, 'dist');
const BUILD = path.join(DIST, '.build');
const PANDOC = process.env.PANDOC || 'pandoc';

const EPUB_OUT = path.join(DIST, 'HowToLiveBetter-vi.epub');
const PDF_OUT = path.join(DIST, 'HowToLiveBetter-vi.pdf');

const HAN = /[\u3400-\u4dbf\u4e00-\u9fff]/u;
const TITLE = 'How To Live Better';
const SUBTITLE = '高性价比人生指南';
const AUTHOR = 'eternity4719';

/* ---------- font cho PDF ---------- */

const FONT_HINTS = {
  main: [
    ['Noto Serif', /^notoserif[-[].*\.(ttf|otf)$/i],
    ['Times New Roman', /^times\.ttf$/i],
    ['Liberation Serif', /^liberationserif-regular\./i],
    ['DejaVu Serif', /^dejavuserif\.ttf$/i],
  ],
};

function nameOf(file) {
  for (const [name, re] of FONT_HINTS.main) if (re.test(file)) return name;
  return file;
}

function fontSet() {
  // Linux/macOS: fontconfig biết tên family
  try {
    const out = execFileSync('fc-list', [':', 'family'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const set = new Set();
    for (const line of out.split('\n')) {
      for (const fam of line.split(',')) if (fam.trim()) set.add(fam.trim().toLowerCase());
    }
    return set;
  } catch { /* không có fc-list, thử Windows */ }

  // Windows: dò tên file trong thư mục font
  const dirs = [
    path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Microsoft', 'Windows', 'Fonts'),
  ].filter(Boolean);
  const files = [];
  for (const dir of dirs) {
    try { files.push(...fs.readdirSync(dir)); } catch { /* không có thư mục */ }
  }
  if (!files.length) return null;

  const set = new Set();
  for (const file of files) {
    const name = nameOf(file);
    if (name !== file) set.add(name.toLowerCase());
  }
  return set;
}

function pickFont(kind) {
  const env = 'BOOK_MAINFONT';
  if (process.env[env]) return process.env[env];

  const hints = FONT_HINTS[kind];
  const have = fontSet();
  if (have) {
    for (const [name] of hints) if (have.has(name.toLowerCase())) return name;
    throw new Error(`không có font nào dùng được cho ${kind} (cần một trong: ` +
      hints.map(h => h[0]).join(', ') + `); đặt ${env}=tên font để chỉ định`);
  }
  return hints[0][0];
}

/* ---------- đọc nguồn ---------- */

const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

// "## Mục lục" → 1. [Don't Die Early (Đừng chết sớm)](book/01-....md)
const chapterToc = [...readme.matchAll(/^(\d+)\.\s+\[(.+)\]\((book\/[^)]+\.md)\)\s*$/gm)]
  .map(m => ({ num: Number(m[1]), title: m[2], file: m[3] }));

const chapterFiles = fs.readdirSync(BOOK_DIR)
  .filter(f => f.endsWith('.md'))
  .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));

if (chapterFiles.length !== 34) throw new Error(`book/ có ${chapterFiles.length} file, mong đợi 34`);

// Thứ tự bài dài: theo README trước, phần còn lại xếp theo tên file
const docOrder = [...readme.matchAll(/\]\((docs\/[^)/]+\.md)\)/g)].map(m => path.basename(m[1]));

const EXCLUDE_DOCS = new Set(['引用对照.md']);
const docFiles = fs.readdirSync(DOCS_DIR, { withFileTypes: true })
  .filter(d => d.isFile() && d.name.endsWith('.md') && !EXCLUDE_DOCS.has(d.name))
  .map(d => d.name)
  .sort((a, b) => {
    const ia = docOrder.indexOf(a);
    const ib = docOrder.indexOf(b);
    if (ia !== -1 && ib !== -1) return ia - ib;
    if (ia !== -1) return -1;
    if (ib !== -1) return 1;
    return a.localeCompare(b);
  });

/* ---------- chỉnh nội dung cho bản đọc offline ---------- */

let droppedLinks = 0;

function clean(text) {
  let out = text.replace(/\r\n?/g, '\n');

  // <!-- 成本标签 … --> chỉ để trang web lọc, bản đọc offline không cần
  out = out.replace(/<!--[\s\S]*?-->/g, '');

  out = out.split('\n').filter(line => {
    const t = line.trim();
    if (/^\[←\s*(?:Về mục lục|回总目录)\]/.test(t)) return false;   // link quay lại mục lục
    if (t.includes('Đọc sách tại đây')) return false;                // nút mở trang đọc
    return true;
  }).join('\n');

  // Link tương đối (../README.md, ../docs/…) trong sách gộp không còn chỗ để trỏ tới:
  // giữ lại chữ, bỏ phần link. Link http giữ nguyên.
  out = out.replace(/\[([^\]\n]*)\]\((?!https?:|mailto:|#)([^)\s]+)[^)]*\)/g, (_m, label) => {
    droppedLinks += 1;
    return label;
  });

  // Đường dẫn có chữ Hán đang nằm trong `…` (monospace). Font mono của LaTeX không có
  // chữ Hán nên sẽ ra ô vuông; bỏ dấu ` để chữ Hán dùng font CJK.
  out = out.replace(/`([^`\n]*)`/g, (m, code) => (HAN.test(code) ? code : m));

  return out.trim();
}

/* ---------- ghép bản thảo ---------- */

const parts = [];

parts.push(`# Nguồn gốc và giấy phép

**${TITLE}** — ${SUBTITLE}. Bản dịch tiếng Việt.

- Nguyên tác: ${AUTHOR}. Bản gốc: <https://github.com/eternity4719/HowToLiveBetter>
- Bản dịch tiếng Việt: dkanh. Trang bản dịch: <https://github.com/khanhdoan4106/HowToLiveBetter>
- Giấy phép: CC BY 4.0. Bản gốc phát hành theo CC BY 4.0; bản dịch là tác phẩm phái sinh, cũng phát hành theo CC BY 4.0.
- Nội dung: 772 mục trong 34 chương, cộng 9 bài dài.
- Dịch dựa trên bản gốc đến đầu tháng 11 năm 2026. Luật, mức trợ cấp và thời hạn thay đổi thường xuyên, bản gốc có thể đã cập nhật sau mốc này.
- Lưu ý: luật lệ, số liệu, giá cả, số điện thoại và cơ quan nhà nước trong sách phần lớn là của Trung Quốc. Phần sức khỏe dựa trên nghiên cứu y khoa nên áp dụng được ở nhiều nơi. Phần pháp luật, bảo hiểm, thủ tục thì ở Việt Nam phải đối chiếu quy định tương ứng. Giá tính bằng tệ (nhân dân tệ).
- Đọc trên web: <https://khanhdoan4106.github.io/HowToLiveBetter/>`);

parts.push('# Mục lục chương\n\n' + chapterToc.map(c => `${c.num}. ${c.title}`).join('\n'));

const chapterTexts = chapterFiles.map(f => {
  if (!chapterToc.some(c => c.file === `book/${f}`)) throw new Error(`README không có mục lục cho book/${f}`);
  return { file: f, text: clean(fs.readFileSync(path.join(BOOK_DIR, f), 'utf8')) };
});

for (const c of chapterTexts) parts.push(c.text);

for (const f of docFiles) {
  parts.push(clean(fs.readFileSync(path.join(DOCS_DIR, f), 'utf8')));
}

const manuscript = `---
title: "${TITLE}"
subtitle: "${SUBTITLE}"
author: "${AUTHOR}"
rights: "CC BY 4.0"
description: "Bản dịch tiếng Việt của 《高性价比人生指南》."
lang: vi
toc-title: "Mục lục"
---

${parts.join('\n\n')}
`;

/* ---------- bản PDF: chỉ tiếng Việt và tiếng Anh ---------- */

const HAN_G = /[㐀-䶿一-鿿]/gu;
const CJK_PUNCT = {
  '：': ': ', '，': ', ', '。': '. ', '、': ', ', '；': '; ', '！': '! ', '？': '? ',
  '（': ' (', '）': ') ', '「': '“', '」': '”', '『': '“', '』': '”', '《': '', '》': '',
  '〔': '[', '〕': '] ', '【': '[', '】': ']', '～': '~', '—': '—',
};
const CIRCLED = { '①': '(1)', '②': '(2)', '③': '(3)', '④': '(4)', '⑤': '(5)', '⑥': '(6)', '⑦': '(7)', '⑧': '(8)', '⑨': '(9)', '⑩': '(10)' };

function stripHan(t) {
  // số hiệu văn bản kiểu 法释〔2015〕17号 → "số 17/2015"
  t = t.replace(/[一-鿿]*〔\s*(\d{4})\s*〕\s*(?:第\s*)?(\d+)\s*号/gu, 'số $2/$1');
  // ngoặc chỉ chứa chữ Hán và dấu câu: bỏ cả ngoặc; ngoặc có chữ khác: chỉ bỏ chữ Hán
  t = t.replace(/\s*[（(]([^()（）\n]*)[）)]/gu, (m, inner) =>
    HAN.test(inner) && !/[A-Za-zÀ-ỹ0-9]/u.test(inner.replace(HAN_G, '')) ? '' : m);
  t = t.replace(/[①-⑩]/g, c => CIRCLED[c]);
  t = t.replace(/[：，。、；！？（）「」『』《》〔〕【】～]/g, c => CJK_PUNCT[c]);
  t = t.replace(HAN_G, '');
  return t.replace(/ {2,}/g, ' ').replace(/ ([,.;:!?)])/g, '$1').replace(/\( /g, '(');
}

function pdfify(md) {
  let droppedSources = 0;
  const out = md.split('\n').map(line => {
    if (/^subtitle:/.test(line)) return null;
    if (/^description:/.test(line)) return 'description: "Bản dịch tiếng Việt của How To Live Better."';
    if (!line.startsWith('- Nguồn:')) return stripHan(line.replace(` — ${SUBTITLE}`, ''));
    // Phần Nguồn: mỗi nguồn cách nhau bằng "；". Nguồn chỉ có tiếng Trung (luật, thông tư…) thì bỏ,
    // nguồn có tiếng Anh/DOI thì giữ phần Latin.
    const segs = line.slice('- Nguồn:'.length).split('；');
    const kept = [];
    let dropped = 0;
    for (const seg of segs) {
      const cleaned = stripHan(seg).trim();
      const letters = (cleaned.replace(/https?:\S+/g, '').match(/[A-Za-z]/g) || []).length;
      if (letters >= 15) kept.push(cleaned); else dropped++;
    }
    droppedSources += dropped;
    let text = kept.join('; ');
    if (!kept.length) text = 'tài liệu pháp luật và nghiên cứu tiếng Trung, xem trên bản web.';
    else if (dropped) text += `; và ${dropped} nguồn tiếng Trung, xem trên bản web.`;
    return `- Nguồn: ${text}`;
  }).filter(l => l !== null).join('\n');
  return { text: out, droppedSources };
}

const items = chapterTexts.reduce((n, c) => n + (c.text.match(/^### /gm) || []).length, 0);
if (items !== 772) throw new Error(`đếm được ${items} mục trong book/, mong đợi 772`);

fs.mkdirSync(BUILD, { recursive: true });
const mdPath = path.join(BUILD, 'sach.md');
fs.writeFileSync(mdPath, manuscript, 'utf8');

const pdfDoc = pdfify(manuscript);
const pdfMdPath = path.join(BUILD, 'sach-pdf.md');
fs.writeFileSync(pdfMdPath, pdfDoc.text, 'utf8');
const leftoverHan = (pdfDoc.text.match(HAN_G) || []).length;
if (leftoverHan) throw new Error(`PDF còn ${leftoverHan} chữ Hán sau khi lọc`);
console.log(`Bản PDF: bỏ chữ Hán, ${pdfDoc.droppedSources} nguồn tiếng Trung được thay bằng ghi chú.`);

console.log(`Bản thảo: ${chapterTexts.length} chương, ${items} mục, ${docFiles.length} bài dài, ` +
  `${(manuscript.length / 1e6).toFixed(2)} triệu ký tự, bỏ ${droppedLinks} link nội bộ.`);

/* ---------- gọi pandoc ---------- */

function pandoc(args) {
  try {
    execFileSync(PANDOC, args, { cwd: ROOT, stdio: 'inherit' });
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error('không tìm thấy pandoc (đặt PANDOC=/đường/dẫn/pandoc)');
    throw err;
  }
}

pandoc([
  mdPath,
  '-o', EPUB_OUT,
  '--toc', '--toc-depth=2',
  '--split-level=1',
]);
console.log(`EPUB: ${EPUB_OUT} (${(fs.statSync(EPUB_OUT).size / 1e6).toFixed(1)} MB)`);

if (process.env.BOOK_SKIP_PDF === '1') {
  console.log('Bỏ PDF vì BOOK_SKIP_PDF=1');
} else {
  const mainFont = pickFont('main');
  console.log(`Font PDF: ${mainFont}`);

  pandoc([
    pdfMdPath,
    '-o', PDF_OUT,
    '--pdf-engine=xelatex',
    '--toc', '--toc-depth=2',
    '-V', 'documentclass=report',
    '-V', 'papersize=a4',
    '-V', 'geometry:margin=2.2cm',
    '-V', 'fontsize=11pt',
    '-V', `mainfont=${mainFont}`,
  ]);
  console.log(`PDF: ${PDF_OUT} (${(fs.statSync(PDF_OUT).size / 1e6).toFixed(1)} MB)`);
}
