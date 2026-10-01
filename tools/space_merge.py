# -*- coding: utf-8 -*-
"""把「基础内容 + 一串 mod」合并成最终内容（纯 Python，不需要 Node）。

为什么要有这个文件：
    mod 的合并语义本来只写在引擎里（engine/space-core.js 的 normalizeSpace /
    applyMod / mergeBlock / mergeAtPath / patchItem / deepMerge）。
    Python 侧的校验器（tools/validate_space.py）和构建器（build_space.py）
    **看不懂 mod**，于是会出现最坏的情况：
       玩家写了个 mod -> 校验器说「错误 0 / 警告 0」-> 进游戏地图整片变实心。
    （实测：python tools/validate_space.py mods/example_mod/mod.json
      输出「场景 0 / 人 0 / 对话 0 ... 错误 0 / 警告 0」，是**静默假通过**。）

   所以这里把引擎那套合并语义逐条移植过来，让「校验合并后的结果」成为可能。

不重复造真值：
   SPACE_BLOCKS / NESTED_BLOCKS **从 engine/space-core.js 里读**，不在这里抄一份。
   加了新块只要改引擎，Python 这边自动跟上；解析不出来就直接报错，绝不静默兜底。

和引擎的一致性靠 tests/test_merge_parity.js 保证：
   同一批 mod 分别喂给引擎和这里，两边合并结果的 JSON 必须一模一样。

用法：
   from space_merge import merge_all, load_mods
   space, report = merge_all(base, [mod1, mod2, ...])
"""
import io, json, os, re, sys

sys.dont_write_bytecode = True

_HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(_HERE)
CORE_JS = os.path.join(ROOT, 'engine', 'space-core.js')


# ---------------------------------------------------------------- 登记表（从 JS 读）
def _read_block_lists(core_js=CORE_JS):
    src = io.open(core_js, encoding='utf-8-sig').read()

    def grab(name):
        m = re.search(r'var\s+%s\s*=\s*\[(.*?)\]\s*;' % name, src, re.S)
        if not m:
            raise RuntimeError(
                'space_merge: 在 %s 里找不到 %s 的声明 —— 登记表是和内核的唯一真值来源，'
                '解析不出来就不能继续（别在 Python 里另抄一份）' % (os.path.basename(core_js), name))
        return [s for s in re.findall(r"'([^']*)'", m.group(1))]

    blocks, nested = grab('SPACE_BLOCKS'), grab('NESTED_BLOCKS')
    if not blocks or not nested:
        raise RuntimeError('space_merge: 登记表解析出来是空的，脚本或引擎的写法变了，先看一眼')
    return blocks, nested


SPACE_BLOCKS, NESTED_BLOCKS = _read_block_lists()


# ---------------------------------------------------------------- 和 JS 对齐的小工具
def is_obj(v):
    return isinstance(v, dict)


def is_arr(v):
    return isinstance(v, list)


def clone(v):
    """引擎用的是 JSON.parse(JSON.stringify(v))，语义就是「只留 JSON 装得下的东西」"""
    return json.loads(json.dumps(v)) if v is not None else None


def js_truthy(v):
    """JS 的真假值：{} 和 [] 为真，'' / 0 / None 为假（Python 里 {} 是假，这里要对齐）"""
    if v is None or v is False:
        return False
    if v is True:
        return True
    if isinstance(v, (int, float)):
        return v != 0
    if isinstance(v, str):
        return v != ''
    return True


def js_str(v, default=None):
    """引擎的 str(v, d)：None/undefined 取默认值，否则 String(v)"""
    if v is None:
        return '' if default is None else default
    if v is True:
        return 'true'
    if v is False:
        return 'false'
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v)


def _idkey(v):
    """JS 里对象的键一律是字符串（m[1] 和 m['1'] 是同一个键），Python 里要对齐"""
    return js_str(v)


