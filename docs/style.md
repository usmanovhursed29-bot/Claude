# Паспорт стиля «Изнутри» (утверждён 2026-11-05)

## Кратко
- Техника: чистая цифровая линейная 2D-графика, стиль эксплейнера, без фактуры и зерна.
- Линия: тонкая, ровная; у персонажей чёрная, у фонов тёмно-синяя или в цвет сцены.
- Палитра: каждая сцена тонирована в одно цветовое семейство + много белого.
- Персонажи: цветные только главные герои; все остальные — чёрные силуэты без лица со светло-серыми внутренними линиями.
- Фоны: детальные, бледные, прямые архитектурные линии, мягкая центральная перспектива.
- Текст: только плашками в монтаже. Чёрная наклонная плашка + белый Oswald/Bebas Neue; коралловая плашка + белый Montserrat Bold.
- Композиция: 16:9, 1 главный объект или пара, средние и общие планы.
- Настроение: тихое, печальное, мягкий рассеянный свет.

## Теги тона (идут в промт ПЕРЕД блоком стиля)
- `[WARM]` → `scene tinted in warm butter-yellow, peach and soft orange` — дом, семья, ностальгия
- `[COLD]` → `scene tinted in icy cyan and pale blue with soft lavender shadows` — офисы, зима, тревога
- `[PINK]` → `scene tinted in dusty salmon pink with bright yellow accents` — деньги, соблазн
- `[NIGHT]` → `scene tinted in deep navy blue and muted violet, dim soft light` — ночь, мрак

## БЛОК СТИЛЯ (дословно, в конец каждого промта картинки)
```
clean modern 2D digital line-art illustration in a flat animated explainer style, thin uniform dark outlines, simple flat color fills with very soft cel shading and subtle glowing highlights, the whole scene tinted in one soft monochromatic color family with lots of white and pale tones, soft translucent colored shadows, any secondary people drawn as solid black faceless silhouettes with thin light-gray inner contour lines, detailed but airy background with straight clean architectural lines and gentle one-point perspective, calm quiet melancholic cinematic mood, no texture, no grain, no photorealism, no 3D, no text unless specified, 16:9 horizontal composition, centered subject, plenty of white negative space
```

## Структура промта картинки
[сцена: кто/что, действие, предметы, расположение] + [персонажи/объекты дословно из characters.md] + [тег тона] + [БЛОК СТИЛЯ]

## Шаблон Veo (image-to-video)
```
Animate this flat 2D hand-drawn cartoon, perfectly preserving the original art style, line work, colors and composition. Subtle limited motion only: <конкретное мелкое движение>. Camera locked, no zoom, no pan. No new objects, no style change, no morphing, no 3D, no realism, no added text or sound. Smooth looping 2D motion, ~5 seconds.
```
