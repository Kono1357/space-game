# -*- coding: utf-8 -*-
"""不开浏览器校验空间层内容（纯数据层，不需要 Node）。

用法:  python tools/validate_space.py content/space.json
       python tools/validate_space.py            （默认 content/space.json）

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
不管什么：引擎的真编译结果（NPC 寻路、交互）  那些看 node tests/test_world.js
  node tests/test_world.js   （世界层回归：房间连通 / 门能走通 / 终端能开 ）
"""
import io, json, sys, collections
sys.dont_write_bytecode = True    # 别在仓库里生成 __pycache__

def aslist(b):
    if b is None: return []
    if isinstance(b, list): return b
    if isinstance(b, dict): return b.get('list') or b.get('options') or b.get('items') or []
    return []

def main(path):
    sp = json.load(io.open(path, encoding='utf-8-sig'))   # 带 BOM 也吃得下
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
        import os as _os
        _here = _os.path.dirname(_os.path.abspath(__file__))
        if _here not in sys.path: sys.path.insert(0, _here)
        import map_rules as _MR
        _res = _MR.check_all(sp)
        for _sid, _msgs in _res['errors'].items():
            for _m in _msgs: errs.append('[%s] %s' % (_sid, _m))
        for _sid, _msgs in _res['warnings'].items():
            for _m in _msgs: warns.append('[%s] %s' % (_sid, _m))
    except Exception as _e:
        warns.append('地图规则检查没跑起来：%s' % _e)

    print('文件 %s' % path)
    print('  场景 %d / 人 %d / 对话 %d / 物件 %d / 视图 %d / 日程 %d'
          % (len(scenes), len(npcs), len(dlg), len(inter), len(views), len(sch)))
    for e in errs: print('  [错误] ' + e)
    for w2 in warns: print('  [警告] ' + w2)
    print('  错误 %d / 警告 %d' % (len(errs), len(warns)))
    return 1 if errs else 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else 'content/space.json'))
