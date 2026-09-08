require('dotenv').config();
const express = require('express');
const compression = require('compression');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { Telegraf, Markup } = require('telegraf');
const store = require('./store');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;
const PORT = process.env.PORT || 3000;
// @BotFather -> /newapp orqali ro'yxatdan o'tkazgan Mini App'ning qisqa nomi.
// Bu bo'lsa, guruhlarda tugma bosilganda Mini App to'g'ridan-to'g'ri (shaxsiy chatga
// chiqmasdan) ochiladi. Bo'lmasa, botning shaxsiy chatiga yo'naltiruvchi havolaga qaytadi.
const MINIAPP_SHORT_NAME = process.env.MINIAPP_SHORT_NAME || '';
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
app.use(compression());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// TEKSHIRUV: server public/ papkasida aynan nimani ko'rayotganini logga chiqaradi
const PUBLIC_DIR = path.join(__dirname, 'public');
console.log('__dirname:', __dirname);
console.log('public papka manzili:', PUBLIC_DIR);
try {
  console.log('public papkadagi fayllar:', fs.readdirSync(PUBLIC_DIR));
} catch (e) {
  console.error('XATOLIK: public papkasini o\'qib bo\'lmadi ->', e.message);
}

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
  res.json(restaurantListPayload());
});

app.get('/api/restaurants/:id/menu', (req, res) => {
  const restaurant = store.getRestaurant(req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'Restoran topilmadi' });
  res.json(restaurant);
});

function restaurantListPayload() {
  return store.getRestaurants().map((r) => ({ id: r.id, name: r.name, url: r.url || null, itemCount: r.items.length }));
}

function ordersPayload(date) {
  const rows = store.getOrders(date);
  const comments = store.getComments(date);
  const deliveryFee = store.getDeliveryFee(date);

  const byRestaurant = {};
  const userFoodTotals = {}; // user_id -> { user_id, user_name, total }
  let foodGrandTotal = 0;

  for (const row of rows) {
    const rid = row.restaurant_id;
    if (!byRestaurant[rid]) {
      byRestaurant[rid] = { restaurant_id: rid, restaurant_name: row.restaurant_name, users: {}, subtotal: 0 };
    }
    const group = byRestaurant[rid];
    if (!group.users[row.user_id]) {
      group.users[row.user_id] = { user_id: row.user_id, user_name: row.user_name, items: [], total: 0, comment: '' };
    }
    const lineTotal = row.price * row.qty;
    group.users[row.user_id].items.push({ name: row.item_name, price: row.price, qty: row.qty, lineTotal });
    group.users[row.user_id].total += lineTotal;
    group.subtotal += lineTotal;
    foodGrandTotal += lineTotal;

    if (!userFoodTotals[row.user_id]) {
      userFoodTotals[row.user_id] = { user_id: row.user_id, user_name: row.user_name, total: 0 };
    }
    userFoodTotals[row.user_id].total += lineTotal;
  }

  // Izohlarni ham qo'shamiz — hatto taom tanlamagan, faqat izoh qoldirgan foydalanuvchi bo'lsa ham ko'rinadi
  for (const c of comments) {
    const rid = c.restaurant_id;
    if (!byRestaurant[rid]) {
      byRestaurant[rid] = { restaurant_id: rid, restaurant_name: c.restaurant_name, users: {}, subtotal: 0 };
    }
    const group = byRestaurant[rid];
    if (!group.users[c.user_id]) {
      group.users[c.user_id] = { user_id: c.user_id, user_name: c.user_name, items: [], total: 0, comment: '' };
    }
    group.users[c.user_id].comment = c.text;
  }

  const restaurants = Object.values(byRestaurant).map((g) => ({ ...g, users: Object.values(g.users) }));

  // Dastavka narxi FAQAT haqiqatan taom buyurtma qilganlar orasida (izohgina qoldirganlarsiz) teng bo'linadi.
  const payingUsers = Object.values(userFoodTotals);
  const payingCount = payingUsers.length;
  const deliveryPerPerson = deliveryFee > 0 && payingCount > 0 ? Math.round(deliveryFee / payingCount) : 0;

  const userSummaries = payingUsers
    .map((u) => ({
      user_id: u.user_id,
      user_name: u.user_name,
      foodTotal: u.total,
      deliveryShare: deliveryPerPerson,
      finalTotal: u.total + deliveryPerPerson,
    }))
    .sort((a, b) => a.user_name.localeCompare(b.user_name));

  const grandTotal = foodGrandTotal + deliveryPerPerson * payingCount;

  return {
    date,
    restaurants,
    foodGrandTotal,
    deliveryFee,
    payingCount,
    deliveryPerPerson,
    userSummaries,
    grandTotal,
  };
}

app.get('/api/orders', (req, res) => {
  res.json(ordersPayload(req.query.date || todayStr()));
});

