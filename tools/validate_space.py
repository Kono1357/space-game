# -*- coding: utf-8 -*-
"""不开浏览器校验空间层内容（纯数据层，不需要 Node）。

用法:
  python tools/validate_space.py                           校验 content/space.json
  python tools/validate_space.py 某内容.json                校验指定文件
  python tools/validate_space.py --mods m1.json m2.json     先合并再校验（重点）
  python tools/validate_space.py --mods-dir mods            同上，自动扫 mods/*/
  python tools/validate_space.py 基础.json --mods m.json    指定基础内容

管什么：
    每个块的 id 不重复
    场景尺寸 / 行宽 / 出口指向 / legend 键是不是单字符
    地图里出现的每个字符都能在「有效图例」里查到
     （有效图例 = config.defaultLegend 垫底 + scene.legend 覆盖）
    漏写的字符会被引擎当墙编译，整张图可能变成实心，这是踩过的大坑
    日程点、props、出口 at 的坐标在范围内
    对话的 entry / goto / next 都有落点
    地图规则：门洞 >= 3 格、边框不漏、四角不开口、单连通、开敞率 >= 55%（tools/map_rules.py，
           和随机地图生成器 tools/gen_maps.py 共用同一套）

**为什么必须支持 mod（2026-10-02 补）**：
    以前这个脚本只吃一个文件、独立校验。拿一个 mod 文件喂它，它找不到 scenes/npcs，
    于是一路输出「场景 0 / 人 0 / 对话 0 …… 错误 0 / 警告 0」——**静默假通过**。
    玩家改坏了 mod，校验器说没问题，进游戏才发现地图整片变实心。
    低门槛路线的致命伤不在功能，在这里。
    现在：① 传 mod 文件进来会被识别出来并明确拒绝（不再假通过）；
         ② --mods / --mods-dir 会把 mod 按引擎的语义合并进基础内容，**校验合并后的结果**。
    合并语义由 tools/space_merge.py 提供，它和引擎逐字节一致
    （由 tests/test_merge_parity.js 守着）。

不管什么：引擎的真编译结果（NPC 寻路、交互）  那些看 node tests/test_world.js
  node tests/test_world.js   （世界层回归：房间连通 / 门能走通 / 终端能开 ）
"""
import io, json, os, sys, collections
sys.dont_write_bytecode = True    # 别在仓库里生成 __pycache__

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
if HERE not in sys.path:
    sys.path.insert(0, HERE)

DEFAULT_SPEC = os.path.join(ROOT, 'content', 'space.json')

def aslist(b):
    if b is None: return []
    if isinstance(b, list): return b
    if isinstance(b, dict): return b.get('list') or b.get('options') or b.get('items') or []
    return []


def looks_like_mod(sp):
    """mod 文件长这样：有 manifest / data，但没有 scenes。
    用来把「把 mod 当内容传进来」这种误用挡掉 —— 以前它会静默假通过。"""
    if not isinstance(sp, dict):
        return False
    if 'scenes' in sp:
        return False
    return isinstance(sp.get('manifest'), dict) or isinstance(sp.get('data'), dict)


