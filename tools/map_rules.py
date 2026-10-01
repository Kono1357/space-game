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

def js_truthy(v):
    """JS 的真假值：{} / [] 为真，'' / 0 / None 为假（Python 里 {} 是假，这里要对齐）"""
    if v is None or v is False: return False
    if v is True: return True
    if isinstance(v, (int, float)): return v != 0
    if isinstance(v, str): return v != ''
    return True


def entry_passable(entry, presets, inter):
    """一个图例条目的可走性 —— 逐字对齐引擎 resolveLegendEntry + compileScene：
        引擎判定是  pass = 0 if (d.passable === false or d.solid) else 1
       注意 `=== false` 是**严格比较**：写了 passable: 0 / null 都不算「挡住」，
       而 solid 走的是真假值判断。

    旧实现是 `bool(e.get('passable'))`：对一个「既没写 passable 也没写 solid」的条目，
    引擎当它是可走的，旧实现当它是墙 —— 校验器和引擎对这种格子会给出相反的结论。
    校验器一旦会说谎，比没有校验器更危险，所以这里照引擎抄。
    """
    if entry is None:
        return False                     # 引擎：没有图例条目 = 墙
    if isinstance(entry, str):
        entry = {'preset': entry}
    if not isinstance(entry, dict):
        return True
    d = {'passable': True, 'solid': False}
    p = presets.get(entry.get('preset')) if entry.get('preset') else None
    if isinstance(p, dict):
        d.update(p)                      # 预设是扁平表，只关心 passable / solid
    idef = inter.get(entry.get('interactable')) if entry.get('interactable') else None
    if isinstance(idef, dict):
        d['passable'] = bool(idef.get('passable'))
        d['solid'] = not d['passable']
    if entry.get('npc'):
        d['passable'] = True; d['solid'] = False
    for f in ('passable', 'solid'):
        if f in entry:
            d[f] = entry[f]
    return not (d.get('passable') is False or js_truthy(d.get('solid')))


def resolve_ch(entry, presets, inter, cur_ch):
    """tileEdit 会把这一格的**字符**也换掉（引擎里是 g.ch[ei] = d3.ch），这里照着走"""
    if entry is None:
        return cur_ch
    if isinstance(entry, str):
        entry = {'preset': entry}
    if not isinstance(entry, dict):
        return cur_ch
    ch = cur_ch
    p = presets.get(entry.get('preset')) if entry.get('preset') else None
    if isinstance(p, dict) and p.get('ch') is not None:
        ch = p['ch']
    idef = inter.get(entry.get('interactable')) if entry.get('interactable') else None
    if isinstance(idef, dict) and idef.get('symbol') is not None:
        ch = idef['symbol']
    if entry.get('playerSpawn'):
        fp = presets.get('floor')
        if isinstance(fp, dict) and fp.get('ch') is not None:
            ch = fp['ch']
    if 'ch' in entry and entry['ch'] is not None:
        ch = entry['ch']
    return ch


def eff_tiles(scene, space):
    """把 tileEdits 真的盖到 tiles 上，得到「引擎实际看到的那张图」。

    以前 grid_of / scene_exits 只读 scene['tiles']，**完全不看 tileEdits**，
    而引擎 compileScene 是会应用它们的。后果是：mod 用 tileEdits 凿出来的门，
    在规则检查里仍然是一堵墙 ——
        R4「出口可站」会对完全合法的 mod 报假错，
        R1 / R2 / R3 / R7 也会基于错的图去算。
    实测：mods/example_mod 在 station_corridor (0,6) 凿了一扇门，
          引擎 isPassable() 返回 true，而旧 map_rules 报「R4 出口不可走 (0,6)」。
    """
    rows = [list(r) for r in (scene.get('tiles') or [])]
    edits = scene.get('tileEdits')
    if not rows or not isinstance(edits, list):
        return rows
    H, W = len(rows), len(rows[0])
    presets = space.get('presets') or {}
    inter = {i['id']: i for i in (space.get('interactables') or {}).get('list', [])
             if isinstance(i, dict) and 'id' in i}
    for ed in edits:
        if not isinstance(ed, dict): continue
        x, y = ed.get('x'), ed.get('y')
        if isinstance(x, bool) or isinstance(y, bool): continue
        if not isinstance(x, int) or not isinstance(y, int): continue
        if not (0 <= x < W and 0 <= y < H): continue        # 引擎越界只警告并跳过
        if ed.get('legend') is not None:
            entry = ed['legend']
        else:
            entry = {k: ed[k] for k in ('preset', 'ch', 'fg', 'bg', 'passable', 'solid',
                                        'interactable', 'name', 'playerSpawn') if k in ed}
        rows[y][x] = resolve_ch(entry, presets, inter, rows[y][x])
    return rows


