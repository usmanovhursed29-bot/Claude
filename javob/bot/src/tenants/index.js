// Полка «Пользователи»: список бизнесов-клиентов Javob.
// Новый клиент = новый файл в этой папке + одна строка ниже.
import madina from "./madina.js";

export const tenants = [madina];
export const bySlug = Object.fromEntries(tenants.map((t) => [t.slug, t]));