def as_list(block):
    if block is None:
        return []
    if is_arr(block):
        return block
    if is_obj(block):
        for k in ('list', 'options', 'items'):
            if is_arr(block.get(k)):
                return block[k]
    return []


def by_id(lst):
    m = {}
    for it in lst:
        if is_obj(it) and it.get('id') is not None:
            m[_idkey(it['id'])] = it
    return m


# ---------------------------------------------------------------- 合并
def deep_merge(base, patch):
    """逐字对齐引擎的 deepMerge（mergeArrays 在引擎里从没被打开过，所以不支持）"""
    if not is_obj(base) or not is_obj(patch):
        return clone(base if patch is None else patch)
    out = clone(base)
    for k, pv in patch.items():
        bv = out.get(k)
        if is_obj(pv) and is_obj(bv):
            out[k] = deep_merge(bv, pv)
        else:
            out[k] = clone(pv)
    return out


def patch_item(base, patch):
    p2 = clone(patch)
    app = p2.pop('_append', None)
    out = deep_merge(base, p2)
    if is_obj(app):
        for k, av in app.items():
            if is_arr(av):
                cur = out.get(k)
                out[k] = (cur if is_arr(cur) else []) + clone(av)
            elif is_obj(av):
                cur = out.get(k)
                out[k] = deep_merge(cur if is_obj(cur) else {}, av)
    return out


def _find_identity(lst, target):
    """引擎用 indexOf（对象比的是「同一个引用」），Python 的 list.index 比的是相等，要对齐"""
    for i, x in enumerate(lst):
        if x is target:
            return i
    return -1


def merge_block(container, incoming, mod_meta, report):
    lst = as_list(container)
    inc = as_list(incoming)
    index = by_id(lst)
    default_op = js_str((mod_meta or {}).get('defaultOp'), 'append')
    mod_id = js_str((mod_meta or {}).get('id'), '?')
    for raw in inc:
        item = clone(raw)
        if not is_obj(item) or 'id' not in item:
            report['warnings'].append('mod[%s] 条目缺少 id，已跳过' % mod_id)
            continue
        op = js_str(item['_op'], default_op) if item.get('_op') is not None else default_op
        item.pop('_op', None)
        key = _idkey(item['id'])
        cur = index.get(key)
        if cur is None:
            if op == 'remove':
                report['warnings'].append('mod[%s] 要删除的 %s 不存在，已跳过' % (mod_id, item['id']))
                continue
            lst.append(item)
            index[key] = item
            continue
        pos = _find_identity(lst, cur)
        if pos < 0:                       # 理论上到不了；真到了说明 list 和 index 脱节了
            report['errors'].append('mod[%s] 条目 %s 的索引对不上（合并器内部不一致）' % (mod_id, item['id']))
            continue
        if op == 'replace':
            lst[pos] = item
            index[key] = item
        elif op == 'patch':
            merged = patch_item(cur, item)
            lst[pos] = merged
            index[key] = merged
        elif op == 'remove':
            if js_truthy((mod_meta or {}).get('allowRemove')):
                lst.pop(pos)
                index.pop(key, None)
            else:
                report['warnings'].append(
                    'mod[%s] 试图删除 %s，但未声明 allowRemove，已忽略' % (mod_id, item['id']))
        else:
            report['warnings'].append(
                'mod[%s] 条目 %s 已存在，append 模式不覆盖（要用 _op:"patch"）' % (mod_id, item['id']))
    return lst


def merge_at_path(space, path, incoming, mod_meta, report):
    parts = str(path).split('.')
    cur = space
    for p in parts[:-1]:
        if not is_obj(cur.get(p)):
            cur[p] = {}
        cur = cur[p]
    last = parts[-1]
    if is_arr(cur.get(last)):
        cur[last] = merge_block({'list': cur[last]}, incoming, mod_meta, report)
    else:
        if not is_obj(cur.get(last)):
            cur[last] = {'list': []}
        if not is_arr(cur[last].get('list')):
            cur[last]['list'] = as_list(cur[last])
        cur[last]['list'] = merge_block(cur[last], incoming, mod_meta, report)
    return cur[last]


