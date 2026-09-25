require('dotenv').config();
const express = require('express');
const compression = require('compression');
const crypto = require('crypto');
const path = require('path');
const { Telegraf, Markup } = require('telegraf');
const ExcelJS = require('exceljs');
const store = require('./store');
const menuImport = require('./menuImport');

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

// Mini App'dan kelgan initData shuncha vaqtdan eski bo'lsa, qabul qilinmaydi
const INIT_DATA_MAX_AGE_SEC = 24 * 60 * 60;
// Bitta taomdan bir martada buyurtma qilish mumkin bo'lgan maksimal son
const MAX_QTY = 50;

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
app.use('/images', express.static(store.IMAGES_DIR, { maxAge: '7d' }));

function isAdminId(id) {
  return ADMIN_IDS.includes(id);
}

function isAdmin(ctx) {
  return isAdminId(ctx.from?.id);
}

function isValidUrl(url) {
  return /^https?:\/\/\S+$/i.test(url);
}

// Buyruqdan keyingi matn: "/dastavka   50000" -> "50000"
function commandArgs(ctx) {
  return (ctx.message?.text || '').replace(/^\/\S+\s*/, '').trim();
}

function userDisplayName(u) {
  return [u.first_name, u.last_name].filter(Boolean).join(' ') || `ID ${u.id}`;
}

// ---------- Telegram WebApp initData ni tekshirish ----------
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
const WEBAPP_SECRET = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();

function validateInitData(initData) {
  if (!initData || typeof initData !== 'string') return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null;
  params.delete('hash');

  const pairs = [];
  for (const [key, value] of params.entries()) pairs.push(`${key}=${value}`);
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const computedHash = crypto.createHmac('sha256', WEBAPP_SECRET).update(dataCheckString).digest();
  if (!crypto.timingSafeEqual(computedHash, Buffer.from(hash, 'hex'))) return null;

  const authDate = Number(params.get('auth_date'));
  if (!authDate || Date.now() / 1000 - authDate > INIT_DATA_MAX_AGE_SEC) return null;

  try {
    const user = JSON.parse(params.get('user') || '');
    return user && typeof user.id === 'number' ? user : null;
  } catch {
    return null;
  }
}

