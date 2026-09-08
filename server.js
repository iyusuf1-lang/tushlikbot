require('dotenv').config();
const express = require('express');
const compression = require('compression');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { Telegraf, Markup } = require('telegraf');
const ExcelJS = require('exceljs');
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

function isAdminId(id) {
  return ADMIN_IDS.includes(id);
}

function isAdmin(ctx) {
  return isAdminId(ctx.from.id);
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

// Toshkent vaqti bo'yicha joriy soat:daqiqa (masalan "14:07")
function nowHHMM() {
  const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
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

app.get('/api/my-order/:restaurantId', (req, res) => {
  const user = validateInitData(req.query.initData || '');
  if (!user) return res.json({ items: [] });
  const items = store.getUserOrderItems(todayStr(), user.id, req.params.restaurantId);
  res.json({ items });
});

function restaurantListPayload() {
  return store.getRestaurants().map((r) => ({ id: r.id, name: r.name, url: r.url || null, itemCount: r.items.length }));
}

function ordersPayload(date) {
  const rows = store.getOrders(date);
  const comments = store.getComments(date);
  const deliveryFee = store.getDeliveryFee(date);
  const paidUserIds = store.getPaidUserIds(date);

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
      paid: paidUserIds.includes(u.user_id),
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
  const user = validateInitData(req.query.initData || '');
  const { cardNumber } = store.getSettings();
  res.json({
    restaurants: restaurantListPayload(),
    orders: ordersPayload(todayStr()),
    isAdmin: user ? isAdminId(user.id) : false,
    cardNumber: cardNumber || null,
  });
});

// ---------- Admin: Mini App ichidagi boshqaruv tugmalari ----------

app.post('/api/admin/card-number', (req, res) => {
  const user = validateInitData((req.body || {}).initData);
  if (!user || !isAdminId(user.id)) return res.status(403).json({ error: "Ruxsat yo'q" });
  const cardNumber = ((req.body || {}).cardNumber || '').trim() || null;
  store.updateSettings({ cardNumber });
  res.json({ ok: true, cardNumber });
});

app.post('/api/admin/clear-all', (req, res) => {
  const user = validateInitData((req.body || {}).initData);
  if (!user || !isAdminId(user.id)) return res.status(403).json({ error: "Ruxsat yo'q" });
  store.clearAllOrders(todayStr());
  res.json({ ok: true });
});

app.post('/api/admin/delivery-fee', (req, res) => {
  const user = validateInitData((req.body || {}).initData);
  if (!user || !isAdminId(user.id)) return res.status(403).json({ error: "Ruxsat yo'q" });
  const amount = Math.max(0, Number((req.body || {}).amount) || 0);
  store.setDeliveryFee(todayStr(), amount);
  res.json({ ok: true, amount });
});

app.post('/api/admin/toggle-paid', (req, res) => {
  const user = validateInitData((req.body || {}).initData);
  if (!user || !isAdminId(user.id)) return res.status(403).json({ error: "Ruxsat yo'q" });
  const targetUserId = Number((req.body || {}).user_id);
  const paid = !!(req.body || {}).paid;
  if (!targetUserId) return res.status(400).json({ error: "user_id kerak" });
  store.setPaymentStatus(todayStr(), targetUserId, paid);
  res.json({ ok: true });
});

app.post('/api/order', (req, res) => {
  const { initData, restaurant_id, items, comment } = req.body || {};
  const user = validateInitData(initData);
  if (!user) return res.status(401).json({ error: 'Tasdiqlanmadi — Telegram ichidan oching' });

  const restaurant = store.getRestaurant(restaurant_id);
  if (!restaurant) return res.status(404).json({ error: 'Restoran topilmadi' });

  const date = todayStr();
  const userName = [user.first_name, user.last_name].filter(Boolean).join(' ') || `ID ${user.id}`;
  store.addToUserOrder(date, user.id, userName, restaurant.id, restaurant.name, items || []);
  store.setUserComment(date, user.id, userName, restaurant.id, restaurant.name, comment || '');
  res.json({ ok: true });

  // Adminlarga bildirishnoma (javobni kutmasdan, orqa fonda yuboriladi)
  const total = (items || []).reduce((s, i) => s + i.price * i.qty, 0);
  const itemsText = (items || []).map((i) => `${i.name} ×${i.qty}`).join(', ');
  const notifyText =
    total > 0
      ? `🔔 ${userName} — ${restaurant.name}: ${itemsText} — ${total.toLocaleString()} so'm`
      : `🔔 ${userName} — ${restaurant.name}'ga izoh qoldirdi${comment ? `: "${comment}"` : ''}`;
  for (const adminId of ADMIN_IDS) {
    if (adminId === user.id) continue; // admin o'zi buyurtma bersa, o'ziga xabar yubormaymiz
    bot.telegram.sendMessage(adminId, notifyText).catch(() => {});
  }
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

// Bir restoran doirasidagi barcha foydalanuvchilarning taomlarini nomi
// bo'yicha jamlab, har bir taomdan jami nechta buyurtma qilinganini beradi
// (masalan: Lag'mon — 3 ta, Norin — 2 ta).
function itemTotals(users) {
  const totals = {};
  for (const u of users) {
    for (const item of u.items) {
      if (!totals[item.name]) totals[item.name] = { name: item.name, qty: 0 };
      totals[item.name].qty += item.qty;
    }
  }
  return Object.values(totals).sort((a, b) => b.qty - a.qty);
}

// Bugungi (yoki berilgan sanadagi) buyurtmalarni chiroyli chek ko'rinishida matn qilib beradi
async function buildExcelBuffer(date) {
  const data = ordersPayload(date);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Chek');

  ws.columns = [
    { header: 'Restoran', key: 'restaurant', width: 22 },
    { header: 'Ism', key: 'name', width: 22 },
    { header: 'ID', key: 'id', width: 14 },
    { header: 'Taomlar', key: 'items', width: 45 },
    { header: 'Summa', key: 'total', width: 15 },
    { header: "To'lov", key: 'paid', width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFE7DA' } };

  const paidMap = {};
  for (const u of data.userSummaries) paidMap[u.user_id] = u.paid;

  for (const rest of data.restaurants) {
    for (const u of rest.users) {
      const itemsText = u.items.length ? u.items.map((i) => `${i.name} x${i.qty}`).join(', ') : '';
      const row = ws.addRow({
        restaurant: rest.restaurant_name,
        name: u.user_name,
        id: u.user_id,
        items: itemsText || (u.comment ? `(izoh: ${u.comment})` : ''),
        total: u.total,
        paid: paidMap[u.user_id] ? "To'landi" : "To'lanmadi",
      });
      if (u.comment && itemsText) row.getCell('items').note = u.comment;
    }
  }

  ws.addRow({});
  const foodTotalRow = ws.addRow({ name: 'Taomlar jami', total: data.foodGrandTotal });
  foodTotalRow.font = { bold: true };

  if (data.deliveryFee > 0) {
    ws.addRow({ name: 'Yetkazib berish', total: data.deliveryFee });
    ws.addRow({});
    const header2 = ws.addRow({ name: 'Ism', id: 'ID', items: "Yakuniy (dastavka bilan)", total: '', paid: "To'lov" });
    header2.font = { bold: true };
    for (const u of data.userSummaries) {
      ws.addRow({ name: u.user_name, id: u.user_id, total: u.finalTotal, paid: u.paid ? "To'landi" : "To'lanmadi" });
    }
  }

  ws.addRow({});
  const grandRow = ws.addRow({ name: 'UMUMIY SUMMA', total: data.grandTotal });
  grandRow.font = { bold: true, size: 12 };

  ws.getColumn('total').numFmt = '#,##0 "so\'m"';

  // 2-varaq: har bir taomdan jami nechta buyurtma qilingani (restoran bo'yicha)
  const ws2 = wb.addWorksheet('Taomlar jami');
  ws2.columns = [
    { header: 'Restoran', key: 'restaurant', width: 22 },
    { header: 'Taom', key: 'name', width: 30 },
    { header: 'Soni', key: 'qty', width: 10 },
  ];
  ws2.getRow(1).font = { bold: true };
  ws2.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFE7DA' } };

  for (const rest of data.restaurants) {
    const totals = itemTotals(rest.users);
    for (const t of totals) {
      ws2.addRow({ restaurant: rest.restaurant_name, name: t.name, qty: t.qty });
    }
  }

  return wb.xlsx.writeBuffer();
}

function escapeHtml(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildReceiptText(date) {
  const data = ordersPayload(date);
  if (!data.restaurants.length) {
    return `🧾 ${date} uchun hali hech kim buyurtma bermagan.`;
  }

  const LINE = '───────────────';
  let text = `🧾 <b>Umumiy chek — ${date}</b>\n`;

  for (const rest of data.restaurants) {
    text += `\n🍽 <b>${escapeHtml(rest.restaurant_name)}</b>\n${LINE}\n`;
    for (const u of rest.users) {
      const itemsText = u.items.length
        ? u.items.map((i) => `${escapeHtml(i.name)} ×${i.qty}`).join(', ')
        : '(taom tanlanmagan)';
      text += `<b>${escapeHtml(u.user_name)}</b> (ID: ${u.user_id})\n  ${itemsText} — <b>${u.total.toLocaleString()} so'm</b>\n`;
      if (u.comment) text += `  💬 «${escapeHtml(u.comment)}»\n`;
    }

    const totals = itemTotals(rest.users);
    if (totals.length) {
      text += `${LINE}\n📦 <b>Jami (taom bo'yicha):</b>\n`;
      for (const t of totals) {
        text += `  ${escapeHtml(t.name)} — ${t.qty} ta\n`;
      }
    }

    text += `${LINE}\nJami: <b>${rest.subtotal.toLocaleString()} so'm</b>\n`;
  }

  text += `\n💵 Taomlar jami: <b>${data.foodGrandTotal.toLocaleString()} so'm</b>`;

  if (data.deliveryFee > 0) {
    text +=
      `\n🚚 Yetkazib berish: ${data.deliveryFee.toLocaleString()} so'm` +
      ` (${data.payingCount} kishiga, har biriga ${data.deliveryPerPerson.toLocaleString()} so'm)`;
  }

  if (data.userSummaries.length) {
    text += `\n\n📋 <b>Har kim to'lashi kerak:</b>\n${LINE}`;
    for (const u of data.userSummaries) {
      const mark = u.paid ? '✅' : '❌';
      text += `\n${mark} <b>${escapeHtml(u.user_name)}</b> (ID: ${u.user_id}) — ${u.finalTotal.toLocaleString()} so'm`;
    }
    text += `\n${LINE}\n(To'lovni qo'lda belgilash: /tolandi ID yoki /tolanmadi ID)`;
  }

  text += `\n\n💰 <b>UMUMIY SUMMA: ${data.grandTotal.toLocaleString()} so'm</b>`;
  return text;
}

bot.command('chek', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Bu buyruq faqat adminlar uchun.');
  ctx.reply(buildReceiptText(todayStr()), { parse_mode: 'HTML' });
});

bot.command('chek_excel', async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Bu buyruq faqat adminlar uchun.');
  try {
    const buffer = await buildExcelBuffer(todayStr());
    await ctx.replyWithDocument({ source: Buffer.from(buffer), filename: `chek-${todayStr()}.xlsx` });
  } catch (err) {
    console.error('Excel yaratishda xato:', err.message);
    ctx.reply("Excel faylini yaratib bo'lmadi.");
  }
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

bot.command('karta', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Bu buyruq faqat adminlar uchun.');
  const raw = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!raw) {
    const { cardNumber } = store.getSettings();
    return ctx.reply(
      cardNumber
        ? `To'lov uchun joriy karta: ${cardNumber}`
        : "Karta raqami hali kiritilmagan.\nFoydalanish: /karta 8600 1234 5678 9012\nOlib tashlash uchun: /karta off"
    );
  }
  if (raw.toLowerCase() === 'off') {
    store.updateSettings({ cardNumber: null });
    return ctx.reply("✅ Karta raqami olib tashlandi.");
  }
  store.updateSettings({ cardNumber: raw });
  ctx.reply(`✅ To'lov uchun karta saqlandi: ${raw}\nEndi bu Mini App'da hammaga ko'rinadi.`);
});

bot.command('eslatma', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Bu buyruq faqat adminlar uchun.');
  const raw = (ctx.message.text.split(' ')[1] || '').trim();
  if (!raw) {
    const { reminderTime, reminderChatId } = store.getSettings();
    return ctx.reply(
      reminderTime && reminderChatId
        ? `Kunlik eslatma har kuni soat ${reminderTime} da shu chatga yuboriladi.`
        : "Kunlik eslatma o'rnatilmagan.\nBuni GURUHNING O'ZIDA yozing: /eslatma 10:00\nO'chirish uchun: /eslatma off"
    );
  }
  if (raw.toLowerCase() === 'off') {
    store.updateSettings({ reminderTime: null, reminderChatId: null });
    return ctx.reply("✅ Kunlik eslatma o'chirildi.");
  }
  if (!/^\d{1,2}:\d{2}$/.test(raw)) {
    return ctx.reply('Foydalanish: shu guruhda /eslatma 10:00 deb yozing');
  }
  const [h, m] = raw.split(':');
  const reminderTime = `${h.padStart(2, '0')}:${m}`;
  store.updateSettings({ reminderTime, reminderChatId: ctx.chat.id });
  ctx.reply(`✅ Endi har kuni soat ${reminderTime} da shu chatga "Bugungi obed" xabari avtomatik yuboriladi.`);
});

bot.command('tolandi', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Bu buyruq faqat adminlar uchun.');
  const userId = Number(ctx.message.text.split(' ')[1]);
  if (!userId) return ctx.reply("Foydalanish: /tolandi user_id\nID'ni /chek chiqishidan oling.");
  store.setPaymentStatus(todayStr(), userId, true);
  ctx.reply(`✅ ID ${userId} — to'landi deb belgilandi.`);
});

bot.command('tolanmadi', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Bu buyruq faqat adminlar uchun.');
  const userId = Number(ctx.message.text.split(' ')[1]);
  if (!userId) return ctx.reply("Foydalanish: /tolanmadi user_id\nID'ni /chek chiqishidan oling.");
  store.setPaymentStatus(todayStr(), userId, false);
  ctx.reply(`✅ ID ${userId} — to'lanmadi deb belgilandi.`);
});

// Foydalanuvchi botga to'lov chekining skrinshotini yuborsa — avtomatik
// "to'landi" deb belgilanadi va tekshirish uchun adminlarga forward qilinadi.
bot.on('photo', (ctx) => {
  if (ctx.chat.type !== 'private') return; // faqat botning shaxsiy chatida qabul qilinadi

  const userName = [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || `ID ${ctx.from.id}`;
  store.setPaymentStatus(todayStr(), ctx.from.id, true);
  ctx.reply("✅ Rahmat! To'lov cheki qabul qilindi — obed jadvalida \"to'landi\" deb belgilandi.");

  for (const adminId of ADMIN_IDS) {
    if (adminId === ctx.from.id) continue;
    ctx.telegram.forwardMessage(adminId, ctx.chat.id, ctx.message.message_id).catch(() => {});
    ctx.telegram.sendMessage(adminId, `☝️ ${userName} to'lov chekini yubordi (yuqoridagi rasm).`).catch(() => {});
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
      "/id — sizning Telegram ID'ingiz\n" +
      "💳 To'lov qilgach, chekning skrinshotini shu botga (shaxsiy chatga) yuboring — avtomatik \"to'landi\" deb belgilanadi.\n\n" +
      'Admin uchun:\n' +
      "/chek — bugungi umumiy chekni (ID'lar bilan) olish\n" +
      "/chek_excel — bugungi chekni .xlsx (Excel) fayl qilib yuboradi\n" +
      "/tozalash — 60 kundan eski ma'lumotlarni qo'lda tozalaydi (avtomatik ham ishlaydi)\n" +
      "/karta 8600 1234 5678 9012 — to'lov uchun karta raqamini belgilaydi (Mini App'da hammaga ko'rinadi)\n" +
      "/karta off — karta raqamini olib tashlaydi\n" +
      "/hammasini_bekor — bugungi BARCHA buyurtmalarni bekor qiladi\n" +
      "/buyurtma_bekor user_id — bitta odamning buyurtmasini bekor qiladi\n" +
      "/dastavka summa — yetkazib berish narxini belgilaydi (teng bo'linadi)\n" +
      "/dastavka 0 — yetkazib berish narxini olib tashlaydi\n" +
      "/eslatma 10:00 — shu guruhga har kuni avtomatik eslatma yuboradi (GURUHDA yozing)\n" +
      "/eslatma off — kunlik eslatmani o'chiradi\n" +
      "/tolandi user_id — odamni \"to'ladi\" deb belgilaydi\n" +
      "/tolanmadi user_id — odamni \"to'lamadi\" deb belgilaydi\n" +
      '/restoran_qoshish Nomi\n' +
      '/restoran_qoshish Nomi | https://sayt.uz  (sayt havolasi bilan)\n' +
      "/restoran_sayt restoran_id | https://sayt.uz  (havolani qo'shish/o'zgartirish)\n" +
      "/restoran_sayt restoran_id | -  (havolani olib tashlash)\n" +
      "/taom_qoshish restoran_id | Taom nomi | Narxi | (ixtiyoriy) rasm havolasi\n" +
      "/taom_rasm restoran_id | taom_id | rasm havolasi  (rasmni qo'shish/o'zgartirish)\n" +
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
    const [ridStr, name, priceStr, imageRaw] = parts;
    const rid = Number(ridStr);
    const price = Number(priceStr.replace(/[^\d]/g, ''));
    const image = imageRaw && (isValidUrl(imageRaw) || imageRaw.startsWith('/')) ? imageRaw : null;
    if (!rid || !name || !price) {
      results.push(`❌ Ma'lumot noto'g'ri: "${line}"`);
      continue;
    }
    const item = store.addMenuItem(rid, name, price, image);
    if (!item) {
      results.push(`❌ ID ${rid} bilan restoran topilmadi: "${name}"`);
      continue;
    }
    results.push(`✅ "${name}" — ${price.toLocaleString()} so'm${image ? ' 🖼' : ''}`);
  }

  if (!results.length) {
    return ctx.reply(
      'Foydalanish: /taom_qoshish restoran_id | Taom nomi | Narxi | (ixtiyoriy) rasm havolasi\n' +
        "Masalan: /taom_qoshish 1 | Osh | 20000\n" +
        "Rasm bilan: /taom_qoshish 1 | Osh | 20000 | https://sayt.uz/osh.jpg\n\n" +
        "Bir nechtasini bitta xabarda, har birini alohida qatorga yozib ham yuborishingiz mumkin."
    );
  }

  ctx.reply(results.join('\n'));
});

bot.command('taom_rasm', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Bu buyruq faqat adminlar uchun.');
  const raw = ctx.message.text.split(' ').slice(1).join(' ');
  const parts = raw.split('|').map((s) => s.trim());
  const rid = Number(parts[0]);
  const iid = Number(parts[1]);
  const imgRaw = parts[2];
  if (!rid || !iid || !imgRaw) {
    return ctx.reply(
      "Foydalanish: /taom_rasm restoran_id | taom_id | rasm havolasi\nOlib tashlash uchun: rasm havolasi o'rniga - yozing"
    );
  }
  const image = imgRaw === '-' ? null : imgRaw;
  if (image && !isValidUrl(image) && !image.startsWith('/')) {
    return ctx.reply("Rasm havolasi https:// bilan boshlanishi yoki / bilan boshlanadigan ichki yo'l bo'lishi kerak.");
  }
  const ok = store.setMenuItemImage(rid, iid, image);
  ctx.reply(ok ? (image ? '✅ Rasm qo\'shildi.' : "✅ Rasm olib tashlandi.") : 'Topilmadi.');
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

// ---------- Kunlik avtomatik eslatma ----------

let lastReminderSentDate = null;

function sendDailyReminderIfDue() {
  const { reminderTime, reminderChatId } = store.getSettings();
  if (!reminderTime || !reminderChatId) return;
  if (!bot.botInfo) return; // bot hali to'liq ishga tushmagan

  const today = todayStr();
  if (nowHHMM() !== reminderTime || lastReminderSentDate === today) return;

  lastReminderSentDate = today;
  const username = bot.botInfo.username;
  const link = MINIAPP_SHORT_NAME
    ? `https://t.me/${username}/${MINIAPP_SHORT_NAME}?startapp=obed`
    : `https://t.me/${username}?start=obed`;

  bot.telegram
    .sendMessage(
      reminderChatId,
      'Bugungi obed! 🍽 Kerakli restoranni tanlab, buyurtma bering.',
      Markup.inlineKeyboard([Markup.button.url('🍽 Obedni ochish', link)])
    )
    .catch((err) => console.error("Eslatma yuborilmadi:", err.message));
}

setInterval(sendDailyReminderIfDue, 60 * 1000);

// ---------- Eski ma'lumotlarni avtomatik tozalash ----------

const DATA_RETENTION_DAYS = 60;

function runCleanup() {
  const removed = store.cleanupOldData(DATA_RETENTION_DAYS);
  if (removed > 0) {
    console.log(`Tozalash: ${removed} ta yozuv o'chirildi (${DATA_RETENTION_DAYS} kundan eski).`);
  }
}

runCleanup(); // server ishga tushganda bir marta
setInterval(runCleanup, 24 * 60 * 60 * 1000); // keyin har 24 soatda

bot.command('tozalash', (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply('⛔ Bu buyruq faqat adminlar uchun.');
  const removed = store.cleanupOldData(DATA_RETENTION_DAYS);
  ctx.reply(
    removed > 0
      ? `✅ ${removed} ta eski yozuv (${DATA_RETENTION_DAYS} kundan eski) o'chirildi.`
      : "Hozircha o'chiriladigan eski ma'lumot yo'q."
  );
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
