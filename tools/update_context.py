# -*- coding: utf-8 -*-
"""重算 AI_CONTEXT.md 里「能自动推导的部分」，其他段落一字不动。

刷新范围（只碰这些）：
  1. 头部：生成时间戳、生成时基线（测试数）
  2. 第 0 节摘要：测试数、块登记表数量、内容条数（场景/人/对话/事件）
  3. 第 2 节文件结构：文件树（行数 / KB；二进制文件标「二进制」）
  4. 第 3.3/3.4 节：回归项数、space-text.html 体积
  5. 附录 A：测试数与各文件项数
  6. 附录 B：整块重算（块计数表 + SPACE_BLOCKS/NESTED_BLOCKS 名单 + 词表计数）

用法:
  python tools/update_context.py              # 重算；测试红则不写
  python tools/update_context.py --check      # 只检查是否已同步（不改文件）：0=最新 3=会变
  python tools/update_context.py --quiet
  SPACE_NODE=/path/to/node python tools/update_context.py    # 指定 node（默认自动找）

幂等：仓库状态不变时跑一百次，文件字节不变（时间戳只在内容真的变了才刷新）。
测试红（失败 != 0）时：报错退出、不写文件。
"""
import argparse, collections, datetime, glob, hashlib, io, json, os, re, shutil, subprocess, sys

try:                                  # Windows 控制台默认 GBK：强制 UTF-8
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CTX = os.path.join(ROOT, "AI_CONTEXT.md")
SPACE = os.path.join(ROOT, "content", "space.json")
CORE = os.path.join(ROOT, "engine", "space-core.js")
OUT_HTML = os.path.join(ROOT, "space-text.html")
TZ = datetime.timezone(datetime.timedelta(hours=8))       # Asia/Shanghai
WALK_SKIP_DIRS = ("node_modules", ".git", "dist", "build", "__pycache__")
WALK_SKIP_FILES = ("tmp_", ".pyc")
MTIME_EXEMPT = ("space-text.html",)      # 构建产物：每次构建都重写，指纹只看体积不看 mtime
STAMP = os.path.join(ROOT, ".ctx_stamp")          # 仓库指纹（没变就跳过回归）


# ---------------------------------------------------------------- 工具
def find_node():
    """按 SPACE_NODE -> PATH -> 常见 bundled 位置 找 node。"""
    cands = []
    env = os.environ.get("SPACE_NODE")
    if env:
        cands.append(env)
    w = shutil.which("node")
    if w:
        cands.append(w)
    for pat in (os.path.expanduser("~/.dsh/dsh-runtimes/*/dependencies/node/bin/node.exe"),
                os.path.expanduser("~/.dsh/dsh-runtimes/*/dependencies/node/bin/node"),
                "C:/Users/*/.dsh/dsh-runtimes/*/dependencies/node/bin/node.exe",
                "/usr/local/bin/node", "/usr/bin/node", "/opt/homebrew/bin/node"):
        cands.extend(sorted(glob.glob(pat)))
    for c in cands:
        if c and os.path.isfile(c):
            return c
    return None


def read(path):
    return io.open(path, encoding="utf-8").read()


def fingerprint():
    """仓库指纹：所有被追踪文件的名字 + 体积 + mtime。没变就说明「上次同步之后没人动过东西」。"""
    items = []
    for root, dirs, files in os.walk(ROOT):
        dirs[:] = sorted(d for d in dirs if d not in WALK_SKIP_DIRS)
        for f in sorted(files):
            if f.startswith(WALK_SKIP_FILES) or f == os.path.basename(STAMP):
                continue
            full = os.path.join(root, f)
            try:
                st = os.stat(full)
            except OSError:
                continue
            rel = os.path.relpath(full, ROOT).replace("\\", "/")
            mt = 0 if os.path.basename(full) in MTIME_EXEMPT else st.st_mtime_ns
            items.append("%s|%d|%d" % (rel, st.st_size, mt))
    return hashlib.sha256("\n".join(items).encode("utf-8")).hexdigest()


