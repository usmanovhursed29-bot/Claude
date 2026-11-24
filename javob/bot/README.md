# Бот Javob: один Telegram-бот на много бизнесов

Гость открывает ссылку `t.me/<бот>?start=<slug>`, и бот отвечает от имени этого бизнеса: меню, адреса, часы и телефон, бронь стола (уведомление владельцу), передача живому человеку. На свободные вопросы отвечает ИИ (Workers AI) строго по данным бизнеса; если ответа нет, говорит «не знаю».

Первый клиент: Чайхона «Мадина», Одинцово, `?start=madina`.

## Как добавить новый бизнес
1. Скопируй `src/tenants/madina.js` в `src/tenants/<slug>.js`, поменяй `slug`, название, адреса, меню.
2. Добавь его в `src/tenants/index.js`.
3. Владелец пишет боту `/myid`, номер вписываем в `ownerChatId`: туда приходят брони.
4. Выложи заново. Новый бот в @BotFather не нужен.

## Как поменять цены и меню
Правь `src/tenants/<slug>.js`. Когда цены настоящие, поставь `demoPrices: false`.

## Проверка локально
```bash
node --experimental-sqlite test/run.mjs
```

## Запуск (один раз)
1. Бот Javob в @BotFather. Токен владелец вставляет сам в секреты Worker (Cloudflare → Workers → javob-bot → Settings → Variables and Secrets → `BOT_TOKEN`), в чат не присылает.
2. Там же секрет `WEBHOOK_SECRET`: случайная строка.
3. База: `npx wrangler d1 create javob`, id в `wrangler.toml`, затем `npx wrangler d1 execute javob --remote --file schema.sql`.
4. `npx wrangler deploy`.
5. Открыть `https://<worker>/setup?key=<WEBHOOK_SECRET>`: Worker сам подключит вебхук, токен его не покидает.

## Россия
Гости общаются через Telegram, а Worker вызывают серверы Telegram. Ограничение загрузки сайтов на Cloudflare в России к этому пути, по нашей логике, не относится. ⚠️ Проверим на реальном запуске.
