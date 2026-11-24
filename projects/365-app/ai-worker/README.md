# Сервер советов Kwantoww

Принимает запрос из мини-приложения, проверяет, что он пришёл из вашего Telegram-бота,
считает лимит (по умолчанию 20 советов в день на человека) и спрашивает Google Gemini.

## Что понадобится
- Токен бота: @BotFather → /mybots → бот → API Token.
- Бесплатный ключ Gemini: https://aistudio.google.com → Get API key.
- Бесплатный аккаунт Cloudflare: https://dash.cloudflare.com.

## Запуск через сайт Cloudflare (без командной строки)
1. Workers & Pages → Create → Create Worker → имя `kwantoww-ai` → Deploy.
2. Edit code → заменить весь код содержимым `worker.js` → Deploy.
3. Storage & Databases → KV → Create namespace `kwantoww-limits`.
4. Воркер → Settings → Bindings → Add → KV namespace: имя переменной `LIMITS`, пространство `kwantoww-limits`.
5. Воркер → Settings → Variables and Secrets:
   - Secret `BOT_TOKEN` — токен бота;
   - Secret `GEMINI_KEY` — ключ Gemini;
   - Text `ALLOWED_ORIGIN` = `https://usmanovhursed29-bot.github.io`;
   - Text `GEMINI_MODEL` = `gemini-2.5-flash`;
   - Text `DAILY_LIMIT` = `20`.
6. Скопировать адрес воркера вида `https://kwantoww-ai.<имя>.workers.dev`.

## Подключение к приложению
Собрать приложение с адресом сервера:

    KWANTOWW_AI_URL=https://kwantoww-ai.<имя>.workers.dev python3 projects/365-app/pwa/build.py

и выложить `pwa/dist` в ветку `gh-pages`. Кнопки «Совет» и «Итог дня» появятся сами.

## Записи из чата и статистика для администратора (2026-11-24)

Человек пишет боту обычными словами: «14 000 шагов», «выпил 200 мл воды», «спал 7,5 часов», «потратил 500 на кафе», «план: купить хлеб».
Бот разбирает сообщение кодом (`parse.js`, без ИИ), а непонятные фразы с числами отдаёт Gemini. Записи ложатся в очередь в базе D1,
приложение при открытии забирает их (`/inbox`), записывает в тот день, когда человек их отправил, и подтверждает (`/inbox/ack`).

Команда `/admin` в боте (только для ID из `ADMIN_IDS`): всего пользователей, новые, ушедшие (заблокировали бота), активные за 1/7/30 дней,
открытия приложения, сообщения, какие записи делают. `/myid` показывает свой Telegram ID.

### Что сделать один раз
1. База: `npx wrangler d1 create kwantoww`, вписать `database_id` в `wrangler.toml`, затем `npx wrangler d1 execute kwantoww --remote --file schema.sql`.
2. В `wrangler.toml` вписать свой ID в `ADMIN_IDS` (узнать: написать боту `/myid` после выкладки).
3. Выложить воркер: `npx wrangler deploy`.
4. Пересобрать приложение (`python3 projects/365-app/pwa/build.py`) и выложить `pwa/dist` в ветку `gh-pages`.
5. Написать боту `/admin`: бот сам включит события «пользователь заблокировал бота».

### Проверка без сети
    node test-parse.mjs
    node --experimental-sqlite test-worker.mjs