def count_blocks(space):
    """所有块条数：先 {list} 块（按内容里的顺序），再 4 个嵌套块。"""
    stats = collections.OrderedDict()
    for k, v in space.items():
        if isinstance(v, dict) and isinstance(v.get("list"), list):
            stats[str(k)] = len(v["list"])
    for name, path in (("galaxy.nodes", ("galaxy", "nodes")),
                       ("techTree.branches", ("techTree", "branches")),
                       ("diplomacy.actions", ("diplomacy", "actions")),
                       ("tutorial.steps", ("tutorial", "steps"))):
        node = space.get(path[0])
        stats[name] = len(node.get(path[1], [])) if isinstance(node, dict) else 0
    return stats


def run_tests(node):
    """跑回归，返回 (通过, 失败, {文件: (通过,失败)}, 原文输出)。"""
    p = subprocess.run([node, "tests/run_all.js"], cwd=ROOT, capture_output=True)
    out = (p.stdout or b"").decode("utf-8", "replace") + (p.stderr or b"").decode("utf-8", "replace")
    per = collections.OrderedDict()
    for m in re.finditer(r"#{5,}\s*(\S+)\s*#{5,}\s*\n[^\n]*?通过 (\d+) / 失败 (\d+)", out):
        per[m.group(1)] = (int(m.group(2)), int(m.group(3)))
    tot = re.search(r"合计：通过 (\d+) / 失败 (\d+)", out)
    if not tot:
        return None, None, per, out
    return int(tot.group(1)), int(tot.group(2)), per, out


def file_rows(ctx_lines, ctx_bytes):
    """扫仓库生成文件树行（AI_CONTEXT.md 自己的行数/体积由调用方传进来，避免自指抖动）。"""
    rows = []
    for root, dirs, files in os.walk(ROOT):
        dirs[:] = sorted(d for d in dirs if d not in WALK_SKIP_DIRS)
        for f in sorted(files):
            if f.startswith(WALK_SKIP_FILES) or f == os.path.basename(STAMP):
                continue                                     # 缓存文件不进文件树
            full = os.path.join(root, f)
            rel = os.path.relpath(full, ROOT).replace("\\", "/")
            size = os.path.getsize(full)
            if rel == "AI_CONTEXT.md":
                # 自己的行数/体积用「候选内容」的统计（不是磁盘上的旧值），
                # 否则这一行永远差一次迭代，一次跑不收敛。
                rows.append((rel, ctx_lines, ctx_bytes))
                continue
            try:
                n = read(full).count("\n") + 1
            except Exception:
                n = -1                                        # 二进制
            rows.append((rel, n, size))
    rows.sort(key=lambda x: x[0])
    out = []
    for rel, n, size in rows:
        if n >= 0:
            out.append("  %-42s %6d 行 %8.1f KB" % (rel, n, size / 1024.0))
        else:
            out.append("  %-42s %6s %8.1f KB" % (rel, "二进制", size / 1024.0))
    return out


# ---------------------------------------------------------------- 各段重建
def patch_tree(text, ctx_lines, ctx_bytes):
    """重建第 2 节的文件树（含文件数）。"""
    m = re.search(r"\*\*文件结构（\d+ 个文件，行数实测）\*\*\n\n```\n(.*?)\n```", text, re.S)
    if not m:
        return text, False
    rows = file_rows(ctx_lines, ctx_bytes)
    new = "**文件结构（%d 个文件，行数实测）**\n\n```\n%s\n```" % (len(rows), "\n".join(rows))
    out = text[:m.start()] + new + text[m.end():]
    return out, out != text


def patch_appendix_b(text, space, stats, sb, nb, eff, cond, prov):
    """整块重建附录 B。"""
    m = re.search(r"## 附录 B .*?(?=\n## )", text, re.S)
    if not m:
        return text, False
    L = ["## 附录 B 数据块计数表（生成时现算）", "", "| 块 | 条数 | 形状 |", "|---|---|---|"]
    for k, n in stats.items():
        node = space.get(k)
        shape = "{list}" if (isinstance(node, dict) and "list" in node) else "嵌套数组"
        L.append("| `%s` | %d | %s |" % (k, n, shape))
    L.append("| `techTree.list` | %d | 嵌套（顶层块同名的 .list）|" % len(space["techTree"]["list"]))
    L += ["", "`SPACE_BLOCKS`（%d）：%s" % (len(sb), " ".join("`%s`" % x for x in sb)),
          "", "`NESTED_BLOCKS`（%d）：%s" % (len(nb), " ".join("`%s`" % x for x in nb)),
          "", "词表：效果词 %d 个、判定词 %d 个、视图提供者 %d 个。" % (len(eff), len(cond), len(prov))]
    out = text[:m.start()] + "\n".join(L) + text[m.end():]
    return out, out != text


