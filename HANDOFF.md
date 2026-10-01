# 朔  项目开发任务文件（HANDOFF）

> **下一个 AI：先读这一份。** 它按「框架 / 已有功能 / 未完成 / 改过什么」四块写清楚，
> 读完你就知道项目在哪、能跑什么、下一步干什么。其它文档按需再查（见下面「文档地图」）。
>
> 更新时间：2026-10-01　|　内容版本 `1.6.0-text`　|　基线：`node tests/run_all.js` **607 项全绿**、`validate_space.py` **0 错 0 警**

---

## 0 三十秒上手

```bash
cd D:/大肥鱼工作区/朔/space

python build_space.py              # 内容 + 引擎 -> 自包含 space-text.html（改内容或引擎后必跑）
node tests/run_all.js              # 回归：6 个文件 / 607 项
python tools/validate_space.py      # 内容层静态校验（要 0 错 0 警）
python tools/update_context.py      # 重算 AI_CONTEXT.md 的数字与文件树（build 会自动跑一次）
python tools/gen_world.py --selftest # 世界生成自检（可选：换 seed 就是一个新宇宙）

# 可选（地图 / 真机）
python tools/map_rules.py           # 25 张预设地图的规则校验（R1~R12）
python tools/gen_maps.py --selftest 10      # 随机地图生成器自检
python tools/gen_maps.py --wire-selftest 5  # 自动接线自检（幂等）
node tools/browser_check.js 1600,900        # 真浏览器自检（Edge headless，需本机有 Edge/Chrome）
node tools/shot.js station_command 1440,810 preview_text.png   # 截一张彩色 PNG（看调色板/轮廓/区域地板）
```

node / python 不在 PATH 时用 bundled 路径，或设 `SPACE_NODE=<node.exe>`。**跑完 build 才算改完。**

### 文档地图（各管什么）

| 文件 | 谁写 | 管什么 |
|---|---|---|
| **`HANDOFF.md`（本文件）** | 手写 | 接手入口：框架 / 已有 / 未完成 / 改动记录 |
| `VISION.md` | 手写 | **游戏类型与长期目标（目标参考）**：群星 / 矮人要塞 / CDDA 三条参照 + 体验目标 + 路线图 |
| `DESIGN.md` | 手写 | **玩法设计**（设计师视角，不写代码）：3 段已全核心循环/目标、张力曲线/深渊/20 块矩阵、反馈节奏/8 个困难选择/**R1R13 JSON 映射表** |
| `DEVLOG.md` | 手写 | 逐轮进度、里程碑、踩坑、下一步 |
| `AI_CONTEXT.md` | **脚本生成** | 数据结构 / 词表 / 架构 / 硬约束 / 文件树；数字由 `tools/update_context.py` 重算，**不许手改数字** |
| `README.md` | 手写 | 玩家视角：玩法、键位、地图字符、开放契约、内容清单 |
| `CONTRIBUTING.md` | 手写 | 改动协议：必跑命令、改哪儿要同步哪份文档、交付格式 |

---

## 1 游戏框架

### 1.1 是什么

`朔` 是**纯文本（ASCII）场景层框架**：玩家以一个 `@` 存在于世界里，**走到哪哪就是界面**。
画面是 `<pre>` 里的一段纯文本，零 Canvas、零像素操作、地图全是 ASCII 字符；引擎零外链零依赖。

三条铁律：**内核不认内容 / 内容不写代码 / 一切皆 id 皆可合并。**
四条不变量（每条都有测试守）：

1. **内核不认内容**：字句、数值、条件、效果全在数据里；内容引用未注册的词会被 `validate()` 与 `test_arch.js` 点名。
2. **一切皆 id 皆可合并**：`SPACE_BLOCKS`(40) + `NESTED_BLOCKS`(5) 登记在册；`append` 绝不覆盖别人的内容，要改必须显式 `_op:"patch"`。
3. **坏数据只降级不崩**：载入期问题进 `report.errors/warnings`；运行期未知词只 `warn` 一次。
4. **存档 = 世界快照**：`world` 每个字段要么进档、要么在派生白名单（`vis` `npcPaths` `path` `kernelOps` `proj`）里。

### 1.2 数据流

```
content/space.json  
mods/*/mod.json      build_space.py    space-text.html（自包含单文件）
                                             SPACE_SPEC（内容）
