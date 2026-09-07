require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { Telegraf, Markup } = require('telegraf');
const store = require('./store');

const BOT_TOKEN = process.env.8976669218:AAGbKlgtU3Eg4ynV_qGXs3t9R4XMjEocujY;
const WEBAPP_URL = process.env.WEBAPP_URL;
const PORT = process.env.PORT || 3000;
const ADMIN_IDS = (process.env.ADMIN_IDS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);

if (!BOT_TOKEN) {
  console.error("Xatolik: .env faylda BOT_TOKEN ko'rsatilmagan!");
  process.exit(1);
}
if (!WEBAPP_URL) {
  console.warn("Ogohlantirish: WEBAPP_URL o'rnatilmagan. Bot tugmasi ishlamasligi mumkin.");
}
if (!ADMIN_IDS.length) {
  console.warn("Ogohlantirish: ADMIN_IDS o'rnatilmagan. /id buyrug'i orqali ID'ingizni bilib, Variables'ga qo'shing.");
}

const bot = new Telegraf(BOT_TOKEN);
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function isAdmin(ctx) {
  return ADMIN_IDS.includes(ctx.from.id);
}

function isValidUrl(url) {
  return /^https?:\/\//i.test(url);
}

// ---------- Telegram WebApp initData ni tekshirish ----------
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
function validateInitData(initData) {
  if (!initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const pairs = [];
  for (const [key, value] of params.entries()) pairs.push(`${key}=${value}`);
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computedHash !== hash) return null;

  const userStr = params.get('user');
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch {
    return null;
  }
}

// Toshkent vaqti (UTC+5) bo'yicha bugungi sana
function todayStr() {
  const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

// ---------- API ----------

app.get('/api/restaurants', (req, res) => {
  const restaurants = store.getRestaurants();
  res.json(restaurants.map((r) => ({ id: r.id, name: r.name, url: r.url || null, itemCount: r.items.length })));
});

app.get('/api/restaurants/:id/menu', (req, res) => {
  const restaurant = store.getRestaurant(req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'Restoran topilmadi' });
  res.json(restaurant);
});

app.get('/api/orders', (req, res) => {
  const date = req.query.date || todayStr();
  const rows = store.getOrders(date);

  const byRestaurant = {};
  let grandTotal = 0;
  for (const row of rows) {
    const rid = row.restaurant_id;
    if (!byRestaurant[rid]) {
      byRestaurant[rid] = { restaurant_id: rid, restaurant_name: row.restaurant_name, users: {}, subtotal: 0 };
    }
    const group = byRestaurant[rid];
    if (!group.users[row.user_id]) {
      group.users[row.user_id] = { user_name: row.user_name, items: [], total: 0 };
    }
    const lineTotal = row.price * row.qty;
    group.users[row.user_id].items.push({ name: row.item_name, price: row.price, qty: row.qty, lineTotal });
    group.users[row.user_id].total += lineTotal;
    group.subtotal += lineTotal;
    grandTotal += lineTotal;
  }

  const restaurants = Object.values(byRestaurant).map((g) => ({ ...g, users: Object.values(g.users) }));
  res.json({ date, restaurants, grandTotal });
});

app.post('/api/order', (req, res) => {
  const { initData, restaurant_id, items } = req.body || {};
  const user = validateInitData(initData);
  if (!user) return res.status(401).json({ error: 'Tasdiqlanmadi — Telegram ichidan oching' });

  const restaurant = store.getRestaurant(restaurant_id);
  if (!restaurant) return res.status(404).json({ error: 'Restoran topilmadi' });

  const date = todayStr();
  const userName = [user.first_name, user.last_name].filter(Boolean).join(' ') || `ID ${user.id}`;
  store.replaceUserOrder(date, user.id, userName, restaurant.id, restaurant.name, items || []);
  res.json({ ok: true });
});

app.delete('/api/order', (req, res) => {
  const { initData, restaurant_id } = req.body || {};
  const user = validateInitData(initData);
  if (!user) return res.status(401).json({ error: 'Tasdiqlanmadi' });

  store.clearUserOrder(todayStr(), user.id, Number(restaurant_id));
  res.json({ ok: true });
});

// ---------- Bot: umumiy buyruqlar ----------

bot.start((ctx) => {
  ctx.reply(
    "Assalomu alaykum! Bugungi obedni buyurtma qilish uchun tugmani bosing 👇",
    Markup.inlineKeyboard([Markup.button.webApp('🍽 Obedni ochish', WEBAPP_URL)])
  );
});

bot.command('obed', (ctx) => {
  ctx.reply(
    "Bugungi obed 👇 Kerakli restoranni tanlab, buyurtma bering.",
    Markup.inlineKeyboard([Markup.button.webApp('🍽 Obedni ochish', WEBAPP_URL)])
  );
});

bot.command('id', (ctx) => {
  ctx.reply(`Sizning Telegram ID'ingiz: ${ctx.from.id}`);
});

bot.command('restoranlar', (ctx) => {
  const restaurants = store.getRestaurants();
  if (!restaurants.length) return ctx.reply("Hozircha restoranlar qo'shilmagan.");
  const text = restaurants
    .map((r) => `#${r.id} — ${r.name} (${r.items.length} ta taom)${r.url ? `\n   🔗 ${r.url}` : ''}`)
    .join('\n');
  ctx.reply(`🍽 Restoranlar ro'yxati:\n${text}`);
});