def validate(sp, label):
    """校验一份**已经合并好**的内容。返回 (errs, warns, stats)"""
    errs, warns = [], []
    scenes = {s['id']: s for s in aslist(sp.get('scenes')) if isinstance(s, dict) and 'id' in s}
    npcs   = {n['id']: n for n in aslist(sp.get('npcs'))   if isinstance(n, dict) and 'id' in n}
    dlg    = {d['id']: d for d in aslist(sp.get('dialogues')) if isinstance(d, dict) and 'id' in d}
    inter  = {i['id']: i for i in aslist(sp.get('interactables')) if isinstance(i, dict) and 'id' in i}
    views  = {v['id']: v for v in aslist(sp.get('views')) if isinstance(v, dict) and 'id' in v}
    default_legend = (sp.get('config') or {}).get('defaultLegend') or {}
    sch    = {}
    for s in aslist(sp.get('schedules')):
        if isinstance(s, dict): sch[s.get('npcId', s.get('id'))] = s

    for key in ('scenes', 'npcs', 'dialogues', 'interactables', 'views', 'shuttles', 'sceneTransitions'):
        ids = [x.get('id') for x in aslist(sp.get(key)) if isinstance(x, dict) and x.get('id') is not None]
        dup = [k for k, c in collections.Counter(ids).items() if c > 1]
        if dup: errs.append('%s 里有重复 id: %s' % (key, dup))

    # 每个 id 列表块里的条目都必须有 id：mod 是按 id 合并的，没 id 就只能整块替换
    blocks = []
    for k, v in sp.items():
        if k.startswith('_'): continue
        if isinstance(v, dict) and isinstance(v.get('list'), list):
            blocks.append((k, v['list']))
        elif isinstance(v, dict):
            for k2, v2 in v.items():
                if k2 != 'list' and isinstance(v2, list) and v2 and isinstance(v2[0], dict):
                    blocks.append((k + '.' + k2, v2))
        elif isinstance(v, list) and v and isinstance(v[0], dict):
            blocks.append((k, v))
    for bname, blist in blocks:
        miss = [x for x in blist if isinstance(x, dict) and 'id' not in x]
        if miss:
            errs.append('块 %s 里有 %d 条没有 id（mod 只能整块替换它）' % (bname, len(miss)))

    for sid, sc in scenes.items():
        size = sc.get('size') or {}
        w, h = size.get('w'), size.get('h')
        tiles = sc.get('tiles') or []
        if not w or not h:
            warns.append('场景 %s 没写 size' % sid); continue
        if len(tiles) != h:
            errs.append('场景 %s 行数 %d != size.h %d' % (sid, len(tiles), h))
        for i, row in enumerate(tiles):
            if len(row) != w:
                errs.append('场景 %s 第 %d 行宽 %d != size.w %d' % (sid, i, len(row), w))
        legend = dict(default_legend)                    # 全局标准字符表垫底
        legend.update(sc.get('legend') or {})
        for ch, ent in (sc.get('legend') or {}).items():
            if len(ch) != 1:
                errs.append('场景 %s 的 legend 键 %r 不是单字符' % (sid, ch))
            if isinstance(ent, dict) and ent.get('interactable') and ent['interactable'] not in inter:
                errs.append('场景 %s 引用了不存在的物件 %s' % (sid, ent['interactable']))
        used = collections.Counter(''.join(tiles))
        missing = [c for c in sorted(used) if c not in legend]
        if missing:
            errs.append('场景 %s 里的字符 %s 不在图例里（会被当成墙；标准字符写进 config.defaultLegend）'
                        % (sid, ' '.join('%r x%d' % (c, used[c]) for c in missing)))
        for pr in (sc.get('props') or []):
            if pr.get('interactable') and pr['interactable'] not in inter:
                errs.append('场景 %s 的 prop 引用了不存在的物件 %s' % (sid, pr['interactable']))
            if not (0 <= int(pr.get('x', -1)) < w and 0 <= int(pr.get('y', -1)) < h):
                errs.append('场景 %s 的 prop 越界：%s,%s' % (sid, pr.get('x'), pr.get('y')))
        for ex in (sc.get('exits') or []):
            if ex.get('to') and ex['to'] not in scenes:
                errs.append('场景 %s 的出口指向不存在的场景 %s' % (sid, ex['to']))
            if not (0 <= int(ex.get('x', -1)) < w and 0 <= int(ex.get('y', -1)) < h):
                errs.append('场景 %s 的出口坐标越界：%s,%s' % (sid, ex.get('x'), ex.get('y')))
            at, tgt = ex.get('at'), scenes.get(ex.get('to'))
            if at and tgt:
                tw = (tgt.get('size') or {}).get('w', 0); th = (tgt.get('size') or {}).get('h', 0)
                if not (0 <= int(at.get('x', -1)) < tw and 0 <= int(at.get('y', -1)) < th):
                    warns.append('场景 %s 的出口落点 %s,%s 不在目标场景 %s 里'
                                 % (sid, at.get('x'), at.get('y'), ex.get('to')))
        if not (sc.get('exits')):
            warns.append('场景 %s 没有 exits（孤岛）' % sid)

    for nid, n in npcs.items():
        if n.get('homeScene') and n['homeScene'] not in scenes:
            warns.append('NPC %s 的 homeScene 不存在：%s' % (nid, n['homeScene']))
        if n.get('dialogue') and n['dialogue'] not in dlg:
            warns.append('NPC %s 的对话不存在：%s' % (nid, n['dialogue']))
        if nid not in sch:
            warns.append('NPC %s 没有日程' % nid)
        sym = n.get('symbol')
        if sym is not None and len(str(sym)) != 1:
            errs.append('NPC %s 的 symbol %r 不是单字符' % (nid, sym))
        if not n.get('color'):
            warns.append('NPC %s 缺 color（渲染需要）' % nid)
    for who, s in sch.items():
        for slot in (s.get('slots') or s.get('schedule') or []):
            scn = slot.get('scene')
            if scn and scn not in scenes:
                warns.append('日程 %s 指向不存在的场景 %s' % (who, scn)); continue
            tgt = scenes.get(scn) or scenes.get((npcs.get(who) or {}).get('homeScene'))
            if tgt:
                tw = (tgt.get('size') or {}).get('w', 0); th = (tgt.get('size') or {}).get('h', 0)
                if not (0 <= int(slot.get('x', -1)) < tw and 0 <= int(slot.get('y', -1)) < th):
                    errs.append('日程 %s 的坐标越界：%s,%s' % (who, slot.get('x'), slot.get('y')))

    for did, d in dlg.items():
        nodes = d.get('nodes') or {}
        if d.get('entry') and d['entry'] not in nodes:
            errs.append('对话 %s 的 entry %s 不存在' % (did, d['entry']))
        for nid, node in nodes.items():
            for o in (node.get('options') or []):
                g = o.get('goto') or o.get('next')
                if g and g != 'end' and g not in nodes:
                    errs.append('对话 %s.%s 跳到不存在的节点 %s' % (did, nid, g))
            if node.get('next') and node['next'] != 'end' and node['next'] not in nodes:
                errs.append('对话 %s.%s 的 next 不存在' % (did, nid))

    for iid, it in inter.items():
        sym = it.get('symbol')
        if not sym: errs.append('物件 %s 缺 symbol' % iid)
        elif len(str(sym)) != 1: errs.append('物件 %s 的 symbol 不是单字符' % iid)
        for e in (it.get('onInteract') or []):
            if isinstance(e, dict) and e.get('type') == 'open_view' and e.get('view') not in views:
                warns.append('物件 %s 打开不存在的视图 %s' % (iid, e.get('view')))

    # 地图规则（和 tools/gen_maps.py 共用一套）：门宽 / 边框 / 四角 / 连通 / 开敞率
    try:
        import map_rules as _MR
        _res = _MR.check_all(sp)
        for _sid, _msgs in _res['errors'].items():
            for _m in _msgs: errs.append('[%s] %s' % (_sid, _m))
        for _sid, _msgs in _res['warnings'].items():
            for _m in _msgs: warns.append('[%s] %s' % (_sid, _m))
    except Exception as _e:
        warns.append('地图规则检查没跑起来：%s' % _e)

    stats = {'场景': len(scenes), '人': len(npcs), '对话': len(dlg),
             '物件': len(inter), '视图': len(views), '日程': len(sch)}
    return errs, warns, stats