engine/space-core.js                        SPACE_MODS（构建时装的 mod）
engine/space-textout.js                       SPACE_STARTER（起手模板）
engine/space-textshell.js
```

### 1.3 引擎三层

| 文件 | 职责 |
|---|---|
| `engine/space-core.js` | 词表注册（效果/判定/视图提供者）、载入合并、场景编译（`compileScene`）、`validate()`、`Game`（tick / 移动 / 门 / 视野 / NPC 日程与寻路 / 对话 / 效果 / 视图 / 事件 / 事件链 / 危机 / 存档 / 屏幕合成）、宏与钩子、热加载 |
| `engine/space-textout.js` | 字符网格  ASCII 文本（含宽字续格）、`applyFont()` 把字号真写回 `<pre>`、`autoFit` 自适应 |
| `engine/space-textshell.js` | 键盘鼠标、`setInterval(step,60)` 主循环、自适应字号两遍、鼠标点格寻路、存档桥（localStorage）、F2 mod 面板 |

### 1.4 词表与扩展点（**加新东西优先用这些，别改引擎**）

- **效果词 39**（含 `open_reader` 阅读弹层）、**判定词 21**、**视图提供者 8**（`validation` `projections` `nearby` `recent_log` `pending_events` `chain_progress` `situation`）。
- **钩子 8 个火点**：`game_start` / `tick` / `day` / `enter_scene` / `interact` / `npc_talk` / `dialogue_end` / `build_done`；过滤器 `scene` `interactable` `npcId` `dialogue` `buildId` `event`；`once` / `priority` / `every`。
- **宏 `macros`**：内容层的函数；`{"type":"macro","id":...}` 调用，内部 `{args.x}` 取参；带 `condition` 可当命名条件（`macro_condition`）。
- **`stop`**：效果链里放 `{"type":"stop"}` 就能掐掉这一轮的默认行为。
- **热加载 `reloadContent`**：F2 装 mod 不重开、进度不丢。
- **私有块 + `source` 任意路径**：视图能读 `space.myNotes.list` 这种自己起的块。

### 1.5 取景与门（最近才定下来的两条约定）

- **固定视口** `config.viewW/viewH = 8824`：字号、分栏、相机都按**视口**算，不按当前场景算所以切场景字号不跳、分栏不翻。
  场景在视口里**偏移**：比视口小的居中（还描一圈 `+-|` 边框），比视口大的滚动（状态行显示 `视野 < > ^ v`）。
- **门是 3 格宽**，判定也按整段算（`compileScene` 里的 `doorMap`）：踩门洞任何一格都能出去，不只中间那格。

---

## 2 已有功能（现在就能跑）

### 2.1 内容规模（`content/space.json`，v1.6.0-text）

| 层 | 块 | 数量 |
|---|---|---|
| 空间 | 场景 / 房间 / 人 / 日程 / 对话（节点）/ 物件 / 过场 | 25 / 25 / 38 / 38 / **200（955）** / 21 / 50 |
| 世界 | 势力 / 外交动作 / 内部政治 / 领袖 / 星系节点 / 行星类型 | 10 / 30 / 12 / 38 / 48 / 18 |
| 军事 | 舰队 / 舰队模块 / 设施 / 殖民地 / 资源 | 14 / 34 / 34 / 10 / 38（计数器 100% 有对应条目）|
| 科技与事件 | 科技 / 事件 / 事件链 / 文本池 / 上报规则 | 72 / **141** / 18 / 44 / 145 |
| 物品与危机 | 遗物 / 任务 / 危机阶段 / 胜利 / 失败 | 28 / 32 / 6 / 7 / 7 |
| 后勤（终端数据源） | 医疗名册 / 军械 / 矿井 / 水培 / 防御炮位 | 12 / 12 / 11 / 11 / 11 |
| 其它 | 视图 / 投影 / 穿梭机 / 宏 / 钩子 / 存档迁移 | 20 / 2 / 6 / 3 / 30 / 1 |
| 生成世界（mod） | `mods/generated_world`：站点 / 场景（含地下层）/ NPC / 对话 / 物件 / 视图 / 遭遇 / 星图节点 | 18 / 64 / 36 / 54 / 55 / 38 / 18 / 18（4 个星区；回程由 base 的 `sh_return` 提供；`tools/gen_world.py` 产出）|

### 2.2 玩家实际能做的事（可感知的形式）

- **走 / 等 / 看 / 环顾**：WASD 或方向键走一格 = 世界前进一分钟；`Tab` 环顾；`X` 查看；鼠标点格自动寻路。
- **和 38 个人说话**：每个人有日程（会换班、会挡路），对话是节点图；选项能改 `counters` / `flags` / 挂事件。
- **在 21 台终端上操作**：面板底部每个 `[n]` 都是**真动作**（有代价：合金/口粮/药品/舰队/小时；有后果：counters、flags、地块、NPC 岗位）
  星图（派舰队测绘 / 补绘星图）、研究（72 个科技、立项计时结算）、资源（合金换口粮 / 调口粮 / 盘点）、
  舰队（调舰队回防 / 解除回防）、医疗（治伤 / 隔离观察 / 体检）、军械（领装甲 / 领装药 / 交还）、
  矿场（加班 / 检修）、农场（抢收 / 育种）、防御（警戒 / 补给 / 演习）、建造（扩建船台 / 加固掩体）、
  通讯（使节 / 援助 / 情报互换）、档案（调阅 / 解读遗物）、气象（看天色 / 露天休整）、打捞（派队 / 回收）、
  贸易（卖合金 / 买燃料 / 谈一笔）、情报板（三段活数据 + 调阅情报）、穿梭机（6 条航线）、记录点（存档/读档/导出）。
- **事件与链**：141 条事件（13 类）由条件触发  挂 `pending`  走到上报人面前按 `E` 处理；18 条链按 `world.chains[id].step` 一步步推进；没有弹窗。
- **危机**：`pollution` 越过 **0 / 3 / 6 / 9 / 12 / 15** 自动进入 6 个阶段，每阶段触发它的事件、部分阶段会扣资源。
- **终局能判定了**（R1/R2）：4 条败北（污染 15 / 民情 0 / 舰队 0 / 人口 0）+ 5 条胜利（封印 / 净化 / 隔离 / 共存 / 答案）都靠 `hook(tick,every:60)` + `end_game` 判；**污染现在有出口**：星图终端「组织净化作业 25 合金  污染1」「封锁裂隙 40 合金」这两个动作现在都要先研究（`tech_purge1` / `tech_rift_seal`，见 R8）。
- **深渊会偶尔说话**（R3）：污染 6 时每 240 tick 有 3/10 概率插一行乱码（`random.table`）。
- **遗物能攒**（R5）：10 条遗迹事件各 +2、打捞队 35% 概率 +1  `win_know` 的 20 件够得着。
- **收口（R6-R13）**：12 个派别支持度变活计数器 + 每日政治结算；殖民地每天按口粮掉/涨民情与人口；7 个场景抽环境文本；4 张地表进场景加疲劳；舰队终端可装 6 种模块（另有全部 34 条列表）；打捞/矿场/农场抽 `textPools`；5 个 NPC 的日常对话从 `dialoguePools` 抽小聊。
- **世界层**：18 个程序生成的站点（`mods/generated_world`）每站点 2~3 张地图，从穿梭机终端过去；星图可见每站归属 / 舰队 / 污染。换 seed 就是一个新宇宙。
- **站点战略动作**：空间站里有「世界地图终端 W」-> 选站点 -> 档案里做 勘测 / 宣示 / 殖民 / 交涉 / 开战；五个全局指令都有计数器，按 `M` 看进度条。
- **站点内内容**：18 个生成站点各有一个 NPC（日程 + 对话 + 到达事件）和一个采集点（数据 / 合金 / 矿石 / 零件，裂隙有污染风险）；采集动作只在站内出现。
- **回程安全**：base 有一条全局「返回索尔空间站」目的地（`sh_return`），旗舰舰桥和每个生成站点首图都有穿梭机终端；`test_world` 5.5 守「每个场景都能走回一台终端」。
- **站点内容加深（本轮）**：每站 2 个 NPC + 专属建筑（补给站 / 粮仓 / 信标塔 / 拆解台 / 封印桩）+ 随机遭遇 + 采集点 + 地下层（可「地下开采」）。
- **战略层深化（本轮）**：宣示 / 殖民 / 交涉 / 开战真的改星图（`galaxy_set` + `galaxy_live`），归属 / 关系 / 舰队 / 污染随存档往返。
- **三层生成（本轮）**：区域（4 星区）-> 站点 -> 地下层；`gen_maps` 新增 `under` 原型。
- **回程硬校验（本轮）**：`map_rules.py` **R13** + `gen_world.py` 生成期复核；任何新场景 / 新目的地回不了穿梭机终端都会直接报错。
- **结束能重开**：胜负后有结束叠加（原因 + 数据 + `[R] 重新开始`）；gameOver 后世界冻结；按 `R` 用同一份内容开新局。
- **地图读得懂（本轮视觉重设计）**：墙按走向画成 `-` `|` `+`（图例里归成一条 `#`），地板按场景类型换字
  （站内 `.` / 地表 `,` / 裂隙 `;` / 舰内 `:` / 殖民地 `'`），货架是 `[`，未探明是一片黑；按 `C` 切彩色后
  地板退到暗部、门与记录点亮黄、`@` 最亮。看效果：`node tools/shot.js <场景> 1440,810 x.png`。
