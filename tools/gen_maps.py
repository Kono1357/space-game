# -*- coding: utf-8 -*-
"""地图生成器：预设原型 + 随机地图，生成结果必须过 tools/map_rules.py 的规则。

用法：
  python tools/gen_maps.py --check                        # 校验 content/space.json 的全部预设地图
  python tools/gen_maps.py --gen --type station --seed 7  # 打印一张随机地图（scene JSON，门未接线）
  python tools/gen_maps.py --selftest 40                  # 每种原型  多种子生成 + 全量校验
  python tools/gen_maps.py --types                        # 看有哪些原型
"""
import json, sys, os, random, argparse
sys.dont_write_bytecode = True    # 别在仓库里生成 __pycache__

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import map_rules as MR

KINDS = {
 'station': {'type': 'space_station', 'sizes': [(72, 24), (68, 24), (60, 22), (76, 26)], 'name': '站内舱段',
             'ambient': '金属地面，灯亮得很匀。'},
 'colony':  {'type': 'colony', 'sizes': [(72, 24), (76, 26), (68, 24)], 'name': '殖民地街区',
             'ambient': '风里带着土味，远处有孩子在跑。'},
 'surface': {'type': 'planet_surface', 'sizes': [(88, 28), (80, 26), (72, 24)], 'name': '地表区域',
             'ambient': '风一直吹，石头是热的。'},
 'ship':    {'type': 'ship_interior', 'sizes': [(52, 16), (56, 22)], 'name': '舰内舱段',
             'ambient': '舱壁在响，空气有点闷。'},
 'under':   {'type': 'rift_interior', 'sizes': [(48, 16), (56, 18), (52, 18)], 'name': '地下层',
             'ambient': '空气是旧的，灯只照到脚边。'},
 'rift':    {'type': 'rift_interior', 'sizes': [(72, 24), (64, 28), (56, 22)], 'name': '裂隙腔体',
             'ambient': '这里没有风，声音却传得很远。'},
}
SPACE = MR.load_space()
PASSABLE = MR.make_resolver(SPACE)


def blank(W, H):
    return [['#'] * W for _ in range(H)]


def carve(grid, x0, y0, x1, y1, ch='.'):
    H, W = len(grid), len(grid[0])
    for y in range(max(1, y0), min(H - 1, y1 + 1)):        # 边框留给门，别开天窗
        for x in range(max(1, x0), min(W - 1, x1 + 1)):
            grid[y][x] = ch


# ============================== 地形噪声 + 群系（第 3 期）==============================
# 以前地表是「先整片挖成地板、再随机撒几团石头」，裂隙是「0.63 均匀随机 + 三次元胞平滑」——
# 两种都**没有大尺度结构**：整张图哪儿都一样，也没有"山脊 / 河谷 / 林间空地"这种东西。
# 现在改用值噪声 + 分形叠加做出连贯场，再由**群系**决定「图案 + 密度 + 障碍物材质」。
def _h2(x, y, seed):
    """整数哈希 -> [0,1)。纯整数运算：不依赖 random 的状态，跨平台跨版本同结果。"""
    n = (x * 374761393 + y * 668265263 + seed * 1013904223) & 0xFFFFFFFF
    n = (n ^ (n >> 13)) & 0xFFFFFFFF
    n = (n * 1274126177) & 0xFFFFFFFF
    return ((n ^ (n >> 16)) & 0xFFFFFF) / 16777216.0


def _smooth(t):
    return t * t * (3.0 - 2.0 * t)


def value_noise(W, H, seed, freq):
    """格点随机 + 平滑插值。freq 越大结构越细。"""
    freq = max(2.0, float(freq))
    gw = int(W / freq) + 3
    gh = int(H / freq) + 3
    lat = [[_h2(gx, gy, seed) for gx in range(gw)] for gy in range(gh)]
    out = []
    for y in range(H):
        fy = y / freq; gy = int(fy); ty = _smooth(fy - gy)
        r0, r1 = lat[gy], lat[gy + 1]
        row = []
        for x in range(W):
            fx = x / freq; gx = int(fx); tx = _smooth(fx - gx)
            a = r0[gx] + (r0[gx + 1] - r0[gx]) * tx
            b = r1[gx] + (r1[gx + 1] - r1[gx]) * tx
            row.append(a + (b - a) * ty)
        out.append(row)
    return out


def fbm(W, H, seed, octaves=4, freq=18.0, gain=0.5):
    """分形叠加：低频决定「大区块在哪」，高频补细节。"""
    field = [[0.0] * W for _ in range(H)]
    amp, total, f = 1.0, 0.0, float(freq)
    for o in range(max(1, int(octaves))):
        layer = value_noise(W, H, seed + o * 7919, f)
        for y in range(H):
            row, lrow = field[y], layer[y]
            for x in range(W): row[x] += lrow[x] * amp
        total += amp; amp *= gain; f = max(2.0, f * 0.5)
    for y in range(H):
        row = field[y]
        for x in range(W): row[x] /= total
    return field


