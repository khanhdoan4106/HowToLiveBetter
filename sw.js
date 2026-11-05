// File này do tools/tao-sw.mjs sinh ra, đừng sửa tay. Sửa template trong script rồi chạy lại.
// Đọc offline cho trang tra cứu: lưu sẵn trang và nội dung sách khi cài, sau đó
// - trang, .md, .json: lấy mạng trước, lưu lại bản mới; mất mạng thì dùng bản đã lưu;
// - ảnh, biểu tượng, manifest: dùng bản đã lưu trước, chưa có thì lấy mạng.
// Chỉ xử lý request GET cùng nguồn; request ra ngoài (font, GitHub, link nguồn) đi thẳng mạng.
const CACHE = 'hltb-05050aec87';
const FILES = [
  "./",
  "index.html",
  "selfcheck.html",
  "README.md",
  "thuat-ngu.md",
  "updates.json",
  "manifest.webmanifest",
  "og.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "icons/apple-touch-icon.png",
  "book/01-dung-chet-som.md",
  "book/02-dung-chet-tu-tu.md",
  "book/03-dung-lang-phi-suc-luc.md",
  "book/04-dung-lang-phi-thoi-gian.md",
  "book/05-dung-lang-phi-tien.md",
  "book/06-danh-sach-phan-dien.md",
  "book/07-song-the-nao-khi-khong-co-tien.md",
  "book/08-dung-tu-hai-minh.md",
  "book/09-ranh-gioi-phap-luat.md",
  "book/10-yeu-duong-va-ket-hon.md",
  "book/11-ranh-gioi-nguoi-lam-ky-thuat.md",
  "book/12-khoi-nghiep-va-lam-an.md",
  "book/13-tinh-huong-khan-cap.md",
  "book/14-tai-khoan-va-an-toan-thong-tin.md",
  "book/15-thue-nha-va-mua-nha.md",
  "book/16-song-the-nao-khi-mac-benh-man-tinh.md",
  "book/17-nha-co-nguoi-gia.md",
  "book/18-nuoi-con-co-dang-khong.md",
  "book/19-dang-lam-nghi-viec-va-tai-nan-lao-dong.md",
  "book/20-cham-tre-so-sinh-the-nao.md",
  "book/21-ra-nuoc-ngoai-du-lich-va-an-toan.md",
  "book/22-thu-gian-the-nao.md",
  "book/23-hoc-ky-nang-gi-thi-dang.md",
  "book/24-kham-benh.md",
  "book/25-nguoi-than-mat-roi-phai-lam-gi.md",
  "book/26-lam-mot-website-hay-nen-tang.md",
  "book/27-mang-thai-va-sinh-no.md",
  "book/28-dung-vi-ngoai-hinh-ma-lam-hong-co-the.md",
  "book/29-sau-khi-gap-cu-soc-lon.md",
  "book/30-tre-da-di-hoc.md",
  "book/31-sau-18-tuoi-co-nhung-con-duong-nao.md",
  "book/32-du-hoc.md",
  "book/33-song-the-nao-sau-khi-bi-khuyet-tat.md",
  "book/34-thuoc-du-phong-trong-nha-dung-uong-ra-chuyen.md",
  "docs/bi-sa-thai-thi-lam-gi-truoc.md",
  "docs/danh-muc-do-du-phong-cho-ho-gia-dinh.md",
  "docs/dong-ho-sinh-hoc-va-ca-dem.md",
  "docs/gap-nguoi-la-gap-nan-co-nen-dung-lai.md",
  "docs/ket-hon-co-dang-khong.md",
  "docs/lam-nen-tang-can-giay-phep-gi.md",
  "docs/sau-khi-moi-chan-doan-benh-man-tinh.md",
  "docs/truoc-khi-doi-viec-doi-thanh-pho.md",
  "docs/viec-can-lam-truoc-va-sau-khi-sinh-con.md"
];

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

const FRESH = /\.(md|json|html)$/;

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