- **阅读弹层 / 终端反馈**：终端动作后标题右侧 flash 显示最近结果；按 `L` 看日志全文，按 `M` 看任务与指令进度；长文本不再塞侧栏。
- **数值出口（R4/R8）**：舰队事件多了一个「抽一支舰队前出（-1 舰队）」的代价选项，且回防时隐藏；研究终端新增裂隙探测 初级净化/局部封印 区域净化 四条线，完成后解锁星图的净化 / 封锁 / 广域净化动作。
- **任务线**：`mis_survey`「深空测绘」是第一条活线（凯尔对话接取  星图派舰  回凯尔复命  资源到账）。
- **情报板闭环**（事件  功能文本）：`intel_terminal`  情报板三段全是活数据（待处理事件 / 事件链进度 / 活计数器）；板上「调阅最新情报  一/二/三」触发 `ev_intel_01..03`，做完一条才解锁下一条；三条事件的选项带 `npc_post` / `set_tile` / `discover` / `counter_add`，改完面板**当场刷新**。

### 2.3 工程与工具

| 项 | 状态 |
|---|---|
| 回归测试 | `node tests/run_all.js`  **607 项全绿**（space 101 / world 206 / arch 100 / text 30 / shell 92 / build 78）|
| 内容校验 | `python tools/validate_space.py`  0 错 0 警 |
| 真机自检 | `node tools/browser_check.js [W,H]`  Edge headless 走遍主场景 + 全部视图（含生成站点档案）+ 情报板 + 阅读弹层，三档分辨率全过 |
| 地图规则 | `tools/map_rules.py`（R1~R12：门 3 格、边框、四角、单连通、开敞率、尺寸）|
| 随机地图 | `tools/gen_maps.py`（5 种原型、确定性、`--gen/--check/--selftest`）|
| 自动接线 | `tools/gen_maps.py --wire`（幂等）+ `tools/scaffold_scene.py --scenes N --wire`（一步产出可走的随机站）|
| 存档 | `saveMigrations` 框架（v1  v2 迁移），读档按版本跑 effects；存档含 `rng` 状态（可复现）|
| mod | `mods/` 目录 + F2 热加载；`tools/scaffold_mod.py` 生成骨架；四种 `_op`（append/patch/replace/remove）|

