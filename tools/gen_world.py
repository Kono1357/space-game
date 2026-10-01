# -*- coding: utf-8 -*-
"""世界生成器：一个种子 -> 一个可玩的世界（多站点 + 场景 + 穿梭机 + 星图节点 + 站点战略动作）。

用法：
  python tools/gen_world.py --seed gw1 --sites 18            # 写到 mods/generated_world/mod.json
  python tools/gen_world.py --seed gw1 --sites 18 --stdout   # 打到 stdout
  python tools/gen_world.py --selftest                       # 确定性 / 结构自检

设计：
- 站点（site）= 1 个星系节点（Stellaris 层：归属 / 舰队 / 污染）+ 2~3 张互相连通的地图（Dwarf Fortress 式生成）。
- 每个站点一条穿梭机目的地；空间站里有一个「世界地图终端」，进去可以勘测 / 宣示 / 殖民 / 交涉 / 开战。
- 五个全局指令（勘测 / 宣示 / 殖民 / 交涉 / 开战）都带 progress，按 M 能看进度条。
- 每个站点注入站内内容：1 个 NPC（日程 + 对话 + 到达事件）+ 1 个采集点（可重复作业）+ 阅读弹层。
- 产物是一个标准 mod（CDDA 式扩展）：F2 可以直接装，也可以整个换成别的 seed 的世界。
"""
import json, sys, os, re, math, random, argparse
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gen_maps as GM
import map_rules as MR

SEP = '-'           # 站点名的分隔符（ASCII，避免 ASCII 映射后标题对不上）
DOT = '\u25cf'      # 实心圆
RING = '\u25cb'     # 空心圆
FILL = '\u25c9'     # 靶心
ARR = '\u2192'      # 右箭头

KIND_CN = {'station': '空间站', 'colony': '殖民地', 'surface': '地表', 'ship': '舰内', 'rift': '裂隙'}
PART_CN = ['入口', '内区', '深处', '外层']
STATE_CN = {0: '未勘测', 1: '已勘测', 2: '已宣示', 3: '已殖民', 4: '已交涉', 5: '已交战'}
KIND_HAZARD = {
    'station': '这里没有天气，只有循环的空气。',
    'colony': '定居点外面就是没有边界的荒地。',
    'surface': '地表有风、有尘，还有要花力气去量的危险。',
    'ship': '它是一艘停在轨道上的旧船，舱壁一直在响。',
    'rift': '离裂隙越近，仪器越安静。',
}

NEAR_OWNERS = ['player_remnant', 'veil_pact', 'free_miners', 'scavenger_league']
MID_OWNERS  = ['vega_compact', 'alpha_traders', 'free_miners', 'scavenger_league', 'veil_pact']
FAR_OWNERS  = ['abyss', 'iron_chorus', 'silent_order', 'old_empire']
MARK = {'player_remnant': DOT, 'abyss': FILL, 'iron_chorus': FILL, 'silent_order': FILL}


def owner_relation(owner):
    if owner == 'player_remnant': return '自己人'
    if owner in ('abyss', 'iron_chorus', 'silent_order'): return '敌对'
    return '中立'

# ---------------------------------------------------------------- 命名（文化驱动）
# 名字不再来自一个全局音节池：每套「文化」有自己的词表，站点按**归属派系**选文化，
# 所以深渊的地名、铁合唱的地名、残响议会的地名听起来是三拨人起的名。
# 词表在 content/space.json 的 nameCultures 块里 —— **mod 可以加新语言，不用改这个文件**。
KIND_SUF = {
    'station': ['前哨', '中继站', '观测点', '锚地'],
    'colony':  ['殖民地', '星区', '穹顶', '驿站'],
    'surface': ['荒野', '星区', '观测点', '穹顶'],
    'ship':    ['残骸区', '锚地', '驿站'],
    'rift':    ['裂隙带', '荒野', '观测点'],
}
SUF_ALL = sorted({s for v in KIND_SUF.values() for s in v})

# 内容里没有 nameCultures 时的兜底（老 spec / 坏数据只降级不崩）。
# 词表就是改造前那套音节池，保证「没有文化表」时生成的还是能看的名字。
FALLBACK_CULTURE = {
    'id': 'fallback', 'name': '通用语',
    'desc': '内容里没写 nameCultures 时的兜底词表。',
    'placeA': list('索安铁静弧尘帷孤长冷织南北深微回灰白锈极远旧寒晨裂环灯烬'),
    'placeB': ['尔', '台', '河', '港', '湾', '星', '矿', '门', '谷', '原', '塞', '礁', '场', '镜',
               '丘', '关', '庭', '川', '岭', '洲', '隼', '锚', '哨', '脊', ''],
    'personA': list('索安铁静弧尘帷孤长冷织南北深微回灰白锈极远旧寒晨裂环灯烬'),
    'personB': ['尔', '台', '河', '港', '湾', '星', '矿', '门', '谷', '原', '塞', '礁'],
}


def load_cultures(space=None):
    """读出文化表 -> (按派系索引, 文化表, 兜底文化, 问题列表)。

    坏数据只降级：缺字段的文化跳过并记一条问题，生成不崩（VISION 第 4 条不变量）。
    """
    space = space if space is not None else GM.SPACE
    blk = space.get('nameCultures')
    if isinstance(blk, list): raw = blk
    elif isinstance(blk, dict): raw = blk.get('list') or []
    else: raw = []
    cults, by_owner, problems = [], {}, []
    for c in raw:
        if not isinstance(c, dict) or not c.get('id'):
            problems.append('nameCultures 里有条目缺少 id，已跳过'); continue
        if not c.get('placeA') or not c.get('personA'):
            problems.append('文化 %s 缺 placeA / personA（地名 / 人名的用词表），已跳过' % c['id']); continue
        cults.append(c)
        for o in (c.get('owners') or []):
            if o in by_owner:
                problems.append('派系 %s 同时被文化 %s 和 %s 认领，用后者'
                                % (o, by_owner[o]['id'], c['id']))
            by_owner[o] = c
    fb_id = blk.get('fallback') if isinstance(blk, dict) else None
    fb = next((c for c in cults if c['id'] == fb_id), None)
    if fb is None:
        fb = cults[0] if cults else FALLBACK_CULTURE
        if cults and fb_id:
            problems.append('nameCultures.fallback=%s 不存在，改用 %s' % (fb_id, fb['id']))
    if not cults:
        problems.append('内容里没有可用的 nameCultures，已回退到内置通用语')
    return by_owner, cults, fb, problems


def culture_for(by_owner, fallback, owner):
    """这个派系说哪套话。没有认领者就走兜底（不报错，但 --selftest 会提示）。"""
    return by_owner.get(owner) or fallback


def person_name(rnd, cult):
    """人名 = 首字 + 尾字；尾字里允许空字符串，就是「这个名字只有一个字」"""
    return rnd.choice(cult['personA']) + rnd.choice(cult.get('personB') or [''])


def place_name(rnd, used, cult, kind):
    """地名 = 词干（可带一个后缀字）+ 分隔符 + 类型词。
    类型词按站点种类挑（裂隙带不会被叫成中继站）。"""
    suf = KIND_SUF.get(kind) or SUF_ALL
    for _ in range(300):
        core = rnd.choice(cult['placeA'])
        if rnd.random() < 0.6:
            core += rnd.choice(cult.get('placeB') or [''])
        name = core + SEP + rnd.choice(suf)
        if name not in used:
            used.add(name); return name
    name = '未命名' + SEP + str(len(used) + 1); used.add(name); return name


