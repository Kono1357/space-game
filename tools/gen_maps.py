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


def gen_surface(grid, rnd, kind):
    H, W = len(grid), len(grid[0])
    carve(grid, 1, 1, W - 2, H - 2)
    for _ in range(rnd.randint(6, 12)):
        x = rnd.randint(3, W - 4); y = rnd.randint(3, H - 4)
        for _ in range(rnd.randint(20, 60)):
            if 1 <= x < W - 1 and 1 <= y < H - 1: grid[y][x] = '^'
            x += rnd.choice((-1, 0, 1)); y += rnd.choice((-1, 0, 1))
    largest_region_only(grid, (W // 2, H // 2))


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


def gen_rift(grid, rnd, kind):
    H, W = len(grid), len(grid[0])
    for y in range(1, H - 1):
        for x in range(1, W - 1): grid[y][x] = '.' if rnd.random() < 0.63 else '#'
    for _ in range(3):
        ng = [row[:] for row in grid]
        for y in range(1, H - 1):
            for x in range(1, W - 1):
                n = 0
                for dy in (-1, 0, 1):
                    for dx in (-1, 0, 1):
                        if dx == 0 and dy == 0: continue
                        if grid[y + dy][x + dx] == '#': n += 1
                ng[y][x] = '#' if n >= 5 else '.'
        for yy in range(H): grid[yy][:] = ng[yy]          # 原地改，别把调用方的 list 换掉
    largest_region_only(grid, (W // 2, H // 2))


GEN = {'station': gen_station, 'colony': gen_colony, 'surface': gen_surface, 'ship': gen_ship, 'rift': gen_rift, 'under': gen_rift}


def gen_scene(kind, seed, sid=None, doors=None):
    for attempt in range(60):
        rnd = random.Random('%s|%s|%d' % (kind, seed, attempt))
        W, H = rnd.choice(KINDS[kind]['sizes'])
        grid = blank(W, H)
        GEN[kind](grid, rnd, kind)
        n_doors = doors if doors else rnd.randint(2, 4)
        door_cells = carve_doors(grid, rnd, n_doors)
        if not door_cells: continue
        tiles = [''.join(r) for r in grid]
        scene = {'id': sid or ('gen_%s_%s' % (kind, seed)), 'name': KINDS[kind]['name'],
                 'type': KINDS[kind]['type'], 'size': {'w': W, 'h': H}, 'tiles': tiles,
                 'legend': {}, 'exits': [{'x': x, 'y': y, 'to': '', 'at': {'x': 0, 'y': 0}} for (x, y) in door_cells],
                 'ambient': KINDS[kind]['ambient']}
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