---

## 3 未完成部分（按优先级）

### P1 玩法层：按 `DESIGN.md` 9 的 R1R13 落地

- **已落地**：R1/R2/R3/R4/R5/R8 + R6/R7/R9/R10/R11/R13 + **世界层战略动作**（勘测 / 宣示 / 殖民 / 交涉 / 开战 + 指令进度 + 阅读弹层 + flash）+ **站点内内容**（每站 NPC / 采集点 / 到达事件）；**R12 部分**（6 个代表模块 + 全部 34 条列进舰队面板）。
- **还剩（上层）**：战略层深化（站点归属真的改星图 / 影响事件、把舰队外交殖民地 counters 和站点绑起来）、区域 -> 站点 -> 楼层三层生成；
  以及 R12 的其余模块（面板只有 1-9 键）、`factions.relation` 还是文案、`leaders` 只做名录。
- 建议下一步：**战略层深化**、**三层生成**、**兵棋桥双向**；先读 `VISION.md` 第 6 节。
- 核心问题一句话：**内容够了，缺的是「数值的出口」**counters 有消耗项却没有稀缺规则，玩家做选择只为了看文案。

### P2 仍是「死数据」的块（只被 `report.stats` 计数或被视图当文案展示，没进任何规则）

真正还没进规则的只剩 `leaders`（只做名录）与 `factions.relation`（文案，没有数字）；
`victoryConditions` / `defeatConditions` 仍是文案块（判定在 9 条 hook 里，改胜负线要两边一起改）。
`fleetModules` / `colonies` / `internalPolitics` / `textPools` / `dialoguePools` 本轮都已经有读它的地方（面板 / 视图 / 钩子 / 对话）。