// Ilk yuklanishda ikkita alohida so'rov o'rniga bittasi bilan cheklanish uchun
// (restoranlar ro'yxati + bugungi jadval bir yo'la qaytariladi)
app.get('/api/bootstrap', (req, res) => {
  res.json({
    restaurants: restaurantListPayload(),
    orders: ordersPayload(todayStr()),
  });
});

app.post('/api/order', (req, res) => {
  const { initData, restaurant_id, items, comment } = req.body || {};
  const user = validateInitData(initData);
  if (!user) return res.status(401).json({ error: 'Tasdiqlanmadi — Telegram ichidan oching' });

  const restaurant = store.getRestaurant(restaurant_id);
  if (!restaurant) return res.status(404).json({ error: 'Restoran topilmadi' });

  const date = todayStr();
  const userName = [user.first_name, user.last_name].filter(Boolean).join(' ') || `ID ${user.id}`;
  store.replaceUserOrder(date, user.id, userName, restaurant.id, restaurant.name, items || []);
  store.setUserComment(date, user.id, userName, restaurant.id, restaurant.name, comment || '');
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

// MUHIM: Telegram "web_app" turidagi tugmani FAQAT shaxsiy chatlarda ruxsat beradi
// (guruhlarda "BUTTON_TYPE_INVALID" xatosi bilan rad etadi). Shuning uchun guruhda
// oddiy havola (URL) tugmasi beramiz — u botning shaxsiy chatini ochadi, o'sha yerda
// esa haqiqiy "web_app" tugmasi chiqadi.
function replyWithWebApp(ctx, text) {
  if (!WEBAPP_URL || !isValidUrl(WEBAPP_URL)) {
    return ctx.reply(
      `${text}\n\n⚠️ WEBAPP_URL sozlanmagan yoki noto'g'ri. Railway'ning Variables bo'limida WEBAPP_URL ni to'g'ri https:// manzil bilan to'ldiring.`
    );
  }

  const isPrivate = ctx.chat?.type === 'private';
  if (isPrivate) {
    return ctx.reply(text, Markup.inlineKeyboard([Markup.button.webApp('🍽 Obedni ochish', WEBAPP_URL)]));
  }

  const username = ctx.botInfo?.username;
  if (!username) {
    return ctx.reply(`${text}\n\nBotning shaxsiy chatiga o'tib /start deb yozing.`);
  }

  // Agar Mini App @BotFather orqali (/newapp) ro'yxatdan o'tkazilgan bo'lsa,
  // to'g'ridan-to'g'ri (guruhning o'zida) ochiladigan havoladan foydalanamiz.
  const link = MINIAPP_SHORT_NAME
    ? `https://t.me/${username}/${MINIAPP_SHORT_NAME}?startapp=obed`
    : `https://t.me/${username}?start=obed`;

  return ctx.reply(text, Markup.inlineKeyboard([Markup.button.url('🍽 Obedni ochish', link)]));
}

bot.start((ctx) =>
  replyWithWebApp(ctx, "Assalomu alaykum! Bugungi obedni buyurtma qilish uchun tugmani bosing 👇")
);

bot.command('obed', (ctx) =>
  replyWithWebApp(ctx, "Bugungi obed 👇 Kerakli restoranni tanlab, buyurtma bering.")
);

bot.command('id', (ctx) => {
  ctx.reply(`Sizning Telegram ID'ingiz: ${ctx.from.id}`);
});

// Bugungi (yoki berilgan sanadagi) buyurtmalarni chiroyli chek ko'rinishida matn qilib beradi
function buildReceiptText(date) {
  const data = ordersPayload(date);
  if (!data.restaurants.length) {
    return `🧾 ${date} uchun hali hech kim buyurtma bermagan.`;
  }

  let text = `🧾 Umumiy chek — ${date}\n`;
  for (const rest of data.restaurants) {
    text += `\n🍽 ${rest.restaurant_name}\n`;
    for (const u of rest.users) {
      const itemsText = u.items.length ? u.items.map((i) => `${i.name} ×${i.qty}`).join(', ') : '(taom tanlanmagan)';
      text += `  ${u.user_name} (ID: ${u.user_id}) — ${itemsText} — ${u.total.toLocaleString()} so'm\n`;
      if (u.comment) text += `    💬 "${u.comment}"\n`;
    }
    text += `  Jami: ${rest.subtotal.toLocaleString()} so'm\n`;
  }

  text += `\n💵 Taomlar jami: ${data.foodGrandTotal.toLocaleString()} so'm`;

  if (data.deliveryFee > 0) {
    text +=
      `\n🚚 Yetkazib berish: ${data.deliveryFee.toLocaleString()} so'm` +
      ` (${data.payingCount} kishiga, har biriga ${data.deliveryPerPerson.toLocaleString()} so'm)`;
    text += `\n\n📋 Har kim to'lashi kerak:`;
    for (const u of data.userSummaries) {
      text += `\n  ${u.user_name} (ID: ${u.user_id}) — ${u.finalTotal.toLocaleString()} so'm`;
    }
  }

  text += `\n\n💰 UMUMIY SUMMA: ${data.grandTotal.toLocaleString()} so'm`;
  return text;
}

bot.command('chek', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Bu buyruq faqat adminlar uchun.');
  ctx.reply(buildReceiptText(todayStr()));
});

bot.command('hammasini_bekor', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Bu buyruq faqat adminlar uchun.');
  store.clearAllOrders(todayStr());
  ctx.reply("✅ Bugungi barcha buyurtmalar va izohlar bekor qilindi.");
});

