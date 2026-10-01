# -*- coding: utf-8 -*-
"""地图规则（预设地图和随机地图共用这一套）。不合规就要改地图或改生成器。

硬规则（errors）
R1  边框完整：最外一圈除了「门洞」，不能出现可走格
R2  门洞够宽：沿门所在的那条边量，连通的门口 >= 3 格
R3  单连通：可走格必须只有一个连通区
R4  出口可站：出口格必须可走
R5  落点可站：出口的 at 必须落在目标场景的可走格上
R7  开敞率：可走格 / 总格 >= 0.55
R9  尺寸：宽 44~104、高 14~36，且宽高都是偶数
R10 四角不开口：地图四角必须是墙（除非那个角本身就是门洞的一部分）
R11 每个场景至少一个出口

软规则（warnings）
R6  别在中间糊一整块墙：室内场景实心非可走块最大正方形 <= 3；地表/裂隙这类野外地貌放宽到 8
R8  门最好成对：A 有门通向 B，B 也应有门回 A（裂隙单向通道属有意设计，只警告）
"""
import json, sys, os

SIZE_MIN = (44, 14); SIZE_MAX = (104, 36)
MAX_SOLID_SQUARE_INDOOR = 3; MAX_SOLID_SQUARE_OUTDOOR = 8
MIN_OPEN_RATIO = 0.55; MIN_DOOR_WIDTH = 3
INDOOR_TYPES = ('space_station', 'colony', 'ship_interior')

def load_space(path=None):
    path = path or os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'content', 'space.json')
    with open(path, encoding='utf-8') as f: return json.load(f)

def make_resolver(space):
    default = space.get('config', {}).get('defaultLegend', {})
    presets = space.get('presets', {})
    inter = {i['id']: i for i in space.get('interactables', {}).get('list', [])}
    def passable(scene, ch):
        e = (scene.get('legend') or {}).get(ch, default.get(ch))
        if not isinstance(e, dict): return False
        if 'preset' in e: return bool((presets.get(e['preset']) or {}).get('passable'))
        if 'interactable' in e: return bool((inter.get(e['interactable']) or {}).get('passable'))
        return bool(e.get('passable'))
    return passable

def grid_of(space, scene, passable):
    return [[passable(scene, ch) for ch in row] for row in scene['tiles']]

def regions(pm):
    H = len(pm); W = len(pm[0]); seen = [[0]*W for _ in range(H)]; sizes = []
    for y in range(H):
        for x in range(W):
            if not pm[y][x] or seen[y][x]: continue
            stack = [(x, y)]; seen[y][x] = 1; n = 0
            while stack:
                cx, cy = stack.pop(); n += 1
                for nx, ny in ((cx-1,cy),(cx+1,cy),(cx,cy-1),(cx,cy+1)):
                    if 0 <= nx < W and 0 <= ny < H and pm[ny][nx] and not seen[ny][nx]:
                        seen[ny][nx] = 1; stack.append((nx, ny))
            sizes.append(n)
    return sizes

def max_solid_square(pm):
    H = len(pm); W = len(pm[0]); dp = [[0]*W for _ in range(H)]; best = 0
    for y in range(H-1, -1, -1):
        for x in range(W-1, -1, -1):
            if pm[y][x]: dp[y][x] = 0; continue
            r = 1
            if x+1 < W and y+1 < H: r = 1 + min(dp[y+1][x], dp[y][x+1], dp[y+1][x+1])
            dp[y][x] = r; best = max(best, r)
    return best

def door_run(pm, x, y):
    """沿门所在的那条边，数出连续可走格（返回 (格子集合, 宽度)）。"""
    H = len(pm); W = len(pm[0])
    cells = {(x, y)}
    if y in (0, H-1):
        xx = x-1
        while xx >= 0 and pm[y][xx]: cells.add((xx, y)); xx -= 1
        xx = x+1
        while xx < W and pm[y][xx]: cells.add((xx, y)); xx += 1
    else:
        yy = y-1
        while yy >= 0 and pm[yy][x]: cells.add((x, yy)); yy -= 1
        yy = y+1
        while yy < H and pm[yy][x]: cells.add((x, yy)); yy += 1
    return cells, len(cells)

