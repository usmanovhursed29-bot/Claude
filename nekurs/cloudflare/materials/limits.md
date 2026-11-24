# Лимиты и цены Cloudflare на 26.10.2026

Проверено по официальным страницам 26.10.2026. Перед настройкой сверь с источником: Cloudflare меняет лимиты.

| Что | Бесплатно | Платно | Источник |
| --- | --- | --- | --- |
| Домен .com (Registrar) | $10.46 в год, с 01.11.2026 $11.17 (регистрация, продление, перенос) | | Баннер в панели Domains → Registrations; https://developers.cloudflare.com/registrar/ |
| Зоны Registrar | больше 400; .kz, .ru, .uz нет | | https://www.cloudflare.com/tld-policies/ |
| Домен на Registrar | только с DNS Cloudflare; перенос добавляет 1 год (кроме .uk, .nz) | | https://developers.cloudflare.com/registrar/faq/ |
| Email Routing | входящие без лимита; 200 правил на домен; 200 адресов получателей на аккаунт; письмо до 25 МиБ | | https://developers.cloudflare.com/email-routing/limits/ |
| Email Sending (бета) | только на подтверждённые адреса аккаунта | Workers Paid: 3 000 писем в месяц, дальше $0.35 за 1 000 | https://developers.cloudflare.com/email-service/platform/pricing/ |
| Gmail «Отправлять как» для адресов вне Google | новые настройки ограничиваются до января 2027, в январе 2027 функция убрана | | https://support.google.com/mail/answer/17101213 |
| Workers | 100 000 запросов в сутки, 10 мс CPU на запрос; статика без лимита | от $5 в месяц: 10 млн запросов, 30 млн мс CPU | https://developers.cloudflare.com/workers/platform/pricing/ |
| Pages | 500 сборок в месяц, 1 сборка одновременно, 20 минут на сборку, 20 000 файлов, 25 МиБ на файл, 100 доменов на проект | | https://developers.cloudflare.com/pages/platform/limits/ |
| Workers Builds | 3 000 минут сборки в месяц | | https://developers.cloudflare.com/workers/ci-cd/builds/limits-and-pricing/ |
| D1 | 5 ГБ; 5 млн прочитанных и 100 000 записанных строк в сутки | | https://developers.cloudflare.com/workers/platform/pricing/ |
| KV | 1 ГБ; 100 000 чтений, 1 000 записей в сутки | | там же |
| R2 (Standard) | 10 ГБ-месяц; 1 млн операций класса A, 10 млн класса B в месяц; скачивание бесплатно | $0.015 за ГБ-месяц | https://developers.cloudflare.com/r2/pricing/ |
| Durable Objects (SQLite) | 100 000 запросов в сутки, 5 ГБ | | https://developers.cloudflare.com/workers/platform/pricing/ |
| Queues | 10 000 операций в сутки | | там же |
| Hyperdrive | 100 000 запросов к базе в сутки | | там же |
| Workers AI | 10 000 нейронов в сутки, сброс в 00:00 UTC | $0.011 за 1 000 нейронов | https://developers.cloudflare.com/workers-ai/platform/pricing/ |
| AI Gateway | аналитика, кэш, лимиты бесплатно | логи и Unified Billing платно | https://developers.cloudflare.com/ai-gateway/reference/pricing/ |
| Browser Run (бывший Browser Rendering) | 10 минут в сутки, 3 браузера одновременно | 10 часов в месяц, дальше $0.09 за час | https://developers.cloudflare.com/browser-rendering/pricing/ |
| Images | 5 000 уникальных преобразований в месяц, хранения нет | | https://developers.cloudflare.com/images/pricing/ |
| Quick Tunnel | без аккаунта; 200 одновременных запросов; без SSE; без гарантии | | https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/ |
| Zero Trust Free (Access, Gateway, Tunnel, клиент) | до 50 пользователей, журнал 24 часа | $7 за пользователя в месяц | https://www.cloudflare.com/plans/sase-zero-trust.md |
| Turnstile | без лимита проверок, 20 виджетов, 10 доменов на виджет | | https://developers.cloudflare.com/turnstile/plans/ |
| WAF custom rules | 5 правил | | https://developers.cloudflare.com/waf/custom-rules/ |
| Rate limiting | 1 правило, по IP, период 10 с | | https://developers.cloudflare.com/waf/rate-limiting-rules/ |
| Redirect Rules | 10 на домен; Bulk: 15 правил, 5 списков, 10 000 ссылок на аккаунт | | https://developers.cloudflare.com/rules/url-forwarding/ |
| Web Analytics | 10 сайтов на аккаунт (мягкий лимит), полные данные 7 дней, всего полгода | | https://developers.cloudflare.com/web-analytics/faq/ |
| Universal SSL | домен и поддомены первого уровня | | https://developers.cloudflare.com/ssl/edge-certificates/universal-ssl/ |
| 1.1.1.1 for Families | 1.1.1.2 и 1.0.0.2 (вредоносные), 1.1.1.3 и 1.0.0.3 (вредоносные и взрослые) | | https://developers.cloudflare.com/1.1.1.1/setup/ |

## Что учесть

- Россия: с 9 июня 2025 года провайдеры ограничивают загрузку сайтов на Cloudflare примерно 16 КБ (https://blog.cloudflare.com/russian-internet-users-are-unable-to-access-the-open-internet/). На работу WARP из России в 2026 году есть жалобы пользователей, официального подтверждения нет.
- WARP не меняет страну для сайтов: IP Cloudflare соответствует примерному местоположению пользователя (https://developers.cloudflare.com/warp-client/known-issues-and-faq/).
- Bot Fight Mode нельзя пропустить правилами WAF, он может мешать API и мобильным приложениям (https://developers.cloudflare.com/bots/get-started/bot-fight-mode/).
- MCP Cloudflare для агентов: `https://mcp.cloudflare.com/mcp` (https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/).