// Toshkent vaqti (UTC+5) bo'yicha bugungi sana
function todayStr() {
  const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

// Toshkent vaqti bo'yicha kun boshidan beri o'tgan daqiqalar
function nowMinutes() {
  const now = new Date(Date.now() + 5 * 60 * 60 * 1000);
  return now.getUTCHours() * 60 + now.getUTCMinutes();
}

function formatSom(n) {
  return `${n.toLocaleString('ru-RU')} so'm`;
}

// ---------- API ----------

function requireUser(req, res) {
  const initData = req.method === 'GET' ? req.query.initData : (req.body || {}).initData;
  const user = validateInitData(initData);
  if (!user) res.status(401).json({ error: 'Tasdiqlanmadi — Mini App\'ni Telegram ichidan qayta oching' });
  return user;
}

function requireAdmin(req, res) {
  const user = requireUser(req, res);
  if (user && !isAdminId(user.id)) {
    res.status(403).json({ error: "Ruxsat yo'q" });
    return null;
  }
  return user;
}

app.get('/api/restaurants', (req, res) => {
  res.json(restaurantListPayload());
});

app.get('/api/restaurants/:id/menu', (req, res) => {
  const restaurant = store.getRestaurant(req.params.id);
  if (!restaurant) return res.status(404).json({ error: 'Restoran topilmadi' });
  res.json(restaurant);
});

app.get('/api/my-order/:restaurantId', (req, res) => {
  const user = validateInitData(req.query.initData);
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
  const payStatuses = store.getPaymentStatuses(date);

  const byRestaurant = {};
  const userFoodTotals = {}; // user_id -> { user_id, user_name, total }
  let foodGrandTotal = 0;

  function userRow(rid, restaurantName, userId, userName) {
    if (!byRestaurant[rid]) {
      byRestaurant[rid] = { restaurant_id: rid, restaurant_name: restaurantName, users: {}, subtotal: 0 };
    }
    const group = byRestaurant[rid];
    if (!group.users[userId]) {
      group.users[userId] = { user_id: userId, user_name: userName, items: [], total: 0, comment: '' };
    }
    return group;
  }

  for (const row of rows) {
    const group = userRow(row.restaurant_id, row.restaurant_name, row.user_id, row.user_name);
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
    const group = userRow(c.restaurant_id, c.restaurant_name, c.user_id, c.user_name);
    group.users[c.user_id].comment = c.text;
  }

  const restaurants = Object.values(byRestaurant).map((g) => ({ ...g, users: Object.values(g.users) }));

  // Dastavka narxi FAQAT haqiqatan taom buyurtma qilganlar orasida (izohgina qoldirganlarsiz) teng bo'linadi.
  // Qoldiq so'mlar birinchi odamlarga bittadan qo'shiladi — jami aynan dastavka narxiga teng bo'ladi.
  const payingUsers = Object.values(userFoodTotals).sort((a, b) => a.user_name.localeCompare(b.user_name));
  const payingCount = payingUsers.length;
  const deliveryPerPerson = payingCount > 0 ? Math.floor(deliveryFee / payingCount) : 0;
  const remainder = payingCount > 0 ? deliveryFee - deliveryPerPerson * payingCount : 0;

  const userSummaries = payingUsers.map((u, idx) => {
    const deliveryShare = deliveryPerPerson + (idx < remainder ? 1 : 0);
    const payStatus = payStatuses[u.user_id] || null;
    return {
      user_id: u.user_id,
      user_name: u.user_name,
      foodTotal: u.total,
      deliveryShare,
      finalTotal: u.total + deliveryShare,
      payStatus,
      paid: payStatus === store.PAID,
    };
  });

  const grandTotal = foodGrandTotal + (payingCount > 0 ? deliveryFee : 0);

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

// Umumiy jadvalda ismlar va summalar bor — faqat Telegram orqali kirganlarga ko'rsatiladi
app.get('/api/orders', (req, res) => {
  if (!requireUser(req, res)) return;
  res.json(ordersPayload(todayStr()));
});

// Ilk yuklanishda ikkita alohida so'rov o'rniga bittasi bilan cheklanish uchun
// (restoranlar ro'yxati + bugungi jadval bir yo'la qaytariladi)
app.get('/api/bootstrap', (req, res) => {
  const user = validateInitData(req.query.initData);
  const { cardNumber } = store.getSettings();
  res.json({
    restaurants: restaurantListPayload(),
    orders: user ? ordersPayload(todayStr()) : null,
    isAdmin: user ? isAdminId(user.id) : false,
    cardNumber: cardNumber || null,
  });
});

// ---------- Admin: Mini App ichidagi boshqaruv tugmalari ----------

app.post('/api/admin/card-number', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const cardNumber = String((req.body || {}).cardNumber || '').trim().slice(0, 40) || null;
  store.updateSettings({ cardNumber });
  res.json({ ok: true, cardNumber });
});

app.post('/api/admin/clear-all', (req, res) => {
  if (!requireAdmin(req, res)) return;
  store.clearAllOrders(todayStr());
  res.json({ ok: true });
});

app.post('/api/admin/delivery-fee', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const amount = Math.max(0, Math.round(Number((req.body || {}).amount) || 0));
  store.setDeliveryFee(todayStr(), amount);
  res.json({ ok: true, amount });
});

app.post('/api/admin/toggle-paid', (req, res) => {
  if (!requireAdmin(req, res)) return;
  const targetUserId = Number((req.body || {}).user_id);
  const paid = !!(req.body || {}).paid;
  if (!targetUserId) return res.status(400).json({ error: "user_id kerak" });
  store.setPaymentStatus(todayStr(), targetUserId, paid ? store.PAID : null);
  res.json({ ok: true });
});

app.post('/api/order', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const { restaurant_id, items, comment } = req.body || {};

  const restaurant = store.getRestaurant(restaurant_id);
  if (!restaurant) return res.status(404).json({ error: 'Restoran topilmadi' });

  // Nom va narx HECH QACHON foydalanuvchidan olinmaydi — faqat taom ID'si va soni.
  // Narx server tomonida menyudan olinadi.
  const orderItems = [];
  for (const raw of Array.isArray(items) ? items : []) {
    const qty = Number(raw?.qty);
    const menuItem = restaurant.items.find((i) => i.id === Number(raw?.id));
    if (!menuItem || !Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return res.status(400).json({ error: "Buyurtmada noto'g'ri taom yoki miqdor bor. Menyuni yangilab, qayta urinib ko'ring." });
    }
    orderItems.push({ name: menuItem.name, price: menuItem.price, qty });
  }
  const commentText = typeof comment === 'string' ? comment.trim().slice(0, 300) : '';
  if (!orderItems.length && !commentText) {
    return res.status(400).json({ error: 'Taom tanlang yoki izoh yozing' });
  }

  const date = todayStr();
  const userName = userDisplayName(user);
  if (orderItems.length) {
    store.addToUserOrder(date, user.id, userName, restaurant.id, restaurant.name, orderItems);
  }
  store.setUserComment(date, user.id, userName, restaurant.id, restaurant.name, commentText);
  res.json({ ok: true });

  // Adminlarga bildirishnoma (javobni kutmasdan, orqa fonda yuboriladi)
  const total = orderItems.reduce((s, i) => s + i.price * i.qty, 0);
  const itemsText = orderItems.map((i) => `${i.name} ×${i.qty}`).join(', ');
  const notifyText =
    total > 0
      ? `🔔 ${userName} — ${restaurant.name}: ${itemsText} — ${formatSom(total)}${commentText ? `\n💬 "${commentText}"` : ''}`
      : `🔔 ${userName} — ${restaurant.name}'ga izoh qoldirdi: "${commentText}"`;
  for (const adminId of ADMIN_IDS) {
    if (adminId === user.id) continue; // admin o'zi buyurtma bersa, o'ziga xabar yubormaymiz
    bot.telegram.sendMessage(adminId, notifyText).catch(() => {});
  }
});

app.delete('/api/order', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  store.clearUserOrder(todayStr(), user.id, Number((req.body || {}).restaurant_id));
  res.json({ ok: true });
});

app.post('/api/order/remove-item', (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const { restaurant_id, item_name } = req.body || {};
  if (!item_name || typeof item_name !== 'string') return res.status(400).json({ error: 'item_name kerak' });

  store.removeItemFromOrder(todayStr(), user.id, Number(restaurant_id), item_name);
  res.json({ ok: true });
});

