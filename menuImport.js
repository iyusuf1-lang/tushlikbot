// Restoran saytidan taom nomi, narxi va rasmini avtomatik o'qib olish.
//
// Har bir sayt har xil tuzilgan, shuning uchun bir nechta usul ketma-ket sinab ko'riladi:
//   1) Sahifa ichidagi JSON ma'lumotlar (schema.org JSON-LD, Next.js __NEXT_DATA__ va h.k.)
//   2) HTML'dagi "kartochkalar": narx yozilgan element + uning yonidagi nom va rasm
// Natija admin tasdiqlamaguncha hech qayerga saqlanmaydi.

const crypto = require('crypto');
const dns = require('dns').promises;
const fs = require('fs');
const net = require('net');
const path = require('path');
const cheerio = require('cheerio');

const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_ITEMS = 300;
const MIN_PRICE = 100;
const MAX_PRICE = 50000000;
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// ---------- Xavfsiz yuklab olish ----------

// Server ichki tarmog'iga (localhost, 10.x, 192.168.x ...) so'rov yuborilmasligi uchun
const privateRanges = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3],
]) {
  privateRanges.addSubnet(addr, prefix, 'ipv4');
}
for (const [addr, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['::ffff:0:0', 96]]) {
  privateRanges.addSubnet(addr, prefix, 'ipv6');
}

async function assertPublicUrl(url) {
  const u = new URL(url);
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error("Faqat http/https havolalar qo'llab-quvvatlanadi");
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host) ? [{ address: host, family: net.isIP(host) }] : await dns.lookup(host, { all: true });
  for (const { address, family } of addresses) {
    if (privateRanges.check(address, family === 6 ? 'ipv6' : 'ipv4')) {
      throw new Error("Bu manzil ichki tarmoqqa tegishli — ruxsat yo'q");
    }
  }
}

// Yo'naltirishlarni (redirect) qo'lda kuzatib boradi — har bir qadamda manzil qayta tekshiriladi
async function safeFetch(url, maxBytes, accept) {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(current);
    const res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(20000),
      headers: { 'User-Agent': USER_AGENT, Accept: accept, 'Accept-Language': 'uz,ru;q=0.9,en;q=0.8' },
    });
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current).href;
      continue;
    }
    if (!res.ok) throw new Error(`Sayt ${res.status} xatosi bilan javob berdi`);

    const chunks = [];
    let size = 0;
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > maxBytes) throw new Error('Fayl juda katta');
      chunks.push(chunk);
    }
    return { buffer: Buffer.concat(chunks), finalUrl: current, contentType: res.headers.get('content-type') || '' };
  }
  throw new Error("Yo'naltirishlar soni juda ko'p");
}

// ---------- Yordamchi funksiyalar ----------

