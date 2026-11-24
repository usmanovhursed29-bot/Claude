// Проверка разбора сообщений: node test-parse.mjs
import assert from "node:assert/strict";
import { parseEntries, entriesFromAI } from "./parse.js";
const cmds = (t) => parseEntries(t).map((e) => e.cmd);
const cases = [
  ["сегодня я сделал 14 000 шагов", ["steps_14000"]],
  ["Я выпил 200 мл воды", ["water_200"]],
  ["выпил 1,5 л воды", ["water_1500"]],
  ["2 стакана воды", ["water_500"]],
  ["спал 7,5 часов", ["sleep_7-5"]],
  ["поспал 6 ч 30 мин", ["sleep_6-5"]],
  ["вес 72,4", ["weight_72-4"]],
  ["потратил 500 на кафе", ["exp_500_cafe"]],
  ["купил продукты 1 250", ["exp_1250_food"]],
  ["такси 300 потратил", ["exp_300_transport"]],
  ["получил зарплату 50000", ["inc_50000"]],
  ["настроение 4", ["mood_4"]],
  ["обед 650 ккал", ["meal_650"]],
  ["выпил 500 мл воды, прошёл 8000 шагов", ["water_500", "steps_8000"]],
  ["выпил 300 мл кофе", []],
  ["как дела?", []],
  ["сколько мне пить воды?", []],
];
for (const [t, want] of cases) assert.deepEqual(cmds(t), want, t);
const plan = parseEntries("План:\n1. купить хлеб\n2. позвонить маме");
assert.equal(plan.length, 2);
assert.equal(plan[1].label, "Задача: позвонить маме");
assert.equal(Buffer.from(plan[1].cmd.slice(5).replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(), "позвонить маме");
assert.deepEqual(entriesFromAI([{ type: "water_ml", value: 99999 }, { type: "expense", value: 120, category: "zzz" }]).map((e) => e.cmd), ["exp_120"]);
console.log(`Разбор: ${cases.length + 2} проверок пройдено ✅`);