// ---------- Bot: umumiy buyruqlar ----------

function miniAppLink(username) {
  return MINIAPP_SHORT_NAME
    ? `https://t.me/${username}/${MINIAPP_SHORT_NAME}?startapp=obed`
    : `https://t.me/${username}?start=obed`;
}

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

  if (ctx.chat?.type === 'private') {
    return ctx.reply(text, Markup.inlineKeyboard([Markup.button.webApp('🍽 Obedni ochish', WEBAPP_URL)]));
  }

  const username = ctx.botInfo?.username;
  if (!username) {
    return ctx.reply(`${text}\n\nBotning shaxsiy chatiga o'tib /start deb yozing.`);
  }
  return ctx.reply(text, Markup.inlineKeyboard([Markup.button.url('🍽 Obedni ochish', miniAppLink(username))]));
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

const PAY_LABELS = { paid: "To'landi", pending: 'Tekshirilmoqda' };
const PAY_MARKS = { paid: '✅', pending: '⏳' };

// Bugungi (yoki berilgan sanadagi) buyurtmalarni Excel fayl qilib beradi
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
    { header: "To'lov", key: 'paid', width: 14 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFE7DA' } };

  const statusMap = {};
  for (const u of data.userSummaries) statusMap[u.user_id] = u.payStatus;
  const payLabel = (status) => PAY_LABELS[status] || "To'lanmadi";

  for (const rest of data.restaurants) {
    for (const u of rest.users) {
      const itemsText = u.items.length ? u.items.map((i) => `${i.name} x${i.qty}`).join(', ') : '';
      const row = ws.addRow({
        restaurant: rest.restaurant_name,
        name: u.user_name,
        id: u.user_id,
        items: itemsText || (u.comment ? `(izoh: ${u.comment})` : ''),
        total: u.total,
        paid: u.items.length ? payLabel(statusMap[u.user_id]) : '',
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
      ws.addRow({ name: u.user_name, id: u.user_id, total: u.finalTotal, paid: payLabel(u.payStatus) });
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
    for (const t of itemTotals(rest.users)) {
      ws2.addRow({ restaurant: rest.restaurant_name, name: t.name, qty: t.qty });
    }
  }

  return wb.xlsx.writeBuffer();
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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
      text += `<b>${escapeHtml(u.user_name)}</b> (ID: ${u.user_id})\n  ${itemsText} — <b>${formatSom(u.total)}</b>\n`;
      if (u.comment) text += `  💬 «${escapeHtml(u.comment)}»\n`;
    }

    const totals = itemTotals(rest.users);
    if (totals.length) {
      text += `${LINE}\n📦 <b>Jami (taom bo'yicha):</b>\n`;
      for (const t of totals) {
        text += `  ${escapeHtml(t.name)} — ${t.qty} ta\n`;
      }
    }

    text += `${LINE}\nJami: <b>${formatSom(rest.subtotal)}</b>\n`;
  }

  text += `\n💵 Taomlar jami: <b>${formatSom(data.foodGrandTotal)}</b>`;

  if (data.deliveryFee > 0) {
    text +=
      `\n🚚 Yetkazib berish: ${formatSom(data.deliveryFee)}` +
      ` (${data.payingCount} kishiga, har biriga ~${formatSom(data.deliveryPerPerson)})`;
  }

  if (data.userSummaries.length) {
    text += `\n\n📋 <b>Har kim to'lashi kerak:</b>\n${LINE}`;
    for (const u of data.userSummaries) {
      const mark = PAY_MARKS[u.payStatus] || '❌';
      text += `\n${mark} <b>${escapeHtml(u.user_name)}</b> (ID: ${u.user_id}) — ${formatSom(u.finalTotal)}`;
    }
    text += `\n${LINE}\n✅ to'landi · ⏳ chek tekshirilmoqda · ❌ to'lanmagan`;
    text += `\n(Qo'lda belgilash: /tolandi ID yoki /tolanmadi ID)`;
  }

  text += `\n\n💰 <b>UMUMIY SUMMA: ${formatSom(data.grandTotal)}</b>`;
  return text;
}

// Faqat adminlar uchun buyruq ro'yxatdan o'tkazadi
function adminCommand(name, handler) {
  bot.command(name, (ctx) => {
    if (!isAdmin(ctx)) return ctx.reply('⛔ Bu buyruq faqat adminlar uchun.');
    return handler(ctx);
  });
}

adminCommand('chek', (ctx) => ctx.reply(buildReceiptText(todayStr()), { parse_mode: 'HTML' }));

adminCommand('chek_excel', async (ctx) => {
  try {
    const buffer = await buildExcelBuffer(todayStr());
    await ctx.replyWithDocument({ source: Buffer.from(buffer), filename: `chek-${todayStr()}.xlsx` });
  } catch (err) {
    console.error('Excel yaratishda xato:', err.message);
    ctx.reply("Excel faylini yaratib bo'lmadi.");
  }
});

adminCommand('hammasini_bekor', (ctx) => {
  store.clearAllOrders(todayStr());
  ctx.reply("✅ Bugungi barcha buyurtmalar va izohlar bekor qilindi.");
});

adminCommand('buyurtma_bekor', (ctx) => {
  const userId = Number(commandArgs(ctx));
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

adminCommand('dastavka', (ctx) => {
  const raw = commandArgs(ctx);
  if (!raw) {
    const current = store.getDeliveryFee(todayStr());
    return ctx.reply(
      current
        ? `Bugungi yetkazib berish narxi: ${formatSom(current)}`
        : "Bugun uchun yetkazib berish narxi kiritilmagan.\nFoydalanish: /dastavka summa (masalan: /dastavka 50000)\nOlib tashlash uchun: /dastavka 0"
    );
  }
  const amount = Number(raw.replace(/[^\d]/g, '')) || 0;
  store.setDeliveryFee(todayStr(), amount);
  if (amount > 0) {
    ctx.reply(
      `✅ Bugungi yetkazib berish narxi ${formatSom(amount)} qilib belgilandi.\n` +
        "Bu summa bugun taom buyurtma qilgan barcha odamlar orasida teng bo'linadi."
    );
  } else {
    ctx.reply("✅ Yetkazib berish narxi olib tashlandi.");
  }
});

adminCommand('karta', (ctx) => {
  const raw = commandArgs(ctx).slice(0, 40);
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

adminCommand('tolov_eslatma', async (ctx) => {
  const data = ordersPayload(todayStr());
  const { cardNumber } = store.getSettings();

  if (!data.userSummaries.length) {
    return ctx.reply('Bugun hali hech kim taom buyurtma bermagan.');
  }
  if (!cardNumber) {
    return ctx.reply("Avval /karta orqali to'lov kartasini kiriting, keyin qayta urinib ko'ring.");
  }

  const unpaid = data.userSummaries.filter((u) => u.payStatus !== store.PAID);
  if (!unpaid.length) return ctx.reply("✅ Bugun buyurtma bergan hamma to'lagan.");

  await ctx.reply(`⏳ ${unpaid.length} ta odamga to'lov eslatmasi yuborilmoqda...`);

  let sent = 0;
  let failed = 0;
  for (const u of unpaid) {
    const breakdown =
      data.deliveryFee > 0
        ? `  (taom: ${formatSom(u.foodTotal)} + dastavka: ${formatSom(u.deliveryShare)})\n`
        : '';
    const text =
      `🍽 Bugungi to'lovingiz\n\n` +
      `💰 Jami: ${formatSom(u.finalTotal)}\n${breakdown}` +
      `💳 Karta: ${cardNumber}\n\n` +
      "Iltimos, shu kartaga to'lab, chekning skrinshotini shu botga (shu yerga) yuboring.";
    try {
      await ctx.telegram.sendMessage(u.user_id, text);
      sent++;
    } catch {
      failed++;
    }
    await new Promise((resolve) => setTimeout(resolve, 60));
  }

  ctx.reply(
    `✅ Yuborildi: ${sent} ta` +
      (failed > 0 ? `\n❌ Yetkazilmadi: ${failed} ta (bu odamlar botga hali shaxsan yozmagan bo'lishi mumkin — ular /start bosishi kerak)` : '')
  );
});

adminCommand('eslatma', (ctx) => {
  const raw = commandArgs(ctx);
  if (!raw) {
    const { reminderTime, reminderChatId } = store.getSettings();
    return ctx.reply(
      reminderTime && reminderChatId
        ? `Kunlik eslatma har kuni soat ${reminderTime} da yuboriladi.`
        : "Kunlik eslatma o'rnatilmagan.\nBuni GURUHNING O'ZIDA yozing: /eslatma 10:00\nO'chirish uchun: /eslatma off"
    );
  }
  if (raw.toLowerCase() === 'off') {
    store.updateSettings({ reminderTime: null, reminderChatId: null });
    return ctx.reply("✅ Kunlik eslatma o'chirildi.");
  }
  const m = raw.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) {
    return ctx.reply('Foydalanish: shu guruhda /eslatma 10:00 deb yozing');
  }
  const reminderTime = `${m[1].padStart(2, '0')}:${m[2]}`;
  // Bugun shu vaqt allaqachon o'tgan bo'lsa, eslatma ertadan boshlanadi
  const alreadyPassed = nowMinutes() >= Number(m[1]) * 60 + Number(m[2]);
  store.updateSettings({
    reminderTime,
    reminderChatId: ctx.chat.id,
    reminderLastSent: alreadyPassed ? todayStr() : null,
  });
  ctx.reply(`✅ Endi har kuni soat ${reminderTime} da shu chatga "Bugungi obed" xabari avtomatik yuboriladi.`);
});

adminCommand('tolandi', (ctx) => {
  const userId = Number(commandArgs(ctx));
  if (!userId) return ctx.reply("Foydalanish: /tolandi user_id\nID'ni /chek chiqishidan oling.");
  store.setPaymentStatus(todayStr(), userId, store.PAID);
  ctx.reply(`✅ ID ${userId} — to'landi deb belgilandi.`);
});

adminCommand('tolanmadi', (ctx) => {
  const userId = Number(commandArgs(ctx));
  if (!userId) return ctx.reply("Foydalanish: /tolanmadi user_id\nID'ni /chek chiqishidan oling.");
  store.setPaymentStatus(todayStr(), userId, null);
  ctx.reply(`✅ ID ${userId} — to'lanmadi deb belgilandi.`);
});

// ---------- To'lov cheki (skrinshot) ----------

// Foydalanuvchi botga to'lov chekining skrinshotini yuborsa — "tekshirilmoqda"
// holatiga o'tadi va adminlarga Tasdiqlash / Rad etish tugmalari bilan yuboriladi.
// Faqat admin tasdiqlagandan keyingina "to'landi" bo'ladi.
bot.on('photo', async (ctx) => {
  if (ctx.chat.type !== 'private') return; // faqat botning shaxsiy chatida qabul qilinadi

  const date = todayStr();
  const userId = ctx.from.id;
  if (!store.userHasOrder(date, userId)) {
    return ctx.reply("Bugun sizda buyurtma topilmadi, shuning uchun chek qabul qilinmadi.");
  }

  const current = store.getPaymentStatuses(date)[userId];
  if (current === store.PAID) {
    return ctx.reply("✅ Bugungi to'lovingiz allaqachon tasdiqlangan.");
  }

  store.setPaymentStatus(date, userId, store.PENDING);
  ctx.reply("⏳ Rahmat! Chek qabul qilindi — admin tekshirib tasdiqlagach, \"to'landi\" deb belgilanadi.");

  const summary = ordersPayload(date).userSummaries.find((u) => u.user_id === userId);
  const caption =
    `🧾 ${userDisplayName(ctx.from)} (ID: ${userId}) to'lov chekini yubordi.` +
    (summary ? `\nTo'lashi kerak: ${formatSom(summary.finalTotal)}` : '');
  const keyboard = Markup.inlineKeyboard([
    Markup.button.callback('✅ Tasdiqlash', `pay:ok:${userId}:${date}`),
    Markup.button.callback('❌ Rad etish', `pay:no:${userId}:${date}`),
  ]);
  const photo = ctx.message.photo[ctx.message.photo.length - 1].file_id;

  for (const adminId of ADMIN_IDS) {
    ctx.telegram.sendPhoto(adminId, photo, { caption, ...keyboard }).catch(() => {});
  }
});

bot.action(/^pay:(ok|no):(\d+):(\d{4}-\d{2}-\d{2})$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ Faqat adminlar uchun', { show_alert: true });
  const [, action, userIdStr, date] = ctx.match;
  const userId = Number(userIdStr);
  const approved = action === 'ok';

  store.setPaymentStatus(date, userId, approved ? store.PAID : null);
  await ctx.answerCbQuery(approved ? 'Tasdiqlandi' : 'Rad etildi');

  const caption = ctx.callbackQuery.message?.caption || '';
  const verdict = approved
    ? `\n\n✅ ${userDisplayName(ctx.from)} tasdiqladi`
    : `\n\n❌ ${userDisplayName(ctx.from)} rad etdi`;
  ctx.editMessageCaption(caption + verdict).catch(() => {});

  bot.telegram
    .sendMessage(
      userId,
      approved
        ? "✅ To'lovingiz admin tomonidan tasdiqlandi. Rahmat!"
        : "❌ To'lov chekingiz tasdiqlanmadi. Iltimos, summani tekshirib, to'g'ri chekni qayta yuboring yoki admin bilan bog'laning."
    )
    .catch(() => {});
});

bot.command('restoranlar', (ctx) => {
  const restaurants = store.getRestaurants();
  if (!restaurants.length) return ctx.reply("Hozircha restoranlar qo'shilmagan.");
  const text = restaurants
    .map((r) => `#${r.id} — ${r.name} (${r.items.length} ta taom)${r.url ? `\n   🔗 ${r.url}` : ''}`)
    .join('\n');
  ctx.reply(`🍽 Restoranlar ro'yxati:\n${text}`);
});

bot.command('menyu', (ctx) => {
  const restaurant = store.getRestaurant(Number(commandArgs(ctx)));
  if (!restaurant) return ctx.reply('Foydalanish: /menyu restoran_id\nID\'larni /restoranlar orqali bilib oling.');
  if (!restaurant.items.length) return ctx.reply(`"${restaurant.name}" menyusi bo'sh.`);
  const lines = restaurant.items.map((i) => `${i.id}. ${i.name} — ${formatSom(i.price)}${i.image ? ' 🖼' : ''}`);
  sendLongText(ctx, `🍽 ${restaurant.name} (ID: ${restaurant.id})\n\n${lines.join('\n')}`);
});

// Telegram xabari 4096 belgidan oshmasligi kerak — uzun matnni bo'lib yuboradi
async function sendLongText(ctx, text, extra) {
  const chunks = [];
  let current = '';
  for (const line of text.split('\n')) {
    if (current.length + line.length + 1 > 3900) {
      chunks.push(current);
      current = '';
    }
    current += (current ? '\n' : '') + line;
  }
  if (current) chunks.push(current);
  for (let i = 0; i < chunks.length; i++) {
    await ctx.reply(chunks[i], i === chunks.length - 1 ? extra : undefined);
  }
}

bot.command('yordam', (ctx) => {
  ctx.reply(
    "📋 Buyruqlar:\n" +
      '/obed — bugungi obed jadvalini ochish\n' +
      "/restoranlar — restoranlar ro'yxati\n" +
      '/menyu restoran_id — restoran menyusi (taom ID\'lari bilan)\n' +
      "/id — sizning Telegram ID'ingiz\n" +
      "💳 To'lov qilgach, chekning skrinshotini shu botga (shaxsiy chatga) yuboring — admin tasdiqlagach \"to'landi\" deb belgilanadi.\n\n" +
      'Admin uchun:\n' +
      "/chek — bugungi umumiy chekni (ID'lar bilan) olish\n" +
      "/chek_excel — bugungi chekni .xlsx (Excel) fayl qilib yuboradi\n" +
      "/tozalash — 60 kundan eski ma'lumotlarni qo'lda tozalaydi (avtomatik ham ishlaydi)\n" +
      "/karta 8600 1234 5678 9012 — to'lov uchun karta raqamini belgilaydi (Mini App'da hammaga ko'rinadi)\n" +
      "/karta off — karta raqamini olib tashlaydi\n" +
      "/tolov_eslatma — bugun buyurtma bergan, hali to'lamaganlarga shaxsiy to'lov summasi va kartani yuboradi\n" +
      "/hammasini_bekor — bugungi BARCHA buyurtmalarni bekor qiladi\n" +
      "/buyurtma_bekor user_id — bitta odamning buyurtmasini bekor qiladi\n" +
      "/dastavka summa — yetkazib berish narxini belgilaydi (teng bo'linadi)\n" +
      "/dastavka 0 — yetkazib berish narxini olib tashlaydi\n" +
      "/eslatma 10:00 — shu guruhga har kuni avtomatik eslatma yuboradi (GURUHDA yozing)\n" +
      "/eslatma off — kunlik eslatmani o'chiradi\n" +
      "/tolandi user_id — odamni \"to'ladi\" deb belgilaydi\n" +
      "/tolanmadi user_id — odamni \"to'lamadi\" deb belgilaydi\n\n" +
      "🌐 Saytdan menyu import qilish:\n" +
      "/menyu_import https://sayt.uz — saytdan taom, narx va rasmlarni o'qib, YANGI restoran sifatida qo'shadi\n" +
      "/menyu_import restoran_id | https://sayt.uz — mavjud restoran menyusiga qo'shadi/yangilaydi\n" +
      "(Topilgan taomlar avval sizga ko'rsatiladi, faqat ✅ Tasdiqlash bosilgandan keyin saqlanadi.)\n\n" +
      '/restoran_qoshish Nomi\n' +
      '/restoran_qoshish Nomi | https://sayt.uz  (sayt havolasi bilan)\n' +
      "/restoran_sayt restoran_id | https://sayt.uz  (havolani qo'shish/o'zgartirish)\n" +
      "/restoran_sayt restoran_id | -  (havolani olib tashlash)\n" +
      "/taom_qoshish restoran_id | Taom nomi | Narxi | (ixtiyoriy) rasm havolasi\n" +
      "/taom_narx restoran_id | taom_id | yangi narx\n" +
      "/taom_rasm restoran_id | taom_id | rasm havolasi  (rasmni qo'shish/o'zgartirish)\n" +
      "/taom_ochirish restoran_id | taom_id\n" +
      '/restoran_ochirish restoran_id'
  );
});

// ---------- Bot: restoran va menyu boshqaruvi (admin) ----------

function pipeArgs(ctx) {
  return commandArgs(ctx).split('|').map((s) => s.trim());
}

adminCommand('restoran_qoshish', (ctx) => {
  const [name, urlRaw] = pipeArgs(ctx);
  if (!name) {
    return ctx.reply(
      "Foydalanish: /restoran_qoshish Nomi\nyoki sayt bilan: /restoran_qoshish Nomi | https://sayt.uz"
    );
  }
  if (urlRaw && !isValidUrl(urlRaw)) {
    return ctx.reply('Havola http:// yoki https:// bilan boshlanishi kerak.');
  }
  const r = store.addRestaurant(name.slice(0, 60), urlRaw || null);
  const urlNote = r.url ? `\n🔗 Sayt: ${r.url}` : '';
  ctx.reply(
    `✅ "${r.name}" qo'shildi (ID: ${r.id}).${urlNote}\nEndi taom qo'shing:\n/taom_qoshish ${r.id} | Taom nomi | Narxi` +
      (r.url ? `\nyoki saytdan avtomatik: /menyu_import ${r.id} | ${r.url}` : '')
  );
});

adminCommand('restoran_sayt', (ctx) => {
  const [ridStr, urlRaw] = pipeArgs(ctx);
  const rid = Number(ridStr);
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

function isValidImage(image) {
  return isValidUrl(image) || /^\/[\w./-]+$/.test(image);
}

adminCommand('taom_qoshish', (ctx) => {
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
    const image = imageRaw && isValidImage(imageRaw) ? imageRaw : null;
    if (!rid || !name || !price) {
      results.push(`❌ Ma'lumot noto'g'ri: "${line}"`);
      continue;
    }
    const item = store.addMenuItem(rid, name.slice(0, 120), price, image);
    if (!item) {
      results.push(`❌ ID ${rid} bilan restoran topilmadi: "${name}"`);
      continue;
    }
    results.push(`✅ "${item.name}" — ${formatSom(price)}${image ? ' 🖼' : ''}`);
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

adminCommand('taom_narx', (ctx) => {
  const [ridStr, iidStr, priceStr] = pipeArgs(ctx);
  const price = Number((priceStr || '').replace(/[^\d]/g, ''));
  if (!Number(ridStr) || !Number(iidStr) || !price) {
    return ctx.reply('Foydalanish: /taom_narx restoran_id | taom_id | yangi narx\nTaom ID\'larini /menyu restoran_id orqali ko\'ring.');
  }
  const item = store.updateMenuItem(ridStr, iidStr, { price });
  ctx.reply(item ? `✅ "${item.name}" narxi endi ${formatSom(price)}.` : 'Topilmadi.');
});

adminCommand('taom_rasm', (ctx) => {
  const [ridStr, iidStr, imgRaw] = pipeArgs(ctx);
  const rid = Number(ridStr);
  const iid = Number(iidStr);
  if (!rid || !iid || !imgRaw) {
    return ctx.reply(
      "Foydalanish: /taom_rasm restoran_id | taom_id | rasm havolasi\nOlib tashlash uchun: rasm havolasi o'rniga - yozing"
    );
  }
  const image = imgRaw === '-' ? null : imgRaw;
  if (image && !isValidImage(image)) {
    return ctx.reply("Rasm havolasi https:// bilan boshlanishi yoki / bilan boshlanadigan ichki yo'l bo'lishi kerak.");
  }
  const ok = store.setMenuItemImage(rid, iid, image);
  ctx.reply(ok ? (image ? "✅ Rasm qo'shildi." : "✅ Rasm olib tashlandi.") : 'Topilmadi.');
});

adminCommand('taom_ochirish', (ctx) => {
  const [ridStr, iidStr] = pipeArgs(ctx);
  const rid = Number(ridStr);
  const iid = Number(iidStr);
  if (!rid || !iid) return ctx.reply('Foydalanish: /taom_ochirish restoran_id | taom_id');
  const ok = store.deleteMenuItem(rid, iid);
  ctx.reply(ok ? "✅ Taom o'chirildi." : 'Topilmadi.');
});

adminCommand('restoran_ochirish', (ctx) => {
  const rid = Number(commandArgs(ctx));
  if (!rid) return ctx.reply('Foydalanish: /restoran_ochirish restoran_id');
  const ok = store.deleteRestaurant(rid);
  ctx.reply(ok ? "✅ Restoran o'chirildi." : 'Topilmadi.');
});

// ---------- Saytdan menyuni import qilish (admin tasdig'i bilan) ----------

// Admin tasdiqlashini kutayotgan importlar: token -> { adminId, restaurantId, name, url, items, createdAt }
const pendingImports = new Map();
const IMPORT_TTL_MS = 30 * 60 * 1000;
const PREVIEW_LIMIT = 40;

function cleanupPendingImports() {
  const now = Date.now();
  for (const [token, imp] of pendingImports) {
    if (now - imp.createdAt > IMPORT_TTL_MS) pendingImports.delete(token);
  }
}

adminCommand('menyu_import', async (ctx) => {
  const parts = pipeArgs(ctx);
  let restaurant = null;
  let url = parts[0];
  if (parts.length > 1) {
    restaurant = store.getRestaurant(Number(parts[0]));
    if (!restaurant) return ctx.reply(`ID ${parts[0]} bilan restoran topilmadi. /restoranlar orqali tekshiring.`);
    url = parts[1];
  }
  if (!url || !isValidUrl(url)) {
    return ctx.reply(
      "Foydalanish:\n" +
        "/menyu_import https://sayt.uz — yangi restoran sifatida\n" +
        "/menyu_import restoran_id | https://sayt.uz — mavjud restoranga\n\n" +
        "Havola restoranning menyu sahifasiga olib borishi kerak."
    );
  }

  await ctx.reply("⏳ Sayt o'qilmoqda, biroz kuting...");

  let result;
  try {
    result = await menuImport.scrapeMenu(url);
  } catch (err) {
    return ctx.reply(`❌ Saytni o'qib bo'lmadi: ${err.message}`);
  }

  if (!result.items.length) {
    return ctx.reply(
      "😕 Bu sahifadan taom va narxlarni topa olmadim.\n\n" +
        "Sabablari: menyu JavaScript orqali yuklanadigan sayt (Wolt, Yandex Eda, Express24 kabi ilovalar), " +
        "menyu rasm/PDF ko'rinishida, yoki havola bosh sahifaga olib boradi (menyu sahifasini bering).\n\n" +
        "Bunday holda taomlarni /taom_qoshish orqali qo'lda qo'shing."
    );
  }

  cleanupPendingImports();
  const token = crypto.randomBytes(6).toString('hex');
  const name = restaurant ? restaurant.name : result.title || new URL(result.url).hostname;
  pendingImports.set(token, {
    adminId: ctx.from.id,
    restaurantId: restaurant ? restaurant.id : null,
    name,
    url: result.url,
    items: result.items,
    createdAt: Date.now(),
  });

  const withImages = result.items.filter((i) => i.image).length;
  const lines = result.items
    .slice(0, PREVIEW_LIMIT)
    .map((i, idx) => `${idx + 1}. ${i.name} — ${formatSom(i.price)}${i.image ? ' 🖼' : ''}`);
  const more = result.items.length > PREVIEW_LIMIT ? `\n... va yana ${result.items.length - PREVIEW_LIMIT} ta` : '';
  const target = restaurant
    ? `"${restaurant.name}" (ID: ${restaurant.id}) menyusiga qo'shiladi. Nomi bir xil taomlarning narxi va rasmi yangilanadi.`
    : `Yangi restoran yaratiladi: "${name}"`;

  await sendLongText(
    ctx,
    `🔎 Topildi: ${result.items.length} ta taom (${withImages} tasida rasm bor)\n${target}\n\n${lines.join('\n')}${more}\n\n` +
      "Narxlarni tekshiring. Saqlash uchun ✅ Tasdiqlash tugmasini bosing (30 daqiqa amal qiladi).",
    Markup.inlineKeyboard([
      Markup.button.callback(`✅ Tasdiqlash (${result.items.length} ta)`, `imp:ok:${token}`),
      Markup.button.callback('❌ Bekor qilish', `imp:no:${token}`),
    ])
  );
});

bot.action(/^imp:(ok|no):([0-9a-f]+)$/, async (ctx) => {
  if (!isAdmin(ctx)) return ctx.answerCbQuery('⛔ Faqat adminlar uchun', { show_alert: true });
  const [, action, token] = ctx.match;
  const imp = pendingImports.get(token);
  if (!imp || Date.now() - imp.createdAt > IMPORT_TTL_MS) {
    pendingImports.delete(token);
    await ctx.answerCbQuery("Muddati o'tgan — /menyu_import ni qayta yuboring", { show_alert: true });
    return ctx.editMessageReplyMarkup(undefined).catch(() => {});
  }
  pendingImports.delete(token);
  ctx.editMessageReplyMarkup(undefined).catch(() => {});

  if (action === 'no') {
    await ctx.answerCbQuery('Bekor qilindi');
    return ctx.reply('❌ Import bekor qilindi, hech narsa saqlanmadi.');
  }

  await ctx.answerCbQuery('Saqlanmoqda...');
  await ctx.reply(`⏳ ${imp.items.length} ta taom saqlanmoqda, rasmlar yuklab olinmoqda...`);

  try {
    let restaurant = imp.restaurantId ? store.getRestaurant(imp.restaurantId) : null;
    if (imp.restaurantId && !restaurant) return ctx.reply("❌ Restoran o'chirib yuborilgan, import to'xtatildi.");
    if (!restaurant) restaurant = store.addRestaurant(imp.name, imp.url);
    else if (!restaurant.url) store.setRestaurantUrl(restaurant.id, imp.url);

    // Rasmlarni bir vaqtda 4 tadan yuklab olamiz
    const images = new Array(imp.items.length).fill(null);
    let cursor = 0;
    async function worker() {
      while (cursor < imp.items.length) {
        const idx = cursor++;
        const src = imp.items[idx].image;
        if (!src) continue;
        try {
          images[idx] = await menuImport.downloadImage(src, store.IMAGES_DIR, `r${restaurant.id}`);
        } catch {
          images[idx] = null;
        }
      }
    }
    await Promise.all([worker(), worker(), worker(), worker()]);

    let added = 0;
    let updated = 0;
    imp.items.forEach((item, idx) => {
      const existing = restaurant.items.find((i) => i.name.toLowerCase() === item.name.toLowerCase());
      const image = images[idx];
      if (existing) {
        store.updateMenuItem(restaurant.id, existing.id, image ? { price: item.price, image } : { price: item.price });
        updated++;
      } else {
        store.addMenuItem(restaurant.id, item.name, item.price, image);
        added++;
      }
    });

    const imageCount = images.filter(Boolean).length;
    ctx.reply(
      `✅ "${restaurant.name}" (ID: ${restaurant.id}) saqlandi.\n` +
        `➕ Yangi: ${added} ta\n🔄 Yangilangan: ${updated} ta\n🖼 Rasm yuklandi: ${imageCount} ta\n\n` +
        `Tekshirish: /menyu ${restaurant.id}\nNarxni tuzatish: /taom_narx ${restaurant.id} | taom_id | narx\n` +
        `Keraksizini o'chirish: /taom_ochirish ${restaurant.id} | taom_id`
    );
  } catch (err) {
    console.error('Import xatosi:', err);
    ctx.reply(`❌ Saqlashda xatolik: ${err.message}`);
  }
});

// ---------- Kunlik avtomatik eslatma ----------

// Server qayta ishga tushsa yoki taymer kechiksa ham eslatma o'tkazib yuborilmasligi uchun,
// belgilangan vaqtdan keyingi 30 daqiqa ichida (agar bugun hali yuborilmagan bo'lsa) yuboriladi.
const REMINDER_WINDOW_MIN = 30;

function sendDailyReminderIfDue() {
  const { reminderTime, reminderChatId, reminderLastSent } = store.getSettings();
  if (!reminderTime || !reminderChatId) return;
  if (!bot.botInfo) return; // bot hali to'liq ishga tushmagan

  const today = todayStr();
  if (reminderLastSent === today) return;
  const [h, m] = reminderTime.split(':').map(Number);
  const diff = nowMinutes() - (h * 60 + m);
  if (diff < 0 || diff > REMINDER_WINDOW_MIN) return;

  store.updateSettings({ reminderLastSent: today });
  bot.telegram
    .sendMessage(
      reminderChatId,
      'Bugungi obed! 🍽 Kerakli restoranni tanlab, buyurtma bering.',
      Markup.inlineKeyboard([Markup.button.url('🍽 Obedni ochish', miniAppLink(bot.botInfo.username))])
    )
    .catch((err) => console.error("Eslatma yuborilmadi:", err.message));
}

setInterval(sendDailyReminderIfDue, 30 * 1000);

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

adminCommand('tozalash', (ctx) => {
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
