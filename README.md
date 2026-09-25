# Obed Bot + Mini App (ko'p restoranli, sayt havolasi bilan)

Telegram guruhida kunlik obed buyurtmalarini yig'ish va umumiy summani avtomatik hisoblaydigan bot + Mini App. Bir nechta restoran/menyuni qo'llab-quvvatlaydi, har biriga haqiqiy vebsayt havolasini biriktirish mumkin — hammasi bot orqali, kodga tegmasdan boshqariladi.

## Qanday ishlaydi

1. Guruhda kimdir `/obed` deb yozadi — bot javoban **"🍽 Obedni ochish"** tugmasini yuboradi.
2. Mini App ochiladi, avval **restoranlar ro'yxati** chiqadi. Agar restoranga sayt havolasi biriktirilgan bo'lsa, uning ostida **"🔗 Saytdagi menyu"** tugmasi ham chiqadi — bosilganda restoranning haqiqiy vebsayti brauzerda ochiladi (odamlar u yerda rasmli/to'liq menyuni ko'rishlari mumkin).
3. Restoran nomiga bosilsa (havola tugmasiga emas), bizning ilovadagi menyu ochiladi — u yerdan taomlar miqdori bilan tanlanadi va **"Buyurtmani yuborish"** bosiladi.
4. **"Restoranlarga qaytish"** orqali orqaga qaytib, boshqa restorandan ham qo'shimcha buyurtma berish mumkin — bir kunda bir nechta restorandan buyurtma bersa bo'ladi.
5. Menyu ostida **"Izoh (ixtiyoriy)"** maydoni bor — menyuda yo'q taom yoki boshqa istak yozib qo'yish mumkin (hatto taom tanlamasdan, faqat izoh bilan ham yuborsa bo'ladi).
6. Pastdagi **umumiy jadval** har 5 soniyada yangilanadi, har bir restoran uchun alohida a'zolar ro'yxati + izohlari + subtotal, eng pastda esa **barcha restoranlar bo'yicha umumiy summa**ni ko'rsatadi.

## Fayllar tuzilishi

```
obed-mini-app/
├── server.js        # Express server + Telegram bot (Telegraf) + admin buyruqlari
├── store.js         # Restoranlar (nomi, sayt havolasi, menyu) va buyurtmalar
├── menuImport.js    # Restoran saytidan taom nomi, narxi va rasmini o'qib olish
├── package.json
├── .env.example
├── data/             # store.json va import qilingan rasmlar (images/) shu yerda avtomatik yaratiladi
└── public/           # Mini App (frontend) + taom rasmlari
    ├── index.html
    └── app.js
```

## 1-qadam: Bot yaratish

1. Telegram'da [@BotFather](https://t.me/BotFather) ga yozing.
2. `/newbot` buyrug'ini yuboring, nom va username bering.
3. Sizga beriladigan **tokenni** saqlab qo'ying — bu `BOT_TOKEN`.

## 2-qadam: Railway'da ishga tushirish

1. Kodni GitHub repo'ga yuklang (`index.html`, `app.js` **`public/` papkasi ichida** bo'lishi shart). Node.js 20.18 yoki yangiroq kerak.
2. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo**.
3. Deploy tugagach: **Settings → Networking → Generate Domain**.
4. **Variables**: `BOT_TOKEN`, `WEBAPP_URL` (3-qadamdagi domen, oxirida `/` bo'lmasin), `ADMIN_IDS` (hozircha bo'sh qoldiring).

## 3-qadam: O'zingizni admin qilib belgilash