bot.command('yordam', (ctx) => {
  ctx.reply(
    "📋 Buyruqlar:\n" +
      '/obed — bugungi obed jadvalini ochish\n' +
      "/restoranlar — restoranlar ro'yxati\n" +
      "/id — sizning Telegram ID'ingiz\n\n" +
      'Admin uchun:\n' +
      '/restoran_qoshish Nomi\n' +
      '/restoran_qoshish Nomi | https://sayt.uz  (sayt havolasi bilan)\n' +
      "/restoran_sayt restoran_id | https://sayt.uz  (havolani qo'shish/o'zgartirish)\n" +
      "/restoran_sayt restoran_id | -  (havolani olib tashlash)\n" +
      "/taom_qoshish restoran_id | Taom nomi | Narxi\n" +
      "/taom_ochirish restoran_id | taom_id\n" +
      '/restoran_ochirish restoran_id'
  );
});

// ---------- Bot: admin buyruqlari ----------

bot.command('restoran_qoshish', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Bu buyruq faqat adminlar uchun.');
  const raw = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!raw) {
    return ctx.reply(
      "Foydalanish: /restoran_qoshish Nomi\nyoki sayt bilan: /restoran_qoshish Nomi | https://sayt.uz"
    );
  }
  const parts = raw.split('|').map((s) => s.trim());
  const name = parts[0];
  const urlRaw = parts[1];
  if (urlRaw && !isValidUrl(urlRaw)) {
    return ctx.reply('Havola http:// yoki https:// bilan boshlanishi kerak.');
  }
  const r = store.addRestaurant(name, urlRaw || null);
  const urlNote = r.url ? `\n🔗 Sayt: ${r.url}` : '';
  ctx.reply(`✅ "${r.name}" qo'shildi (ID: ${r.id}).${urlNote}\nEndi taom qo'shing:\n/taom_qoshish ${r.id} | Taom nomi | Narxi`);
});

bot.command('restoran_sayt', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Bu buyruq faqat adminlar uchun.');
  const raw = ctx.message.text.split(' ').slice(1).join(' ');
  const parts = raw.split('|').map((s) => s.trim());
  const rid = Number(parts[0]);
  const urlRaw = parts[1];
  if (!rid || !urlRaw) {
    return ctx.reply(
      "Foydalanish: /restoran_sayt restoran_id | https://sayt.uz\nOlib tashlash uchun: /restoran_sayt restoran_id | -"
    );
  }
  const url = urlRaw === '-' ? null : urlRaw;
  if (url && !isValidUrl(url)) {
    return ctx.reply('Havola http:// yoki https:// bilan boshlanishi kerak.');
  }
  const ok = store.setRestaurantUrl(rid, url);
  if (!ok) return ctx.reply(`ID ${rid} bilan restoran topilmadi.`);
  ctx.reply(url ? `✅ Sayt havolasi saqlandi: ${url}` : "✅ Sayt havolasi olib tashlandi.");
});

bot.command('taom_qoshish', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Bu buyruq faqat adminlar uchun.');
  const raw = ctx.message.text.split(' ').slice(1).join(' ');
  const parts = raw.split('|').map((s) => s.trim());
  if (parts.length < 3) {
    return ctx.reply('Foydalanish: /taom_qoshish restoran_id | Taom nomi | Narxi\nMasalan: /taom_qoshish 1 | Osh | 20000');
  }
  const [ridStr, name, priceStr] = parts;
  const rid = Number(ridStr);
  const price = Number(priceStr.replace(/[^\d]/g, ''));
  if (!rid || !name || !price) return ctx.reply("Ma'lumotlar noto'g'ri. /restoranlar orqali ID ni tekshiring.");
  const item = store.addMenuItem(rid, name, price);
  if (!item) return ctx.reply(`ID ${rid} bilan restoran topilmadi.`);
  ctx.reply(`✅ "${name}" — ${price.toLocaleString()} so'm qo'shildi.`);
});

bot.command('taom_ochirish', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Bu buyruq faqat adminlar uchun.');
  const raw = ctx.message.text.split(' ').slice(1).join(' ');
  const parts = raw.split('|').map((s) => s.trim());
  const rid = Number(parts[0]);
  const iid = Number(parts[1]);
  if (!rid || !iid) return ctx.reply('Foydalanish: /taom_ochirish restoran_id | taom_id');
  const ok = store.deleteMenuItem(rid, iid);
  ctx.reply(ok ? "✅ Taom o'chirildi." : 'Topilmadi.');
});

bot.command('restoran_ochirish', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Bu buyruq faqat adminlar uchun.');
  const rid = Number(ctx.message.text.split(' ')[1]);
  if (!rid) return ctx.reply('Foydalanish: /restoran_ochirish restoran_id');
  const ok = store.deleteRestaurant(rid);
  ctx.reply(ok ? "✅ Restoran o'chirildi." : 'Topilmadi.');
});

bot.launch();
console.log('Bot ishga tushdi (polling rejimida)');

app.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishga tushdi`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