bot.command('buyurtma_bekor', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Bu buyruq faqat adminlar uchun.');
  const userId = Number(ctx.message.text.split(' ')[1]);
  if (!userId) {
    return ctx.reply(
      "Foydalanish: /buyurtma_bekor user_id\nID'ni /chek chiqishidan oling (har bir ism yonida ko'rsatiladi)."
    );
  }
  const ok = store.clearOrdersForUser(todayStr(), userId);
  ctx.reply(
    ok ? `✅ ID ${userId} bo'yicha bugungi buyurtma bekor qilindi.` : `ID ${userId} bo'yicha bugun buyurtma topilmadi.`
  );
});

bot.command('dastavka', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Bu buyruq faqat adminlar uchun.');
  const raw = ctx.message.text.split(' ')[1];
  if (!raw) {
    const current = store.getDeliveryFee(todayStr());
    return ctx.reply(
      current
        ? `Bugungi yetkazib berish narxi: ${current.toLocaleString()} so'm`
        : "Bugun uchun yetkazib berish narxi kiritilmagan.\nFoydalanish: /dastavka summa (masalan: /dastavka 50000)\nOlib tashlash uchun: /dastavka 0"
    );
  }
  const amount = Number(raw.replace(/[^\d]/g, ''));
  store.setDeliveryFee(todayStr(), amount);
  if (amount > 0) {
    ctx.reply(
      `✅ Bugungi yetkazib berish narxi ${amount.toLocaleString()} so'm qilib belgilandi.\n` +
        "Bu summa bugun taom buyurtma qilgan barcha odamlar orasida teng bo'linadi."
    );
  } else {
    ctx.reply("✅ Yetkazib berish narxi olib tashlandi.");
  }
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
      "/chek — bugungi umumiy chekni (ID'lar bilan) olish\n" +
      "/hammasini_bekor — bugungi BARCHA buyurtmalarni bekor qiladi\n" +
      "/buyurtma_bekor user_id — bitta odamning buyurtmasini bekor qiladi\n" +
      "/dastavka summa — yetkazib berish narxini belgilaydi (teng bo'linadi)\n" +
      "/dastavka 0 — yetkazib berish narxini olib tashlaydi\n" +
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

  // Xabar bir nechta qatordan iborat bo'lishi mumkin (har bir qatorda bitta taom).
  // Har bir qatorning boshidagi "/taom_qoshish" so'zi bo'lsa ham, bo'lmasa ham ishlaydi.
  const lines = ctx.message.text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const results = [];

  for (const line of lines) {
    const withoutCmd = line.replace(/^\/taom_qoshish(@\S+)?\s*/i, '');
    if (!withoutCmd) continue; // faqat "/taom_qoshish" yozilgan, argumentsiz qator — o'tkazib yuboriladi

    const parts = withoutCmd.split('|').map((s) => s.trim());
    if (parts.length < 3) {
      results.push(`❌ Noto'g'ri format: "${line}"`);
      continue;
    }
    const [ridStr, name, priceStr] = parts;
    const rid = Number(ridStr);
    const price = Number(priceStr.replace(/[^\d]/g, ''));
    if (!rid || !name || !price) {
      results.push(`❌ Ma'lumot noto'g'ri: "${line}"`);
      continue;
    }
    const item = store.addMenuItem(rid, name, price);
    if (!item) {
      results.push(`❌ ID ${rid} bilan restoran topilmadi: "${name}"`);
      continue;
    }
    results.push(`✅ "${name}" — ${price.toLocaleString()} so'm`);
  }

  if (!results.length) {
    return ctx.reply(
      'Foydalanish: /taom_qoshish restoran_id | Taom nomi | Narxi\n' +
        "Masalan: /taom_qoshish 1 | Osh | 20000\n\n" +
        "Bir nechtasini bitta xabarda, har birini alohida qatorga yozib ham yuborishingiz mumkin."
    );
  }

  ctx.reply(results.join('\n'));
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

bot.catch((err, ctx) => {
  console.error(`Bot xatosi (${ctx.updateType}):`, err.message || err);
});

// Qo'shimcha himoya: agar biror joyda promise xatosi ushlanmay qolsa
// (masalan bot.catch yetib bormagan holatlar), server butunlay qulab
// tushmasin, faqat logga yozilsin.
process.on('unhandledRejection', (err) => {
  console.error("Ushlanmagan xatolik (server ishlashda davom etadi):", err?.message || err);
});

bot.launch();
console.log('Bot ishga tushdi (polling rejimida)');

app.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishga tushdi`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
