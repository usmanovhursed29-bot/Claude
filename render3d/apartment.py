"""Евродвушка 48 м² в Blender (Cycles): реалистичные материалы, свет, мебель.
Запуск:  python apartment.py --out DIR [--samples 128] [--res 1600x1000] [--views living,kitchen,bed] [--empty]
"""
import argparse, math, random, sys
import bpy, addon_utils
from mathutils import Vector

ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--samples", type=int, default=128)
ap.add_argument("--res", default="1600x1000")
ap.add_argument("--views", default="living,kitchen,bed")
ap.add_argument("--empty", action="store_true")
ap.add_argument("--blend", default="")
args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])

random.seed(7)
bpy.ops.wm.read_factory_settings(use_empty=True)
addon_utils.enable("cycles", default_set=True)
S = bpy.context.scene

# ---------------- материалы ----------------
def principled(name, color, rough=0.5, metal=0.0, **kw):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    for k, v in kw.items():
        b.inputs[k].default_value = v
    return m

def hexc(h):
    h = h.lstrip("#"); c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c)  # sRGB → linear

def add_bump(m, scale=40.0, strength=0.15, detail=6.0):
    nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    n = nt.nodes.new("ShaderNodeTexNoise"); n.inputs["Scale"].default_value = scale; n.inputs["Detail"].default_value = detail
    bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = strength
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m

