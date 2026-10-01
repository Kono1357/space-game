# 贡献与改动协议

> 这个仓库的文档是**半自动同步**的：改完代码跑一遍命令链，数字会自己重算。
> 目的只有一个：**下一个 AI 对话读到的，一定是当前状态，不是上次扫描时的状态。**
>
> 配套文件：`AI_CONTEXT.md`（AI 读的说明书，数字由脚本重算）、`DEVLOG.md`（人写进度）、`README.md`（玩法）。
> 同步脚本：`tools/update_context.py`（在 `build_space.py` 末尾自动调用）。

---

## 0 一句话

**改代码 -> 跑命令链 -> 按固定格式汇报。任一条红，不许提交。**

---

## A 必跑命令（顺序不可换）

```bash
node --check engine/space-core.js
python build_space.py
node tests/run_all.js
python tools/validate_space.py
python tools/map_rules.py
python tools/gen_maps.py --selftest 10
python tools/gen_maps.py --wire-selftest 5
python tools/gen_world.py --selftest
python tools/update_context.py
```

| # | 命令 | 管什么 | 红了怎么办 |
|---|---|---|---|
| 1 | `node --check engine/space-core.js` | 三个引擎文件的语法 | 改到不红；这是最快的一道闸 |
| 2 | `python build_space.py` | 把内容 + 引擎编成自包含 `space-text.html`（末尾会自动同步 `AI_CONTEXT.md`） | 看报错：内容 JSON 坏了 / 模板占位符没替换 / 校验器报了错误 |
| 3 | `node tests/run_all.js` | 6 个测试文件、全部回归 | 对着红的那条改；不许「先提交再修」 |
| 4 | `python tools/validate_space.py` | 纯 Python 的内容层校验（图例覆盖 / 引用 / 坐标 / 缺 id + 地图规则 R1~R13） | 补内容或补登记，别改校验器绕过 |
| 4b | `python tools/map_rules.py` | 地图规则（门宽 >= 3 / 边框 / 四角 / 单连通 / 开敞率 / **R13 回程安全**） | 改地图让它合规，别放宽规则 |
| 4c | `python tools/gen_maps.py --selftest 10` | 随机地图生成器自检（每种原型多种子，生成结果必须过规则） | 改生成器，别改断言 |
| 4d | `python tools/gen_maps.py --wire-selftest 5` | 自动接线自检（全门有 transition / 全图连通 / 跑两次幂等） | 改接线逻辑，别放宽断言 |
| 4e | `python tools/gen_world.py --selftest` | 世界生成自检（同 seed 幂等 / 站点数 / id 不重复） | 改生成器，别放宽断言 |
| 4f | `node tools/browser_check.js 1600,900` | 真浏览器自检（可选，需 Edge/Chrome；覆盖视图 / 阅读弹层 / 站点档案） | 看报错修 UI；没浏览器会跳过 |
| 5 | `python tools/update_context.py` | 重算 `AI_CONTEXT.md` 的数字与附录 B（测试红时它会拒绝写） | 它会告诉你是哪个数字对不上；跑第 3 步修完再跑 |

**补充约定**

- 第 2 步会**自动**跑第 5 步；第 5 步再显式跑一次是为了确认「真的同步了」（它会打印「已是最新，没有改动（幂等）」）。
- **耗时**（实测）：`node tests/run_all.js` 约 46 秒；所以第 2 步在「有改动」时约 47 秒（构建 <1s + 回归 ~46s + 重算 <1s），在「没改动」时 **0.2 秒**。
  为了不让每次构建都等 46 秒，同步脚本记了一个**仓库指纹**（`.ctx_stamp`，所有被追踪文件的名字 + 体积 + mtime）：
  - 指纹没变  直接说「已是最新（仓库未变，跳过回归）」，**不到 1 秒**；
  - 指纹变了（改了任何内容 / 引擎 / 测试 / 文档） 才跑回归、重算数字；
  - 想强制重算：`python tools/update_context.py --force`。
  指纹只是省时间，不影响「测试红不写文档」的判定：真要写文档时，回归必须全绿。