def _deep_merge(base, patch):
    """引擎的 deepMerge（mergeArrays 在引擎里从没打开过）。这里只需要它来复刻有效图例。"""
    if not isinstance(base, dict) or not isinstance(patch, dict):
        return json.loads(json.dumps(base if patch is None else patch))
    out = json.loads(json.dumps(base))
    for k, pv in patch.items():
        bv = out.get(k)
        out[k] = _deep_merge(bv, pv) if (isinstance(pv, dict) and isinstance(bv, dict)) else json.loads(json.dumps(pv))
    return out


def effective_legend(space, scene):
    """逐字对齐引擎的 effectiveLegend：**深度合并** defaultLegend 与 scene.legend。

    以前这里是「场景 legend 里有就用场景的，否则用全局的」—— 二选一。
    引擎是深合并，两者在同一个字符上都有条目时会**合起来**：
    全局条目带的 preset 会把 solid:true 注进去，盖过场景自己写的 passable:true。
    实测：中央大厅把 % 和 ~ 定义成「通向 X」的通道（passable:true），
    一旦全局表里也有 % / ~，引擎那边这两个字符就变成走不过去的墙，而规则这边还是可走 ——
    两边对同一格给出相反结论，校验器的结论就不作数了。
    """
    default = (space.get('config') or {}).get('defaultLegend')
    own = scene.get('legend') if isinstance(scene.get('legend'), dict) else {}
    if not isinstance(default, dict): return json.loads(json.dumps(own))
    return _deep_merge(default, own)


def make_resolver(space):
    presets = space.get('presets', {})
    inter = {i['id']: i for i in space.get('interactables', {}).get('list', [])}
    cache = {}                      # 有效图例要按场景算一次就够：每格重算深合并会把校验拖到分钟级
    def passable(scene, ch):
        key = id(scene)
        lg = cache.get(key)
        if lg is None:
            lg = effective_legend(space, scene); cache[key] = lg
        return entry_passable(lg.get(ch), presets, inter)
    return passable

def grid_of(space, scene, passable):
    """引擎口径的可走矩阵：先应用 tileEdits，再按有效图例判定"""
    return [[passable(scene, ch) for ch in row] for row in eff_tiles(scene, space)]

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

def scene_exits(scene, space=None):
    """出口的两个来源（跟引擎 compileScene 一个口径）：scene.exits 数组 + legend 里的 exit（裂隙口这种）。
    space 传进来时会先应用 tileEdits —— 否则 tileEdits 写进去的出口字符会被漏掉。"""
    out = []
    for e in (scene.get('exits') or []):
        if isinstance(e, dict) and e.get('x') is not None:
            out.append({'x': e['x'], 'y': e['y'], 'to': e.get('to') or e.get('scene'), 'at': e.get('at')})
    tiles = eff_tiles(scene, space) if space is not None else (scene.get('tiles') or [])
    for ch, lg in (scene.get('legend') or {}).items():
        if not isinstance(lg, dict): continue
        # 跟引擎 resolveLegendEntry 同口径：entry.exit 或 entry.to 都算出口
        if isinstance(lg.get('exit'), dict): ex = lg['exit']
        elif lg.get('exit') or lg.get('to'): ex = {'to': lg.get('to'), 'at': lg.get('at')}
        else: continue
        to = ex.get('to') or ex.get('scene') or lg.get('to') or lg.get('scene')
        at = ex.get('at') or lg.get('at')
        for y, row in enumerate(tiles):
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
    exits = scene_exits(scene, space)
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

def dump_pass(argv):
    """--dump-pass：把每个场景的「可走矩阵」按引擎口径吐成 JSON。

    给 tests/test_maprules_parity.js 用：它拿这份矩阵和引擎编译出来的 pass 数组
    逐格比对，证明「规则看到的图和游戏看到的图是同一张」。
    这是整个校验器可信的前提 —— 规则和引擎对同一格给出相反结论的话，
    校验通过就没有任何意义。

    用法: python tools/map_rules.py --dump-pass <基础内容.json> [mod.json ...]
    """
    if not argv:
        sys.exit('用法: python tools/map_rules.py --dump-pass <基础内容.json> [mod.json ...]')
    with open(argv[0], encoding='utf-8') as f:
        space = json.load(f)
    if len(argv) > 1:
        _here = os.path.dirname(os.path.abspath(__file__))
        if _here not in sys.path: sys.path.insert(0, _here)
        import space_merge
        mods = [space_merge.load_mod(p) for p in argv[1:]]
        space, _ = space_merge.merge_all(space, mods)
    passable = make_resolver(space)
    out = {}
    for s in (space.get('scenes') or {}).get('list', []):
        pm = grid_of(space, s, passable)
        out[s['id']] = [[1 if c else 0 for c in row] for row in pm]
    sys.stdout.write(json.dumps(out, ensure_ascii=False, separators=(',', ':')))


def main():
    argv = sys.argv[1:]
    if argv and argv[0] == '--dump-pass':
        dump_pass(argv[1:]); return 0
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