def parse_engine():
    """从引擎里读出块登记表与词表（避免手抄）。"""
    core = read(CORE)
    sb_raw = re.search(r"var SPACE_BLOCKS = \[([\s\S]*?)\];", core).group(1)
    sb = [x.strip().strip("'") for x in sb_raw.replace("\n", " ").split(",") if x.strip()]
    nb = re.findall(r"'([\w.]+)'", re.search(r"var NESTED_BLOCKS = \[([^\]]*)\];", core).group(1))
    eff = re.findall(r"registerEffect\('([a-z_]+)'", core)
    cond = re.findall(r"registerCondition\('([a-z_]+)'", core)
    prov = re.findall(r"registerViewProvider\('([a-z_]+)'", core)
    return sb, nb, eff, cond, prov


def patch_numbers(text, ctx):
    """所有「数字」段落的定点替换（全部幂等）。"""
    before = text
    def sub1(pat, rep, cnt=0):
        nonlocal text
        text = re.sub(pat, rep, text, count=cnt)
    p, f = ctx["passed"], ctx["failed"]
    sub1(r"通过 \d+ / 失败 \d+", "通过 %d / 失败 %d" % (p, f))
    sub1(r"\*\*\d+ 项全绿\*\*", "**%d 项全绿**" % p)
    sub1(r"（\d+ 项全绿）", "（%d 项全绿）" % p)
    sub1(r"内容 \d+ 场景 / \d+ 人 / \d+ 段对话 / \d+ 条事件",
         "内容 %d 场景 / %d 人 / %d 段对话 / %d 条事件" % (ctx["scenes"], ctx["npcs"], ctx["dialogues"], ctx["events"]))
    sub1(r"（`SPACE_BLOCKS` \d+ \+ `NESTED_BLOCKS` \d+）",
         "（`SPACE_BLOCKS` %d + `NESTED_BLOCKS` %d）" % (ctx["n_blocks"], ctx["n_nested"]))
    sub1(r"（\d+ 文件 \d+ 项）", "（%d 文件 %d 项）" % (ctx["n_testfiles"], p))
    if ctx["per_line"]:
        sub1(r"测试文件与项数（实测）：[^\n]*", "测试文件与项数（实测）：" + ctx["per_line"])
    if ctx["html_kb"]:
        sub1(r"(space-text\.html`?\s+)[\d.]+ KB", lambda m: m.group(1) + ("%.1f KB" % ctx["html_kb"]))
    return text, text != before


def set_timestamp(text, ctx):
    ts = ctx["ts"]
    out = re.sub(r"生成时间：[\d\-: +]+", "生成时间：" + ts, text, count=1)
    return out


