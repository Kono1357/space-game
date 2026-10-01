# -*- coding: utf-8 -*-
r"""把内容 + 引擎编译成单文件网页 space-text.html（纯文本模式，零 Canvas）。

用法：
    python build_space.py
    python build_space.py --spec x.json --mods ..\mods
    python build_space.py --kernel ..\zhanyi.json     # 顺便把兵棋内核挂上桥
"""
import io, json, os, re, sys, glob, subprocess
try:                                  # Windows 控制台默认 GBK：强制 UTF-8，避免打印生僻字符时崩
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.abspath(__file__))
TPL  = os.path.join(ROOT, 'space-text.tpl.html')
SPEC = os.path.join(ROOT, 'content', 'space.json')
OUT  = os.path.join(ROOT, 'space-text.html')
MODS = os.path.join(ROOT, 'mods')
ENGINE = {
    '/*__CORE__*/':    os.path.join(ROOT, 'engine', 'space-core.js'),
    '/*__TEXTOUT__*/': os.path.join(ROOT, 'engine', 'space-textout.js'),
    '/*__SHELL__*/':   os.path.join(ROOT, 'engine', 'space-textshell.js'),
}

def arg(name, default=None):
    if name in sys.argv:
        i = sys.argv.index(name)
        if i + 1 < len(sys.argv): return sys.argv[i + 1]
    return default

SPEC = arg('--spec', SPEC)
OUT  = arg('--out', OUT)
MODS = arg('--mods', MODS)
KERNEL = arg('--kernel', None)

def rd(p):
    # utf-8-sig：带不带 BOM 都能吃（Windows 下手写的 JSON 常常带 BOM）
    return io.open(p, encoding='utf-8-sig').read()

def safe(s):
    """只转义会提前闭合 <script> 的 </script>。
       绝不能像以前那样把所有 </ 都替换掉：代码里的正则 /</g 会被改成 /<\\/g 直接语法错误。"""
    return re.sub(r'</(script)', r'<\\/\1', s, flags=re.I)

def load_json(path, what):
    try:
        return json.load(io.open(path, encoding='utf-8-sig'))
    except IOError:
        sys.exit('%s 读不到：%s' % (what, path))
    except ValueError as e:
        sys.exit('%s 不是合法 JSON：%s\n  %s' % (what, path, e))

spec = load_json(SPEC, '内容')

mods = []
if os.path.isdir(MODS):
    for d in sorted(glob.glob(os.path.join(MODS, '*'))):
        if not os.path.isdir(d): continue
        man = None
        for cand in ('mod.json', 'manifest.json'):
            p2 = os.path.join(d, cand)
            if os.path.isfile(p2): man = load_json(p2, 'mod 清单'); break
        if man is None: continue
        data = man.pop('data', None)
        if data is None and 'content' in man: data = man.pop('content')
        if data is None:
            cp = os.path.join(d, 'content.json')
            data = load_json(cp, 'mod 内容') if os.path.isfile(cp) else {}
        mods.append({'manifest': man, 'data': data})

kernel_obj = {}
if KERNEL and os.path.isfile(KERNEL):
    k = load_json(KERNEL, '兵棋内核')
    kernel_obj = {'meta': k.get('meta', {}), 'CONTENT': k.get('CONTENT', {}), 'TEXT': k.get('TEXT', {})}

# 起手 mod：一并编进产物，游戏里按 F2 就能填进输入框（也是 tools/starter_mod.json 那一份）
starter_obj = None
starter_path = os.path.join(ROOT, 'tools', 'starter_mod.json')
if os.path.isfile(starter_path):
    starter_obj = load_json(starter_path, '起手 mod')

t = rd(TPL)
for ph, path in ENGINE.items():
    t = t.replace(ph, safe(rd(path)))
spec_js = 'window.SPACE_SPEC = ' + safe(json.dumps(spec, ensure_ascii=False, separators=(',', ':'))) + ';'
mods_js = 'window.SPACE_MODS = ' + safe(json.dumps(mods, ensure_ascii=False, separators=(',', ':'))) + ';'
kern_js = ''
if kernel_obj:
    kern_js = 'window.ZHANYI_KERNEL = ' + safe(json.dumps(kernel_obj, ensure_ascii=False, separators=(',', ':'))) + ';\n'
starter_js = ''
if starter_obj is not None:
    starter_js = 'window.SPACE_STARTER = ' + safe(json.dumps(starter_obj, ensure_ascii=False, separators=(',', ':'))) + ';\n'
t = t.replace('/*__SPEC__*/', kern_js + spec_js)
t = t.replace('/*__MODS__*/', mods_js + starter_js)

left = re.findall(r'/\*__[A-Z_]+__\*/', t)
if left:
    sys.exit('模板里还有没替换的占位符：' + str(left))

io.open(OUT, 'w', encoding='utf-8').write(t)

st = spec
def n(k):
    v = st.get(k)
    return len(v.get('list', v) if isinstance(v, dict) else (v or []))
print('内容  %s  %.1f KB' % (os.path.basename(SPEC), os.path.getsize(SPEC) / 1024.0))
print('  场景 %d / 物件 %d / 人 %d / 日程 %d / 对话 %d / 视图 %d / 穿梭机 %d / 事件 %d'
      % (n('scenes'), n('interactables'), n('npcs'), n('schedules'), n('dialogues'),
         n('views'), n('shuttles'), n('events')))
print('mod   %d 个 %s' % (len(mods), [m['manifest'].get('id') for m in mods]))
print('起手  %s' % ('tools/starter_mod.json 已编入（F2 -> 填入示例模板）' if starter_obj is not None else '没找到'))
print('内核  %s' % ('已挂桥' if kernel_obj else '未挂（可用 --kernel 挂上）'))
print('输出  %s  %.1f KB' % (os.path.basename(OUT), os.path.getsize(OUT) / 1024.0))

# ---------- 构建成功后同步 AI_CONTEXT.md（数字由脚本重算，见 CONTRIBUTING.md）----------
# 想快速迭代、暂时不同步： python build_space.py --no-context   或   set SPACE_NO_CONTEXT=1
if '--no-context' in sys.argv or os.environ.get('SPACE_NO_CONTEXT') == '1':
    print('文档  跳过同步（--no-context / SPACE_NO_CONTEXT=1）')
else:
    updater = os.path.join(ROOT, 'tools', 'update_context.py')
    if not os.path.isfile(updater):
        print('文档  跳过（找不到 tools/update_context.py）')
    else:
        try:
            env = dict(os.environ, PYTHONIOENCODING='utf-8')     # 强制子进程用 UTF-8 说话
            r = subprocess.run([sys.executable, updater], cwd=ROOT, capture_output=True, env=env)
            out = (r.stdout or b'').decode('utf-8', 'replace').strip()
            err = (r.stderr or b'').decode('utf-8', 'replace').strip()
            if out:
                print('文档  %s' % out)
            if r.returncode != 0:
                print('[warn] update_context.py 未完成（exit %d），AI_CONTEXT.md 可能过时' % r.returncode)
                if err:
                    print(err[:400])
        except Exception as e:                                   # 文档同步绝不能把构建搞崩
            print('[warn] 文档同步异常（构建本身没问题）：%s' % e)
