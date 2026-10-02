# -*- coding: utf-8 -*-
"""星图航道：给 galaxy.nodes 连超空间航道（数据层，没有它星图就是一堆孤立的点）。

群星里银河是开局生成的，航道密度是**开局设置项**（低/中/高）—— 它直接决定一局的形状：
航道密 → 到处都能绕，防守容易，扩张快；航道疏 → 每条走廊都是咽喉，一夫当关。

用法:
  python tools/galaxy_links.py                     # 只检查（打印现状，不改文件）
  python tools/galaxy_links.py --write             # 算出来写回 content/space.json
  python tools/galaxy_links.py --write --density 1.6
  python tools/galaxy_links.py --selftest          # 拓扑自检（连通 / 无重边 / 无自环 / 度数）

星图硬规则（本地化的 R1~R13，和地图规则是两套东西）:
  G1 连通   ：所有星系必须在同一张连通图上（否则舰队进不去）
  G2 回程   ：每个星系都要能沿航道走回母星（对应地图层的 R13 回程安全）
  G3 无重边 ：同一对星系只连一条航道
  G4 无自环 ：星系不连自己
  G5 度数   ：每个星系 1~6 条航道（群星也差不多这个量级；0 度 = 孤岛，>6 度 = 枢纽过载）
  G6 交叉少 ：航道尽量不要交叉（交叉看着像立交桥，读不出来）
"""
import io, json, os, re, sys, math, random, collections
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
SPEC = os.path.join(ROOT, 'content', 'space.json')

MAX_DEGREE = 6


def load_nodes(path=SPEC):
    sp = json.load(io.open(path, encoding='utf-8-sig'))
    g = sp.get('galaxy') or {}
    return sp, g.get('nodes') or []


def dist(a, b):
    return math.hypot(a.get('x', 0) - b.get('x', 0), a.get('y', 0) - b.get('y', 0))


def build_links(nodes, density=1.0, seed='links'):
    """最小生成树保证连通，再按 density 补额外边做出回路（群星的航道就是这样）。

    只连 MST 是"树"：任何一条走廊被切断，银河就断成两半。
    只连最近邻是"网"：太密，没有咽喉要地，战争没有战略点。density 就是这两者的旋钮。
    """
    ids = [n['id'] for n in nodes]
    by = {n['id']: n for n in nodes}
    if len(ids) < 2:
        return {}, []
    rnd = random.Random('%s|%s|%d' % (seed, len(ids), int(density * 100)))
    # --- Prim 最小生成树（保证 G1 连通）
    in_tree = {ids[0]}
    links = collections.defaultdict(set)
    edges = []
    while len(in_tree) < len(ids):
        best = None
        for a in in_tree:
            for b in ids:
                if b in in_tree: continue
                d = dist(by[a], by[b])
                if best is None or d < best[0]: best = (d, a, b)
        if best is None: break
        _, a, b = best
        links[a].add(b); links[b].add(a); edges.append((a, b))
        in_tree.add(b)
    # --- 按密度补边：每个星系连上「半径内还没连的邻居」
    all_d = sorted(dist(by[a], by[b]) for i, a in enumerate(ids) for b in ids[i+1:])
    if all_d:
        radius = all_d[int(len(all_d) * min(0.35, 0.10 * density))] if density > 0 else 0
        for i, a in enumerate(ids):
            cands = sorted((dist(by[a], by[b]), b) for b in ids[i+1:])
            for d, b in cands:
                if d > radius: break
                if len(links[a]) >= MAX_DEGREE or len(links[b]) >= MAX_DEGREE: continue
                if b in links[a] or rnd.random() > 0.55: continue
                links[a].add(b); links[b].add(a); edges.append((a, b))
    return {k: sorted(v) for k, v in links.items()}, edges


