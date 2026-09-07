# Obed Bot + Mini App

Telegram guruhida kunlik obed buyurtmalarini yig'ish va umumiy summani avtomatik hisoblaydigan bot + Mini App (Web App).

## Qanday ishlaydi

1. Guruhda kimdir `/obed` deb yozadi — bot javoban **"🍽 Obedni ochish"** tugmasini yuboradi.
2. Har bir a'zo shu tugmani bosadi — o'zi uchun Mini App (haqiqiy HTML sahifa) ochiladi.
3. U yerda menyudan kerakli taomlarni miqdori bilan tanlaydi va **"Buyurtmani yuborish"**ni bosadi.
4. Pastdagi jadval har 5 soniyada avtomatik yangilanadi va **hamma a'zolarning buyurtmalari + umumiy summani** ko'rsatadi.
5. Sana har kuni Toshkent vaqti bo'yicha (UTC+5) yangilanadi — ertangi kun uchun jadval yana bo'shdan boshlanadi.

## Fayllar tuzilishi

```
obed-mini-app/
├── server.js        # Express server + Telegram bot (Telegraf)
├── store.js         # Menyu va buyurtmalarni JSON faylda saqlash
├── package.json
├── .env.example
├── data/             # store.json shu yerda avtomatik yaratiladi
└── public/           # Mini App (frontend)
    ├── index.html
    ├── style.css
    └── app.js
```

## 1-qadam: Bot yaratish

1. Telegram'da [@BotFather](https://t.me/BotFather) ga yozing.
2. `/newbot` buyrug'ini yuboring, nom va username bering.
3. Sizga beriladigan **tokenni** saqlab qo'ying — bu `BOT_TOKEN`.

## 2-qadam: Kodni GitHub'ga yuklash

```bash
git init
git add .
git commit -m "Obed bot + mini app"
git branch -M main
git remote add origin https://github.com/SIZNING_USERNAME/obed-mini-app.git
git push -u origin main
```

## 3-qadam: Railway'da ishga tushirish

1. [railway.app](https://railway.app) ga kiring → **New Project** → **Deploy from GitHub repo** → shu repo'ni tanlang.
2. Railway avtomatik `npm install` va `npm start` qiladi (Node.js loyihasini o'zi taniydi).
3. Deploy tugagach: **Settings → Networking → Generate Domain** tugmasini bosing. Sizga shunaqa manzil beriladi: `https://obed-mini-app-production.up.railway.app`.
4. **Variables** bo'limiga o'ting va qo'shing:
   - `BOT_TOKEN` — 1-qadamdagi token
   - `WEBAPP_URL` — 3-qadamda olingan domen (oxirida `/` bo'lmasin)
5. O'zgarish saqlangach Railway avtomatik qayta deploy qiladi. Loglarda `Bot ishga tushdi` va `Server ...portda ishga tushdi` yozuvlarini ko'rishingiz kerak.

## 4-qadam: Botni guruhga qo'shish

1. Botni kerakli Telegram guruhiga qo'shing (admin bo'lishi shart emas).
2. Guruhda `/obed` deb yozing — tugma chiqadi.
3. Ixtiyoriy: [@BotFather](https://t.me/BotFather) → **/mybots** → botingiz → **Bot Settings → Group Privacy → Turn off** qilib qo'ysangiz, bot guruh xabarlarini to'liqroq ko'radi (majburiy emas, chunki buyruqlar baribir yetib boradi).

## Muhim eslatmalar

- **Ma'lumot saqlash**: buyurtmalar `data/store.json` faylida saqlanadi. Railway diski har doim doimiy emas — agar loyihani qayta deploy qilsangiz, fayl tozalanishi mumkin. Doimiy saqlash kerak bo'lsa, Railway loyihangizga **Volume** qo'shing (Settings → Volumes) va uni `/app/data` ga ulang.
- **Menyuni o'zgartirish**: `store.js` faylidagi `DEFAULT_MENU` massivini tahrirlang (yangi taom/narx qo'shish yoki o'chirish), so'ng qayta deploy qiling. Loyiha allaqachon ishga tushgan bo'lsa, `data/store.json` faylidagi `"menu"` qismini to'g'ridan-to'g'ri tahrirlashingiz ham mumkin.
- **Lokal test**: Mini App faqat Telegram ichida ochilganda to'liq ishlaydi (chunki foydalanuvchi ma'lumoti — ism — Telegramdan keladi). Oddiy brauzerda ochsangiz, buyurtma yuborishda "Xatolik" chiqadi — bu normal holat.

## Lokalda ishga tushirish (ixtiyoriy)

```bash
npm install
cp .env.example .env
# .env faylni to'ldiring: BOT_TOKEN va WEBAPP_URL
npm start
```

Lokalda `WEBAPP_URL` uchun HTTPS manzil kerak bo'ladi (masalan [ngrok](https://ngrok.com) orqali tunnel oching), aks holda Telegram web_app tugmasi ishlamaydi.
