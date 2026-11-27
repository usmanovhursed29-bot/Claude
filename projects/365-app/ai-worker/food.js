// Фото еды → ИИ оценивает блюда и КБЖУ → команда food_<base64url JSON {n,g,k,p,f,c}> для вкладки «Здоровье → Питание».
// Оценка по фото приблизительная: вес порции на глаз, поэтому в ответе всегда «≈».

export const FOOD_PROMPT =
  "Ты нутрициолог. На фото еда. Определи каждое блюдо или продукт и оцени порцию в граммах на глаз по размеру тарелки и приборов. " +
  "Для каждого посчитай калории и белки, жиры, углеводы в граммах по типичному составу. Названия по-русски, коротко (например «Плов», «Лепёшка», «Чай с сахаром»). " +
  "Если на фото не еда, верни {\"food\":false}. Иначе верни JSON {\"food\":true,\"items\":[{\"name\":\"…\",\"grams\":0,\"kcal\":0,\"p\":0,\"f\":0,\"c\":0}]}. " +
  "Только JSON, числа целые. Подпись пользователя, если есть, — подсказка, что это за блюдо и сколько его.";

const n = (x, max) => { const v = Math.round(Number(x)); return Number.isFinite(v) && v >= 0 && v <= max ? v : 0; };

export function parseFood(text) {
  let d;
  try { d = JSON.parse(String(text || "").replace(/^```(?:json)?|```$/g, "").trim()); } catch { return null; }
  if (!d || d.food === false || !Array.isArray(d.items)) return { food: false, items: [] };
  const items = d.items.slice(0, 8).map((i) => ({ n: String(i.name || "Блюдо").slice(0, 60), g: n(i.grams, 3000), k: n(i.kcal, 5000), p: n(i.p, 500), f: n(i.f, 500), c: n(i.c, 800) })).filter((i) => i.k > 0);
  return { food: items.length > 0, items };
}

export function foodCmd(it) {
  const bytes = new TextEncoder().encode(JSON.stringify(it));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return "food_" + btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function foodText(items) {
  const t = items.reduce((s, i) => ({ k: s.k + i.k, p: s.p + i.p, f: s.f + i.f, c: s.c + i.c }), { k: 0, p: 0, f: 0, c: 0 });
  const lines = items.map((i) => `• ${i.n}${i.g ? ` ~${i.g} г` : ""} — ${i.k} ккал (Б ${i.p} · Ж ${i.f} · У ${i.c})`);
  return `🍽 Записал в «Питание»:\n${lines.join("\n")}${items.length > 1 ? `\n\nИтого ≈ ${t.k} ккал · Б ${t.p} · Ж ${t.f} · У ${t.c}` : ""}\n\nОценка по фото примерная. Поправить можно в приложении: Здоровье → Питание.`;
}

// Байты фото → разбор. Возвращает {food, items} или null, если ИИ недоступен.
export async function analyzeFood(env, ask, bytesB64, mime, caption) {
  const out = await ask(env, FOOD_PROMPT, [{ role: "user", parts: [{ inlineData: { mimeType: mime || "image/jpeg", data: bytesB64 } }, { text: caption ? `Подпись: ${caption}` : "Что это за еда и сколько КБЖУ?" }] }], { json: true, maxTokens: 500 });
  return out === null ? null : parseFood(out);
}