def sid_of(seed):
    return re.sub(r'[^0-9A-Za-z_]', '_', str(seed)) or 'x'


def pick_kind(rnd, i, n):
    t = i / max(1, n - 1)
    if t < 0.34:   pool = ['station', 'station', 'colony', 'colony']
    elif t < 0.67: pool = ['surface', 'surface', 'colony', 'station', 'ship']
    else:          pool = ['rift', 'rift', 'surface', 'ship', 'colony']
    return rnd.choice(pool)


def pick_owner(rnd, t, kind):
    if kind == 'rift': return rnd.choice(['abyss', 'silent_order', 'abyss'])
    if t < 0.34: return rnd.choice(NEAR_OWNERS)
    if t < 0.67: return rnd.choice(MID_OWNERS)
    return rnd.choice(FAR_OWNERS)


def unique_name(rnd, used):
    """（旧的全局音节池命名，已被 place_name 取代，保留给外部脚本调用）"""
    for _ in range(300):
        name = rnd.choice(FALLBACK_CULTURE['placeA']) + rnd.choice(FALLBACK_CULTURE['placeB'])
        if rnd.random() < 0.5:
            name += rnd.choice(FALLBACK_CULTURE['placeA']) + rnd.choice(FALLBACK_CULTURE['placeB'])
        name += SEP + rnd.choice(SUF_ALL)
        if name not in used:
            used.add(name); return name
    name = '未知星区' + SEP + str(len(used) + 1); used.add(name); return name


def log(text, level='dim'): return {'type': 'log', 'text': text, 'level': level}
def cadd(c, n): return {'type': 'counter_add', 'counter': c, 'delta': n}
def cset(c, v): return {'type': 'counter_set', 'counter': c, 'value': v}
def fset(f): return {'type': 'flag_set', 'flag': f}
def nflag(f): return {'type': 'not', 'not': {'type': 'flag', 'flag': f}}
def fcond(f): return {'type': 'flag', 'flag': f}
def cnd(c, op, v): return {'type': 'counter', 'counter': c, 'op': op, 'value': v}
def allc(*parts): return {'type': 'all', 'all': list(parts)}


def narrative(rnd, name, kind_cn, owner, hz):
    return [
        name + '。一座' + kind_cn + '，坐标在索尔星系的边缘。',
        '它现在由 ' + owner + ' 看着。' + hz,
        rnd.choice([
            '登陆队说，风里有铁锈味。',
            '第一批脚印已经留在外面了。',
            '通讯里只有电流声，没有别的声音。',
            '地图上的等高线在这里忽然断掉。',
            '有人在墙面上刻了一行谁都不认识的字。',
        ]),
        rnd.choice([
            '如果这里能站住脚，索尔就多一只眼睛。',
            '值不值得为它花掉一支舰队，得看你。',
            '先勘测，还是先宣示，没人替你决定。',
            '远处有灯，但不确定是不是自己人。',
        ]),
    ]


SITE_NPC = {
    'station': {'role': '值班员', 'symbol': 's', 'color': 'npc2'},
    'colony':  {'role': '工头',   'symbol': 'k', 'color': 'npc3'},
    'surface': {'role': '勘探员', 'symbol': 'r', 'color': 'warn'},
    'ship':    {'role': '舰员',   'symbol': 'v', 'color': 'npc2'},
    'rift':    {'role': '观测员', 'symbol': 'o', 'color': 'abyss'},
}
SITE_OBJ = {
    'station': {'name': '中继控制台', 'symbol': 'T', 'color': 'accent', 'res': 'data',      'amount': 1,  'verb': '读取', 'unit': '数据 +1'},
    'colony':  {'name': '采集井',     'symbol': 'M', 'color': 'warn',   'res': 'alloy',     'amount': 5,  'verb': '采集', 'unit': '合金 +5'},
    'surface': {'name': '地表采样站', 'symbol': 'G', 'color': 'warn',   'res': 'ore_today', 'amount': 25, 'verb': '采样', 'unit': '今日矿石 +25'},
    'ship':    {'name': '打捞吊臂',   'symbol': 'C', 'color': 'accent', 'res': 'parts',     'amount': 8,  'verb': '打捞', 'unit': '零件 +8'},
    'rift':    {'name': '裂隙观测仪', 'symbol': 'O', 'color': 'abyss',  'res': 'data',      'amount': 2,  'verb': '观测', 'unit': '数据 +2（有风险）'},
}
EVENT_CAT = {'station': 'personnel', 'colony': 'colony', 'surface': 'resource', 'ship': 'fleet', 'rift': 'rift'}
SITE_NPC2 = {
    'station': {'role': '技师', 'symbol': 't', 'color': 'npc3'},
    'colony':  {'role': '农民', 'symbol': 'f', 'color': 'npc3'},
    'surface': {'role': '拾荒者', 'symbol': 'j', 'color': 'warn'},
    'ship':    {'role': '轮机长', 'symbol': 'e', 'color': 'npc2'},
    'rift':    {'role': '教徒', 'symbol': 'p', 'color': 'abyss'},
}
SITE_BLD = {
    'station': {'name': '船坞补给站', 'symbol': 'B', 'color': 'accent'},
    'colony':  {'name': '粮仓', 'symbol': 'F', 'color': 'good'},
    'surface': {'name': '信标塔', 'symbol': 'E', 'color': 'accent'},
    'ship':    {'name': '拆解台', 'symbol': 'D', 'color': 'warn'},
    'rift':    {'name': '封印桩', 'symbol': 'S', 'color': 'abyss'},
}
REGIONS = ['索尔内环', '帷幕前缘', '锈带', '孤灯外环']


def floor_cells(sc):
    out = []
    for y, row in enumerate(sc.get('tiles') or []):
        for x, ch in enumerate(row):
            if ch == '.': out.append((x, y))
    return out


def wall_cells(sc):
    out = []
    tiles = sc.get('tiles') or []
    h = len(tiles); w = len(tiles[0]) if h else 0
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            if tiles[y][x] not in ('#', '^'): continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                if tiles[y + dy][x + dx] in ('.', '+'): out.append((x, y)); break
    return out


