# Obed Bot + Mini App (ko'p restoranli, sayt havolasi bilan)

Telegram guruhida kunlik obed buyurtmalarini yig'ish va umumiy summani avtomatik hisoblaydigan bot + Mini App. Bir nechta restoran/menyuni qo'llab-quvvatlaydi, har biriga haqiqiy vebsayt havolasini biriktirish mumkin — hammasi bot orqali, kodga tegmasdan boshqariladi.

## Qanday ishlaydi

1. Guruhda kimdir `/obed` deb yozadi — bot javoban **"🍽 Obedni ochish"** tugmasini yuboradi.
2. Mini App ochiladi, avval **restoranlar ro'yxati** chiqadi. Agar restoranga sayt havolasi biriktirilgan bo'lsa, uning ostida **"🔗 Saytdagi menyu"** tugmasi ham chiqadi — bosilganda restoranning haqiqiy vebsayti brauzerda ochiladi (odamlar u yerda rasmli/to'liq menyuni ko'rishlari mumkin).
3. Restoran nomiga bosilsa (havola tugmasiga emas), bizning ilovadagi menyu ochiladi — u yerdan taomlar miqdori bilan tanlanadi va **"Buyurtmani yuborish"** bosiladi.
4. **"Restoranlarga qaytish"** orqali orqaga qaytib, boshqa restorandan ham qo'shimcha buyurtma berish mumkin — bir kunda bir nechta restorandan buyurtma bersa bo'ladi.
5. Pastdagi **umumiy jadval** har 5 soniyada yangilanadi, har bir restoran uchun alohida a'zolar ro'yxati + subtotal, eng pastda esa **barcha restoranlar bo'yicha umumiy summa**ni ko'rsatadi.

## Fayllar tuzilishi

```
obed-mini-app/
├── server.js        # Express server + Telegram bot (Telegraf) + admin buyruqlari
├── store.js         # Restoranlar (nomi, sayt havolasi, menyu) va buyurtmalar
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

## 2-qadam: Railway'da ishga tushirish

1. Kodni GitHub repo'ga yuklang (`index.html`, `app.js`, `style.css` **`public/` papkasi ichida** bo'lishi shart).
2. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
3. Deploy tugagach: **Settings → Networking → Generate Domain**.
4. **Variables**: `BOT_TOKEN`, `WEBAPP_URL` (3-qadamdagi domen, oxirida `/` bo'lmasin), `ADMIN_IDS` (hozircha bo'sh qoldiring).

## 3-qadam: O'zingizni admin qilib belgilash

1. Botga shaxsiy yozishmada `/id` deb yozing — Telegram ID'ingizni qaytaradi.
2. Railway **Variables**'da `ADMIN_IDS` ga shu ID'ni yozing (bir nechta bo'lsa vergul bilan: `123456789,987654321`).

## Restoran, sayt havolasi va menyuni boshqarish (faqat adminlar)

| Buyruq | Vazifasi |
|---|---|
| `/restoran_qoshish Somsa Corner` | Yangi restoran qo'shadi (saytsiz) |
| `/restoran_qoshish Somsa Corner \| https://somsacorner.uz` | Yangi restoran, sayt havolasi bilan |
| `/restoran_sayt 1 \| https://sayt.uz` | Mavjud restoranga sayt havolasini qo'shadi/o'zgartiradi |
| `/restoran_sayt 1 \| -` | Restorandan sayt havolasini olib tashlaydi |
| `/restoranlar` | Barcha restoranlar, ID'lari va havolalarini ko'rsatadi (hammaga ochiq) |
| `/taom_qoshish 1 \| Osh \| 20000` | 1-ID'li restoranga taom qo'shadi |
| `/taom_ochirish 1 \| 3` | 1-ID'li restorandagi 3-ID'li taomni o'chiradi |
| `/restoran_ochirish 2` | 2-ID'li restoranni butunlay o'chiradi |
| `/yordam` | Barcha buyruqlar ro'yxatini ko'rsatadi |

**Misol:**
```
/restoran_qoshish Milliy Taomlar | https://milliytaomlar.uz
✅ "Milliy Taomlar" qo'shildi (ID: 2).
🔗 Sayt: https://milliytaomlar.uz

/taom_qoshish 2 | Norin | 25000
✅ "Norin" — 25 000 so'm qo'shildi.
```
Mini App'ni qayta ochganda "Milliy Taomlar" restorani ro'yxatda, ostida esa "🔗 Saytdagi menyu" tugmasi bilan paydo bo'ladi.

## Muhim eslatmalar

- **Nega sayt avtomatik o'qilmaydi**: restoranning haqiqiy vebsaytidagi taom nomi/narxini tizim o'zi o'qib ololmaydi (bunga o'sha saytning maxsus API'si kerak). Shuning uchun sayt faqat **ko'rish uchun havola** sifatida ishlaydi, buyurtma va summa hisobi esa `/taom_qoshish` orqali kiritilgan menyu asosida bizning ilovada davom etadi.
- **Ma'lumot saqlash**: hammasi `data/store.json` faylida. Railway'da doimiy saqlash uchun **Volume** qo'shing (Settings → Volumes → `/app/data`).
- **Xavfsizlik**: restoran/menyu o'zgartiruvchi buyruqlar faqat `ADMIN_IDS` ro'yxatidagilar uchun ishlaydi.
- **Lokal test**: Mini App faqat Telegram ichida to'liq ishlaydi (foydalanuvchi ismi Telegramdan keladi).

## Lokalda ishga tushirish (ixtiyoriy)

```bash
npm install
cp .env.example .env
# BOT_TOKEN, WEBAPP_URL, ADMIN_IDS ni to'ldiring
npm start
```