1. Botga shaxsiy yozishmada `/id` deb yozing — Telegram ID'ingizni qaytaradi.
2. Railway **Variables**'da `ADMIN_IDS` ga shu ID'ni yozing (bir nechta bo'lsa vergul bilan: `123456789,987654321`).

## Restoran, sayt havolasi va menyuni boshqarish (faqat adminlar)

| Buyruq | Vazifasi |
|---|---|
| `/chek` | Bugungi umumiy chekni (kim nima tanlagani, ID'lari, izohlari, summasi) chiroyli formatda (qalin ismlar bilan) yuboradi |
| `/chek_excel` | Bugungi chekni haqiqiy `.xlsx` (Excel) fayl qilib yuboradi |
| `/tozalash` | 60 kundan eski ma'lumotlarni qo'lda tozalaydi (bu avtomatik ham, har kuni o'zi ishlaydi) |
| `/karta 8600 1234 5678 9012` | To'lov uchun karta raqamini belgilaydi — Mini App'da hammaga ko'rinadi |
| `/karta off` | Karta raqamini olib tashlaydi |
| `/tolov_eslatma` | Bugun buyurtma bergan, hali to'lamagan har bir odamga shaxsiy xabar yuboradi: uning yakuniy summasi (taom + dastavka ulushi) va to'lov kartasi |
| `/hammasini_bekor` | Bugungi BARCHA buyurtma va izohlarni bekor qiladi |
| `/buyurtma_bekor user_id` | Bitta odamning bugungi buyurtmasini (barcha restoranlardan) bekor qiladi |
| `/dastavka summa` | Bugungi yetkazib berish narxini belgilaydi — bu summa taom buyurtma qilgan (faqat izoh qoldirmagan) odamlar orasida teng bo'linadi |
| `/dastavka` (argumentsiz) | Bugungi joriy yetkazib berish narxini ko'rsatadi |
| `/dastavka 0` | Yetkazib berish narxini olib tashlaydi |
| `/eslatma 10:00` | **GURUHNING O'ZIDA** yozilsa, har kuni shu vaqtda "Bugungi obed" xabari avtomatik yuboriladi |
| `/eslatma off` | Kunlik avtomatik eslatmani o'chiradi |
| `/tolandi user_id` | Odamni qo'lda "to'ladi" deb belgilaydi (masalan naqd to'lasa) |
| `/tolanmadi user_id` | Odamni "to'lamadi" deb qaytaradi |
| `/restoran_qoshish Somsa Corner` | Yangi restoran qo'shadi (saytsiz) |
| `/restoran_qoshish Somsa Corner \| https://somsacorner.uz` | Yangi restoran, sayt havolasi bilan |
| `/restoran_sayt 1 \| https://sayt.uz` | Mavjud restoranga sayt havolasini qo'shadi/o'zgartiradi |
| `/restoran_sayt 1 \| -` | Restorandan sayt havolasini olib tashlaydi |
| `/restoranlar` | Barcha restoranlar, ID'lari va havolalarini ko'rsatadi (hammaga ochiq) |
| `/menyu 1` | 1-ID'li restoran menyusini taom ID'lari bilan ko'rsatadi (hammaga ochiq) |
| `/menyu_import https://sayt.uz/menu` | Saytdan taomlar, narxlar va rasmlarni o'qib, **yangi restoran** sifatida qo'shadi (tasdiqlashdan keyin) |
| `/menyu_import 1 \| https://sayt.uz/menu` | Saytdagi taomlarni 1-ID'li restoranga qo'shadi, nomi bir xillarining narxi/rasmini yangilaydi |
| `/taom_qoshish 1 \| Osh \| 20000` | 1-ID'li restoranga taom qo'shadi |
| `/taom_narx 1 \| 3 \| 22000` | 1-ID'li restorandagi 3-ID'li taom narxini o'zgartiradi |
| `/taom_rasm 1 \| 3 \| https://sayt.uz/osh.jpg` | Taom rasmini qo'shadi/o'zgartiradi (`-` — olib tashlaydi) |
| `/taom_ochirish 1 \| 3` | 1-ID'li restorandagi 3-ID'li taomni o'chiradi |
| `/restoran_ochirish 2` | 2-ID'li restoranni butunlay o'chiradi |
| `/yordam` | Barcha buyruqlar ro'yxatini ko'rsatadi |

**Bir nechta taomni birdaniga qo'shish**: `/taom_qoshish` buyrug'ini bir nechta qatorga yozib, bitta xabar sifatida yuborsangiz ham bo'ladi — har bir qator alohida taom sifatida qo'shiladi:
```
/taom_qoshish 2 | Osh | 20000
/taom_qoshish 2 | Norin | 25000
/taom_qoshish 2 | Chuchvara | 18000
```

## Saytdan menyuni avtomatik import qilish

Admin botga restoranning menyu sahifasi havolasini beradi:
```
/menyu_import https://restoran.uz/menu
```
1. Bot saytni o'qiydi va topilgan taomlarni (nomi, narxi, 🖼 rasm bor-yo'qligi) ro'yxat qilib ko'rsatadi.
2. Ostida **✅ Tasdiqlash** va **❌ Bekor qilish** tugmalari chiqadi. **Admin tasdiqlamaguncha hech narsa saqlanmaydi.** Tasdiqlash 30 daqiqa amal qiladi va faqat adminlar bosa oladi.
3. Tasdiqlangach, taomlar saqlanadi, rasmlar esa bizning serverga yuklab olinadi (`data/images/`), shuning uchun sayt keyinchalik o'zgarsa ham rasmlar ko'rinib turadi.
4. Keyin `/menyu ID` bilan tekshirib, noto'g'ri narxni `/taom_narx`, keraksiz taomni `/taom_ochirish` bilan tuzatish mumkin.

Mavjud restoranni yangilash uchun: `/menyu_import 2 | https://restoran.uz/menu`. Nomi bir xil taomlarning narxi va rasmi yangilanadi, yangilari qo'shiladi.

**Cheklovlar**: bot oddiy HTML sahifalarni, schema.org belgilangan saytlarni va ko'pchilik Next.js saytlarini o'qiy oladi. Menyusi faqat JavaScript orqali yuklanadigan ilovalar (Wolt, Yandex Eda, Express24 va h.k.), menyusi rasm yoki PDF bo'lgan saytlar o'qilmaydi. Bunday holda bot buni aytadi va taomlarni `/taom_qoshish` bilan qo'lda kiritish kerak bo'ladi. Xavfsizlik uchun bot ichki tarmoq manzillariga (localhost, 192.168.x va h.k.) so'rov yubormaydi.

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

- **To'lov eslatmasini yuborish tartibi**: avval `/dastavka summa` (kerak bo'lsa) va `/karta ...` bilan kartani kiriting, so'ng `/tolov_eslatma` deb yozing — bot bugun buyurtma bergan har bir odamga uning aniq summasi va kartani shaxsiy xabar qilib yuboradi. **Diqqat**: bot faqat botning shaxsiy chatida hech bo'lmaganda bir marta `/start` bosgan odamlarga xabar yubora oladi — Telegram'ning o'z cheklovi shunday. Agar kimgadir yetib bormasa, o'sha odam avval botga `/start` deb yozishi kerak.

- **Avtomatik tozalash**: 60 kundan eski buyurtma/izoh/to'lov yozuvlari har kuni o'zi avtomatik o'chiriladi (fayl haddan tashqari katta bo'lib ketmasligi uchun). Buni istalgan payt `/tozalash` bilan qo'lda ham ishga tushirish mumkin. Diqqat: bu faqat matn yozuvlariga tegishli — to'lov chekining skrinshotlari bizning serverimizda umuman saqlanmaydi (ular faqat Telegram orqali adminlarga forward qilinadi), shuning uchun ular bilan bog'liq tozalashning hojati yo'q.
- **To'lov uchun karta**: `/karta` bilan kiritilgan karta raqami Mini App'da hammaga ko'rinadi, "Nusxalash" tugmasi bilan. Payme yoki Click'da summani oldindan to'ldirib qo'yadigan havola faqat rasmiy ro'yxatdan o'tgan merchant (biznes) hisobi bilangina mumkin — oddiy shaxsiy karta bilan bunday havola yaratib bo'lmaydi, shuning uchun foydalanuvchi ilovani o'zi ochib, karta va summani qo'lda kiritadi.