- node 不在 PATH 时：设 `SPACE_NODE=<node 路径>`；脚本也会自动去 `~/.dsh/dsh-runtimes/*/dependencies/node/bin/node.exe` 这类 bundled 位置找。
- **性能预算的环境系数**（`tests/perf_budget.js`）：第 3 步里有 7 条断言量的是毫秒数，而毫秒数取决于机器。在比开发机慢的机器上（手机 / 容器）它们会因为机器慢而红，但代码并没有回归 —— 于是第 5 步会以「测试未全绿」拒绝写文档，整条链卡死。
  为了不让机器速度冒充代码回归，这几条预算可以按机器缩放：
  - `SPACE_PERF_SLACK=1.5 node tests/run_all.js`，或在仓库根目录写一个 `.perf_slack` 文件（内容就是一个数字，已 gitignore）；
  - **默认 1.0**：不设的话快机器上逐字节和以前完全一样，一个字都没放宽；
  - 缩放生效时，`run_all.js` 会打印一行 `⚠`，断言标题会带 `[预算×1.5]`，`update_context.py` 也会额外警告 —— **缩放的绿灯永远看得出来，不许冒充真绿灯**；
  - 缩放只影响这 7 条毫秒断言，通过数、块数、其它断言都不受影响，所以写进 `AI_CONTEXT.md` 的数字仍然是准的；
  - 定系数前先看实际超标幅度：本机实测超 1%~4%，所以 1.5 够用又不足以掩盖真实回归（真退化 50% 照样红）。
- 只想快速迭代、暂时不同步文档：`python build_space.py --no-context`（或 `SPACE_NO_CONTEXT=1`）。**提交前必须补跑第 5 步。**
- 只检查文档是否过时、不改文件：`python tools/update_context.py --check`（0=最新，3=会变）。

---

## B 改动类型 -> 必须更新的文档

| 改动类型 | 必须做 |
|---|---|
| 加 / 删 / 改**内容块**（场景、人、对话、物件、事件） | `DEVLOG.md` 追加一行（改了什么、为什么） |
| 加**新块**（新的 id 列表） | 登记进 `SPACE_BLOCKS` / `NESTED_BLOCKS` + 写 `_howToAdd` 与 `_example` + `DEVLOG.md` |
| 加**新词**（效果词 / 判定词 / 视图提供者） | `register*` + 配测试 + `DEVLOG.md` |
| 改**引擎**（`space-core.js` / `space-textout.js` / `space-textshell.js`） | `DEVLOG.md` 追加「改了什么、为什么」 + 配测试 |
| 改**用户可见行为**（键位、画面、流程） | `README.md` 对应段落 + `DEVLOG.md` |
| 加**新机制**（新系统、新钩子、新命令） | 加测试断言（架构级放 `tests/test_arch.js`） + `DEVLOG.md` |
| 加 / 删**文件** | 什么都不用改：`AI_CONTEXT.md` 的文件树由脚本重算 |

> `AI_CONTEXT.md` 的**数字与附录 B 不许手改**包含「块条数、测试项数、词表数量、文件树、时间戳、
> 各文件行数」这些全部由 `tools/update_context.py` 重算。手写描述性段落可以改，数字别碰。

---

## C AI 每次交付的固定格式

```markdown
## 本次改动
- 文件：xxx
- 内容：xxx
- 原因：xxx

## 验证
- build: exit 0
- tests: 通过 N / 失败 0
- validate: 错误 0 / 警告 0

## 文档更新
- [x] DEVLOG.md 追加
- [x] AI_CONTEXT.md 已重算
- [ ] README.md（未改用户可见行为，无需更新）

## 下一步
- xxx
```

要求：

- 「验证」里的数字**必须是真跑出来的**，不许估。
- 「文档更新」里没用到的项也要留着并写明原因（`（未改用户可见行为，无需更新）`）。
- 改了用户可见行为却勾了「无需更新」= 违约。