> 已经活起来的：`techTree`（引擎索引 + `requires` 校验 + 研究流程）、`eventChains`（`stepChains()`）、
> `crisisStages`（`stepCrisis()`）、`resources`（计数器 + `situation` 面板）、`events`（141 条 + 链 + 危机触发）。

### P3 已知技术问题

- `world.kernelOps` 是**出站队列，没有消费方**（兵棋桥没接）；`kernel` 效果只排队。
- `victoryConditions` / `defeatConditions` 是文案块；**真正在跑的是 9 条 `hook` + `end_game`**（R1 已落地）。
- `AI_CONTEXT.md` 第 6/8 节描述**上一轮已过时**，本轮已重写（数字部分照旧交给 `tools/update_context.py`）。
- 相机**不做补间**（切场景瞬间重算，有意为之）；视口 8824 比最高场景矮，所以**预设里没有横向滚动**，横向滚动只在 mod 地图上出现。
- `test_shell.js` 用**假 DOM**；真机行为要靠 `tools/browser_check.js`。

### P4 文档/测试债

- 两条测试当初为内容让步而**加固**过，别改回去：`test_space.js` 凯尔根选项 4  5（并加了「第 5 个是任务入口」）；`test_arch.js` 的 `hooksByTick.length === 1`  按 id 找 mod 的钩子。
- `test_space.js` 第 14 节把当前内容规模写成**下限**（「只多不少」）减少内容会直接报红，这是有意的。

---

## 4 修改内容（倒序，最近的在最上面）

> 这一节只记「这一轮改了什么、为什么、动了哪些文件」，细节看 `DEVLOG.md` 对应里程碑。

