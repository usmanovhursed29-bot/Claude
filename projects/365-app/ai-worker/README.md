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