# ---------------------------------------------------------------- 主流程
def main():
    ap = argparse.ArgumentParser(description="重算 AI_CONTEXT.md 里可自动推导的数字与表格")
    ap.add_argument("--check", action="store_true", help="只检查是否已同步：0=最新，3=会变")
    ap.add_argument("--force", action="store_true", help="忽略仓库指纹，强制跑一遍回归再重算")
    ap.add_argument("--quiet", action="store_true")
    args = ap.parse_args()
    log = (lambda *a: None) if args.quiet else print

    if not os.path.isfile(CTX):
        print("[error] 找不到 %s" % CTX)
        return 2

    # 仓库指纹没变 -> 上次同步之后没人动过东西，不必再跑 46 秒回归
    fp = fingerprint()
    old_fp = read(STAMP).strip() if os.path.isfile(STAMP) else ""
    if fp == old_fp and not args.force:
        # 上次同步之后没人动过任何被追踪的文件 -> 文档必然还是同步的
        if args.check:
            log("[ok] AI_CONTEXT.md 已同步（仓库未变）")
        else:
            log("[ok] AI_CONTEXT.md 已是最新（仓库未变，跳过回归）")
        return 0

    space = json.loads(read(SPACE))
    stats = count_blocks(space)
    sb, nb, eff, cond, prov = parse_engine()

    node = find_node()
    if not node:
        print("[error] 找不到 node，跑不了回归就不知道该写什么数字（可用 SPACE_NODE=<node 路径> 指定）")
        return 2
    passed, failed, per, raw = run_tests(node)
    if failed is None:
        print("[error] 回归没有输出「合计：通过 N / 失败 M」，不更新（先手动跑一遍 node tests/run_all.js）")
        print(raw[-600:])
        return 2
    if failed != 0:
        print("[error] 测试未全绿（通过 %d / 失败 %d），按约定不更新 AI_CONTEXT.md" % (passed, failed))
        return 1
    # 性能预算被环境系数缩放过时，一定要说出来：否则「全绿」会被当成「代码没问题」。
    # 通过数是真跑出来的、和缩放无关；但性能类断言这次不作数。
    scaled = "\u26a0" in raw
    if scaled:
        print("[warn] 本次回归的性能预算被环境系数缩放过（tests/perf_budget.js）——")
        print("       通过数为真，但性能类断言不作数。要在开发机上复核：删掉 .perf_slack，"
              "或 SPACE_PERF_SLACK=1。")
    n_testfiles = len(per)

    text = read(CTX)
    old = text
    ctx = {
        "passed": passed, "failed": failed, "per_line": None, "html_kb": None,
        "scenes": len(space["scenes"]["list"]), "npcs": len(space["npcs"]["list"]),
        "dialogues": len(space["dialogues"]["list"]),
        "events": len(space["events"]["list"]),
        "n_blocks": len(sb), "n_nested": len(nb), "n_testfiles": n_testfiles,
        "ts": datetime.datetime.now(TZ).strftime("%Y-%m-%d %H:%M +08:00"),
    }
    # 各文件项数那一行
    order = ["test_space.js", "test_world.js", "test_arch.js", "test_text.js", "test_shell.js", "test_build.js",
             "test_merge_parity.js", "test_maprules_parity.js", "test_validate.js", "test_names.js",
             "test_terrain.js"]
    parts = []
    for name in order:
        if name in per:
            parts.append("%s %d 项" % (name.replace("test_", "").replace(".js", ""), per[name][0]))
    for name in per:
        if name not in order:
            parts.append("%s %d 项" % (name.replace("test_", "").replace(".js", ""), per[name][0]))
    ctx["per_line"] = "、".join(parts)
    if os.path.isfile(OUT_HTML):
        ctx["html_kb"] = os.path.getsize(OUT_HTML) / 1024.0

    # 1) 数字类替换（先用旧时间戳，好判断「是否真的变了」）
    text, ch1 = patch_numbers(text, ctx)
    # 2) 附录 B
    text, ch2 = patch_appendix_b(text, space, stats, sb, nb, eff, cond, prov)
    # 3) 文件树：AI_CONTEXT.md 自己的行数/体积会随上面两步变，迭代到稳定
    ch3 = False
    for _ in range(8):
        cand, changed = patch_tree(text, text.count("\n") + 1, len(text.encode("utf-8")))
        text = cand
        ch3 = ch3 or changed
        if not changed:
            break

    if text == old:
        io.open(STAMP, "w", encoding="utf-8", newline="\n").write(fingerprint())
        log("[ok] AI_CONTEXT.md 已是最新，没有改动（幂等）")
        return 0
    text = set_timestamp(text, ctx)
    if args.check:
        print("[warn] AI_CONTEXT.md 需要更新（数字或表格已过时）；跑 python tools/update_context.py")
        return 3
    io.open(CTX, "w", encoding="utf-8", newline="\n").write(text)
    io.open(STAMP, "w", encoding="utf-8", newline="\n").write(fingerprint())
    log("[ok] AI_CONTEXT.md 已更新：测试 %d 项%s、块 %d 个、文件 %d 个、时间戳 %s"
        % (passed, "全绿" if not scaled else "全绿（性能预算已缩放，非开发机数据）",
           len(stats), len(file_rows(text.count("\n") + 1, len(text.encode("utf-8")))), ctx["ts"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
