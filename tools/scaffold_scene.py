# -*- coding: utf-8 -*-
"""tools/scaffold_scene.py  生成一个「能走」的随机星站（gen_maps 的薄封装）。

用法：
  python tools/scaffold_scene.py --scenes 3 --seed demo --wire --out mods/demo_station/mod.json
  python tools/scaffold_scene.py --scenes 4 --seed abc --type station     # 打到 stdout
产物是一个标准 mod（manifest + data），可以直接放进 mods/ 或粘进游戏 F2。
--wire 默认开启：门会被配对、落点会算好、sceneTransitions 会一起写出来（跑两次结果一样）。
"""
import argparse, json, os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_maps as G


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--scenes', type=int, default=3)
    ap.add_argument('--seed', default='demo')
    ap.add_argument('--type', default='station', choices=sorted(G.KINDS.keys()))
    ap.add_argument('--id', default='')
    ap.add_argument('--name', default='')
    ap.add_argument('--wire', dest='wire', action='store_true', default=True)
    ap.add_argument('--no-wire', dest='wire', action='store_false')
    ap.add_argument('--out', default='')
    a = ap.parse_args()

    mid = a.id or ('gen_station_' + str(a.seed))
    scenes = G.gen_station_set(a.scenes, str(a.seed), a.type)
    for i, s in enumerate(scenes):
        s['id'] = '%s_%d' % (mid, i + 1)
        s['name'] = '%s %d 号舱' % (a.name or '生成站', i + 1)
    trs, warns = ([], [])
    if a.wire:
        trs, warns = G.wire_scenes(scenes, [], G.SPACE, G.PASSABLE)
    for w in warns: print('[警告] ' + w, file=sys.stderr)
    seen = G.reachable_scenes(scenes, scenes[0]['id'])
    free = [1 for s in scenes for d in G.scene_doors(s) if not d.get('to')]
    print('生成 %d 张图 / %d 条过场 / 连通 %d-%d / 没接线的门 %d'
          % (len(scenes), len(trs), len(seen), len(scenes), len(free)), file=sys.stderr)
    doc = {'id': mid, 'name': (a.name or '生成站'), 'version': '1',
           'data': {'scenes': {'list': scenes}, 'sceneTransitions': {'list': trs}}}
    txt = json.dumps(doc, ensure_ascii=False, indent=1)
    if a.out:
        d = os.path.dirname(os.path.abspath(a.out))
        if d and not os.path.isdir(d): os.makedirs(d)
        open(a.out, 'w', encoding='utf-8', newline='').write(txt)
        print('已写出 ' + a.out)
    else:
        print(txt)
    return 0 if (not a.wire or len(free) == 0) else 1


if __name__ == '__main__':
    sys.exit(main())