def scene_exits(scene):
    """出口的两个来源（跟引擎 compileScene 一个口径）：scene.exits 数组 + legend 里的 exit（裂隙口这种）。"""
    out = []
    for e in (scene.get('exits') or []):
        if isinstance(e, dict) and e.get('x') is not None:
            out.append({'x': e['x'], 'y': e['y'], 'to': e.get('to') or e.get('scene'), 'at': e.get('at')})
    for ch, lg in (scene.get('legend') or {}).items():
        if not isinstance(lg, dict): continue
        # 跟引擎 resolveLegendEntry 同口径：entry.exit 或 entry.to 都算出口
        if isinstance(lg.get('exit'), dict): ex = lg['exit']
        elif lg.get('exit') or lg.get('to'): ex = {'to': lg.get('to'), 'at': lg.get('at')}
        else: continue
        to = ex.get('to') or ex.get('scene') or lg.get('to') or lg.get('scene')
        at = ex.get('at') or lg.get('at')
        for y, row in enumerate(scene.get('tiles') or []):
            for x, c in enumerate(row):
                if c == ch: out.append({'x': x, 'y': y, 'to': to, 'at': at, 'legend': ch})
    return out


def check_scene(space, scene, passable, exits_by_scene=None):
    errors, warns = [], []
    W, H = scene['size']['w'], scene['size']['h']
    tiles = scene['tiles']
    if len(tiles) != H or any(len(r) != W for r in tiles):
        return ['R9 尺寸与 tiles 不一致：%dx%d' % (W, H)], []
    pm = grid_of(space, scene, passable)
    exits = scene_exits(scene)
    if not (SIZE_MIN[0] <= W <= SIZE_MAX[0] and SIZE_MIN[1] <= H <= SIZE_MAX[1]):
        errors.append('R9 尺寸越界：%dx%d' % (W, H))
    if W % 2 or H % 2: errors.append('R9 宽高必须是偶数：%dx%d' % (W, H))
    if not exits: errors.append('R11 没有任何出口')
    door_cells, widths = set(), {}
    for e in exits:
        x, y = e['x'], e['y']
        if not (0 <= x < W and 0 <= y < H): errors.append('R4 出口越界 (%d,%d)' % (x, y)); continue
        if not pm[y][x]: errors.append('R4 出口不可走 (%d,%d)' % (x, y)); continue
        cells, w = door_run(pm, x, y); door_cells |= cells; widths[(x, y)] = w
        if w < MIN_DOOR_WIDTH: errors.append('R2 门太窄 (%d,%d)：宽 %d < %d' % (x, y, w, MIN_DOOR_WIDTH))
    # R1 / R10
    for x in range(W):
        for y in (0, H-1):
            if pm[y][x] and (x, y) not in door_cells: errors.append('R1 边框上出现非门可走格 (%d,%d)' % (x, y))
    for y in range(H):
        for x in (0, W-1):
            if pm[y][x] and (x, y) not in door_cells: errors.append('R1 边框上出现非门可走格 (%d,%d)' % (x, y))
    for (cx, cy) in ((0,0),(W-1,0),(0,H-1),(W-1,H-1)):
        if pm[cy][cx] and (cx, cy) not in door_cells: errors.append('R10 四角开口 (%d,%d)' % (cx, cy))
    # R5
    for e in exits:
        if not e.get('to'): continue          # 生成器可以先画出没接线的门
        at = e.get('at') or {}; tgt = (exits_by_scene or {}).get(e.get('to'))
        if tgt is None: errors.append('R5 出口指向不存在的场景 %s' % e.get('to')); continue
        tpm = grid_of(space, tgt, passable)
        ax, ay = at.get('x', -1), at.get('y', -1)
        if not (0 <= ax < tgt['size']['w'] and 0 <= ay < tgt['size']['h'] and tpm[ay][ax]):
            errors.append('R5 落点不可走 -> %s (%d,%d)' % (e.get('to'), ax, ay))
    # R3 / R6 / R7
    sizes = regions(pm)
    if len(sizes) != 1: errors.append('R3 可走区域 %d 块：%s' % (len(sizes), sorted(sizes, reverse=True)[:4]))
    ms = max_solid_square(pm)
    limit = MAX_SOLID_SQUARE_INDOOR if scene.get('type') in INDOOR_TYPES else MAX_SOLID_SQUARE_OUTDOOR
    if ms > limit: warns.append('R6 实心块偏大：%dx%d（上限 %d）' % (ms, ms, limit))
    walk = sum(1 for r in pm for v in r if v)
    if walk and walk / float(W*H) < MIN_OPEN_RATIO: errors.append('R7 开敞率太低：%.0f%%' % (100.0*walk/(W*H)))
    return errors, warns