| 日期 | 改了什么 | 关键文件 |
|---|---|---|
| 2026-10-01 | **地图视觉重设计**：墙轮廓化（`shapeWalls`，`- \| +`，图例归成 `#`）、地板按场景类型分层（`config.floorByType`：`.` `,` `;` `:` `'`）、12 个场景把「货架」与舱壁拆开（312 格改 `[`，通行性没动）、调色板按信息优先级重排（补 `info`/`dim`）、未探明改空白、自带边框的小图不再重复描边、污染投影阶梯改 `. : % X`；新增 `tools/shot.js` 彩色截图 | `engine/space-core.js`、`content/space.json`、`tests/test_arch.js`、`tests/test_world.js`、`tests/test_text.js`、`tools/shot.js`、`README.md`、`HANDOFF.md`、`DEVLOG.md`、`AI_CONTEXT.md`、`preview_text.png` |
| 2026-10-01 | **VISION 6 推进**：站点内容加深（2 NPC / 专属建筑 / 随机遭遇 / 地下层）+ 战略层深化（`galaxy_set` / `galaxy_live` / `world.galaxy` + 星图活数据）+ 三层生成（4 星区 + `under` 原型）+ 回程硬校验（R13 + 生成期复核）；`test_build` 新增 10 项 | `engine/space-core.js`、`tools/map_rules.py`、`tools/gen_maps.py`、`tools/gen_world.py`、`mods/generated_world/mod.json`、`content/space.json`、`tests/test_arch.js`、`tests/test_build.js`、`README.md`、`HANDOFF.md`、`DEVLOG.md`、`VISION.md`、`CONTRIBUTING.md`、`AI_CONTEXT.md` |
| 2026-10-01 | **修两个严重问题**：旗舰单向卡关（base 加 `sh_return` + `ship_bridge` 放穿梭机终端 + 全图无单向检查）；结束死局（`drawGameOver` 结束叠加 + `R` 重开 + gameOver 后冻结 + test_shell/真机断言）；顺带修 `tileEdits` 的 `ch:undefined` 覆盖 symbol 的 bug | `content/space.json`、`engine/space-core.js`、`engine/space-textshell.js`、`tools/gen_world.py`、`mods/generated_world/mod.json`、`tests/test_space.js`、`tests/test_world.js`、`tests/test_shell.js`、`tests/test_build.js`、`tools/browser_check.js`、`README.md`、`HANDOFF.md`、`DEVLOG.md`、`VISION.md`、`AI_CONTEXT.md` |
| 2026-10-01 | **修复卡关**：生成站点首图放 `shuttle_terminal` + 穿梭机列表加「返回索尔空间站」目的地 + 站点档案加返航动作（三保险）；`test_build` 新增 4 项回程断言 | `tools/gen_world.py`、`mods/generated_world/mod.json`、`tests/test_build.js`、`README.md`、`HANDOFF.md`、`DEVLOG.md`、`VISION.md`、`DESIGN.md`、`AI_CONTEXT.md` |
| 2026-10-01 | **站点内内容**：`tools/gen_world.py` 给 18 个站点各注入 1 个 NPC（日程 + 对话 + 到达事件）+ 1 个采集点（可重复作业、站内限定）；`test_build` 新增 10 项 | `tools/gen_world.py`、`mods/generated_world/mod.json`、`tests/test_build.js`、`README.md`、`HANDOFF.md`、`DEVLOG.md`、`VISION.md`、`DESIGN.md`、`AI_CONTEXT.md` |
| 2026-10-01 | **世界层二期 + 交互反馈**：站点战略动作（勘测/宣示/殖民/交涉/开战）+ 5 条带 progress 的指令；引擎新增 `open_reader` 阅读弹层（L 日志 / M 指令进度）与终端动作 flash 反馈；`tools/gen_world.py` 升级到 44 场景 / 20 视图；新增 `VISION.md` | `engine/space-core.js`、`engine/space-textshell.js`、`tools/gen_world.py`、`mods/generated_world/mod.json`、`tests/test_shell.js`、`tests/test_build.js`、`VISION.md`、`README.md`、`HANDOFF.md`、`DEVLOG.md`、`AI_CONTEXT.md`、`DESIGN.md` |
| 2026-10-01 | **世界生成（群星  矮人  CDDA）**：新增 `tools/gen_world.py`；生成 18 站点 / 41 场景 / 18 穿梭机 / 18 星图节点，作为标准 mod 编入产物；`test_build` 新增 6 项验收 | `tools/gen_world.py`、`mods/generated_world/mod.json`、`tests/test_build.js`、`README.md`、`HANDOFF.md`、`DEVLOG.md`、`DESIGN.md`、`AI_CONTEXT.md` |
| 2026-10-01 | **数值出口三期 R6/R7/R9-R13**：12 派别支持度变计数器 + 每日政治钩子 + 动作推动；殖民地每日补给结算；7 场景环境文本钩子；4 地表 hazard 加疲劳；舰队装模块（6 动作 + 34 条列表）+ `fleet_power`；打捞/矿场/农场抽 `textPools`；5 个对话挂 `dialoguePools`；新增 `test_world` 9.12 节 17 项 | `content/space.json`、`tests/test_world.js`、`README.md`、`HANDOFF.md`、`DEVLOG.md`、`DESIGN.md`、`AI_CONTEXT.md` |
| 2026-10-01 | **数值出口二期 R4/R8**：舰队事件加「-1 舰队」代价选项 + `home_guard` 门槛（10 条模板对话）；研究终端加 4 条科技线（裂隙探测  初级净化/局部封印  区域净化，4 计数器 + 4 hook），星图净化/封锁/广域净化改由科技解锁；新增 `test_world` 9.11 节 15 项 | `content/space.json`、`tests/test_world.js`、`tools/browser_check.js`、`README.md`、`HANDOFF.md`、`DEVLOG.md`、`DESIGN.md`、`AI_CONTEXT.md` |
| 2026-10-01 | **设计映射落地 R1/R2/R3/R5**：9 条胜负判定 hook + `end_game`；败北线 1215；深渊杂音 `random.table`；10 条遗迹事件各 +2 遗物 + 打捞 35% 出遗物；`pop` 变活计数器；星图/情报板/外交/档案各加终局动作；**修了 `morale` 不是活计数器导致误判败北的 bug**，并给 `deserialize` 加了计数器兜底补齐 | `content/space.json`、`engine/space-core.js`、`tests/test_world.js`、`tests/test_space.js`、`tools/browser_check.js` |
| 2026-10-01 | **设计文档补齐**：`DESIGN.md` 第 2/3 段落盘（张力曲线 / 深渊 3 脚本 / 20 块矩阵 / 反馈节奏 / 8 个困难选择 / R1R13 映射 / 自检）| `DESIGN.md`、`HANDOFF.md`、`DEVLOG.md` |
| 2026-10-01 | **基础互动内容：12 个只读面板全部变成可用面板**：`warehouse_stock`/`build_menu`/`diplomacy`/`medical_status`/`armory_status`/`mine_status`/`farm_status`/`defense_status`/`archive_view`/`weather_view`/`salvage_view`/`trade_view` 各加 23 个带代价的动作，`galaxy_map` 加「补绘星图」，`fleet_status` 加「调舰队回防 / 解除回防」；新增 `test_world` 第 10.6 节（面板有真动作 + 动作真的改变世界）与真机面板动作断言 | `content/space.json`、`tests/test_world.js`、`tools/browser_check.js`、`README.md` |
| 2026-10-01 | **设计层开工**：新增 `DESIGN.md`（第 1 段：三个问题 + 核心循环 + 三层目标；第 0 节列出 AI_CONTEXT 第 6 节 6 处过时项） | `DESIGN.md`、`DEVLOG.md` |
| 2026-10-01 | **事件  功能文本**：3 个视图提供者（`pending_events` / `chain_progress` / `situation`）、段落级 `provider`、情报终端 + 情报板、3 条终端触发的情报事件（链式解锁）、资源/舰队终端改显示活数据 | `engine/space-core.js`、`content/space.json`、`tests/test_world.js`、`tests/test_arch.js`、`tools/browser_check.js` |
| 2026-10-01 | **生成器 `--wire`**：自动接线（先连通再配对、落点、冲突只警告、幂等）、`tools/scaffold_scene.py`、`--wire-selftest` / `--check-engine`；修了「一扇门登记成 3 个出口」的 bug | `tools/gen_maps.py`、`tools/scaffold_scene.py`、`CONTRIBUTING.md` |
| 2026-10-01 | **固定视口**：`viewW/viewH` + `originX/originY`（小图居中/大图滚动）+ `doorMap`（3 格门判定）+ 小图描边 + 状态行视野箭头；鼠标反算与外壳点击同步 | `engine/space-core.js`、`engine/space-textshell.js`、`content/space.json`、`tests/test_shell.js`、`tools/browser_check.js` |
| 2026-10-01 | **地图规则 + 生成器**：`tools/map_rules.py`（R1~R12）、`tools/gen_maps.py`（5 原型、确定性、自检）、并入 `validate_space.py`；所有门加宽到 3 格 | `tools/map_rules.py`、`tools/gen_maps.py`、`tools/validate_space.py`、`CONTRIBUTING.md` |
| 2026-10-01 | **中央大厅重做**：拆掉「环形走廊 + 密封核心」，改成打通的中央大厅（指挥中心居中），更新门/落点/门牌 | `content/space.json`、`README.md` |
| 2026-10-01 | **五层内容扩充（只多不少）**：空间 +8 人/ +4 终端/ +8 对话，世界/军事/科技/事件/物品各层加厚；资源补齐；`test_space` 第 14 节锁下限 | `content/space.json`、`tests/test_space.js`、`README.md` |
| 2026-10-01 | **P0~P7 自主推进**：P0 真机验证工具、P1 五个空视图数据、P2 第一条任务线、P3 事件链推进、P4 `techTree` 活起来、P5 危机阶段、P6 存档迁移、P7 打磨 | 见 `DEVLOG.md` 的 P0~P7 里程碑 |