def pick_open_floor(sc, rnd, avoid):
    tiles = sc.get('tiles') or []
    cells = [c for c in floor_cells(sc) if c not in avoid]
    if not cells: return None
    def open_n(c):
        x, y = c; k = 0
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            if 0 <= y + dy < len(tiles) and 0 <= x + dx < len(tiles[0]) and tiles[y + dy][x + dx] in ('.', '+'): k += 1
        return k
    cells.sort(key=lambda c: -open_n(c))
    return rnd.choice(cells[:max(1, len(cells) // 2)])


def npc_greeting(owner):
    if owner == 'player_remnant': return '你是从索尔来的人？'
    if owner in ('abyss', 'iron_chorus', 'silent_order', 'old_empire'): return '站住。这里是 ' + owner + ' 的地界。'
    return '你怎么会走到这里？'


def make_npc_dialogue(dlg_id, npc_id, npc_name, name, kind, owner, narr, n):
    work = {
        'station': '那边的中继控制台还能用，去按一下就有数据。',
        'colony': '采集井还出料，缺合金就去拉一车。',
        'surface': '地表采样站就在旁边，去采一份样，记得留神风。',
        'ship': '打捞吊臂还能动，去吊一件下来。',
        'rift': '观测仪在响。要看可以，别站太久。',
    }[kind]
    return {'id': dlg_id, 'npcId': npc_id, 'entry': 'root', 'nodes': {
        'root': {'text': npc_greeting(owner) + ' 我是' + npc_name + '。', 'options': [
            {'text': '这里是什么地方？', 'goto': 'about'},
            {'text': '有什么可做的？', 'goto': 'work'},
            {'text': '跟我说说这里的传闻。', 'effects': [{'type': 'open_reader', 'title': name + ' 档案', 'text': ' '.join(narr)}], 'goto': 'end'},
            {'text': '（收下他递来的东西）', 'condition': nflag('gw_talk_' + n),
             'effects': [cadd('data', 1), fset('gw_talk_' + n),
                         log('【站点】' + npc_name + ' 塞给你一份手抄的记录（数据 +1）。', 'good')], 'goto': 'end'},
            {'text': '没什么。', 'goto': 'end'},
        ]},
        'about': {'text': narr[0] + narr[1], 'options': [
            {'text': '再说说别的。', 'goto': 'root'}, {'text': '明白了。', 'goto': 'end'}]},
        'work': {'text': work, 'options': [
            {'text': '我去看看。', 'goto': 'end'}, {'text': '再说说别的。', 'goto': 'root'}]},
        'end': {'text': '去吧。风小的时候就回来。', 'action': 'close_dialogue'},
    }}


def make_event_dialogue(dlg_id, npc_id, name, kind, owner, n):
    if kind == 'rift':
        text = '我们在 ' + name + ' 的观测仪里听到一段回声，它在重复我们三天前的通讯。'
        opts = [
            {'text': '完整记录，带回去（数据 +2）', 'effects': [cadd('data', 2), fset('gw_ev_' + n), log('【站点】把回声完整记了下来（数据 +2）。', 'good')], 'goto': 'a'},
            {'text': '关掉仪器，别回应（民情 +1）', 'effects': [cadd('morale', 1), fset('gw_ev_' + n), log('【站点】仪器被关掉，站上的人松了口气。', 'info')], 'goto': 'b'},
        ]
    elif kind == 'surface':
        text = '登陆队说 ' + name + ' 的地表下面有东西在动。要挖，还是先撤？'
        opts = [
            {'text': '挖开看看（今日矿石 +30）', 'effects': [cadd('ore_today', 30), fset('gw_ev_' + n), log('【站点】挖出一层富矿（今日矿石 +30）。', 'good')], 'goto': 'a'},
            {'text': '标记坐标，先撤（数据 +1）', 'effects': [cadd('data', 1), fset('gw_ev_' + n), log('【站点】坐标记进了星图（数据 +1）。', 'info')], 'goto': 'b'},
        ]
    elif kind == 'ship':
        text = '打捞队在一截旧船体里发现了一间还没断电的舱室。进去吗？'
        opts = [
            {'text': '进去（零件 +8）', 'effects': [cadd('parts', 8), fset('gw_ev_' + n), log('【站点】拆回一批零件（零件 +8）。', 'good')], 'goto': 'a'},
            {'text': '封起来，只做记录（数据 +1）', 'effects': [cadd('data', 1), fset('gw_ev_' + n), log('【站点】舱室被原地封存（数据 +1）。', 'info')], 'goto': 'b'},
        ]
    elif kind == 'colony':
        text = '殖民地的人围过来，问 ' + name + ' 到底算不算索尔的地。你怎么回？'
        opts = [
            {'text': '算，明天就立旗（合金 +5）', 'effects': [cadd('alloy', 5), fset('gw_ev_' + n), log('【站点】先遣队留下了一批合金（合金 +5）。', 'good')], 'goto': 'a'},
            {'text': '先等等，还要勘测（数据 +1）', 'effects': [cadd('data', 1), fset('gw_ev_' + n), log('【站点】你把决定推后，先记了数据（数据 +1）。', 'info')], 'goto': 'b'},
        ]
    else:
        text = name + ' 的值班员报告：中继里有一段没署名的通讯。'
        opts = [
            {'text': '解码它（数据 +2）', 'effects': [cadd('data', 2), fset('gw_ev_' + n), log('【站点】通讯被解开，是一段旧航图（数据 +2）。', 'good')], 'goto': 'a'},
            {'text': '只登记，不上报（民情 +1）', 'effects': [cadd('morale', 1), fset('gw_ev_' + n), log('【站点】你压下了这条通讯（民情 +1）。', 'info')], 'goto': 'b'},
        ]
    return {'id': dlg_id, 'npcId': npc_id, 'entry': 'root', 'nodes': {
        'root': {'text': text, 'options': opts},
        'a': {'text': '明白，就照你说的办。', 'options': [{'text': '好。', 'goto': 'end'}]},
        'b': {'text': '好，听你的。', 'options': [{'text': '嗯。', 'goto': 'end'}]},
        'end': {'text': '现场安静下来。', 'action': 'close_dialogue'},
    }}


def collect_effects(kind, obj, name):
    eff = [{'type': 'advance_ticks', 'ticks': 60}, cadd(obj['res'], obj['amount'])]
    if kind == 'surface': eff.append({'type': 'stat_add', 'stat': 'fatigue', 'delta': 3})
    if kind == 'rift':
        eff.append({'type': 'random', 'table': [
            {'weight': 3, 'effects': [cadd('pollution', 1), log('【观测】仪器过载，污染 +1。', 'warn')]},
            {'weight': 7, 'effects': []}]})
    eff.append(log('【' + obj['verb'] + '】' + name + '：' + obj['unit'] + '。', 'good'))
    eff.append({'type': 'hint', 'text': '这是可重复的作业，代价是时间；按 Esc 回地图。'})
    return eff


def building_lore(kind, name):
    return {
        'station': '备件、燃料、预备舰员都从这里过。',
        'colony': '这里的粮食决定了索尔能撑多久。',
        'surface': '它替索尔看着这片地表。',
        'ship': '旧船的每一块都能再拆一次。',
        'rift': '它压着地下的东西，不让它往上爬。',
    }[kind]


def make_npc2_dialogue(dlg_id, npc_id, npc_name, name, kind, narr, n):
    work = {
        'station': '补给站就在旁边，缺船就去整备。',
        'colony': '粮仓就在旁边，缺口粮就去调。',
        'surface': '信标塔就在旁边，上去发一次信号就有数据。',
        'ship': '拆解台就在旁边，旧舱段能拆出合金。',
        'rift': '封印桩就在旁边，合金够就去压一压。',
    }[kind]
    return {'id': dlg_id, 'npcId': npc_id, 'entry': 'root', 'nodes': {
        'root': {'text': '我是' + npc_name + '。这地方我熟。', 'options': [
            {'text': '你在忙什么？', 'goto': 'work'},
            {'text': '这边的传闻。', 'effects': [{'type': 'open_reader', 'title': name + ' 档案', 'text': ' '.join(narr)}], 'goto': 'end'},
            {'text': '（收下他递来的东西）', 'condition': nflag('gw_talk2_' + n),
             'effects': [cadd('data', 1), fset('gw_talk2_' + n), log('【站点】' + npc_name + ' 给你指了一处没登记过的矿点（数据 +1）。', 'good')], 'goto': 'end'},
            {'text': '再见。', 'goto': 'end'},
        ]},
        'work': {'text': work, 'options': [{'text': '我去看看。', 'goto': 'end'}, {'text': '再说说。', 'goto': 'root'}]},
        'end': {'text': '路上小心。', 'action': 'close_dialogue'},
    }}


def make_building_view(n, kind, name, narr):
    b = SITE_BLD[kind]
    if kind == 'station':
        acts = [{'text': '整备舰队 -10 合金  舰队 +1',
                 'condition': cnd('alloy', '>=', 10), 'cost': {'counter': 'alloy', 'amount': 10},
                 'effects': [cadd('fleets', 1), log('【补给站】' + name + '：一支预备舰补进了编制（合金 -10，舰队 +1）。', 'good')]}]
    elif kind == 'colony':
        acts = [{'text': '扩建农田 -15 合金  口粮 +6',
                 'condition': cnd('alloy', '>=', 15), 'cost': {'counter': 'alloy', 'amount': 15},
                 'effects': [cadd('food', 6), log('【粮仓】' + name + '：新开了一片田（合金 -15，口粮 +6）。', 'good')]}]
    elif kind == 'surface':
        acts = [{'text': '架设信标 -8 合金  数据 +2',
                 'condition': cnd('alloy', '>=', 8), 'cost': {'counter': 'alloy', 'amount': 8},
                 'effects': [cadd('data', 2), log('【信标塔】' + name + '：信号传回了索尔（合金 -8，数据 +2）。', 'good')]}]
    elif kind == 'ship':
        acts = [{'text': '拆解旧舱段  合金 +6  污染 +1',
                 'effects': [cadd('alloy', 6), cadd('pollution', 1), log('【拆解台】' + name + '：拆出可用合金（合金 +6，污染 +1）。', 'warn')]}]
    else:
        acts = [{'text': '加固封印 -25 合金  污染 -1',
                 'condition': allc(cnd('alloy', '>=', 25), cnd('pollution', '>=', 1), nflag('gw_seal_' + n)),
                 'cost': {'counter': 'alloy', 'amount': 25},
                 'effects': [fset('gw_seal_' + n), cadd('pollution', -1), log('【封印桩】' + name + '：压住了一处裂隙（合金 -25，污染 -1）。', 'good')]}]
    return {'id': 'gw_bld_' + n, 'title': b['name'] + ' ' + SEP + ' ' + name, 'width': 72,
            'lines': [' ' + b['name'] + '。' + building_lore(kind, name), '', ' 门口的牌子上写着：' + name + '。'],
            'actions': acts + [
                {'text': '阅读完整档案', 'effects': [{'type': 'open_reader', 'title': name + ' 档案', 'text': ' '.join(narr)}]},
                {'text': '关闭', 'effects': [{'type': 'close_view'}]}]}


def floor_action(under_id, name):
    return {'text': '地下开采（1 小时） 今日矿石 +20',
            'condition': {'type': 'scene', 'scene': under_id},
            'effects': [{'type': 'advance_ticks', 'ticks': 60}, cadd('ore_today', 20),
                        {'type': 'stat_add', 'stat': 'fatigue', 'delta': 3},
                        {'type': 'random', 'table': [
                            {'weight': 2, 'effects': [cadd('relic', 1), log('【地下】' + name + '：挖到一件旧帝国的残件（遗物 +1）。', 'good')]},
                            {'weight': 8, 'effects': []}]},
                        log('【地下】' + name + '：从矿脉里刨出一批矿石（今日矿石 +20）。', 'good'),
                        {'type': 'hint', 'text': '地下层可反复开采，代价是时间和疲劳。'}]}


def make_encounter(n, first, name, kind):
    flavor = {
        'station': '走廊尽头有人在低声争论。',
        'colony': '田里的水声停了一瞬。',
        'surface': '风把沙打在舱门上，一下，又一下。',
        'ship': '舱壁深处传来一声闷响。',
        'rift': '仪器自己亮了一下，又灭了。',
    }[kind]
    trouble = {
        'station': '有人把备件账做错了。',
        'colony': '配给出了点岔子。',
        'surface': '采样站的滤芯堵了。',
        'ship': '一段管线漏了。',
        'rift': '封印读数跳了一下。',
    }[kind]
    return {'id': 'gwh_enc_' + n, 'on': 'tick', 'every': 120, 'priority': 30,
            'condition': {'type': 'scene', 'scene': first},
            'effects': [{'type': 'random', 'table': [
                {'weight': 4, 'effects': []},
                {'weight': 2, 'effects': [log('【' + name + '】' + flavor, 'dim')]},
                {'weight': 2, 'effects': [cadd('data', 1), log('【' + name + '】' + flavor + ' 你顺手记了一笔（数据 +1）。', 'info')]},
                {'weight': 1, 'effects': [cadd('morale', -1), log('【' + name + '】' + trouble + '（民情 -1）。', 'warn')]},
            ]}]}


def build_site_content(rnd, s, i, kind, name, site_scenes, owner, narr, first, under_id, node_id, cult=None):
    if cult is None: cult = FALLBACK_CULTURE
    n = '%02d' % (i + 1)
    view_id = 'gw_site_' + n
    ids = {
        'npc': 'gwn_%s_%s' % (s, n), 'sch': 'gws_%s_%s' % (s, n), 'dlg': 'dlg_gw_%s_%s' % (s, n),
        'npc2': 'gw2_%s_%s' % (s, n), 'sch2': 'gws2_%s_%s' % (s, n), 'dlg2': 'dlg_gw2_%s_%s' % (s, n),
        'obj': 'gwo_%s_%s' % (s, n), 'ev': 'gwe_%s_%s' % (s, n),
        'evdlg': 'dlg_gwe_%s_%s' % (s, n), 'app': 'gwa_%s_%s' % (s, n),
        'bld': 'gwb_%s_%s' % (s, n), 'bldview': 'gw_bld_' + n,
        'fobj': 'gwf_%s_%s' % (s, n), 'enc': 'gwh_enc_%s_%s' % (s, n),
    }
    sc0 = site_scenes[0]
    under = [x for x in site_scenes if x['id'] == under_id][0]
    floors0 = floor_cells(sc0); walls0 = wall_cells(sc0)
    floorsU = floor_cells(under); wallsU = wall_cells(under)
    if not floors0 or not floorsU: return None
    used0 = set(); usedU = set()
    def solid(scene, pool, used):
        cand = [c for c in pool if c not in used]
        if cand:
            c = rnd.choice(cand); used.add(c); return c
        f = pick_open_floor(scene, rnd, used)
        if f: used.add(f)
        return f
    oxy = solid(sc0, walls0, used0); sxy = solid(sc0, walls0, used0); bxy = solid(sc0, walls0, used0)
    uxy = solid(under, wallsU, usedU)
    f1 = pick_open_floor(sc0, rnd, used0)
    if f1: used0.add(f1)
    f2 = pick_open_floor(sc0, rnd, used0)
    if f2: used0.add(f2)
    if not (oxy and sxy and bxy and uxy and f1 and f2): return None
    tpl = SITE_NPC[kind]
    npc_name = tpl['role'] + ' ' + person_name(rnd, cult)
    npc = {'id': ids['npc'], 'name': npc_name, 'symbol': tpl['symbol'], 'color': tpl['color'],
           'role': kind + '_keeper', 'faction': owner, 'homeScene': first, 'dialogue': ids['dlg'],
           'desc': '在 ' + name + ' 值守的人。'}
    sch = {'id': ids['sch'], 'npcId': ids['npc'],
           'slots': [{'hours': [0, 24], 'scene': first, 'x': f1[0], 'y': f1[1]}]}
    dlg = make_npc_dialogue(ids['dlg'], ids['npc'], npc_name, name, kind, owner, narr, n)
    tpl2 = SITE_NPC2[kind]
    npc2_name = tpl2['role'] + ' ' + person_name(rnd, cult)
    npc2 = {'id': ids['npc2'], 'name': npc2_name, 'symbol': tpl2['symbol'], 'color': tpl2['color'],
            'role': kind + '_specialist', 'faction': owner, 'homeScene': first, 'dialogue': ids['dlg2'],
            'desc': '在 ' + name + ' 干活的' + tpl2['role'] + '。'}
    sch2 = {'id': ids['sch2'], 'npcId': ids['npc2'],
            'slots': [{'hours': [0, 24], 'scene': first, 'x': f2[0], 'y': f2[1]}]}
    dlg2 = make_npc2_dialogue(ids['dlg2'], ids['npc2'], npc2_name, name, kind, narr, n)
    obj = SITE_OBJ[kind]
    inter = {'id': ids['obj'], 'name': obj['name'], 'symbol': obj['symbol'], 'color': obj['color'],
             'bg': 'panel2', 'passable': False, 'auto': False, 'priority': 26,
             'onInteract': [{'type': 'open_view', 'view': view_id}],
             'desc': obj['name'] + '：' + obj['verb'] + '这里能得到 ' + obj['unit'] + '。'}
    b = SITE_BLD[kind]
    bld = {'id': ids['bld'], 'name': b['name'], 'symbol': b['symbol'], 'color': b['color'],
           'bg': 'panel2', 'passable': False, 'auto': False, 'priority': 24,
           'onInteract': [{'type': 'open_view', 'view': ids['bldview']}],
           'desc': b['name'] + '：' + building_lore(kind, name)}
    bld_view = make_building_view(n, kind, name, narr)
    fobj = {'id': ids['fobj'], 'name': '地下矿脉', 'symbol': 'V', 'color': 'warn',
            'bg': 'panel2', 'passable': False, 'auto': False, 'priority': 24,
            'onInteract': [{'type': 'open_view', 'view': view_id}],
            'desc': '地下矿脉：可以反复开采，代价是时间和疲劳。'}
    ev = {'id': ids['ev'], 'name': '[站点] ' + name, 'category': EVENT_CAT[kind],
          'condition': {'type': 'all', 'all': [{'type': 'visited', 'scene': first}, nflag('gw_ev_' + n)]},
          'once': True, 'priority': 85, 'presentedBy': [ids['npc']], 'dialogue': ids['evdlg']}
    evdlg = make_event_dialogue(ids['evdlg'], ids['npc'], name, kind, owner, n)
    app = {'id': ids['app'], 'npcId': ids['npc'], 'condition': 'pending:' + ids['ev'],
           'dialogue': ids['evdlg'], 'priority': 95}
    collect = {'text': obj['verb'] + '（1 小时） ' + obj['unit'],
               'condition': {'type': 'scene', 'scene': first},
               'effects': collect_effects(kind, obj, name)}
    enc = make_encounter(n, first, name, kind)
    return {'npc': npc, 'schedule': sch, 'dialogue': dlg,
            'npc2': npc2, 'schedule2': sch2, 'dialogue2': dlg2,
            'interactable': inter, 'building': bld, 'buildingView': bld_view, 'floorObj': fobj,
            'tileEdit': {'x': oxy[0], 'y': oxy[1], 'interactable': ids['obj']},
            'shuttleEdit': {'x': sxy[0], 'y': sxy[1], 'interactable': 'shuttle_terminal'},
            'buildingEdit': {'x': bxy[0], 'y': bxy[1], 'interactable': ids['bld']},
            'floorEdit': {'x': uxy[0], 'y': uxy[1], 'interactable': ids['fobj']},
            'event': ev, 'eventDialogue': evdlg, 'approach': app, 'collect': collect, 'encounter': enc}


def site_actions(n, name, narr, node_id):
    return [
        {'text': '勘测登陆点（1 小时） 数据 +1',
         'condition': nflag('gw_svy_' + n),
         'effects': [{'type': 'advance_ticks', 'ticks': 60}, cadd('data', 1), fset('gw_svy_' + n),
                     cadd('gw_surveyed', 1), cset('gw_st_' + n, 1),
                     log('【勘测】' + name + '：登陆队带回了一手地形数据（数据 +1）。', 'good'),
                     {'type': 'hint', 'text': name + ' 已勘测。可以宣示主权，或和它打交道。'}]},
        {'text': '宣示主权 -20 合金',
         'condition': allc(fcond('gw_svy_' + n), nflag('gw_clm_' + n)),
         'cost': {'counter': 'alloy', 'amount': 20},
         'effects': [fset('gw_clm_' + n), cadd('gw_claimed', 1), cset('gw_st_' + n, 2), cadd('morale', 1),
                     {'type': 'galaxy_set', 'node': node_id, 'owner': 'player_remnant', 'relation': '自己人'},
                     log('【宣示】' + name + ' 升起了残响议会的旗（合金 -20，民情 +1）。', 'good')]},
        {'text': '建立殖民地 -30 合金 -5 口粮',
         'condition': allc(fcond('gw_clm_' + n), nflag('gw_col_' + n), cnd('alloy', '>=', 30), cnd('food', '>=', 5)),
         'cost': {'counter': 'alloy', 'amount': 30},
         'effects': [cadd('food', -5), fset('gw_col_' + n), cadd('gw_colonized', 1), cset('gw_st_' + n, 3), cadd('pop', 20),
                     {'type': 'galaxy_set', 'node': node_id, 'owner': 'player_remnant', 'relation': '自己人'},
                     log('【殖民】' + name + ' 打下第一批地基（合金 -30、口粮 -5、人口 +20）。', 'good')]},
        {'text': '交涉与结盟 -10 口粮',
         'condition': allc(fcond('gw_svy_' + n), nflag('gw_talk_' + n), cnd('food', '>=', 10)),
         'cost': {'counter': 'food', 'amount': 10},
         'effects': [fset('gw_talk_' + n), cadd('gw_relations', 1), cset('gw_st_' + n, 4), cadd('morale', 3),
                     {'type': 'galaxy_set', 'node': node_id, 'relation': '友好'},
                     log('【交涉】' + name + ' 愿意坐下来谈（口粮 -10、民情 +3）。', 'good')]},
        {'text': '开战威慑 -1 舰队',
         'condition': allc(fcond('gw_svy_' + n), nflag('gw_war_' + n), cnd('fleets', '>=', 1)),
         'cost': {'counter': 'fleets', 'amount': 1},
         'effects': [fset('gw_war_' + n), cadd('gw_wars', 1), cset('gw_st_' + n, 5), cadd('pollution', 1),
                     {'type': 'galaxy_set', 'node': node_id, 'relation': '敌对', 'fleets_add': -1, 'pollution_add': 1},
                     log('【交战】' + name + ' 方向开火，局势升级（舰队 -1、污染 +1）。', 'warn'),
                     {'type': 'hint', 'text': '交战会推高污染，也会挡住殖民和交涉。'}]},
        {'text': '阅读完整档案',
         'effects': [{'type': 'open_reader', 'title': name + ' 档案', 'text': ' '.join(narr)}]},
    ]


def hub_cell(scene_id='station_command'):
    """找一格「实心、且挨着可走格」的地方放世界地图终端。
    以前只扫内部（range(1, h-1)），中央大厅改成开阔大 hall 之后内部再没有 '#'，
    于是**每次都走兜底 (1,1)** —— 终端一直落在过道上，不是墙龛里，
    这也正是签入仓库的 mods/generated_world/mod.json 无法由代码复现的原因。
    现在先扫内部、再扫整张图，实在没有才兜底。"""
    for sc in GM.SPACE['scenes']['list']:
        if sc.get('id') != scene_id: continue
        tiles = sc.get('tiles') or []
        w = sc['size']['w']; h = sc['size']['h']
        for x0, x1, y0, y1 in ((1, w - 1, 1, h - 1), (0, w, 0, h)):
            for y in range(y0, y1):
                for x in range(x0, x1):
                    if tiles[y][x] != '#': continue
                    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and tiles[ny][nx] == '.':
                            return x, y
    return 1, 1


def build_site(rnd, s, i, sites, kind=None, cult=None):
    t = i / max(1, sites - 1)
    if kind is None: kind = pick_kind(rnd, i, sites)
    if cult is None: cult = FALLBACK_CULTURE
    name = place_name(rnd, SITE_NAMES, cult, kind)
    nsc = 2 if kind in ('surface', 'ship', 'rift') else rnd.choice([2, 3])
    u_id = 'gw_%s_s%02d_u' % (s, i + 1)
    for attempt in range(12):
        site_scenes = []
        for j in range(nsc):
            sc_id = 'gw_%s_s%02d_%s' % (s, i + 1, 'abcdef'[j])
            sc = GM.gen_scene(kind, '%s|%d|%d|%d' % (s, i, j, attempt), sc_id, 2)
            sc['name'] = name + SEP + PART_CN[j]
            sc['ambient'] = sc['ambient'] + '（' + name + '）'
            site_scenes.append(sc)
        under = GM.gen_scene('under', '%s|%d|under|%d' % (s, i, attempt), u_id, 2)
        under['name'] = name + SEP + '地下层'
        under['ambient'] = under['ambient'] + '（' + name + ' 地下）'
        site_scenes.append(under)
        trs, warns = GM.wire_scenes(site_scenes, [], GM.SPACE, GM.PASSABLE)
        reach = GM.reachable_scenes(site_scenes, site_scenes[0]['id'])
        free = [e for sc in site_scenes for e in (sc.get('exits') or []) if not e.get('to')]
        if not warns and len(reach) == nsc + 1 and not free:
            return kind, name, site_scenes, trs, u_id
    for sc in site_scenes:
        keep = []
        for e in (sc.get('exits') or []):
            if e.get('to'): keep.append(e)
            else:
                row = list(sc['tiles'][e['y']]); row[e['x']] = '#'; sc['tiles'][e['y']] = ''.join(row)
        sc['exits'] = keep
    return kind, name, site_scenes, trs, u_id


SITE_NAMES = set()


def generated_return_unsafe(doc):
    """生成期硬校验：每个生成场景都要能沿门走回一台穿梭机终端。
    生成站点的终端在首图，其余图由 wire_scenes 连过去；这里复核一遍。"""
    data = doc['data']
    scenes = {s['id']: s for s in data['scenes']['list'] if not s.get('_op')}
    adj = {sid: set() for sid in scenes}
    for s in scenes.values():
        for ex in (s.get('exits') or []):
            if ex.get('to') in scenes: adj[s['id']].add(ex['to'])
    term = set()
    for s in scenes.values():
        for ed in (s.get('tileEdits') or []):
            if isinstance(ed, dict) and ed.get('interactable') == 'shuttle_terminal': term.add(s['id'])
    unsafe = []
    for sid in scenes:
        seen = {sid}; st = [sid]
        while st:
            c = st.pop()
            for nx in adj.get(c, ()):
                if nx not in seen: seen.add(nx); st.append(nx)
        if not (seen & term): unsafe.append(sid)
    return unsafe


def make_world(seed, sites):
    global SITE_NAMES
    # 起名用的「已占用」集合先把**手写层已有的地名**装进去 ——
    # 这样生成出来的站点不会和 content/space.json 里那些手写节点（索尔 / 帷幕星云 / 铁砧…）重名。
    # 手写层和生成层从此是同一张命名表上的两批名字，而不是各说各话。
    SITE_NAMES = {n.get('name') for n in (GM.SPACE.get('galaxy') or {}).get('nodes', []) if n.get('name')}
    SITE_NAMES |= {(s.get('name') or '') for s in (GM.SPACE.get('scenes') or {}).get('list', [])}
    SITE_NAMES.discard('')
    by_owner, cults, fallback, cult_problems = load_cultures()
    rnd = random.Random('world|%s|%d' % (seed, sites))
    s = sid_of(seed)
    scenes, transitions, shuttles, rooms, nodes = [], [], [], [], []
    views, missions, counters, resources = [], [], {}, []
    npcs, schedules, dialogues, events, approaches, interactables, hooks = [], [], [], [], [], [], []

    for cid, cn in (('gw_surveyed', '指令：已勘测星区'), ('gw_claimed', '指令：已宣示主权'),
                    ('gw_colonized', '指令：已建立殖民地'), ('gw_relations', '指令：已缔结关系'),
                    ('gw_wars', '指令：已进入交战')):
        counters[cid] = 0
        resources.append({'id': cid, 'name': cn, 'amount': 0, 'unit': '处', 'carried': False})

    for i in range(sites):
        t = i / max(1, sites - 1)
        # 归属与种类都要在起名之前定：地名用的是**归属方**的语言。
        kind = pick_kind(rnd, i, sites)
        owner = pick_owner(rnd, t, kind)
        cult = culture_for(by_owner, fallback, owner)
        kind, name, site_scenes, trs, under_id = build_site(rnd, s, i, sites, kind, cult)
        scenes.extend(site_scenes); transitions.extend(trs)
        for sc in site_scenes:
            rooms.append({'id': sc['id'], 'name': sc['name'], 'scene': sc['id'], 'type': sc['type']})
        ang = i * 2.399963229728653
        rad = 3.0 + i * 1.05
        x = max(0, min(32, int(round(10 + rad * math.cos(ang)))))
        y = max(0, min(26, int(round(14 + rad * math.sin(ang)))))
        poll = rnd.randint(0, 2 if t < 0.34 else (4 if t < 0.67 else 8))
        fleets = rnd.randint(0, 3)
        first = site_scenes[0]['id']
        under = [z for z in site_scenes if z['id'] == under_id][0]
        cost = 60 + int(round(rad * 30 / 60.0) * 60)
        n = '%02d' % (i + 1)
        node_id = 'gw_%s_n%02d' % (s, i + 1)
        view_id = 'gw_site_' + n
        region = REGIONS[min(len(REGIONS) - 1, i * len(REGIONS) // max(1, sites))]
        narr = narrative(rnd, name, KIND_CN[kind], owner, KIND_HAZARD[kind])
        counters['gw_st_' + n] = 0
        resources.append({'id': 'gw_st_' + n, 'name': '站点状态：' + name, 'amount': 0, 'unit': '级', 'carried': False})

        content = build_site_content(rnd, s, i, kind, name, site_scenes, owner, narr, first, under_id, node_id, cult)
        if content is None:
            raise RuntimeError('站点 %d 放不下站内内容（没有可用的墙 / 地板格）' % (i + 1))
        npcs.append(content['npc']); schedules.append(content['schedule']); dialogues.append(content['dialogue'])
        npcs.append(content['npc2']); schedules.append(content['schedule2']); dialogues.append(content['dialogue2'])
        dialogues.append(content['eventDialogue'])
        interactables.extend([content['interactable'], content['building'], content['floorObj']])
        events.append(content['event']); approaches.append(content['approach']); hooks.append(content['encounter'])
        views.append(content['buildingView'])
        site_scenes[0].setdefault('tileEdits', []).extend([content['tileEdit'], content['shuttleEdit'], content['buildingEdit']])
        under.setdefault('tileEdits', []).append(content['floorEdit'])

        actions = site_actions(n, name, narr, node_id) + [
            content['collect'], floor_action(under_id, name),
            {'text': '返回索尔空间站（2 小时）',
             'condition': {'type': 'not', 'not': {'type': 'scene', 'scene': 'station_command'}},
             'effects': [{'type': 'travel', 'to': 'station_command', 'costTicks': 120},
                         log('【返航】穿梭机把你们带回索尔空间站。', 'info'),
                         {'type': 'close_view'}]},
            {'text': '关闭', 'effects': [{'type': 'close_view'}]}]
        views.append({
            'id': view_id, 'title': name, 'width': 78,
            'lines': [
                ' ' + name + '  ' + SEP + '  ' + KIND_CN[kind] + '  ' + SEP + '  ' + region,
                ' 归属 ' + owner + '   舰队 ' + str(fleets) + '   污染 ' + str(poll) + '%   距离 ' + str(int(round(rad))) + ' 跳',
                ' 状态：{counters.gw_st_' + n + '}（0 未勘测 / 1 已勘测 / 2 已宣示 / 3 已殖民 / 4 已交涉 / 5 已交战）',
                '',
                ' ' + narr[0],
                ' ' + narr[2],
                '',
                ' 站内有：' + content['interactable']['name'] + ' / ' + content['building']['name'] + ' / 地下层（走到跟前按 E）。',
                ' 战略动作：勘测 ' + ARR + ' 宣示 ' + ARR + ' 殖民 / 交涉 / 开战。按 L 看日志全文。',
            ],
            'actions': actions,
        })
        shuttles.append({
            'id': 'gw_%s_sh_%02d' % (s, i + 1), 'name': name, 'scene': first,
            'costTicks': cost, 'desc': '%s %s 距离 %d 跳 %s 归属 %s' % (KIND_CN[kind], SEP, int(round(rad)), SEP, owner),
            'mark': '>', 'locked': False,
        })
        nodes.append({
            'id': node_id, 'name': name, 'x': x, 'y': y, 'owner': owner,
            'relation': owner_relation(owner), 'region': region,
            'pollution': poll, 'fleets': fleets, 'mark': MARK.get(owner, RING),
            'desc': '生成世界' + SEP + KIND_CN[kind] + SEP + '%d 张图（含地下层）' % len(site_scenes), 'scene': first,
            'generated': True, 'view': view_id,
        })

    views.insert(0, {
        'id': 'gw_world_map', 'title': '世界地图终端', 'width': 82,
        'lines': [' 已知站点都在这里。选中一个，回车进入它的登陆点。',
                  ' 每个站点里可以做：勘测 / 宣示 / 殖民 / 交涉 / 开战；站内有 NPC、建筑、采集点和地下层。',
                  ' 按 M 看指令进度，按 L 看日志全文。', ''],
        'list': {'source': 'space.galaxy.nodes',
                 'rowCondition': {'type': 'row', 'path': 'generated', 'is': True},
                 'rowTemplate': ' {row.region}  {row.name}   {row.relation}   污染 {row.pollution}%',
                 'empty': '还没有已知站点。', 'selectable': True,
                 'onSelect': [{'type': 'open_view', 'view': '{row.view}'}]},
        'actions': [{'text': '查看指令进度', 'effects': [{'type': 'open_view', 'view': 'gw_orders'}]},
                    {'text': '关闭', 'effects': [{'type': 'close_view'}]}],
    })
    views.append({
        'id': 'gw_orders', 'title': '指令进度', 'width': 74,
        'lines': [
            ' 已勘测星区：{counters.gw_surveyed} / ' + str(sites),
            ' 已宣示主权：{counters.gw_claimed} / ' + str(sites),
            ' 已建立殖民地：{counters.gw_colonized} / ' + str(sites),
            ' 已缔结关系：{counters.gw_relations} / ' + str(sites),
            ' 已进入交战：{counters.gw_wars} / ' + str(sites),
            '',
            ' 进度也会出现在按 M 打开的「任务与指令」里。',
        ],
        'actions': [{'text': '关闭', 'effects': [{'type': 'close_view'}]}],
    })

    for mid, mn, cid, obj in (
        ('gw_mis_survey', '指令：勘测星区', 'gw_surveyed', '到每个站点的登陆点做一次勘测。'),
        ('gw_mis_claim', '指令：宣示主权', 'gw_claimed', '在已勘测的站点宣示主权。'),
        ('gw_mis_colony', '指令：建立殖民地', 'gw_colonized', '在已宣示的站点建立殖民地。'),
        ('gw_mis_talk', '指令：缔结关系', 'gw_relations', '和已勘测的站点交涉。'),
        ('gw_mis_war', '指令：交战威慑', 'gw_wars', '对已勘测的站点开战威慑。'),
    ):
        missions.append({'id': mid, 'name': mn, 'objective': obj, 'progress': {'counter': cid, 'target': sites}})

    hx, hy = hub_cell()
    interactables.append({'id': 'gw_world_terminal', 'name': '世界地图终端', 'symbol': 'W', 'color': 'npc2', 'bg': 'panel2',
                          'passable': False, 'auto': False, 'priority': 28,
                          'onInteract': [{'type': 'open_view', 'view': 'gw_world_map'}],
                          'desc': '查看已生成的站点，规划勘探、殖民与交涉。'})
    scene_patch = {'id': 'station_command', '_op': 'patch',
                   '_append': {'tileEdits': [{'x': hx, 'y': hy, 'interactable': 'gw_world_terminal'}]}}

    doc = {
        'id': 'generated_world', 'name': '生成世界（%d 站点）' % sites, 'version': '1.3.0',
        'priority': 5, 'author': 'tools/gen_world.py',
        'description': '程序生成的世界：%d 个站点、%d 张场景（含地下层）、%d 个星系节点、5 条战略指令；每个站点有 2 个 NPC / 建筑 / 采集点 / 随机遭遇 / 到达事件。用 tools/gen_world.py 换 seed 重新生成。' % (sites, len(scenes), len(nodes)),
        'defaultOp': 'append',
        'data': {
            'initialState': {'counters': counters},
            'resources': {'list': resources},
            'scenes': {'list': [scene_patch] + scenes},
            'sceneTransitions': {'list': transitions},
            'shuttles': {'list': shuttles},
            'rooms': {'list': rooms},
            'galaxy': {'nodes': nodes},
            'interactables': {'list': interactables},
            'views': {'list': views},
            'missions': {'list': missions},
            'npcs': {'list': npcs},
            'schedules': {'list': schedules},
            'dialogues': {'list': dialogues},
            'events': {'list': events},
            'npcApproach': {'list': approaches},
            'hooks': {'list': hooks},
        },
    }
    unsafe = generated_return_unsafe(doc)
    base_unsafe = MR.return_safety(GM.SPACE)
    if unsafe or base_unsafe:
        raise RuntimeError('回程不安全：生成 %r / base %r（生成器拒绝产出会单向卡死的世界）' % (unsafe[:3], base_unsafe[:3]))
    return doc


def selftest():
    bad = []
    a = json.dumps(make_world('selftest', 6), ensure_ascii=False, sort_keys=True)
    b = json.dumps(make_world('selftest', 6), ensure_ascii=False, sort_keys=True)
    if a != b: bad.append('同 seed 两次生成不一致（不幂等）')
    d = json.loads(a); data = d['data']; sites = 6
    sc = [x for x in data['scenes']['list'] if not x.get('_op')]
    sh = data['shuttles']['list']; nd = data['galaxy']['nodes']
    if len(sh) != sites or len(nd) != sites: bad.append('站点 / 节点数不对')
    if len(sc) < sites * 3: bad.append('场景数少于 站点 x 3（主图 + 地下层）')
    if len(sc) != sites * 3 and len(sc) < sites * 3: bad.append('地下层缺失')
    if len(data['interactables']['list']) != sites * 3 + 1: bad.append('采集点 / 建筑 / 地下矿脉 / 世界地图终端数不对')
    if len(data['npcs']['list']) != sites * 2: bad.append('站点 NPC 数不对（应为 2/站）')
    if len(data['schedules']['list']) != sites * 2: bad.append('站点日程数不对')
    if len(data['dialogues']['list']) != sites * 3: bad.append('站点对话数不对（2 NPC + 到达事件）')
    if len(data['events']['list']) != sites: bad.append('站点事件数不对')
    if len(data['npcApproach']['list']) != sites: bad.append('站点上报规则数不对')
    if len(data['hooks']['list']) != sites: bad.append('随机遭遇钩子数不对')
    if len(data['views']['list']) != sites * 2 + 2: bad.append('视图数不对（站点档案 + 建筑 + 世界地图 + 指令）')
    ids = []
    for key in ('scenes', 'shuttles', 'interactables', 'views', 'npcs', 'dialogues', 'events', 'npcApproach', 'hooks', 'missions', 'resources'):
        rows = data[key].get('list', []) if isinstance(data.get(key), dict) else []
        for r in rows:
            if isinstance(r, dict) and 'id' in r: ids.append(r['id'])
    for r in data['galaxy']['nodes']:
        if 'id' in r: ids.append(r['id'])
    if len(ids) != len(set(ids)): bad.append('id 有重复')
    gu = generated_return_unsafe(d)
    if gu: bad.append('有生成场景回不了穿梭机终端：' + ','.join(gu[:3]))
    bu = MR.return_safety(GM.SPACE)
    if bu: bad.append('base 内容回程不安全：' + ','.join(bu[:3]))
    for sch in data['schedules']['list']:
        for slot in sch.get('slots', []):
            scn = [x for x in data['scenes']['list'] if x.get('id') == slot['scene']]
            if not scn: bad.append('日程场景不存在 ' + slot['scene']); continue
            row = scn[0]['tiles'][slot['y']]
            if slot['x'] >= len(row) or row[slot['x']] != '.': bad.append('日程点不是地板 ' + sch['id'])
    # ---- 命名（第 2 期）：文化表要真的被用上，而且不许和手写层撞车 ----
    by_owner, cults, fallback, cult_problems = load_cultures()
    for p in cult_problems:
        bad.append('文化表：' + p)
    hand = {n.get('name') for n in (GM.SPACE.get('galaxy') or {}).get('nodes', []) if n.get('name')}
    site_names = [n['name'] for n in nd]
    if len(site_names) != len(set(site_names)):
        dup = [x for x in site_names if site_names.count(x) > 1]
        bad.append('站点名有重复：' + ','.join(sorted(set(dup))[:3]))
    clash = sorted(set(site_names) & hand)
    if clash: bad.append('生成的地名和手写层重名：' + ','.join(clash[:3]))
    words = {c['id']: (set(c['placeA']) | set(c.get('placeB') or [])) for c in cults}
    for n in nd:
        o = n.get('owner')
        if o not in by_owner:
            bad.append('派系 %s 没有认领任何文化（会走兜底 %s）' % (o, fallback['id'])); continue
        c = by_owner[o]
        stem = n['name'].split(SEP)[0]
        # 词干必须由「这个派系的文化的词」拼出来（允许 A、A+B 两种长度）
        a = [w for w in c['placeA'] if stem.startswith(w)]
        if not a:
            bad.append('%s（%s）的名字 %s 用了 %s 的词表以外的字' % (n['name'], o, stem, c['id'])); continue
        rest = stem[len(max(a, key=len)):]
        if rest and rest not in set(c.get('placeB') or []):
            bad.append('%s（%s）的词干后缀 %r 不在 %s 的 placeB 里' % (n['name'], o, rest, c['id']))
        suf = n['name'].split(SEP)[-1]
        if suf not in SUF_ALL:
            bad.append('%s 的类型词 %s 不认识' % (n['name'], suf))
    print('世界生成自检：%s' % ('OK' if not bad else '失败 %d' % len(bad)))
    for x in bad: print('  ' + x)
    return 1 if bad else 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--seed', default='gw1')
    ap.add_argument('--sites', type=int, default=18)
    ap.add_argument('--out', default='')
    ap.add_argument('--stdout', action='store_true')
    ap.add_argument('--selftest', action='store_true')
    a = ap.parse_args()
    if a.selftest: return selftest()
    doc = make_world(a.seed, a.sites)
    txt = json.dumps(doc, ensure_ascii=False, indent=1)
    if a.stdout:
        print(txt); return 0
    out = a.out or os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'mods', 'generated_world', 'mod.json')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    open(out, 'w', encoding='utf-8', newline='').write(txt)
    gen_scenes = [s for s in doc['data']['scenes']['list'] if not s.get('_op')]
    print('生成世界：%d 站点 / %d 场景 / %d 视图 -> %s' % (a.sites, len(gen_scenes), len(doc['data']['views']['list']), out))
    return 0


if __name__ == '__main__':
    sys.exit(main())
