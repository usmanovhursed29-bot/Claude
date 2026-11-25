# Бот знакомств на Cloudflare Workers (работает 24/7, бесплатно)

Адрес: https://dating-bot.usmanovhursed747.workers.dev
База анкет: Cloudflare D1 `dating-bot-db`.

## Подключение токена (один раз)

1. Зайди на https://dash.cloudflare.com → **Workers & Pages** → **dating-bot**.
2. **Settings** → **Variables and Secrets** → **+ Add**.
3. Type: **Secret**, Name: `BOT_TOKEN`, Value: токен от @BotFather → **Deploy**.
4. Там же можно добавить (Type: **Text**):
   - `ADMIN_ID` — твой ID из @userinfobot (сюда приходят жалобы);
   - `CHAT_LINK` — ссылка-приглашение в общий чат.
5. Открой в браузере https://dating-bot.usmanovhursed747.workers.dev/setup — должно появиться «✅ Готово!».
6. Открой бота в Telegram → /start.

## Обновление кода

```bash
npm install
npx wrangler deploy
```

Схема базы — `schema.sql` (`npx wrangler d1 execute dating-bot-db --remote --file=schema.sql`).