def normalize_space(raw):
    space = clone(raw) if is_obj(raw) else {}
    for k in SPACE_BLOCKS:
        if k not in space:
            space[k] = {'list': []}
        elif not is_obj(space[k]):
            space[k] = {'list': as_list(space[k])}
        elif 'list' not in space[k]:
            space[k]['list'] = as_list(space[k])
    for k in ('config', 'palette', 'presets'):
        if not is_obj(space.get(k)):
            space[k] = {}
    return space


def apply_mod(space, mod, report):
    meta = mod.get('manifest') if is_obj(mod.get('manifest')) else mod
    if mod.get('data') is not None:
        data = mod['data']
    elif mod.get('content') is not None:
        data = mod['content']
    else:
        data = {}
    if not is_obj(data):
        data = {}
    report['mods'].append({
        'id': js_str(meta.get('id'), 'unnamed'),
        'name': js_str(meta.get('name'), ''),
        'version': js_str(meta.get('version'), '1'),
        'blocks': list(data.keys()),
    })
    for k in ('config', 'palette', 'presets'):
        if is_obj(meta.get(k)):
            space[k] = deep_merge(space[k], meta[k])
    for key, val in data.items():
        if key in SPACE_BLOCKS:
            space[key]['list'] = merge_block(space[key], val, meta, report)
            if is_obj(val):
                for sub in val:
                    if sub == 'list':
                        continue
                    path = key + '.' + sub
                    if path in NESTED_BLOCKS:
                        merge_at_path(space, path, val[sub], meta, report)
                    elif sub.startswith('_'):
                        if space[key].get(sub) is None:
                            space[key][sub] = clone(val[sub])
                    elif is_obj(val[sub]) and is_obj(space[key].get(sub)):
                        space[key][sub] = deep_merge(space[key][sub], val[sub])
                    else:
                        space[key][sub] = clone(val[sub])
                if val.get('_howToAdd') and not space[key].get('_howToAdd'):
                    space[key]['_howToAdd'] = val['_howToAdd']
                if val.get('_example') and not space[key].get('_example'):
                    space[key]['_example'] = val['_example']
            continue
        if key in NESTED_BLOCKS:
            merge_at_path(space, key, val, meta, report)
            continue
        if is_obj(val):
            rest, nested = {}, []
            for sk, sv in val.items():
                if (key + '.' + sk) in NESTED_BLOCKS:
                    nested.append(sk)
                else:
                    rest[sk] = sv
            space[key] = deep_merge(space[key], rest) if is_obj(space.get(key)) else clone(rest)
            for nk in nested:
                merge_at_path(space, key + '.' + nk, val[nk], meta, report)
        else:
            space[key] = clone(val)


def sort_mods(mods):
    """引擎按 (priority, order) 升序排（稳定的），数字大的后合并因而占上风"""
    def key(m):
        meta = m.get('manifest') if is_obj(m.get('manifest')) else m
        return (_num(meta.get('priority'), 0), _num(meta.get('order'), 0))
    return sorted(mods, key=key)


def _num(v, d):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return d
    if f != f or f in (float('inf'), float('-inf')):
        return d
    return f


def merge_all(base_space, mods, trace=None):
    """base 内容 + 一串 mod -> (合并后的 space, 报告)

    报告结构对齐引擎的 report：{'warnings': [...], 'errors': [...], 'mods': [...]}
    trace 传一个 list 的话，会往里塞每一条「谁改了哪个块」（给冲突报告用）。
    """
    report = {'warnings': [], 'errors': [], 'mods': []}
    space = normalize_space(base_space)
    for mod in sort_mods(mods or []):
        meta = mod.get('manifest') if is_obj(mod.get('manifest')) else mod
        mid = js_str(meta.get('id'), '?')
        before = {k: len(as_list(space.get(k))) for k in SPACE_BLOCKS}
        try:
            apply_mod(space, mod, report)
        except Exception as e:                                  # 引擎那边也是 try/catch 记错误继续
            report['errors'].append('mod[%s] 合并失败：%s' % (mid, e))
            continue
        if trace is not None:
            for k in SPACE_BLOCKS:
                delta = len(as_list(space.get(k))) - before[k]
                if delta:
                    trace.append({'mod': mid, 'block': k, 'delta': delta,
                                  'total': len(as_list(space.get(k)))})
    return space, report