- **Buyurtma qo'shimcha (additive) tarzda ishlaydi**: foydalanuvchi Mini App'ni qayta ochib, yana taom tanlab yuborsa, bu **eskisiga qo'shiladi** (masalan 2 osh + yana 1 osh = 3 osh), eskisi o'chmaydi. Buyurtma faqat foydalanuvchi "Bu restorandagi buyurtmani bekor qilish" tugmasini bosgandagina to'liq o'chadi.

- **To'lov chekini tasdiqlash**: foydalanuvchi to'lov qilib, chekning skrinshotini botning **shaxsiy chatiga** (guruhga emas) yuborsa, u **⏳ tekshirilmoqda** holatiga o'tadi. Rasm barcha adminlarga **✅ Tasdiqlash / ❌ Rad etish** tugmalari bilan yuboriladi. Admin tasdiqlagandagina **✅ to'landi** bo'ladi, foydalanuvchiga esa natija haqida xabar boradi. Bugun buyurtma bermagan odamning rasmi qabul qilinmaydi.

- **user_id qayerdan olinadi**: `/buyurtma_bekor` uchun kerak bo'ladigan ID'larni `/chek` chiqishidan olishingiz mumkin — har bir ism yonida `(ID: ...)` ko'rinishida ko'rsatiladi.

- **Nega sayt avtomatik o'qilmaydi**: restoranning haqiqiy vebsaytidagi taom nomi/narxini tizim o'zi o'qib ololmaydi (bunga o'sha saytning maxsus API'si kerak). Shuning uchun sayt faqat **ko'rish uchun havola** sifatida ishlaydi, buyurtma va summa hisobi esa `/taom_qoshish` orqali kiritilgan menyu asosida bizning ilovada davom etadi.
- **Ma'lumot saqlash**: hammasi `data/store.json` faylida. Railway'da doimiy saqlash uchun **Volume** qo'shing (Settings → Volumes → `/app/data`).
- **Xavfsizlik**: restoran/menyu o'zgartiruvchi buyruqlar faqat `ADMIN_IDS` ro'yxatidagilar uchun ishlaydi. Taom narxi har doim serverda menyudan olinadi (Mini App faqat taom ID'si va sonini yuboradi), shuning uchun narxni soxtalashtirib bo'lmaydi. Umumiy jadval (ismlar va summalar) faqat Telegram orqali ochilgan Mini App'ga ko'rsatiladi. Telegram tasdiqlash ma'lumoti (`initData`) 24 soatdan keyin eskiradi.
- **Lokal test**: Mini App faqat Telegram ichida to'liq ishlaydi (foydalanuvchi ismi Telegramdan keladi).

## Lokalda ishga tushirish (ixtiyoriy)

```bash
npm install
cp .env.example .env
# BOT_TOKEN, WEBAPP_URL, ADMIN_IDS ni to'ldiring
npm start
```