def check(nodes, links, home=None):
    """返回 (errors, warnings, stats)"""
    errs, warns = [], []
    ids = [n['id'] for n in nodes]
    by = {n['id']: n for n in nodes}
    # G3 重边 / G4 自环
    seen = set()
    for a, bs in links.items():
        if a not in by: errs.append('航道指向不存在的星系 %s' % a); continue
        for b in bs:
            if b == a: errs.append('G4 星系 %s 连了自己' % a); continue
            if b not in by: errs.append('航道 %s -> %s 指向不存在的星系' % (a, b)); continue
            # 航道是无向的：links 里 a->b 和 b->a 各存一份，只数一次（不然每条都被当成重边）
            if a > b: continue
            key = (a, b)
            if key in seen: errs.append('G3 重复航道 %s - %s' % key)
            seen.add(key)
    # G5 度数
    for i in ids:
        d = len(links.get(i) or [])
        if d == 0: errs.append('G5 星系 %s 是孤岛（没有任何航道）' % i)
        elif d > MAX_DEGREE: warns.append('G5 星系 %s 有 %d 条航道（枢纽过载）' % (i, d))
    # G1 连通
    if ids:
        start = home if home in by else ids[0]
        comp = reachable(links, start)
        missing = [i for i in ids if i not in comp]
        if missing:
            errs.append('G1 从 %s 出发走不到 %d 个星系：%s' % (start, len(missing), ','.join(missing[:4])))
    # G2 回程：每个星系都能走回母星（在 G1 成立且母星存在时等价，但单独报更清楚）
    if home in by and ids:
        back = reachable(links, home)
        for i in ids:
            if i not in back: errs.append('G2 %s 回不了母星 %s' % (i, home))
    degs = [len(links.get(i) or []) for i in ids]
    stats = {'nodes': len(ids), 'edges': len(seen), 'isolated': sum(1 for d in degs if d == 0),
             'avg_degree': (sum(degs) / float(len(degs))) if degs else 0,
             'max_degree': max(degs) if degs else 0}
    return errs, warns, stats


def reachable(links, start):
    seen, stack = {start}, [start]
    while stack:
        cur = stack.pop()
        for nb in (links.get(cur) or []):
            if nb not in seen: seen.add(nb); stack.append(nb)
    return seen


def selftest():
    sp, nodes = load_nodes()
    bad = []
    for density in (0.6, 1.0, 1.6, 2.4):
        links, edges = build_links(nodes, density, seed='selftest')
        errs, warns, st = check(nodes, links, home='sol')
        if errs: bad.append('density=%.1f: %s' % (density, errs[0]))
        # 确定性
        l2, _ = build_links(nodes, density, seed='selftest')
        if l2 != links: bad.append('density=%.1f 两次结果不一致（不确定）' % density)
        print('  density %.1f -> %d 星系 / %d 航道 / 平均度 %.2f / 最大度 %d'
              % (density, st['nodes'], st['edges'], st['avg_degree'], st['max_degree']))
    # 密度旋钮要真的有效：密度的边数必须单调不减
    counts = []
    for density in (0.6, 1.0, 1.6, 2.4):
        links, _ = build_links(nodes, density, seed='selftest')
        counts.append(sum(len(v) for v in links.values()) // 2)
    if counts != sorted(counts): bad.append('航道密度不是单调的：%s' % counts)
    print('星图航道自检：%s' % ('OK' if not bad else '失败 %d' % len(bad)))
    for x in bad: print('  ' + x)
    return 1 if bad else 0


def main():
    argv = sys.argv[1:]
    if '--selftest' in argv:
        return selftest()
    density = 1.0
    if '--density' in argv:
        density = float(argv[argv.index('--density') + 1])
    sp, nodes = load_nodes()
    links, edges = build_links(nodes, density, seed=sp.get('config', {}).get('galaxySeed', 'links'))
    errs, warns, st = check(nodes, links, home='sol')
    print('星系 %d / 航道 %d / 平均度 %.2f / 最大度 %d / 孤岛 %d'
          % (st['nodes'], st['edges'], st['avg_degree'], st['max_degree'], st['isolated']))
    for e in errs: print('  [错误] ' + e)
    for w in warns[:5]: print('  [警告] ' + w)
    print('  错误 %d / 警告 %d' % (len(errs), len(warns)))
    if '--write' in argv:
        if errs:
            print('有错误，不写。'); return 1
        for n in nodes:
            n['links'] = links.get(n['id'], [])
        io.open(SPEC, 'w', encoding='utf-8', newline='\n').write(
            json.dumps(sp, ensure_ascii=False, indent=1) + '\n')
        print('已写回 %s' % SPEC)
    elif '--nodes' in argv:
        # 人类可读的拓扑：每个星系通往哪
        by = {n['id']: n for n in nodes}
        for n in sorted(nodes, key=lambda x: -len(links.get(x['id'], [])))[:8]:
            nb = links.get(n['id'], [])
            print('  %-10s (%2d,%2d) 度 %d -> %s'
                  % (n['id'], n['x'], n['y'], len(nb), ' '.join(by[b]['name'] for b in nb)))
    return 1 if errs else 0


if __name__ == '__main__':
    sys.exit(main())