function cleanText(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

// "25 000 so'm", "25.000", "25,000.00", 25000 -> 25000
function parsePrice(value) {
  if (value == null) return null;
  if (typeof value === 'object') {
    return parsePrice(value.value ?? value.amount ?? value.price ?? value.lowPrice ?? null);
  }
  let n;
  if (typeof value === 'number') {
    n = value;
  } else {
    const s = String(value).replace(/[.,]\d{1,2}(?!\d)\s*\D*$/, ''); // tiyinlarni tashlab yuboramiz
    const digits = s.replace(/[^\d]/g, '');
    if (!digits || digits.length > 9) return null;
    n = Number(digits);
  }
  n = Math.round(n);
  return n >= MIN_PRICE && n <= MAX_PRICE ? n : null;
}

function resolveImage(value, baseUrl) {
  if (!value) return null;
  if (Array.isArray(value)) return resolveImage(value[0], baseUrl);
  if (typeof value === 'object') {
    return resolveImage(
      value.url || value.src || value.original || value.large || value.medium || value.small || value.path || value.contentUrl,
      baseUrl
    );
  }
  const raw = String(value).trim().split(/\s+/)[0]; // srcset bo'lsa, birinchi variant
  if (!raw || raw.startsWith('data:')) return null;
  try {
    const u = new URL(raw, baseUrl);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

function isGoodName(name) {
  return name.length >= 2 && name.length <= 120 && /\p{L}/u.test(name);
}

// ---------- 1-usul: sahifa ichidagi JSON ----------

const NAME_KEYS = ['name', 'title', 'productName', 'product_name', 'nomi'];
const PRICE_KEYS = [
  'price', 'cost', 'amount', 'sum', 'narx', 'priceValue', 'price_value', 'currentPrice', 'current_price',
  'basePrice', 'base_price', 'salePrice', 'sale_price', 'regularPrice', 'regular_price',
];
const IMAGE_KEYS = [
  'image', 'images', 'img', 'photo', 'photos', 'picture', 'imageUrl', 'image_url', 'imageURL', 'photoUrl',
  'photo_url', 'thumbnail', 'thumb', 'media',
];

function firstValue(obj, keys, parse) {
  for (const k of keys) {
    if (obj[k] != null) {
      const v = parse(obj[k]);
      if (v) return v;
    }
  }
  return null;
}

function walkJson(node, baseUrl, out, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 40 || out.length >= MAX_ITEMS * 3) return;
  if (Array.isArray(node)) {
    for (const child of node) walkJson(child, baseUrl, out, depth + 1);
    return;
  }

  const name = firstValue(node, NAME_KEYS, (v) => (typeof v === 'string' ? cleanText(v) : null));
  let price = firstValue(node, PRICE_KEYS, parsePrice);
  if (!price && node.offers) price = parsePrice([].concat(node.offers)[0]); // schema.org Product/MenuItem
  if (name && price && isGoodName(name)) {
    out.push({ name, price, image: firstValue(node, IMAGE_KEYS, (v) => resolveImage(v, baseUrl)) });
    return; // taomning ichidagi qo'shimchalarni (sous, variant) alohida taom deb olmaymiz
  }
  for (const child of Object.values(node)) walkJson(child, baseUrl, out, depth + 1);
}

function extractFromJson($, baseUrl) {
  const out = [];
  $('script').each((_, el) => {
    const type = ($(el).attr('type') || '').toLowerCase();
    const text = $(el).html() || '';
    if (text.length < 20) return;
    let data = null;
    try {
      if (type.includes('json')) {
        data = JSON.parse(text);
      } else {
        // window.__INITIAL_STATE__ = {...};
        const m = text.match(/^\s*(?:window\.)?[\w$.]+\s*=\s*(\{[\s\S]*\}|\[[\s\S]*\])\s*;?\s*$/);
        if (m) data = JSON.parse(m[1]);
      }
    } catch {
      return;
    }
    walkJson(data, baseUrl, out);
  });
  return out;
}

// ---------- 2-usul: HTML kartochkalar ----------

// Valyuta so'zidan keyin kichik harf kelmasligi kerak ("summa" narx emas)
const PRICE_TEXT_RE = /(\d{1,3}(?:[   .,]\d{3})+|\d{3,8})(?:[.,]\d{1,2})?\s*(?:so['‘’ʻʼ`]?m|сум|сўм|sum|uzs)(?!\p{Ll})/iu;
const PRICE_TEXT_RE_G = new RegExp(PRICE_TEXT_RE.source, 'giu');

// Element matni, ichki elementlar orasiga bo'shliq qo'yib (cheerio .text() ularni yopishtirib yuboradi)
function textOf(el) {
  const parts = [];
  (function rec(node) {
    if (node.type === 'text') parts.push(node.data);
    else if (node.children) node.children.forEach(rec);
  })(el);
  return cleanText(parts.join(' '));
}

function countPrices(text) {
  return (text.match(PRICE_TEXT_RE_G) || []).length;
}

function classOf($el) {
  return (($el.attr('class') || '') + ' ' + ($el.attr('itemprop') || '')).toLowerCase();
}

function extractFromHtml($, baseUrl) {
  const out = [];
  $('script, style, noscript, svg').remove();

  const priceEls = $('body *').filter((_, el) => {
    const $el = $(el);
    if ($el.children().length > 3) return false;
    const text = textOf(el);
    if (!text || text.length > 40) return false;
    if (PRICE_TEXT_RE.test(text) && countPrices(text) === 1) return true;
    return /price|narx|cost/.test(classOf($el)) && /\d{3}/.test(text) && $el.children().length === 0;
  });

  priceEls.each((_, el) => {
    const $price = $(el);
    const price = parsePrice(textOf(el));
    if (!price) return;

    // Faqat bitta narxni o'z ichiga olgan eng katta ota elementni "kartochka" deb olamiz
    let $card = $price;
    for (let i = 0; i < 8; i++) {
      const $parent = $card.parent();
      if (!$parent.length || $parent.is('body')) break;
      if (countPrices(textOf($parent[0])) > 1) break;
      if ($parent.find('[class*="price"], [class*="Price"]').length > 2) break;
      $card = $parent;
    }
    if ($card.is($price)) return;

    let name = '';
    $card.find('h1, h2, h3, h4, h5, h6, [class], [itemprop="name"], strong, b').each((_, n) => {
      if (name) return;
      const $n = $(n);
      const isHeading = /^h[1-6]$|^strong$|^b$/.test(n.tagName) || /name|title|nomi/.test(classOf($n));
      if (!isHeading || /price|narx|desc|cost|btn|button/.test(classOf($n))) return;
      const t = textOf(n);
      if (isGoodName(t) && !PRICE_TEXT_RE.test(t)) name = t;
    });
    if (!name) return;

    const $img = $card.find('img').first();
    let image = null;
    if ($img.length) {
      image = resolveImage(
        $img.attr('data-src') || $img.attr('data-lazy-src') || $img.attr('data-original') || $img.attr('src') || $img.attr('srcset'),
        baseUrl
      );
    }
    if (!image) {
      const bg = $card.find('[style*="background"]').first().attr('style') || $card.attr('style') || '';
      const m = bg.match(/url\((['"]?)([^'")]+)\1\)/);
      if (m) image = resolveImage(m[2], baseUrl);
    }

    out.push({ name, price, image });
  });
  return out;
}

// ---------- Asosiy funksiya ----------

function pageTitle($) {
  const raw =
    $('meta[property="og:site_name"]').attr('content') ||
    $('meta[property="og:title"]').attr('content') ||
    $('title').first().text() ||
    '';
  return cleanText(raw).split(/\s+[|–—-]\s+/)[0].slice(0, 60);
}

function dedupe(items) {
  const seen = new Map();
  for (const item of items) {
    const key = item.name.toLowerCase();
    const prev = seen.get(key);
    if (!prev) seen.set(key, item);
    else if (!prev.image && item.image) prev.image = item.image;
  }
  return [...seen.values()].slice(0, MAX_ITEMS);
}

async function scrapeMenu(url) {
  const { buffer, finalUrl, contentType } = await safeFetch(url, MAX_PAGE_BYTES, 'text/html,application/xhtml+xml,*/*;q=0.8');
  if (contentType && !/html|xml|text/i.test(contentType)) throw new Error("Havola HTML sahifa emas");

  const $ = cheerio.load(buffer.toString('utf-8'));
  const title = pageTitle($);
  const jsonItems = extractFromJson($, finalUrl);
  const htmlItems = jsonItems.length >= 3 ? [] : extractFromHtml($, finalUrl);
  return { title, url: finalUrl, items: dedupe(jsonItems.concat(htmlItems)) };
}

// Rasmni bizning serverga yuklab oladi (ko'p saytlar tashqaridan rasm ko'rsatishni bloklaydi).
// Muvaffaqiyatli bo'lsa "/images/..." yo'lini qaytaradi.
async function downloadImage(url, imagesDir, prefix) {
  const { buffer, contentType } = await safeFetch(url, MAX_IMAGE_BYTES, 'image/*');
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[
    contentType.split(';')[0].trim().toLowerCase()
  ];
  if (!ext) throw new Error('Rasm formati qo\'llab-quvvatlanmaydi');
  const hash = crypto.createHash('sha1').update(url).digest('hex').slice(0, 12);
  const filename = `${prefix}-${hash}.${ext}`;
  await fs.promises.mkdir(imagesDir, { recursive: true });
  await fs.promises.writeFile(path.join(imagesDir, filename), buffer);
  return `/images/${filename}`;
}

module.exports = { scrapeMenu, downloadImage, parsePrice, extractFromJson, extractFromHtml };
