// Полка «Настройки → Общие» и «Плагины → Заголовки и бренд».
// Бренд задаётся ТОЛЬКО здесь. Шаблон берёт его отсюда для всех страниц.
export const brand = {
  name: "Javob",
  tagline: "ИИ-агенты для бизнеса в Telegram",
  description:
    "Javob делает ИИ-агентов, которые отвечают вашим клиентам в Telegram круглосуточно: цены, запись, заказы. Настроим за вас за один день.",
  // Адрес сайта. Пока бесплатный адрес Cloudflare, после покупки домена меняем только эту строку.
  siteUrl: "https://javob.example.workers.dev",
  lang: "ru",
  accent: "#0f766e",
  // Контакт для заявок. TODO: вписать настоящий @username в Telegram.
  telegram: "",
  email: "",
  // Токен Cloudflare Web Analytics. Пусто = счётчик не вставляется.
  analyticsToken: "",
};