---

## 5 接手第一步（checklist）

1. **跑一遍基线**：`python build_space.py`  `node tests/run_all.js`  `python tools/validate_space.py`。要看到 **607 / 0** 与 **0 错 0 警**；不绿先修，别往下做。
2. **读 `DESIGN.md` 第 1 段**（它是玩法方向） 如果那一节还标着「待确认」，先确认或直接续写第 2 段。
3. **要动工程**：先看 `CONTRIBUTING.md` 的必跑命令与「改动类型  更新哪份文档」；改内容或引擎**必须重新 build**。
4. **别碰**：`zhanyi.json`（一个字节都不许动）；`AI_CONTEXT.md` 里的数字（交给 `tools/update_context.py`）。
5. **每完成一件事**：往 `DEVLOG.md` 追加一条里程碑，并更新本文件第 4 节那一行。

---

## 6 雷区（踩过的，别再踩）

- **PowerShell `Set-Content -Encoding UTF8` 会给文件加 BOM**：改了 `engine/space-core.js` 会被 `test_build.js` 当场抓住（产物与磁盘不一致）。仓库文本一律**不带 BOM**（用 Python 写，或改完剥掉）。
- **别用 PowerShell 管道接 `Select-Object -First` 跑 node**：node 不被杀会挂到 300 秒超时并重置 shell。长输出重定向到文件再读。
- **加块必须登记** `SPACE_BLOCKS` / `NESTED_BLOCKS`，并写 `_howToAdd` + `_example`；不然 mod 一写就把整块替换掉。
- **加新词必须 `register*` + 配测试**（`test_arch.js` 的词表检查会替你守）。
- **条目必须有 id**；`append` 不覆盖别人的内容。
- **新计数器必须同时进 `initialState.counters` 和 `resources`**：只写 `resources` 的话，规则读到的是 `undefined  0`（曾让「民情0」判定开局就判负）。读档已有兜底补齐，但新档必须写全。
- **新事件 / 对话 id 会撞名**：`ev_<分类>_<序号>` 与 `dlg_ev_<分类>_<序号>` 已被占用 12 类，新前缀先查重（曾撞过 `ev_medical_01/02`，同 id 会被静默合并）。
- **地图有硬规则**：门 3 格宽、不占四角、单连通、开敞率 55%、尺寸偶数（`tools/map_rules.py` 的 R1~R12；`validate_space.py` 已并入）。改地图后跑 `python tools/map_rules.py`。
- **内容规模只许增不许减**：`test_space.js` 第 14 节把当前数字写成了下限。
- 文件换行：内容/引擎多为 CRLF，新文件用 LF（构建与测试都能吃，别混着改同一个文件）。
- **结束不是死局**：`end_game` 后要有结束叠加 + `R` 重开 + 世界冻结（`tickOnce`/`onTick` 早退）；`test_shell` 6.6 / 真机 3 项守它。
- **tileEdits 只写 interactable 时**：别写 `ch: undefined`；`resolveLegendEntry` 已改成显式 undefined 不覆盖 symbol（曾让放的物件变空字符）。
- **地图规则现在是 R1~R13**：`R13 回程安全` = 每个场景必须能沿门走回一台穿梭机终端；`validate_space.py` / `map_rules.py` / `gen_world.py` 三处都查，不过直接报错（别再出单向卡关）。
- **生成站点必须有回家路径**：站点首图放 `shuttle_terminal` + `shuttles` 里加一条回 `station_command` 的目的地 + 站点档案加返航动作；`test_build` 的「回程安全」4 项守它（曾出过「去了回不来」的卡关）。
- **给生成地图放 NPC / 物件**：日程点只选 `.` 地板（`gen_world.py` 的 `pick_open_floor`）；物件用 `tileEdits` 放 `#` / `^` 实心格，别放地板（会改变连通性、触发「走不到的区域」）。
- **生成的名字别用会被 ASCII 映射的符号**（`` `` `` 等）：真机自检按渲染文本找视图标题，生成站点名改用 ASCII 分隔符 `-`。
- **`toAscii()` 会吃掉 Unicode 画图字符**：`space-textout.js` 的 `ASCII_MAP` 把 `█ ░ ◆ ─ │ ┌ ┐` 在**黑白和彩色两种模式下**都映射成 `# . * - | +`。所以别指望用 Unicode 把地图画好看 —— 要新字形就用 ASCII 原生字符（或同时补 `ASCII_MAP` + `test_text.js`）。
- **改「墙」的样子要动同一个来源**：`shapeWalls()` 按 `presets.wall.ch` 找墙，图例按 `presets.wall.kind === 'wall'` 归一；改字符别只改一个地方。墙格以前 `kind` 是 `floor`，现在是 `wall`。
- **加一种地板**：加一个 `floor_xxx` preset（`ch` / `fg` / `name`）+ 在 `config.floorByType` 里登记场景类型即可；**别去改各场景 tiles 里的 `.`** —— 地图源字符统一是 `.`，按类型换字是编译期的事，改了就会同时触发 `map_rules` / 生成器 / 校验器三处。
- **改完地图视觉记得重截** `preview_text.png`：`node tools/shot.js station_command 1440,810 preview_text.png`（默认黑白模式下调色板根本看不出来）。