def wood_mat(name, c1, c2, scale=(1, 12, 1), rough=0.45, planks=False):
    """Дерево: волокна (wave + noise), опционально доски (brick)."""
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree; b = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexCoord"); mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = scale; nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    wave = nt.nodes.new("ShaderNodeTexNoise"); wave.inputs["Scale"].default_value = 3.0; wave.inputs["Detail"].default_value = 10.0
    wave.inputs["Roughness"].default_value = 0.6; nt.links.new(mp.outputs["Vector"], wave.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (*c1, 1); ramp.color_ramp.elements[1].color = (*c2, 1)
    nt.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    color_out = ramp.outputs["Color"]
    if planks:
        br = nt.nodes.new("ShaderNodeTexBrick")
        br.inputs["Scale"].default_value = 1.0; br.inputs["Mortar Size"].default_value = 0.004
        br.inputs["Brick Width"].default_value = 1.2; br.inputs["Row Height"].default_value = 0.18
        br.offset = 0.37; br.squash = 1.0
        br.inputs["Color1"].default_value = (1, 1, 1, 1); br.inputs["Color2"].default_value = (0.86, 0.84, 0.82, 1); br.inputs["Bias"].default_value = 0.0
        br.inputs["Mortar"].default_value = (0.35, 0.3, 0.26, 1)
        tc2 = nt.nodes.new("ShaderNodeTexCoord"); nt.links.new(tc2.outputs["Object"], br.inputs["Vector"])
        mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        nt.links.new(color_out, mix.inputs[6]); nt.links.new(br.outputs["Color"], mix.inputs[7])
        color_out = mix.outputs[2]
        bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.12
        nt.links.new(br.outputs["Fac"], bump.inputs["Height"]); nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    nt.links.new(color_out, b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    return m

def fabric_mat(name, color, rough=0.9):
    m = principled(name, color, rough)
    b = m.node_tree.nodes["Principled BSDF"]
    try:
        b.inputs["Sheen Weight"].default_value = 0.6; b.inputs["Sheen Roughness"].default_value = 0.5
    except KeyError:
        pass
    return add_bump(m, scale=220, strength=0.12, detail=2)

def emission_mat(name, color, strength):
    m = bpy.data.materials.new(name); m.use_nodes = True; nt = m.node_tree
    nt.nodes.remove(nt.nodes["Principled BSDF"])
    e = nt.nodes.new("ShaderNodeEmission"); e.inputs["Color"].default_value = (*color, 1); e.inputs["Strength"].default_value = strength
    nt.links.new(e.outputs[0], nt.nodes["Material Output"].inputs["Surface"])
    return m

M = {
    "floor": wood_mat("Паркет", hexc("#a87b52"), hexc("#d0a780"), scale=(0.6, 30, 1), rough=0.38, planks=True),
    "wall": add_bump(principled("Стены", hexc("#efebe5"), 0.92), scale=60, strength=0.03),
    "ceiling": principled("Потолок", hexc("#f6f4f0"), 0.95),
    "skirting": principled("Плинтус", hexc("#f3f1ed"), 0.4),
    "frame": principled("Рамы", hexc("#f4f4f2"), 0.35),
    "glass": principled("Стекло", (1, 1, 1), 0.0, **{"Transmission Weight": 1.0, "IOR": 1.45}),
    "sofa": fabric_mat("Ткань дивана", hexc("#8f9c8e")),
    "beige": fabric_mat("Бежевая ткань", hexc("#d9ccb9")),
    "terracotta": fabric_mat("Терракота", hexc("#b95a3a")),
    "cream": fabric_mat("Кремовая ткань", hexc("#ece4d6")),
    "linen": fabric_mat("Лён", hexc("#f1ede6")),
    "throw": fabric_mat("Плед", hexc("#b89f7f")),
    "rug": add_bump(principled("Ковёр", hexc("#d8cbb6"), 1.0), scale=400, strength=0.25, detail=2),
    "rug2": add_bump(principled("Ковёр 2", hexc("#b6bdb4"), 1.0), scale=400, strength=0.25, detail=2),
    "oak": wood_mat("Дуб", hexc("#a67a51"), hexc("#cda47a"), scale=(0.8, 40, 1), rough=0.4),
    "walnut": wood_mat("Орех", hexc("#4a2f1f"), hexc("#73503a"), scale=(0.8, 40, 1), rough=0.35),
    "white_lac": principled("Белый фасад", hexc("#f2f1ee"), 0.25),
    "graphite": principled("Графит", hexc("#2d3034"), 0.3, 0.4),
    "stone": add_bump(principled("Кварц", hexc("#e4e0d9"), 0.12), scale=12, strength=0.02),
    "steel": principled("Сталь", hexc("#c6c9cc"), 0.22, 1.0),
    "brass": principled("Латунь", hexc("#c9a36a"), 0.28, 1.0),
    "black": principled("Чёрный металл", hexc("#1b1b1c"), 0.4, 0.6),
    "screen": principled("Экран", hexc("#0b0c0e"), 0.08, 0.2),
    "ceramic": principled("Керамика", hexc("#ece8e1"), 0.25),
    "pot": add_bump(principled("Горшок", hexc("#cdb79c"), 0.75), scale=30, strength=0.1),
    "soil": principled("Земля", hexc("#3a2a1f"), 1.0),
    "leaf": principled("Лист", hexc("#3f6b3f"), 0.45, **{"Subsurface Weight": 0.15}),
    "leaf2": principled("Лист светлый", hexc("#5d8a4f"), 0.45, **{"Subsurface Weight": 0.15}),
    "curtain": principled("Тюль", hexc("#f7f4ee"), 0.8, **{"Transmission Weight": 0.55}),
    "tile": None,
    "bulb": emission_mat("Лампа", hexc("#ffd9a8"), 18.0),
    "shade": principled("Абажур", hexc("#f3ece0"), 0.8, **{"Transmission Weight": 0.35}),
    "art_a": principled("Картина 1", hexc("#c86f4f"), 0.8), "art_b": principled("Картина 2", hexc("#3f6467"), 0.8),
    "art_bg": principled("Паспарту", hexc("#f4efe6"), 0.9),
}
# фартук-плитка: кирпичная текстура
t = bpy.data.materials.new("Плитка"); t.use_nodes = True; nt = t.node_tree; b = nt.nodes["Principled BSDF"]
br = nt.nodes.new("ShaderNodeTexBrick"); br.inputs["Scale"].default_value = 9; br.inputs["Mortar Size"].default_value = 0.012
br.inputs["Color1"].default_value = (*hexc("#e9efee"), 1); br.inputs["Color2"].default_value = (*hexc("#dfe8e7"), 1)
br.inputs["Mortar"].default_value = (*hexc("#cfcac2"), 1); br.inputs["Row Height"].default_value = 0.5; br.inputs["Brick Width"].default_value = 1.0
tc = nt.nodes.new("ShaderNodeTexCoord"); nt.links.new(tc.outputs["Object"], br.inputs["Vector"])
nt.links.new(br.outputs["Color"], b.inputs["Base Color"]); b.inputs["Roughness"].default_value = 0.15
M["tile"] = t

# ---------------- геометрия ----------------
COLL = {}
def coll(name):
    if name not in COLL:
        c = bpy.data.collections.new(name); S.collection.children.link(c); COLL[name] = c
    return COLL[name]

def finish(o, mat, c="Комната", bevel=0.0, segs=3, subsurf=0, smooth=True):
    for cc in o.users_collection: cc.objects.unlink(o)
    coll(c).objects.link(o)
    if mat: o.data.materials.append(mat)
    if bevel > 0:
        md = o.modifiers.new("Фаска", "BEVEL"); md.width = bevel; md.segments = segs; md.limit_method = "ANGLE"
    if subsurf:
        md = o.modifiers.new("Сглаживание", "SUBSURF"); md.levels = subsurf; md.render_levels = subsurf
    if smooth:
        for p in o.data.polygons: p.use_smooth = True
        if bevel > 0 or subsurf:
            o.modifiers.new("Нормали", "WEIGHTED_NORMAL")
    return o

def box(sx, sy, sz, x, y, z, mat, c="Мебель", bevel=0.006, segs=3, subsurf=0, rot=(0, 0, 0)):
    """Коробка: размеры по x(ширина), y(глубина), z(высота); (x, y, z) — центр низа."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=(x, y, z + sz / 2), rotation=rot)
    o = bpy.context.object; o.scale = (sx, sy, sz)
    bpy.ops.object.transform_apply(scale=True)
    return finish(o, mat, c, bevel=bevel, segs=segs, subsurf=subsurf, smooth=bevel > 0 or subsurf > 0)

def cyl(r, h, x, y, z, mat, c="Мебель", r2=None, verts=48, bevel=0.004, rot=(0, 0, 0)):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r, radius2=r if r2 is None else r2, depth=h, location=(x, y, z + h / 2), rotation=rot)
    return finish(bpy.context.object, mat, c, bevel=bevel, segs=2)

def sphere(r, x, y, z, mat, c="Мебель", scale=(1, 1, 1), rot=(0, 0, 0), seg=24):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, segments=seg, ring_count=seg // 2, location=(x, y, z), rotation=rot)
    o = bpy.context.object; o.scale = scale; bpy.ops.object.transform_apply(scale=True)
    return finish(o, mat, c)

def cushion(sx, sy, sz, x, y, z, mat, rot=(0, 0, 0)):
    """Подушка: куб с фаской + сглаживание = мягкая форма."""
    return box(sx, sy, sz, x, y, z, mat, bevel=min(sx, sy, sz) * 0.35, segs=3, subsurf=2, rot=rot)

# ---------------- квартира 8 × 6 м (x — ширина, y — глубина), потолок 2.7 ----------------
W, D, H, T = 8.0, 6.0, 2.7, 0.14
box(W + 2 * T, D + 2 * T, 0.05, W / 2, D / 2, -0.05, M["floor"], c="Комната", bevel=0)
box(W + 2 * T, D + 2 * T, 0.08, W / 2, D / 2, H, M["ceiling"], c="Комната", bevel=0)

def wall_x(y, x1, x2, holes=(), inner_side=+1):
    """Стена вдоль оси X на линии y."""
    cuts = sorted(holes); pos = x1
    for (a, b2, bot, top, win) in cuts:
        if a - pos > 0.001: box(a - pos, T, H, (pos + a) / 2, y, 0, M["wall"], c="Комната", bevel=0)
        if bot > 0: box(b2 - a, T, bot, (a + b2) / 2, y, 0, M["wall"], c="Комната", bevel=0)
        box(b2 - a, T, H - top, (a + b2) / 2, y, top, M["wall"], c="Комната", bevel=0)
        if win: window_x(a, b2, y, bot, top, inner_side)
        pos = b2
    if x2 - pos > 0.001: box(x2 - pos, T, H, (pos + x2) / 2, y, 0, M["wall"], c="Комната", bevel=0)

def wall_y(x, y1, y2, holes=(), inner_side=+1):
    cuts = sorted(holes); pos = y1
    for (a, b2, bot, top, win) in cuts:
        if a - pos > 0.001: box(T, a - pos, H, x, (pos + a) / 2, 0, M["wall"], c="Комната", bevel=0)
        if bot > 0: box(T, b2 - a, bot, x, (a + b2) / 2, 0, M["wall"], c="Комната", bevel=0)
        box(T, b2 - a, H - top, x, (a + b2) / 2, top, M["wall"], c="Комната", bevel=0)
        if win: window_y(a, b2, x, bot, top, inner_side)
        pos = b2
    if y2 - pos > 0.001: box(T, y2 - pos, H, x, (pos + y2) / 2, 0, M["wall"], c="Комната", bevel=0)

def window_x(a, b2, y, bot, top, s):
    w, h = b2 - a, top - bot
    box(w, 0.02, h, (a + b2) / 2, y, bot, M["glass"], c="Комната", bevel=0)
    for fx in (a + 0.03, (a + b2) / 2, b2 - 0.03): box(0.06, 0.08, h, fx, y, bot, M["frame"], c="Комната", bevel=0.004)
    for fz in (bot, top - 0.06): box(w, 0.08, 0.06, (a + b2) / 2, y, fz, M["frame"], c="Комната", bevel=0.004)
    box(w + 0.12, 0.3, 0.035, (a + b2) / 2, y + s * 0.12, bot - 0.035, M["stone"], c="Комната", bevel=0.004)  # подоконник
    portal(((a + b2) / 2, y - s * 0.05, (bot + top) / 2), (w, h), (math.radians(90), 0, 0) if s > 0 else (math.radians(-90), 0, 0))

def window_y(a, b2, x, bot, top, s):
    w, h = b2 - a, top - bot
    box(0.02, w, h, x, (a + b2) / 2, bot, M["glass"], c="Комната", bevel=0)
    for fy in (a + 0.03, (a + b2) / 2, b2 - 0.03): box(0.08, 0.06, h, x, fy, bot, M["frame"], c="Комната", bevel=0.004)
    for fz in (bot, top - 0.06): box(0.08, w, 0.06, x, (a + b2) / 2, fz, M["frame"], c="Комната", bevel=0.004)
    box(0.3, w + 0.12, 0.035, x + s * 0.12, (a + b2) / 2, bot - 0.035, M["stone"], c="Комната", bevel=0.004)
    portal((x - s * 0.05, (a + b2) / 2, (bot + top) / 2), (h, w), (0, math.radians(-90) if s > 0 else math.radians(90), 0))

def portal(loc, size, rot):
    bpy.ops.object.light_add(type="AREA", location=loc, rotation=rot)
    L = bpy.context.object; L.data.shape = "RECTANGLE"; L.data.size, L.data.size_y = size
    L.data.cycles.is_portal = True

wall_x(0, -T / 2, W + T / 2, [(0.7, 2.3, 0.85, 2.35, True)], inner_side=+1)                # задняя, окно спальни
wall_x(D, -T / 2, W + T / 2, [(5.6, 6.5, 0.0, 2.1, False)], inner_side=-1)                 # передняя, входная дверь
wall_y(0, 0, D)                                                                             # левая
wall_y(W, 0, D, [(2.9, 5.4, 0.55, 2.4, True)], inner_side=-1)                               # правая, большое окно гостиной
wall_y(3.2, 0, D, [(1.0, 1.9, 0.0, 2.1, False)])                                            # перегородка
# входная дверь
box(0.86, 0.05, 2.06, 6.05, D - 0.02, 0, M["walnut"], c="Комната", bevel=0.004)
for dz in (0.35, 1.25): box(0.6, 0.012, 0.75, 6.05, D - 0.05, dz, M["walnut"], c="Комната", bevel=0.01)
box(0.14, 0.04, 0.02, 5.75, D - 0.07, 1.0, M["steel"], c="Комната", bevel=0.005)
for (x, w2) in [(5.6 - 0.04, 0.08), (6.5 + 0.04, 0.08)]: box(w2, 0.03, 2.14, x, D - 0.08, 0, M["skirting"], c="Комната", bevel=0.003)
box(1.06, 0.03, 0.08, 6.05, D - 0.08, 2.1, M["skirting"], c="Комната", bevel=0.003)
# плинтусы
for (sx, sy, x, y) in [(W, 0.015, W / 2, 0.08), (0.015, D, 0.08, D / 2), (0.015, D, W - 0.08, D / 2), (W, 0.015, W / 2, D - 0.08),
                        (0.015, D, 3.2 - 0.08, D / 2), (0.015, D, 3.2 + 0.08, D / 2)]:
    box(sx, sy, 0.08, x, y, 0, M["skirting"], c="Комната", bevel=0.002)

# ---------------- мебель ----------------
F = "Мебель"
# === Гостиная ===
box(2.8, 2.0, 0.012, 5.25, 4.4, 0, M["rug"], bevel=0.003)
# диван: спинкой к окну (x ≈ 7.2), смотрит на ТВ (−x)
sx0, sy0 = 6.85, 4.35
box(0.95, 2.4, 0.2, sx0, sy0, 0.1, M["sofa"], bevel=0.03)                                  # основание
for dy in (-0.58, 0.58):
    cushion(0.72, 1.12, 0.2, sx0 - 0.08, sy0 + dy, 0.28, M["sofa"])                        # сиденья
    cushion(0.22, 1.12, 0.48, sx0 + 0.33, sy0 + dy, 0.33, M["sofa"], rot=(0, math.radians(-8), 0))  # спинки
for dy in (-1.28, 1.28):
    cushion(0.95, 0.2, 0.52, sx0, sy0 + dy, 0.1, M["sofa"])                                # подлокотники
for (dx, dy) in [(-0.4, -1.2), (0.4, -1.2), (-0.4, 1.2), (0.4, 1.2)]:
    cyl(0.022, 0.1, sx0 + dx, sy0 + dy, 0, M["walnut"], r2=0.016, verts=16)
cushion(0.16, 0.44, 0.42, sx0 + 0.16, sy0 - 0.75, 0.5, M["terracotta"], rot=(0, math.radians(-14), math.radians(8)))
cushion(0.16, 0.4, 0.4, sx0 + 0.16, sy0 + 0.72, 0.5, M["cream"], rot=(0, math.radians(-14), math.radians(-6)))
box(0.75, 0.55, 0.04, sx0 - 0.05, sy0 + 0.95, 0.48, M["throw"], bevel=0.015, subsurf=1)   # плед на подлокотнике
# журнальный столик
cyl(0.48, 0.035, 5.2, 4.4, 0.4, M["oak"], verts=96)
cyl(0.07, 0.4, 5.2, 4.4, 0.0, M["walnut"], r2=0.05)
cyl(0.26, 0.02, 5.2, 4.4, 0.0, M["walnut"], verts=64)
for i, (c, h) in enumerate([("art_b", 0.035), ("art_bg", 0.03), ("terracotta", 0.025)]):
    box(0.26 - i * 0.03, 0.19 - i * 0.02, h, 5.1, 4.25, 0.435 + sum(x[1] for x in [("", 0.035), ("", 0.03)][:i]), M[c], bevel=0.003, rot=(0, 0, 0.15 * i))
cyl(0.045, 0.1, 5.35, 4.6, 0.435, M["ceramic"], verts=32)                                   # кружка
cyl(0.07, 0.22, 5.0, 4.6, 0.435, M["ceramic"], r2=0.04, verts=40)                           # ваза
for k in range(5):
    sphere(0.03, 5.0 + random.uniform(-0.05, 0.05), 4.6 + random.uniform(-0.05, 0.05), 0.68 + random.uniform(0, 0.08), M["leaf2"], scale=(1, 0.4, 1.8),
           rot=(random.uniform(-0.5, 0.5), random.uniform(-0.5, 0.5), random.uniform(0, 3)))
# ТВ-тумба и ТВ на перегородке
box(0.42, 1.9, 0.42, 3.48, 4.4, 0.12, M["walnut"], bevel=0.008)
for dy in (-0.62, 0.0, 0.62): box(0.004, 0.6, 0.38, 3.69, 4.4 + dy, 0.14, M["oak"], bevel=0.001)
for dy in (-0.85, 0.85): cyl(0.02, 0.12, 3.48, 4.4 + dy, 0, M["black"], verts=12)
box(0.04, 1.3, 0.75, 3.29, 4.4, 1.15, M["screen"], bevel=0.006)
box(0.18, 0.12, 0.2, 3.48, 3.7, 0.54, M["ceramic"], bevel=0.02)                             # колонка/декор
# картины над ТВ
for (dy, art) in [(-0.95, "art_a"), (0.95, "art_b")]:
    box(0.03, 0.5, 0.65, 3.29, 4.4 + dy, 1.95, M["walnut"], bevel=0.003)
    box(0.008, 0.42, 0.57, 3.307, 4.4 + dy, 1.99, M["art_bg"], bevel=0)
    box(0.006, 0.28, 0.36, 3.313, 4.4 + dy, 2.09, M[art], bevel=0)
# кресло
arm_x, arm_y = 4.35, 3.15
cushion(0.75, 0.72, 0.22, arm_x, arm_y, 0.2, M["beige"], rot=(0, 0, -0.5))
cushion(0.72, 0.2, 0.5, arm_x + 0.13, arm_y - 0.3, 0.32, M["beige"], rot=(math.radians(10), 0, -0.5))
for (dx, dy) in [(-0.28, -0.24), (0.28, -0.24), (-0.28, 0.24), (0.28, 0.24)]:
    cyl(0.018, 0.2, arm_x + dx, arm_y + dy, 0, M["walnut"], r2=0.012, verts=12)
# торшер
cyl(0.15, 0.025, 7.4, 2.85, 0, M["black"], verts=48)
cyl(0.012, 1.45, 7.4, 2.85, 0.025, M["brass"], verts=12)
cyl(0.2, 0.32, 7.4, 2.85, 1.45, M["shade"], r2=0.15, verts=48)
sphere(0.05, 7.4, 2.85, 1.58, M["bulb"])
# растения
def plant(x, y, s=1.0, big=False):
    cyl(0.2 * s, 0.4 * s, x, y, 0, M["pot"], r2=0.16 * s)
    cyl(0.18 * s, 0.01, x, y, 0.37 * s, M["soil"])
    n = 22 if big else 12
    for i in range(n):
        a = random.uniform(0, 2 * math.pi); h = random.uniform(0.55, 1.5 if big else 0.95) * s
        r = random.uniform(0.05, 0.35 if big else 0.22) * s
        lx, ly = x + math.cos(a) * r, y + math.sin(a) * r
        bpy.ops.mesh.primitive_cylinder_add(vertices=6, radius=0.006 * s, depth=h, location=((x + lx) / 2, (y + ly) / 2, 0.38 * s + h / 2))
        st = bpy.context.object; st.rotation_euler = (0, math.atan2(r, h), a); finish(st, M["leaf"], F)
        sphere(0.11 * s, lx, ly, 0.38 * s + h, M["leaf" if i % 3 else "leaf2"], scale=(1.6, 0.9, 0.18),
               rot=(random.uniform(-0.6, 0.6), random.uniform(-0.4, 0.4), a))
plant(7.5, 5.5, 1.1, big=True)
plant(0.45, 5.55, 0.85)

# === Кухня (задняя стена, x 5.3..7.3) и столовая ===
kx0, kx1 = 5.3, 7.25
box(kx1 - kx0, 0.58, 0.1, (kx0 + kx1) / 2, 0.38, 0, M["graphite"], bevel=0.002)            # цоколь
n = 4; w = (kx1 - kx0) / n
for i in range(n):
    cx = kx0 + w * (i + 0.5)
    box(w - 0.006, 0.02, 0.74, cx, 0.68, 0.1, M["white_lac"], bevel=0.003)                 # фасады
    box(w - 0.006, 0.56, 0.74, cx, 0.39, 0.1, M["white_lac"], bevel=0.002)
    box(0.18, 0.02, 0.015, cx, 0.7, 0.76, M["brass"], bevel=0.004)                          # ручки
box(kx1 - kx0 + 0.04, 0.64, 0.035, (kx0 + kx1) / 2, 0.37, 0.84, M["stone"], bevel=0.004)  # столешница
box(kx1 - kx0, 0.01, 0.62, (kx0 + kx1) / 2, 0.075, 0.875, M["tile"], c="Комната", bevel=0)  # фартук
box(0.5, 0.42, 0.012, 5.85, 0.38, 0.868, M["steel"], bevel=0.02)                          # мойка
bpy.ops.mesh.primitive_torus_add(major_radius=0.12, minor_radius=0.012, location=(5.85, 0.2, 1.05), rotation=(math.radians(90), 0, 0))
tor = bpy.context.object; finish(tor, M["steel"], F)
cyl(0.018, 0.2, 5.85, 0.08, 0.875, M["steel"], verts=16)
box(0.58, 0.5, 0.008, 6.75, 0.38, 0.875, M["screen"], bevel=0.004)                        # варочная
for (dx, dy, r) in [(-0.14, -0.11, 0.08), (0.14, -0.11, 0.1), (-0.14, 0.12, 0.1), (0.14, 0.12, 0.08)]:
    cyl(r, 0.002, 6.75 + dx, 0.38 + dy, 0.883, M["graphite"], verts=48, bevel=0)
# верхние шкафы + полка
for i in range(n):
    cx = kx0 + w * (i + 0.5)
    if i == 2: continue
    box(w - 0.006, 0.34, 0.72, cx, 0.19, 1.55, M["white_lac"], bevel=0.003)
box(w, 0.26, 0.03, kx0 + w * 2.5, 0.15, 1.85, M["oak"], bevel=0.003)                       # открытая полка
for k in range(4):
    cyl(0.04, 0.13, kx0 + w * 2.1 + k * 0.1, 0.15, 1.88, M["glass" if k % 2 else "ceramic"], verts=24)
box(w, 0.4, 0.06, kx0 + w * 2.5, 0.22, 1.5, M["steel"], bevel=0.004)                       # вытяжка
# холодильник
box(0.64, 0.66, 2.02, 7.62, 0.4, 0, M["graphite"], bevel=0.01)
box(0.62, 0.005, 0.01, 7.62, 0.735, 1.25, M["black"], bevel=0)
box(0.02, 0.03, 0.55, 7.34, 0.75, 1.0, M["steel"], bevel=0.005)
# на столешнице
cyl(0.11, 0.025, 5.45, 0.25, 0.875, M["oak"], verts=40)                                    # доска
for k in range(3): cyl(0.05, 0.16 + 0.03 * k, 7.05 - k * 0.11, 0.22, 0.875, M["ceramic"], r2=0.04, verts=24)
# обеденный стол (овальный) и стулья
tx, ty = 4.7, 1.5
bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=0.5, depth=0.035, location=(tx, ty, 0.745)); top = bpy.context.object
top.scale = (1.4, 0.9, 1); bpy.ops.object.transform_apply(scale=True); finish(top, M["oak"], F, bevel=0.008, segs=3)
for (dx, dy) in [(-0.5, -0.25), (0.5, -0.25), (-0.5, 0.25), (0.5, 0.25)]:
    cyl(0.025, 0.73, tx + dx, ty + dy, 0, M["walnut"], r2=0.018, verts=16)
def chair(x, y, ang):
    ca, sa = math.cos(ang), math.sin(ang)
    def p(dx, dy): return (x + dx * ca - dy * sa, y + dx * sa + dy * ca)
    cushion(0.44, 0.44, 0.07, x, y, 0.44, M["beige"], rot=(0, 0, ang))
    bx, by = p(0, -0.2)
    box(0.44, 0.03, 0.36, bx, by, 0.55, M["oak"], bevel=0.008, rot=(0, 0, ang))
    for (dx, dy) in [(-0.18, -0.18), (0.18, -0.18), (-0.18, 0.18), (0.18, 0.18)]:
        lx, ly = p(dx, dy); cyl(0.016, 0.44, lx, ly, 0, M["walnut"], r2=0.012, verts=12)
for (cx, cy, a) in [(4.35, 0.95, 0), (5.05, 0.95, 0), (4.35, 2.05, math.pi), (5.05, 2.05, math.pi)]:
    chair(cx, cy, a)
# подвесные светильники
for x in (4.4, 5.0):
    cyl(0.004, 0.85, x, ty, H - 0.85, M["black"], verts=8)
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.15, location=(x, ty, H - 0.85)); sh = bpy.context.object
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.select_all(action="DESELECT"); bpy.ops.object.mode_set(mode="OBJECT")
    for v in sh.data.vertices: v.select = v.co.z < -0.001
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.delete(type="VERT"); bpy.ops.object.mode_set(mode="OBJECT")
    sh.modifiers.new("s", "SOLIDIFY").thickness = 0.006
    finish(sh, M["black"], F)
    sphere(0.045, x, ty, H - 0.88, M["bulb"])
# ваза с фруктами
cyl(0.16, 0.06, tx, ty, 0.78, M["ceramic"], r2=0.1, verts=48)
for k in range(5): sphere(0.04, tx + random.uniform(-0.07, 0.07), ty + random.uniform(-0.07, 0.07), 0.86, principled(f"Фрукт{k}", hexc(["#d65a3a", "#e3a43b", "#9db84a"][k % 3]), 0.4))

# === Спальня (x 0..3.2) ===
box(2.3, 2.6, 0.012, 1.3, 3.55, 0, M["rug2"], bevel=0.003)
bx, by = 1.1, 3.55                                                                          # кровать 1.6×2.0
box(2.05, 1.72, 0.28, bx, by, 0.06, M["walnut"], bevel=0.02)
for (dx, dy) in [(-0.9, -0.75), (0.9, -0.75), (-0.9, 0.75), (0.9, 0.75)]: cyl(0.025, 0.06, bx + dx, by + dy, 0, M["black"], verts=12)
cushion(2.0, 1.64, 0.22, bx + 0.02, by, 0.34, M["linen"])                                 # матрас
cushion(1.35, 1.72, 0.1, bx + 0.32, by, 0.52, M["linen"])                                 # одеяло
cushion(0.75, 1.76, 0.04, bx + 0.6, by, 0.6, M["throw"])                                  # покрывало в ногах
cushion(0.12, 1.85, 1.1, 0.12, by, 0.06, M["beige"])                                       # изголовье
for dy in (-0.4, 0.4):
    cushion(0.2, 0.66, 0.46, 0.4, by + dy, 0.5, M["cream"], rot=(0, math.radians(-22), 0))
cushion(0.14, 0.42, 0.32, 0.62, by, 0.6, M["terracotta"], rot=(0, math.radians(-30), 0))
for y in (2.45, 4.65):                                                                      # тумбы и лампы
    box(0.45, 0.42, 0.46, 0.3, y, 0.05, M["oak"], bevel=0.008)
    box(0.006, 0.36, 0.18, 0.525, y, 0.3, M["walnut"], bevel=0.001)
    for (dx, dy) in [(-0.17, -0.16), (0.17, -0.16), (-0.17, 0.16), (0.17, 0.16)]: cyl(0.015, 0.05, 0.3 + dx, y + dy, 0, M["black"], verts=10)
    sphere(0.085, 0.3, y, 0.6, M["ceramic"], scale=(1, 1, 1.1))
    cyl(0.14, 0.18, 0.3, y, 0.68, M["shade"], r2=0.1, verts=40)
    sphere(0.03, 0.3, y, 0.75, M["bulb"])
    box(0.16, 0.12, 0.025, 0.3, y + 0.05, 0.51, M["art_b"], bevel=0.002)                   # книга
# шкаф у задней стены
box(0.85, 0.6, 2.35, 2.72, 0.38, 0, M["white_lac"], bevel=0.004)
box(0.003, 0.002, 2.25, 2.72, 0.685, 0.05, M["oak"], bevel=0)
for dx in (-0.04, 0.04): box(0.015, 0.02, 0.4, 2.72 + dx, 0.695, 1.0, M["brass"], bevel=0.004)
# рабочий стол у окна и стул
box(1.25, 0.55, 0.035, 1.5, 0.42, 0.72, M["oak"], bevel=0.004)
for dx in (-0.57, 0.57): box(0.03, 0.5, 0.72, 1.5 + dx, 0.42, 0, M["black"], bevel=0.003)
box(0.34, 0.24, 0.02, 1.35, 0.42, 0.755, M["graphite"], bevel=0.004)                       # ноутбук
cyl(0.06, 0.2, 1.95, 0.35, 0.755, M["pot"], r2=0.05)
for k in range(6): sphere(0.045, 1.95 + random.uniform(-0.05, 0.05), 0.35 + random.uniform(-0.05, 0.05), 1.0 + random.uniform(0, 0.08), M["leaf2"], scale=(1.4, 0.5, 0.25), rot=(0, 0, random.uniform(0, 3)))
chair(1.5, 1.05, math.pi)

# шторы (тюль) у окон — волна
def curtain(x, y, w, h, along_x=True):
    bpy.ops.mesh.primitive_plane_add(size=1, location=(x, y, 0.02 + h / 2), rotation=(math.radians(90), 0, 0 if along_x else math.radians(90)))
    o = bpy.context.object; o.scale = (w, h, 1); bpy.ops.object.transform_apply(scale=True, rotation=False)
    bpy.ops.object.mode_set(mode="EDIT"); bpy.ops.mesh.subdivide(number_cuts=60); bpy.ops.object.mode_set(mode="OBJECT")
    md = o.modifiers.new("Складки", "WAVE"); md.use_normal = True; md.use_x = True; md.use_y = False
    md.height = 0.03; md.width = 0.1; md.narrowness = 1.2; md.speed = 0
    o.modifiers.new("Толщина", "SOLIDIFY").thickness = 0.002
    finish(o, M["curtain"], F)
curtain(7.8, 2.6, 0.55, 2.6, along_x=False); curtain(7.8, 5.7, 0.55, 2.6, along_x=False)
# карниз
cyl(0.012, 3.4, 7.82, 2.5, 2.62, M["black"], verts=12, rot=(math.radians(-90), 0, 0))

# ---------------- свет и мир ----------------
world = bpy.data.worlds.new("Небо"); S.world = world; world.use_nodes = True; wn = world.node_tree
sky = wn.nodes.new("ShaderNodeTexSky"); sky.sky_type = "NISHITA"
sky.sun_elevation = math.radians(28); sky.sun_rotation = math.radians(-25); sky.sun_intensity = 0.5
sky.air_density = 1.0; sky.dust_density = 1.5
bg = wn.nodes["Background"]; bg.inputs["Strength"].default_value = 0.35
wn.links.new(sky.outputs["Color"], bg.inputs["Color"])
bpy.ops.object.light_add(type="SUN", location=(12, -6, 8))
sun = bpy.context.object; sun.data.energy = 3.2; sun.data.angle = math.radians(2.5); sun.data.color = (1.0, 0.93, 0.84)
sun.rotation_euler = (math.radians(58), 0, math.radians(68))
# мягкий заполняющий свет (как отражённый от потолка)
for (x, y) in [(5.6, 3.0), (1.6, 3.0)]:
    bpy.ops.object.light_add(type="AREA", location=(x, y, H - 0.05)); a = bpy.context.object
    a.data.shape = "RECTANGLE"; a.data.size, a.data.size_y = 2.4, 2.4; a.data.energy = 120; a.data.color = (1.0, 0.96, 0.9)
# тёплый свет от торшера и подвесов
for (x, y, z, e) in [(7.4, 2.85, 1.55, 35), (4.4, 1.5, H - 0.95, 20), (5.0, 1.5, H - 0.95, 20), (0.3, 2.45, 0.72, 12), (0.3, 4.65, 0.72, 12)]:
    bpy.ops.object.light_add(type="POINT", location=(x, y, z)); p = bpy.context.object
    p.data.energy = e; p.data.shadow_soft_size = 0.06; p.data.color = (1.0, 0.82, 0.6)
    for cc in p.users_collection: cc.objects.unlink(p)
    coll(F).objects.link(p)

# ---------------- рендер ----------------
S.render.engine = "CYCLES"; S.cycles.device = "CPU"
S.cycles.samples = args.samples; S.cycles.use_adaptive_sampling = True; S.cycles.adaptive_threshold = 0.02
S.cycles.use_denoising = True
try: S.cycles.denoiser = "OPENIMAGEDENOISE"
except Exception: pass
S.cycles.max_bounces = 8; S.cycles.diffuse_bounces = 4; S.cycles.glossy_bounces = 3; S.cycles.transmission_bounces = 6
S.cycles.sample_clamp_indirect = 8.0; S.cycles.caustics_reflective = False; S.cycles.caustics_refractive = False
rx, ry = (int(v) for v in args.res.split("x")); S.render.resolution_x, S.render.resolution_y = rx, ry
S.render.image_settings.file_format = "JPEG"; S.render.image_settings.quality = 88
try:
    S.view_settings.view_transform = "AgX"; S.view_settings.look = "AgX - Medium High Contrast"
except Exception:
    S.view_settings.view_transform = "Filmic"
S.view_settings.exposure = 0.35

if args.empty:
    coll(F).hide_render = True

CAMS = {   # (позиция, точка взгляда, фокусное, мм)
    "living": ((3.55, 2.55, 1.4), (7.2, 4.9, 0.8), 18),
    "kitchen": ((3.6, 4.4, 1.55), (6.3, 0.4, 1.0), 22),
    "bed": ((2.95, 5.75, 1.6), (0.7, 2.6, 0.75), 20),
    "overview": ((3.5, 5.72, 2.5), (6.6, 1.4, 0.2), 15),
}
for name in args.views.split(","):
    pos, look, lens = CAMS[name]
    bpy.ops.object.camera_add(location=pos); cam = bpy.context.object
    d = Vector(look) - Vector(pos); cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens; cam.data.sensor_width = 36
    S.camera = cam
    S.render.filepath = f"{args.out}/{name}{'-empty' if args.empty else ''}.jpg"
    bpy.ops.render.render(write_still=True)
    print("RENDERED", S.render.filepath, flush=True)
if args.blend:
    bpy.ops.wm.save_as_mainfile(filepath=args.blend)