def run(base_path, mod_paths, mods_dir, quiet=False):
    """读基础内容 ->（可选）合并 mod -> 校验 -> 打印。返回退出码。"""
    sp = json.load(io.open(base_path, encoding='utf-8-sig'))   # 带 BOM 也吃得下

    if looks_like_mod(sp):
        # 以前这里会输出「场景 0 …… 错误 0 / 警告 0」的假通过，现在明确拒绝。
        sys.stderr.write(
            '× %s 看起来是一个 **mod 文件**（有 manifest/data，没有 scenes），不是基础内容。\n'
            '  拿它单独校验只会得到「场景 0 / 错误 0」的假通过，什么都验不出来。\n'
            '  正确用法：python tools/validate_space.py --mods %s\n'
            '  （它会把这个 mod 合并进 content/space.json，再校验合并后的结果）\n'
            % (os.path.relpath(base_path, ROOT), os.path.relpath(base_path, ROOT)))
        return 2

    paths = list(mod_paths or [])
    report = None
    if mods_dir or paths:
        import space_merge
        if mods_dir:
            if not os.path.isdir(mods_dir):
                sys.stderr.write('× 目录不存在：%s\n' % mods_dir); return 2
            paths = space_merge.find_mods(mods_dir) + paths
        if not paths:
            sys.stderr.write('× %s 里没找到任何 mod（认 mod.json / manifest.json）\n' % mods_dir); return 2
        mods, trace = [], []
        for p in paths:
            try:
                mods.append(space_merge.load_mod(p))
            except Exception as e:
                sys.stderr.write('× 读不了 mod %s：%s\n' % (p, e)); return 2
        sp, report = space_merge.merge_all(sp, mods, trace=trace)
        if not quiet:
            print('合并 %d 个 mod：%s' % (len(report['mods']), [m['id'] for m in report['mods']]))
            for t in trace:
                print('   %-18s %-16s %+d -> %d' % (t['mod'], t['block'], t['delta'], t['total']))

    errs, warns, stats = validate(sp, base_path)
    if report:
        # 合并期的问题（撞 id / 没声明 allowRemove 就删 / 条目没 id）也要算进结论，
        # 否则「校验通过」会漏掉 mod 层最常踩的坑。
        errs = list(report['errors']) + errs
        warns = list(report['warnings']) + warns

    print('文件 %s' % os.path.relpath(base_path, ROOT))
    print('  场景 %d / 人 %d / 对话 %d / 物件 %d / 视图 %d / 日程 %d'
          % (stats['场景'], stats['人'], stats['对话'], stats['物件'], stats['视图'], stats['日程']))
    for e in errs: print('  [错误] ' + e)
    for w2 in warns: print('  [警告] ' + w2)
    print('  错误 %d / 警告 %d' % (len(errs), len(warns)))
    return 1 if errs else 0


def main(argv):
    base_path, mod_paths, mods_dir, quiet = DEFAULT_SPEC, [], None, False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--mods':
            i += 1
            while i < len(argv) and not argv[i].startswith('--'):
                mod_paths.append(argv[i]); i += 1
            continue
        if a == '--mods-dir':
            i += 1
            mods_dir = argv[i] if i < len(argv) else None
            i += 1
            continue
        if a == '--quiet':
            quiet = True; i += 1; continue
        if a.startswith('--'):
            sys.stderr.write('× 未知参数 %s\n用法见文件头\n' % a); return 2
        base_path = a; i += 1
    if not os.path.isfile(base_path):
        sys.stderr.write('× 文件不存在：%s\n' % base_path); return 2
    return run(base_path, mod_paths, mods_dir, quiet)


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
