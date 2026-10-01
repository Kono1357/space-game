# -*- coding: utf-8 -*-
"""起一个新 mod 的骨架：拿 tools/starter_mod.json 当底子，把 id / 名字换成你的。

用法:
  python tools/scaffold_mod.py                        # mods/my_mod/mod.json（名字：我的 mod）
  python tools/scaffold_mod.py 我的房间
  python tools/scaffold_mod.py 我的房间 --id my_room --door-y 12
  python tools/scaffold_mod.py 我的房间 --dir D:/tmp/my_mod --force

生成之后：
  1) 直接改 mods/<你的 id>/mod.json  （每个块里都有 _howToAdd 教你这一块能放什么）
  2) python build_space.py           （把它编进 space-text.html）
  3) node tests/run_all.js           （回归：内容、连通性、门、对话、块登记表都会替你查）
  4) 或者不改文件：把 mod.json 粘进游戏的 F2 面板，点「应用并重载」热加载，进度保留
"""
import argparse, io, json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = os.path.join(ROOT, 'tools', 'starter_mod.json')

# 起手 mod 里的 id 一律换成你的，避免和别的 mod 撞车（模板里的门开在环形走廊西墙）
RENAMES = ['starter_mod', 'my_room', 'my_terminal', 'my_view', 'npc_my_guest', 'dialogue_my_guest',
           'sch_my_guest', 'my_hello', 'hook_my_first', 'hook_my_terminal', 'myNotes', 'note_1', 'note_2']
TEXT_RENAMES = [('我的房间', '{name}'), ('我的客人', '{name}客人'), ('我的终端', '{name}终端'),
                ('起手 mod（照着改就行）', '{name}'), ('我记的事', '{name}记录'),
                ('这是我加的房间', '{name}：这是我加的房间')]


def slug(s):
    s = re.sub(r'[^0-9a-zA-Z_]+', '_', str(s)).strip('_').lower()
    return s or 'my_mod'


def new_id(old, mid, room):
    # 前缀要分家：人 / 日程 / 对话 / 钩子 各自独立，别撞成一个 id
    fixed = {
        'starter_mod': mid,
        'my_room': room,
        'my_terminal': room + '_terminal',
        'my_view': room + '_view',
        'npc_my_guest': 'npc_' + room + '_guest',
        'dialogue_my_guest': 'dialogue_' + room + '_guest',
        'sch_my_guest': 'sch_' + room + '_guest',
        'my_hello': room + '_hello',
        'hook_my_first': 'hook_' + room + '_first',
        'hook_my_terminal': 'hook_' + room + '_terminal',
        'myNotes': room + '_notes',
        'note_1': room + '_note_1',
        'note_2': room + '_note_2',
    }
    return fixed.get(old, old)


def main():
    ap = argparse.ArgumentParser(description='生成一个能跑的 mod 骨架')
    ap.add_argument('name', nargs='?', default='我的 mod', help='给玩家看的名字（也是房间名）')
    ap.add_argument('--id', dest='mid', default=None, help='mod id（默认由名字转写）')
    ap.add_argument('--door-y', dest='door_y', type=int, default=None,
                    help='在环形走廊西墙上开门的那一行（默认按 id 算，避免和别的 mod 撞门）')
    ap.add_argument('--dir', dest='outdir', default=None, help='输出目录（默认 mods/<id>/）')
    ap.add_argument('--force', action='store_true', help='目录已存在也覆盖')
    args = ap.parse_args()

    mid = slug(args.mid or args.name)
    room = mid if mid.endswith('_room') else mid + '_room'
    door_y = args.door_y if args.door_y is not None else 8 + (sum(ord(c) for c in mid) % 12)
    if not (1 <= door_y <= 34):
        sys.exit('--door-y 要在 1..34 之间（环形走廊西墙那一列）')
    outdir = args.outdir or os.path.join(ROOT, 'mods', mid)
    outfile = os.path.join(outdir, 'mod.json')
    if os.path.exists(outfile) and not args.force:
        sys.exit('已经存在：%s\n（要覆盖就加 --force）' % outfile)
    if not os.path.isfile(BASE):
        sys.exit('找不到底子：%s' % BASE)

    text = io.open(BASE, encoding='utf-8').read()
    for old in sorted(RENAMES, key=len, reverse=True):        # 长的先换，避免子串打架
        text = text.replace(old, new_id(old, mid, room))
    for old, tmpl in TEXT_RENAMES:
        text = text.replace(old, tmpl.format(name=args.name))
    text = text.replace('"y": 10', '"y": %d' % door_y)         # 门那一行 + 走廊里的落点
    data = json.loads(text)                                    # 顺手确认没改坏
    if data.get('id') != mid:
        sys.exit('内部错误：id 没换成 %s' % mid)

    if not os.path.isdir(outdir):
        os.makedirs(outdir)
    io.open(outfile, 'w', encoding='utf-8', newline='').write(json.dumps(data, indent=1, ensure_ascii=False))

    print('已生成 %s' % outfile)
    print('  mod id   %s' % mid)
    print('  房间 id  %s      （环形走廊的门开在 0,%d）' % (room, door_y))
    print('')
    print('下一步：')
    print('  1) 打开它改内容（每个块都有 _howToAdd；tiles 每行长度必须等于 size.w）')
    print('  2) python build_space.py   ->   node tests/run_all.js')
    print('  3) 或者把这份 JSON 粘进游戏的 F2 面板，点「应用并重载」（热加载，进度保留）')
    print('  4) 想画新字符就写进这个场景的 legend；# . + * h 这些标准字符不用写')
    return 0


if __name__ == '__main__':
    sys.exit(main())