---

## D 不许做的事

- 手改 `AI_CONTEXT.md` 里的数字（必须脚本重算）
- 改代码不跑 `python build_space.py`
- 加块不登记 `SPACE_BLOCKS` / `NESTED_BLOCKS`（会被 deepMerge 整块替换，`test_arch.js` 会红）
- 改完不更新 `DEVLOG.md`
- 一次改太多、不验证
- 测试红了还提交（`update_context.py` 会直接拒绝写文档）
- 改 `zhanyi.json`（兵棋数据层，约定「一个字节都没动」）

---

## E 文档分工与同步机制

| 文件 | 谁生成 | 内容 | 什么时候动 |
|---|---|---|---|
| `README.md` | 手写 | 玩法、操作键位、地图字符、开放契约、内容清单 | 用户可见行为变了 |
| `DEVLOG.md` | 手写 | 进度、里程碑、下一步、约定与坑 | 每次有意义的改动 |
| `AI_CONTEXT.md` | **脚本生成** | 定位 / 技术栈 / 功能状态 / 数据结构 / 代码架构 / 硬约束 / 术语 + 精简上下文包 | 数字与附录 B 由 `update_context.py` 重算 |
| `CONTRIBUTING.md`（本文件） | 手写 | 改动协议 | 协议变了 |
| `VISION.md` | 手写 | **游戏类型与长期目标**（群星 / 矮人要塞 / CDDA + 体验目标 + 路线图） | 目标 / 阶段变了 |

**`tools/update_context.py` 会刷新哪些东西**（只碰这些，其他段落一字不动）：

1. 头部：生成时间戳、生成时基线（测试数）
2. 第 0 节摘要：测试数、块登记表数量、内容条数（场景 / 人 / 对话 / 事件）
3. 第 2 节文件结构：文件树（文件数、每文件行数 / KB，二进制标「二进制」，含本文件自己的行数 / KB）
4. 第 3.3 / 3.4 节：回归项数、`space-text.html` 体积
5. 附录 A：测试总数与各文件项数
6. 附录 B：整块重算（块计数表 + `SPACE_BLOCKS` / `NESTED_BLOCKS` 名单 + 词表数量）

**幂等与时间戳**

- 仓库状态不变时，跑一百次 `AI_CONTEXT.md` 字节不变。
- 时间戳只在「数字或表格真的变了」时刷新所以「生成时间」= 这份说明书的数字是哪时候算的。
- 测试不是全绿时：`update_context.py` 报错退出、**不写文件**（宁可文档暂时过时，也不写进错的数字）。

---

## F 加东西的最小例子（速查）

| 想加 | 看哪儿 | 写几行 |
|---|---|---|
| 一个新房间 / 人 / 对话 / 终端 | `tools/starter_mod.json`（能跑的起手 mod）；`python tools/scaffold_mod.py 我的房间 --id my_room` 生成骨架 | 一个 JSON 块 |
| 一整个新世界（多站点 / 多地图） | `python tools/gen_world.py --seed 我的世界 --sites 24`（产物是标准 mod） | 一条命令 |
| 一段可复用的效果组合 | `content/space.json` 的 `macros`（`_howToAdd` + `_example`） | 1 条 |
| 挂在某个时刻上的反应（进场景 / 交互 / 对话结束） | `content/space.json` 的 `hooks` | 1 条 |
| 一个新数值来源画到地图上 | `content/space.json` 的 `projections` | 1 条 |
| 一个新终端界面 | `content/space.json` 的 `views` + `interactables` | 2 条 |
| 各块字段与真实示例 | `AI_CONTEXT.md` 第 4 节 |  |
| 现在的进度与下一步 | `DEVLOG.md` |  |

**没登记的块 = 一写就冲掉别人的内容**；`node tests/run_all.js` 里的 `test_arch.js` 会拿内容里真实存在的每个块逐个实测「加一条，老的还在吗」。
