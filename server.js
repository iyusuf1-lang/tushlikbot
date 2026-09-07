require('dotenv').config();
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { Telegraf, Markup } = require('telegraf');
const store = require('./store');

const BOT_TOKEN = process.env.BOT_TOKEN;
const WEBAPP_URL = process.env.WEBAPP_URL;
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error('Xatolik: .env faylda BOT_TOKEN ko\'rsatilmagan!');
  process.exit(1);
}
if (!WEBAPP_URL) {
  console.warn('Ogohlantirish: WEBAPP_URL o\'rnatilmagan. Bot tugmasi ishlamasligi mumkin.');
}

const bot = new Telegraf("8976669218:AAGbKlgtU3Eg4ynV_qGXs3t9R4XMjEocujY");
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

app.get('/api/menu', (req, res) => {
  res.json(store.getMenu());
});

app.get('/api/orders', (req, res) => {
  const date = req.query.date || todayStr();
  const rows = store.getOrders(date);

  const byUser = {};
  let grandTotal = 0;
  for (const row of rows) {
    if (!byUser[row.user_id]) {
      byUser[row.user_id] = { user_name: row.user_name, items: [], total: 0 };
    }
    const lineTotal = row.price * row.qty;
    byUser[row.user_id].items.push({ name: row.item_name, price: row.price, qty: row.qty, lineTotal });
    byUser[row.user_id].total += lineTotal;
    grandTotal += lineTotal;
  }

  res.json({ date, users: Object.values(byUser), grandTotal });
});

app.post('/api/order', (req, res) => {
  const { initData, items } = req.body || {};
  const user = validateInitData(initData);
  if (!user) return res.status(401).json({ error: "Tasdiqlanmadi — iltimos Telegram ichidan oching" });

  const date = todayStr();
  const userName = [user.first_name, user.last_name].filter(Boolean).join(' ') || `ID ${user.id}`;
  store.replaceUserOrder(date, user.id, userName, items || []);
  res.json({ ok: true });
});

app.delete('/api/order', (req, res) => {
  const { initData } = req.body || {};
  const user = validateInitData(initData);
  if (!user) return res.status(401).json({ error: 'Tasdiqlanmadi' });

  store.clearUserOrder(todayStr(), user.id);
  res.json({ ok: true });
});

// ---------- Bot ----------

bot.start((ctx) => {
  ctx.reply(
    "Assalomu alaykum! Bugungi obedni buyurtma qilish uchun tugmani bosing 👇",
    Markup.inlineKeyboard([Markup.button.webApp('🍽 Obedni ochish', WEBAPP_URL)])
  );
});

bot.command('obed', (ctx) => {
  ctx.reply(
    "Bugungi obed jadvali 👇 Har kim o'z buyurtmasini shu yerdan kiritsin.",
    Markup.inlineKeyboard([Markup.button.webApp('🍽 Obedni ochish', WEBAPP_URL)])
  );
});

bot.launch();
console.log('Bot ishga tushdi (polling rejimida)');

app.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishga tushdi`);
});

process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