# ---------------------------------------------------------------- 找 mod / 读 mod
def find_mods(mods_dir):
    """和 build_space.py 的扫描口径一致：mods/* 里认 mod.json 或 manifest.json"""
    found = []
    if not os.path.isdir(mods_dir):
        return found
    for name in sorted(os.listdir(mods_dir)):
        d = os.path.join(mods_dir, name)
        if not os.path.isdir(d):
            continue
        for fn in ('mod.json', 'manifest.json'):
            p = os.path.join(d, fn)
            if os.path.isfile(p):
                found.append(p)
                break
    return found


def load_mod(path):
    """读一个 mod 文件成引擎吃的形状：{manifest, data}"""
    raw = json.load(io.open(path, encoding='utf-8-sig'))
    if not is_obj(raw):
        raise ValueError('%s 不是一个 JSON 对象' % path)
    if is_obj(raw.get('manifest')):
        return raw
    data = raw.get('data')
    if is_obj(data):
        manifest = {k: v for k, v in raw.items() if k != 'data'}
        return {'manifest': manifest, 'data': data}
    d = os.path.dirname(os.path.abspath(path))
    sibling = os.path.join(d, 'content.json')       # build_space.py 也认这种拆开放法
    if os.path.isfile(sibling):
        manifest = {k: v for k, v in raw.items() if k != 'data'}
        return {'manifest': manifest, 'data': json.load(io.open(sibling, encoding='utf-8-sig'))}
    return {'manifest': raw, 'data': {}}


def describe_conflicts(report):
    """把「同 id 撞车」这类问题从 warnings 里挑出来单独列 —— 这是新手最容易踩且最难自查的"""
    out = []
    for w in report['warnings']:
        if 'append 模式不覆盖' in w or '试图删除' in w:
            out.append(w)
    return out


if __name__ == '__main__':
    argv = sys.argv[1:]

    # 给 tests/test_merge_parity.js 用：把合并结果按「键排序」吐成 JSON，
    # 好和引擎那边的结果做逐字节比较（两边都排序，就不会被键序差异干扰）。
    if argv and argv[0] == '--dump-json':
        if len(argv) < 2:
            sys.exit('用法: python tools/space_merge.py --dump-json <基础内容.json> [mod.json ...]')
        base_obj = json.load(io.open(argv[1], encoding='utf-8-sig'))
        mod_objs = [load_mod(p) for p in argv[2:]]
        merged, rep = merge_all(base_obj, mod_objs)
        sys.stdout.write(json.dumps(merged, sort_keys=True, ensure_ascii=False,
                                    separators=(',', ':')))
        sys.exit(0)

    # 自检：能让命令行直接看合并结果
    base = json.load(io.open(os.path.join(ROOT, 'content', 'space.json'), encoding='utf-8-sig'))
    paths = argv or find_mods(os.path.join(ROOT, 'mods'))
    mods = [load_mod(p) for p in paths]
    space, report = merge_all(base, mods)
    print('并入 %d 个 mod：%s' % (len(report['mods']), [m['id'] for m in report['mods']]))
    for k in SPACE_BLOCKS:
        n = len(as_list(space.get(k)))
        b = len(as_list(base.get(k)))
        if n != b:
            print('  %-20s %d -> %d' % (k, b, n))
    print('  错误 %d / 警告 %d' % (len(report['errors']), len(report['warnings'])))
    for m in describe_conflicts(report):
        print('  [冲突] ' + m)