# 群系 = 地形**图案** + 结构尺度 + 目标开敞率 + 障碍物字符。
#   blobs    成团的山脊 / 树丛（大块连贯）
#   cracks   长条状的沟 / 裂（离中值最近的那些格子）
#   plateaus 量化成台地，边缘整齐（沙丘孤峰）
#   ruins    正交残墙 + 碎块（废墟）
#   open     目标开敞率 —— 密度由它定，但**一定要过 R7（>= 55%）**，所以都留了余量
BIOMES = {
 'ridge':   {'name': '岩脊',   'pattern': 'blobs',    'ratio': 0.26, 'octaves': 5, 'open': 0.82, 'solid': '^'},
 'dunes':   {'name': '沙丘',   'pattern': 'plateaus', 'ratio': 0.34, 'octaves': 4, 'open': 0.82, 'solid': '^'},
 'lava':    {'name': '熔岩沟', 'pattern': 'cracks',   'ratio': 0.20, 'octaves': 4, 'open': 0.84, 'solid': '~'},
 'fissure': {'name': '冰裂',   'pattern': 'cracks',   'ratio': 0.30, 'octaves': 5, 'open': 0.84, 'solid': '^'},
 'grove':   {'name': '林间',   'pattern': 'blobs',    'ratio': 0.14, 'octaves': 5, 'open': 0.80, 'solid': '%'},
 'marsh':   {'name': '沼面',   'pattern': 'blobs',    'ratio': 0.18, 'octaves': 4, 'open': 0.86, 'solid': '~'},
 'ruins':   {'name': '废墟',   'pattern': 'ruins',    'ratio': 0.22, 'octaves': 3, 'open': 0.82, 'solid': '^'},
 'cave':    {'name': '洞窟',   'pattern': 'blobs',    'ratio': 0.24, 'octaves': 5, 'open': 0.78, 'solid': '^'},
}
# 行星类型 -> 群系（planetTypes 那 18 种都要落在某个群系里；认不出来就走 DEFAULT_BIOME）
BIOME_OF = {
 'rock': 'ridge', 'barren': 'ridge', 'ferrous': 'ridge', 'crystal_world': 'ridge',
 'desert': 'dunes', 'dune': 'dunes',
 'volcanic': 'lava', 'magma_ocean': 'lava',
 'ice': 'fissure', 'tundra': 'fissure', 'aerial': 'fissure',
 'jungle': 'grove', 'fen': 'grove',
 'ocean': 'marsh', 'toxic': 'marsh', 'gas': 'marsh', 'anomalous': 'marsh',
 'shattered': 'ruins',
}
DEFAULT_BIOME = 'ridge'
UNDER_LAVA = ('volcanic', 'magma_ocean')


def biome_of(planet_type):
    return BIOME_OF.get(planet_type or '', DEFAULT_BIOME)


def under_biome(planet_type):
    """地下层的地貌跟着行星走：火山行星的地下是熔岩沟，别的走洞窟。"""
    return 'lava' if (planet_type in UNDER_LAVA) else 'cave'