def shuttle_scenes(space):
    """放了穿梭机终端的场景（legend 或 tileEdits）。"""
    out = set()
    for s in (space.get('scenes') or {}).get('list', []):
        found = False
        for ch, lg in (s.get('legend') or {}).items():
            if isinstance(lg, dict) and lg.get('interactable') == 'shuttle_terminal': found = True
        for ed in (s.get('tileEdits') or []):
            if isinstance(ed, dict) and ed.get('interactable') == 'shuttle_terminal': found = True
        if found: out.add(s['id'])
    return out


def return_safety(space):
    """R13 回程安全：每个场景都要能沿门走回一台穿梭机终端。
    没有穿梭机终端的 spec（小 mod）不适用，返回 []。
    返回走不到任何终端的场景列表（这些场景一旦只能靠穿梭机到达就会单向卡死）。"""
    scenes = (space.get('scenes') or {}).get('list', [])
    by_id = {s['id']: s for s in scenes}
    term = shuttle_scenes(space)
    if not term: return []
    adj = {sid: set() for sid in by_id}
    for s in scenes:
        for ex in scene_exits(s):
            if ex.get('to') in by_id: adj[s['id']].add(ex['to'])
    unsafe = []
    for sid in by_id:
        seen = {sid}; stack = [sid]
        while stack:
            cur = stack.pop()
            for nx in adj.get(cur, ()):
                if nx not in seen: seen.add(nx); stack.append(nx)
        if not (seen & term): unsafe.append(sid)
    return unsafe


def check_all(space):
    passable = make_resolver(space)
    scenes = (space.get('scenes') or {}).get('list', [])
    by_id = {s['id']: s for s in scenes}
    errors, warns = {}, {}
    for s in scenes:
        e, w = check_scene(space, s, passable, by_id)
        if e: errors[s['id']] = e
        if w: warns[s['id']] = w
    for s in scenes:
        for ex in scene_exits(s):
            tgt = by_id.get(ex.get('to'))
            if tgt is None: continue
            if not any((b.get('to') == s['id']) for b in scene_exits(tgt)):
                warns.setdefault(s['id'], []).append('R8 %s -> %s 是单向门（没有回门）' % (s['id'], ex.get('to')))
    for sid in return_safety(space):
        errors.setdefault(sid, []).append('R13 回程不安全：从 %s 走不到任何穿梭机终端（只能单向困死）' % sid)
    return {'errors': errors, 'warnings': warns}

def main():
    space = load_space(); res = check_all(space)
    n = len(space['scenes']['list'])
    for sid, msgs in res['errors'].items():
        print('[错误][%s]' % sid)
        for m in msgs: print('   -', m)
    for sid, msgs in res['warnings'].items():
        print('[警告][%s]' % sid)
        for m in msgs: print('   -', m)
    if res['errors']:
        print('地图规则：%d 个场景，%d 个不合规' % (n, len(res['errors']))); return 1
    print('地图规则：%d 个场景全部通过（错误 0 / 警告 %d）' % (n, len(res['warnings']))); return 0

if __name__ == '__main__':
    sys.exit(main())