def paint_terrain(grid, field, biome):
    """把一个噪声场画进网格（只动内部，边框留给门）。

    密度用**排名**解，不用阈值猜：要 1-open 比例的实心格，就取"最像实心"的那 1-open，
    所以开敞率是准的（封岛之前），R7 不会被群系参数顶穿。
    """
    H, W = len(grid), len(grid[0])
    ih, iw = H - 2, W - 2
    if ih <= 0 or iw <= 0: return
    inner = [[field[y + 1][x + 1] for x in range(iw)] for y in range(ih)]
    pat, solid = biome['pattern'], biome['solid']
    n = ih * iw
    k = max(0, min(n, int(n * (1.0 - biome['open']))))

    if pat == 'cracks':
        # 离中值最近的 k 格 = 长条状的沟壑（贴着一圈等值线走）
        order = sorted(range(n), key=lambda i: abs(inner[i // iw][i % iw] - 0.5))
    elif pat == 'plateaus':
        flat = [int(inner[i // iw][i % iw] * 5) for i in range(n)]
        order = sorted(range(n), key=lambda i: (-flat[i], inner[i // iw][i % iw]))
    else:
        order = sorted(range(n), key=lambda i: -inner[i // iw][i % iw])

    if pat == 'ruins':
        # 废墟：正交残墙**优先占坑**，剩下的名额再按场值补碎块。
        # 关键：墙上必须按节奏开口子 —— 完整的网格会把地图切成密封小间，
        # largest_region_only 只留下一间，开敞率会掉到 5%（实测过）。
        # 1 格宽的口子只要有一个，墙两侧就通了。
        lat = [i for i in range(n)
               if (((i % iw) % 9) < 1 or ((i // iw) % 11) < 1)
               and ((i % iw) * 3 + (i // iw) * 5) % 8 != 0
               and inner[i // iw][i % iw] > 0.26]
        lat.sort(key=lambda i: -inner[i // iw][i % iw])
        hit = set(lat[:k])
        for i in order:
            if len(hit) >= k: break
            hit.add(i)
    else:
        hit = set(order[:k])

    for i in hit:
        grid[i // iw + 1][i % iw + 1] = solid
    return biome


SOLID_CHARS = ('#', '^', '~', '%')
# 群系障碍物字符 -> 预设名（写进场景 legend，见 gen_scene）
BIOME_PRESET = {'^': 'rock', '~': 'liquid', '%': 'flora'}


def _cut_channel(grid, x, y, ch='.'):
    """从 (x,y) 往左右找最近的已可走格，把中间打通。

    为什么不直接 `grid[y][x] = '.'`：单点挖开会造出**孤立的**可走格，
    随后 largest_region_only 又把它封回实心（实测：大山块原封不动回来了）。
    打一条连得上的通道才是真的把它劈开，而且不会破坏 R3 单连通。"""
    H, W = len(grid), len(grid[0])
    for d in range(1, W):
        for nx in (x - d, x + d):
            if 1 <= nx < W - 1 and grid[y][nx] == ch:
                lo, hi = (nx, x) if nx < x else (x, nx)
                for xx in range(lo, hi + 1): grid[y][xx] = ch
                return True
    for d in range(1, H):
        for ny in (y - d, y + d):
            if 1 <= ny < H - 1 and grid[ny][x] == ch:
                lo, hi = (ny, y) if ny < y else (y, ny)
                for yy in range(lo, hi + 1): grid[yy][x] = ch
                return True
    return False


def break_big_masses(grid, limit=8, ch='.'):
    """把超过 limit x limit 的实心块打穿。

    R6（软规则）说野外地貌的实心正方块别超过 8。这条规则本来是防「屋子中间糊一整块墙」，
    而噪声地形天然会造出大山块 —— 实测 gw1 有 6 张图报 R6（9x9 / 11x11）。
    VISION 第 7 节明说**不为生成器放宽地图硬规则**，所以不让规则让步，让生成器守规矩。
    在 largest_region_only **之后**跑，每条缝都连到已有可走区，所以不会破 R3。
    """
    H, W = len(grid), len(grid[0])
    for _ in range(8):
        dp = [[0] * W for _ in range(H)]
        worst = 0
        for y in range(H - 1, -1, -1):
            gy = grid[y]; dy = dp[y]
            for x in range(W - 1, -1, -1):
                if gy[x] not in SOLID_CHARS: continue
                r = 1
                if x + 1 < W and y + 1 < H:
                    r = 1 + min(dp[y + 1][x], dy[x + 1], dp[y + 1][x + 1])
                dy[x] = r
                if r > worst: worst = r
        if worst <= limit: return True
        targets = [(x, y) for y in range(1, H - 1) for x in range(1, W - 1) if dp[y][x] > limit]
        if not targets:
            # 大块是**贴着边框**的：边框不能动（R1），而贴边的那种大块，
            # 内部格子的 dp 最多只到 limit（剩下那几行/列都在边框上）。
            # 退一档切 dp >= limit 的内部格，把它从边上拆下来。
            targets = [(x, y) for y in range(1, H - 1) for x in range(1, W - 1) if dp[y][x] >= limit]
        if not targets: return False
        for (x, y) in targets:
            _cut_channel(grid, x, y, ch)
    return False


def gen_surface(grid, rnd, kind, biome=None):
    """地表：噪声出连贯地形，群系决定形状与材质。"""
    b = BIOMES[biome] if isinstance(biome, str) else (biome or BIOMES[DEFAULT_BIOME])
    H, W = len(grid), len(grid[0])
    carve(grid, 1, 1, W - 2, H - 2)
    seed = rnd.randint(1, 1 << 30)
    field = fbm(W, H, seed, b['octaves'], max(5.0, min(W, H) * b['ratio']))
    paint_terrain(grid, field, b)
    largest_region_only(grid, (W // 2, H // 2))
    break_big_masses(grid, 8)          # 必须在封岛之后：通道要连到已有可走区
    return b


def gen_rift(grid, rnd, kind, biome=None):
    """地下 / 裂隙：同样是连贯场，但结构更粗（洞窟成群，不是均匀麻点）。"""
    b = BIOMES[biome] if isinstance(biome, str) else (biome or BIOMES['cave'])
    H, W = len(grid), len(grid[0])
    carve(grid, 1, 1, W - 2, H - 2)          # 先挖成可走，再让噪声把实心格盖回去
    seed = rnd.randint(1, 1 << 30)
    field = fbm(W, H, seed, b['octaves'], max(5.0, min(W, H) * b['ratio']))
    paint_terrain(grid, field, b)
    largest_region_only(grid, (W // 2, H // 2))
    break_big_masses(grid, 8)          # 必须在封岛之后：通道要连到已有可走区
    return b


def largest_region_only(grid, seed):
    """只保留从 seed 能走到的那一块可走区，其余可走格封成墙（保证 R3）。"""
    H, W = len(grid), len(grid[0])
    seen = [[False] * W for _ in range(H)]
    if not (0 <= seed[0] < W and 0 <= seed[1] < H) or grid[seed[1]][seed[0]] != '.':
        seed = None
        for y in range(H):
            for x in range(W):
                if grid[y][x] == '.': seed = (x, y); break
            if seed: break
        if seed is None: return 0
    stack = [seed]; seen[seed[1]][seed[0]] = True
    while stack:
        x, y = stack.pop()
        for nx, ny in ((x-1, y), (x+1, y), (x, y-1), (x, y+1)):
            if 0 <= nx < W and 0 <= ny < H and grid[ny][nx] == '.' and not seen[ny][nx]:
                seen[ny][nx] = True; stack.append((nx, ny))
    for y in range(H):
        for x in range(W):
            if grid[y][x] == '.' and not seen[y][x]: grid[y][x] = '#'
    return sum(1 for r in seen for v in r if v)


def bsp_rooms(grid, rnd, rooms, x0, y0, x1, y1, depth):
    if depth <= 0 or (x1 - x0) < 14 or (y1 - y0) < 9:
        rx0, ry0, rx1, ry1 = x0 + 1, y0 + 1, x1 - 1, y1 - 1
        if rx1 - rx0 >= 3 and ry1 - ry0 >= 3:
            carve(grid, rx0, ry0, rx1, ry1); rooms.append((rx0, ry0, rx1, ry1))
        return
    if (x1 - x0) >= (y1 - y0):
        cut = rnd.randint(x0 + 6, max(x0 + 6, x1 - 6)); bsp_rooms(grid, rnd, rooms, x0, y0, cut, y1, depth - 1); bsp_rooms(grid, rnd, rooms, cut, y0, x1, y1, depth - 1)
    else:
        cut = rnd.randint(y0 + 5, max(y0 + 5, y1 - 5)); bsp_rooms(grid, rnd, rooms, x0, y0, x1, cut, depth - 1); bsp_rooms(grid, rnd, rooms, x0, cut, x1, y1, depth - 1)


def corridor(grid, a, b, width=2):
    ax, ay = (a[0] + a[2]) // 2, (a[1] + a[3]) // 2
    bx, by = (b[0] + b[2]) // 2, (b[1] + b[3]) // 2
    for x in range(min(ax, bx), max(ax, bx) + 1):
        for d in range(width): carve(grid, x, ay + d, x, ay + d)
    for y in range(min(ay, by), max(ay, by) + 1):
        for d in range(width): carve(grid, bx + d, y, bx + d, y)


def pillars(grid, rnd, rooms):
    for (x0, y0, x1, y1) in rooms:
        if (x1 - x0) < 12 or (y1 - y0) < 12: continue      # 太小就放不下柱子，直接跳过
        if rnd.random() < 0.45: continue
        px = rnd.randint(x0 + 3, max(x0 + 3, x1 - 5))
        py = rnd.randint(y0 + 3, max(y0 + 3, y1 - 5))
        s = 1 if rnd.random() < 0.6 else 2
        if px + s < x1 - 1 and py + s < y1 - 1:
            for y in range(py, py + s):
                for x in range(px, px + s): grid[y][x] = '#'


def carve_doors(grid, rnd, n):
    H, W = len(grid), len(grid[0]); out = []; occupied = []
    sides = ['N', 'S', 'W', 'E']; rnd.shuffle(sides)
    for side in sides:
        if len(out) >= n: break
        for _ in range(30):
            if side in ('N', 'S'):
                x = rnd.randint(3, W - 5); y = 0 if side == 'N' else H - 1
                reach = None
                for d in range(1, 6):
                    yy = d if side == 'N' else H - 1 - d
                    if grid[yy][x] == '.': reach = yy; break
                if reach is None: continue
                carve(grid, x - 1, 1 if side == 'N' else reach, x + 1, reach if side == 'N' else H - 2)
                cells = [(x - 1, y), (x, y), (x + 1, y)]
            else:
                y = rnd.randint(3, H - 5); x = 0 if side == 'W' else W - 1
                reach = None
                for d in range(1, 6):
                    xx = d if side == 'W' else W - 1 - d
                    if grid[y][xx] == '.': reach = xx; break
                if reach is None: continue
                carve(grid, 1 if side == 'W' else reach, y - 1, reach if side == 'W' else W - 2, y + 1)
                cells = [(x, y - 1), (x, y), (x, y + 1)]
            if any(abs(cx - dx) <= 2 and abs(cy - dy) <= 2 for (cx, cy) in cells for (dx, dy) in occupied): continue
            for (cx, cy) in cells: grid[cy][cx] = '+'
            occupied.extend(cells)
            out.append((x, y))          # 一扇门只登记中间那一格（其余两格交给引擎的 doorMap）
            break
    return out


def gen_station(grid, rnd, kind):
    rooms = []; bsp_rooms(grid, rnd, rooms, 1, 1, len(grid[0]) - 2, len(grid) - 2, 4)
    rooms.sort(key=lambda r: (r[0], r[1]))
    for i in range(len(rooms) - 1): corridor(grid, rooms[i], rooms[i + 1])
    pillars(grid, rnd, rooms)


def gen_colony(grid, rnd, kind):
    rooms = []
    bsp_rooms(grid, rnd, rooms, 1, 1, len(grid[0]) - 2, len(grid) - 2, 4)
    rooms.sort(key=lambda r: (r[0], r[1]))
    for i in range(len(rooms) - 1): corridor(grid, rooms[i], rooms[i + 1])
    pillars(grid, rnd, rooms)
    for (x0, y0, x1, y1) in rooms:                 # 宿舍区：房间里再摆几组小方块
        if (x1 - x0) < 14 or (y1 - y0) < 12: continue
        for _ in range(2):
            px = rnd.randint(x0 + 3, max(x0 + 3, x1 - 6)); py = rnd.randint(y0 + 3, max(y0 + 3, y1 - 6))
            for y in range(py, min(y1 - 1, py + 2)):
                for x in range(px, min(x1 - 1, px + 2)): grid[y][x] = '#'


def gen_ship(grid, rnd, kind):
    H, W = len(grid), len(grid[0])
    mid = H // 2
    carve(grid, 1, mid - 1, W - 2, mid + 1)                     # 主龙骨走廊（3 格宽）
    for bx in range(6, W - 6, rnd.randint(12, 18)):
        top = rnd.randint(2, mid - 5); bot = rnd.randint(mid + 5, H - 3)
        carve(grid, bx, top, bx + 1, mid)                        # 上支路
        carve(grid, bx, mid, bx + 1, bot)                        # 下支路
        carve(grid, bx - 4, top - 1, bx + 6, top + 2)            # 上舱室
        carve(grid, bx - 4, bot - 2, bx + 6, bot + 1)            # 下舱室
    largest_region_only(grid, (W // 2, mid))


GEN = {'station': gen_station, 'colony': gen_colony, 'surface': gen_surface, 'ship': gen_ship, 'rift': gen_rift, 'under': gen_rift}


def gen_scene(kind, seed, sid=None, doors=None, biome=None, planet_type=None):
    """生成一张图。biome 只对 surface / rift / under 有意义（别的原型是室内结构，不谈地貌）。
    planet_type 会写进场景（跟手写内容一个口径），地貌名会缀在 ambient 后面 —— 走进去按 X 看得到。"""
    noisy = kind in ('surface', 'rift', 'under')
    b = None
    if noisy:
        if isinstance(biome, str): b = BIOMES.get(biome) or BIOMES[DEFAULT_BIOME]
        elif isinstance(biome, dict): b = biome
        elif kind == 'surface': b = BIOMES[biome_of(planet_type)]
        else: b = BIOMES[under_biome(planet_type)]
    for attempt in range(60):
        rnd = random.Random('%s|%s|%d' % (kind, seed, attempt))
        W, H = rnd.choice(KINDS[kind]['sizes'])
        grid = blank(W, H)
        if noisy: GEN[kind](grid, rnd, kind, b)
        else:     GEN[kind](grid, rnd, kind)
        n_doors = doors if doors else rnd.randint(2, 4)
        door_cells = carve_doors(grid, rnd, n_doors)
        if not door_cells: continue
        tiles = [''.join(r) for r in grid]
        ambient = KINDS[kind]['ambient'] + (('地貌：' + b['name'] + '。') if b else '')
        # 群系用的障碍物字符写进**场景自己的 legend**，不占全局 defaultLegend：
        # 全局表是深度合并进每个场景的，往里加一个别的场景已经用过的字符会把那个场景的意思改掉
        # （踩过：% 和 ~ 在中央大厅里是「通向 X」的通道，加进全局表后全变成墙）。
        legend = {}
        if b: legend[b['solid']] = {'preset': BIOME_PRESET[b['solid']]}
        scene = {'id': sid or ('gen_%s_%s' % (kind, seed)), 'name': KINDS[kind]['name'],
                 'type': KINDS[kind]['type'], 'size': {'w': W, 'h': H}, 'tiles': tiles,
                 'legend': legend, 'exits': [{'x': x, 'y': y, 'to': '', 'at': {'x': 0, 'y': 0}} for (x, y) in door_cells],
                 'ambient': ambient}
        if b and planet_type: scene['planetType'] = planet_type
        errs, _ = MR.check_scene(SPACE, scene, PASSABLE, None)
        if not errs: return scene
    raise RuntimeError('生成失败：%s seed=%s' % (kind, seed))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true')
    ap.add_argument('--selftest', type=int, default=0)
    ap.add_argument('--gen', action='store_true')
    ap.add_argument('--type', default='station')
    ap.add_argument('--seed', default='1')
    ap.add_argument('--types', action='store_true')
    ap.add_argument('--count', type=int, default=1)
    ap.add_argument('--wire', nargs='?', const='', default=None,
                    help='自动接线：--wire <file.json> 原地接线；--wire 配合 --gen-station 给生成结果接线')
    ap.add_argument('--gen-station', type=int, default=0, metavar='N', help='生成 N 张连在一起的站内图')
    ap.add_argument('--out', default='', help='写到文件（不给就打到 stdout）')
    ap.add_argument('--wire-selftest', type=int, default=0, metavar='N', help='自动接线自检（N 组）')
    ap.add_argument('--check-engine', default='', metavar='FILE', help='拿引擎真跑一遍：门能不能走 / 全图连通 / 落点可站')
    a = ap.parse_args()

    if a.wire_selftest:
        import tempfile, os as _os
        bad = 0
        for i in range(a.wire_selftest):
            seed = 'wire%d' % (900 + i)
            scenes = gen_station_set(3, seed)
            trs, warns = wire_scenes(scenes, [], SPACE, PASSABLE)
            # a) 每扇接好线的门都要有一条对应的 sceneTransition（两个方向都算）
            pairs = set((t2['from']['scene'], t2['to']['scene']) for t2 in trs)
            for s in scenes:
                for d in scene_doors(s):
                    if d.get('to') and (s['id'], d['to']) not in pairs:
                        bad += 1; print('FAIL %s: 门 %s (%d,%d) -> %s 没有 transition' % (seed, s['id'], d['x'], d['y'], d['to']))
            # b) 从第一张图能走到全部场景
            seen = reachable_scenes(scenes, scenes[0]['id'])
            if len(seen) != len(scenes):
                bad += 1; print('FAIL %s: 只连通 %d/%d 张图' % (seed, len(seen), len(scenes)))
            # c) 幂等：再跑一次，transition 数量不变、内容一致
            n1 = len(trs)
            trs2, _ = wire_scenes(scenes, list(trs), SPACE, PASSABLE)
            if len(trs2) != n1:
                bad += 1; print('FAIL %s: 第二次接线把 transition 从 %d 变成 %d' % (seed, n1, len(trs2)))
            # d) 所有门都接上了
            free = [d for s in scenes for d in scene_doors(s) if not d.get('to')]
            if free:
                bad += 1; print('FAIL %s: 还有 %d 扇门没接线' % (seed, len(free)))
        total = a.wire_selftest * 3
        print('接线自检：%d 组 / %d 张图，失败 %d' % (a.wire_selftest, total, bad))
        return 1 if bad else 0

    if a.check_engine:
        import subprocess, tempfile
        root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        js = (
          "var Core=require(process.argv[3]+'/engine/space-core.js'), fs=require('fs');\n"
          "var gen=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));\n"
          "var spec=JSON.parse(fs.readFileSync(process.argv[3]+'/content/space.json','utf8'));\n"
          "var root=gen.data?gen.data:gen;\n"
          "var built=Core.load({space:spec,mods:[{manifest:{id:gen.id||'gen'},data:root}]});\n"
          "var scenes=root.scenes.list, bad=[], ok=0;\n"
          "scenes.forEach(function(s){(s.exits||[]).forEach(function(e){\n"
          "  var g=Core.createGame(built,{}); g.teleport(s.id,e.x,e.y);\n"
          "  if(!g.takeExit()) bad.push(s.id+' ('+e.x+','+e.y+') 走不出去');\n"
          "  else if(g.world.player.scene!==e.to) bad.push(s.id+' 走错到 '+g.world.player.scene+' 期望 '+e.to);\n"
          "  else ok++;\n"
          "});});\n"
          "console.log((bad.length?'FAIL':'OK')+' 门: '+ok+' 扇能走'+(bad.length?(' / '+bad.slice(0,3).join(' | ')):''));\n"
          "var adj={};scenes.forEach(function(s){adj[s.id]={};});\n"
          "scenes.forEach(function(s){(s.exits||[]).forEach(function(e){if(e.to&&adj[s.id])adj[s.id][e.to]=1;});});\n"
          "var seen={},st=[scenes[0].id];seen[scenes[0].id]=1;\n"
          "while(st.length){var c=st.pop();Object.keys(adj[c]||{}).forEach(function(t){if(!seen[t]){seen[t]=1;st.push(t);}});}\n"
          "var nc=Object.keys(seen).length; console.log((nc===scenes.length?'OK':'FAIL')+' 连通: '+nc+'/'+scenes.length);\n"
          "var lb=[];scenes.forEach(function(s){(s.exits||[]).forEach(function(e){var g=built.idx.sceneGrids[e.to];\n"
          "  if(!g||!g.pass[e.at.y*g.w+e.at.x]) lb.push(s.id+'->'+e.to);});});\n"
          "console.log((lb.length?'FAIL':'OK')+' 落点: '+(lb.length?lb.slice(0,3).join(' | '):'全部可站'));\n"
          "process.exit((bad.length||nc!==scenes.length||lb.length)?1:0);\n")
        tmp = os.path.join(tempfile.gettempdir(), 'space_gen_check.js')
        open(tmp, 'w', encoding='utf-8', newline='').write(js)
        node = os.environ.get('SPACE_NODE') or 'node'
        r = subprocess.run([node, tmp, os.path.abspath(a.check_engine), root.replace('\\', '/')],
                           capture_output=True, text=True, encoding='utf-8', errors='replace')
        print((r.stdout or '') + (r.stderr or ''))
        return 0 if r.returncode == 0 else 1

    if a.gen_station:
        scenes = gen_station_set(a.gen_station, str(a.seed))
        trs, warns = ([], [])
        if a.wire is not None:
            trs, warns = wire_scenes(scenes, [], SPACE, PASSABLE)
            for w3 in warns: print('[警告] ' + w3)
            seen = reachable_scenes(scenes, scenes[0]['id'])
            print('生成 %d 张图，接线 %d 条，连通 %d/%d' % (len(scenes), len(trs), len(seen), len(scenes)))
        doc = {'_description': '生成器产出的随机星站（scenes + sceneTransitions）',
               'scenes': {'list': scenes}, 'sceneTransitions': {'list': trs}}
        txt = json.dumps(doc, ensure_ascii=False, indent=1)
        if a.out:
            open(a.out, 'w', encoding='utf-8', newline='').write(txt); print('已写出 ' + a.out)
        else:
            print(txt)
        return 0

    if a.wire is not None and a.wire:
        src = a.wire
        doc = json.loads(open(src, encoding='utf-8').read())
        # 两种形状都认：裸 spec {scenes:{list}} 或 mod {data:{scenes:{list}}}
        root = doc.get('data') if isinstance(doc.get('data'), dict) else doc
        scenes = (root.get('scenes') or {}).get('list') or []
        if not scenes:
            print('文件里没有 scenes.list（裸 spec 或 mod 的 data.scenes 都行），没什么可接的'); return 2
        trs = (root.get('sceneTransitions') or {}).get('list') or []
        before = len(trs)
        trs, warns = wire_scenes(scenes, trs, SPACE, PASSABLE)
        for w3 in warns: print('[警告] ' + w3)
        root.setdefault('sceneTransitions', {})['list'] = trs
        seen = reachable_scenes(scenes, scenes[0]['id'])
        open(src, 'w', encoding='utf-8', newline='').write(json.dumps(doc, ensure_ascii=False, indent=1))
        print('接线完成：%s  过场 %d -> %d，连通 %d/%d' % (src, before, len(trs), len(seen), len(scenes)))
        return 0
    if a.types:
        for k, v in KINDS.items(): print('%-8s %-14s 尺寸 %s' % (k, v['name'], v['sizes']))
        return 0
    if a.check:
        res = MR.check_all(SPACE)
        print('预设地图：%d 个场景，错误 %d，警告 %d' % (len(SPACE['scenes']['list']), len(res['errors']), len(res['warnings'])))
        return 1 if res['errors'] else 0
    if a.selftest:
        bad = 0
        for i in range(a.selftest):
            for kind in KINDS:
                seed = '%d' % (1000 + i * 7 + list(KINDS).index(kind))
                try:
                    sc = gen_scene(kind, seed)
                    errs, _ = MR.check_scene(SPACE, sc, PASSABLE, None)
                    if errs: bad += 1; print('FAIL %s seed=%s %s' % (kind, seed, errs[:2]))
                except Exception as e:
                    bad += 1; print('ERR  %s seed=%s %s' % (kind, seed, e))
        total = a.selftest * len(KINDS)
        print('生成自检：%d 张图，失败 %d' % (total, bad))
        return 1 if bad else 0
    if a.gen:
        if a.type not in KINDS: print('未知原型：' + a.type); return 2
        for i in range(a.count):
            sc = gen_scene(a.type, '%s-%d' % (a.seed, i))
            print(json.dumps(sc, ensure_ascii=False, indent=1))
        return 0
    ap.print_help(); return 0

# ============================== 自动接线 --wire ==============================
# 门的两类来源跟引擎一致：scene.exits 数组 + legend 里的 exit/to。
# 配对优先级：方向相对（N<->S / W<->E）> 门口坐标对齐（同一轴差得越少越好）。
OPP = {'N': 'S', 'S': 'N', 'W': 'E', 'E': 'W'}
INWARD = {'N': (0, 1), 'S': (0, -1), 'W': (1, 0), 'E': (-1, 0), 'IN': (0, 0)}


def side_of(scene, door):
    W, H = scene['size']['w'], scene['size']['h']
    if door['y'] == 0: return 'N'
    if door['y'] == H - 1: return 'S'
    if door['x'] == 0: return 'W'
    if door['x'] == W - 1: return 'E'
    return 'IN'


def scene_doors(scene):
    """列出一张图里所有的门（每个门一个 dict）。"""
    out = []
    for e in (scene.get('exits') or []):
        if isinstance(e, dict) and e.get('x') is not None:
            out.append({'x': int(e.get('x') or 0), 'y': int(e.get('y') or 0),
                        'to': e.get('to') or '', 'at': e.get('at'), '_ref': e})
    for ch, lg in (scene.get('legend') or {}).items():
        if not isinstance(lg, dict): continue
        if isinstance(lg.get('exit'), dict): ex = lg['exit']
        elif lg.get('exit') or lg.get('to'): ex = {'to': lg.get('to'), 'at': lg.get('at')}
        else: continue
        for y, row in enumerate(scene.get('tiles') or []):
            for x, c in enumerate(row):
                if c == ch:
                    out.append({'x': x, 'y': y, 'to': ex.get('to') or '', 'at': ex.get('at'), 'legend': ch})
    return out


def inward_cell(scene, door, resolver):
    """门内侧最近的一块可走格（作为对面走过来的落点）。"""
    W, H = scene['size']['w'], scene['size']['h']
    dx, dy = INWARD[side_of(scene, door)]
    for k in range(1, 7):
        x, y = door['x'] + dx * k, door['y'] + dy * k
        if 0 <= x < W and 0 <= y < H and resolver(scene, scene['tiles'][y][x]): return {'x': x, 'y': y}
    return {'x': door['x'], 'y': door['y']}


def _door_score(a, sa, b, sb):
    A, B = side_of(sa, a), side_of(sb, b)
    sc = 0
    if OPP.get(A) == B: sc += 100
    elif A == 'IN' or B == 'IN': sc += 10
    if A in ('N', 'S') and B in ('N', 'S'): sc += max(0, 40 - abs(a['x'] - b['x']))
    if A in ('W', 'E') and B in ('W', 'E'): sc += max(0, 40 - abs(a['y'] - b['y']))
    return sc


def wire_scenes(scenes, transitions=None, space=None, resolver=None):
    """给一批场景接线。返回 (transitions, warnings)。
    幂等：已经接好线的门跳过，不覆盖、不重复生成。"""
    space = space or SPACE
    resolver = resolver or PASSABLE
    transitions = list(transitions or [])
    warns = []
    by_id = {s['id']: s for s in scenes}
    doors = {s['id']: scene_doors(s) for s in scenes}
    have_pair = set()
    for tr in transitions:
        f = (tr.get('from') or {}).get('scene'); tt = (tr.get('to') or {}).get('scene')
        if f and tt: have_pair.add(f + '>' + tt)
    used = set()
    def key(sid, d): return (sid, d['x'], d['y'])
    # 没有「没接线的门」就直接返回：对已经接好线的内容（包括 content/space.json）是空操作
    if not [1 for sid in doors for d in doors[sid] if not d.get('to')]:
        return transitions, warns
    def pair(sA, a, sB, b):
        a['to'] = sB; a['at'] = inward_cell(by_id[sB], b, resolver)
        b['to'] = sA; b['at'] = inward_cell(by_id[sA], a, resolver)
        for (f, t2, fd, td) in ((sA, sB, a, b), (sB, sA, b, a)):
            transitions.append({'id': 'wire_%s_%d_%d__%s_%d_%d' % (f, fd['x'], fd['y'], t2, td['x'], td['y']),
                                'from': {'scene': f, 'x': fd['x'], 'y': fd['y']},
                                'to': {'scene': t2, 'x': td['x'], 'y': td['y']}, 'costTicks': 0})
            have_pair.add(f + '>' + t2)
        used.add(key(sA, a)); used.add(key(sB, b))

    # 4a) 先保证连通：按场景顺序把还没连通的相邻两张接起来（已经连着的跳过，不重复接）
    order = [s['id'] for s in scenes]
    parent = {s['id']: s['id'] for s in scenes}
    def find(x):
        while parent[x] != x: parent[x] = parent[parent[x]]; x = parent[x]
        return x
    def union(a2, b2):
        ra, rb = find(a2), find(b2)
        if ra != rb: parent[ra] = rb
    for sid in list(parent):
        for d in doors[sid]:
            if d.get('to') and d['to'] in parent: union(sid, d['to'])
    for i in range(len(order) - 1):
        sA, sB = order[i], order[i + 1]
        if find(sA) == find(sB): continue          # 已经能走到，别重复接线
        best = None
        for a in doors[sA]:
            if a.get('to') or key(sA, a) in used: continue
            for b in doors[sB]:
                if b.get('to') or key(sB, b) in used: continue
                sc = _door_score(a, by_id[sA], b, by_id[sB])
                if best is None or sc > best[0]: best = (sc, a, b)
        if best:
            pair(sA, best[1], sB, best[2]); union(sA, sB)

    # 4b) 再把剩下的门两两配掉（不要求方向，纯装饰；已有的不覆盖）
    free = [(sid, d) for sid in doors for d in doors[sid] if not d.get('to') and key(sid, d) not in used]
    cand = []
    for i in range(len(free)):
        for j in range(i + 1, len(free)):
            (sA, a), (sB, b) = free[i], free[j]
            if sA == sB: continue
            cand.append((_door_score(a, by_id[sA], b, by_id[sB]), sA, a, sB, b))
    cand.sort(key=lambda c: -c[0])
    for (sc, sA, a, sB, b) in cand:
        if key(sA, a) in used or key(sB, b) in used: continue
        if a.get('to') or b.get('to'): continue
        if sA + '>' + sB in have_pair or sB + '>' + sA in have_pair: continue
        pair(sA, a, sB, b)

    roots = set(find(sid) for sid in parent)
    if len(roots) > 1:
        warns.append('接线后仍有 %d 个互不相通的场景组（生成器只能连相邻场景，复杂拓扑要人工补）' % len(roots))

    # 写回：只改原有的 exits 条目（原地更新 to/at），不重建数组、不丢 direction/condition 这些字段
    for s in scenes:
        for d in doors[s['id']]:
            ref = d.get('_ref')
            if ref is None: continue
            if d.get('to'): ref['to'] = d['to']
            if d.get('at'): ref['at'] = d['at']
    return transitions, warns


def reachable_scenes(scenes, start=None):
    """按接线做 BFS，返回能走到的场景 id 集合。"""
    by_id = {s['id']: s for s in scenes}
    start = start or scenes[0]['id']
    adj = {}
    for s in scenes:
        adj[s['id']] = set()
    for s in scenes:
        for d in scene_doors(s):
            if d.get('to') and d['to'] in by_id: adj[s['id']].add(d['to'])
        for d in (s.get('exits') or []):
            if isinstance(d, dict) and d.get('to') in by_id: adj[s['id']].add(d['to'])
    seen, stack = {start}, [start]
    while stack:
        cur = stack.pop()
        for nx in adj.get(cur, ()):
            if nx not in seen: seen.add(nx); stack.append(nx)
    return seen


def gen_station_set(n, seed, kind='station'):
    """生成 n 张连在一起的站内图（先不接线）。"""
    scenes = []
    for i in range(n):
        sid = 'gen_%s_%s_%d' % (kind, seed, i + 1)
        scenes.append(gen_scene(kind, '%s-%d' % (seed, i), sid, 2))   # 每张 2 扇 -> 总数偶数，能两两配上
    return scenes

if __name__ == '__main__':
    sys.exit(main())
