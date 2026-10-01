# 开发进度 / 交接文档

> 给「下一个对话里的我」看：做到哪了、下一步做什么、怎么验证、别踩哪些坑。
> **本轮目标：按 VISION.md 第 6 节没做完的部分推进 —— 第 1 期 mod 安全网、第 2 期命名与文化体系已完成；接着做地形生态、战略层死数据、mod 生态。**
> 最后更新：2026-10-02（第 2 期：命名与文化体系 —— 地名/人名按派系说不同的语言，手写层与生成层并到一张表上） | 原记录：2026-10-02（第 1 期：mod 安全网 —— 校验器看得懂 mod、构建期闸门、抓出示例 mod 的真实违规） | 原记录：2026-10-02（性能预算环境系数：让命令链在慢机器上不再卡死） | 原记录：2026-10-01（VISION 第 6 节：站点内容加深 + 战略层深化 + 三层生成 + 回程硬校验） | 原记录：2026-10-01（P0-P7 + 内容扩充 + 中央大厅 + 门加宽/固定视口/地图规则与生成器；内容版本 v1.6.0-text）
>
> **接手入口 = `HANDOFF.md`**（框架 / 已有功能 / 未完成 / 改动记录，一页看清，下一个 AI 先读它）。
> 另有给 AI 读的**项目说明书** `AI_CONTEXT.md`（含可直接粘贴的精简上下文包）；本文件管「进度与下一步」；玩法设计在 `DESIGN.md`。
> 改动的**必跑命令**与「改动文档」对照表见 `CONTRIBUTING.md`（构建成功会自动同步 `AI_CONTEXT.md` 的数字）。

---

## 可玩标准（本轮验收口径）

**8 条全打勾 = 可玩。没打勾之前不停。** 现状见每条的进度。

- [x] **真浏览器能打开、能走、能对话、不花屏、字号正常**  新增 `tools/browser_check.js`（Edge/Chrome headless），在 1280x720 / 1600x900 / 1920x1080 三种窗口实测：0 错 0 警、`<pre>` 有内容、字号真写回 DOM（17/23/28px 自适应）、无运行期报错；`probe.html` 结论 4/4。
- [x] **15 个终端视图全部有内容（不是 empty）**  P1 已补 `medical` / `armory` / `mine` / `farm` / `defense` 五个数据块；`node tools/browser_check.js` 在 1280/1600/1920 三窗口实测 15 个官方视图 `empty=[]` 全通过。
- [x] **玩家能接至少 1 条任务线并完成它**  P2 已做「深空测绘」：凯尔对话接取 -> 星图终端派舰队测绘（花 2 支舰队）-> 回凯尔复命领奖；`test_world.js` 有端到端断言。
- [x] **至少 3 条事件链能完整推进到结束**  P3 给 `eventChains` 加了 `stepChains()`：15 条链全部能按顺序推到 `done`（`test_world.js` 逐条验）。
- [x] **至少 1 种资源能被玩法改变（不是死数据）**  P4 研究完成后 `counter_add water +40` / `food +3` / 立项扣 `alloy -50`；这些资源进存档、`test_world.js` 有断言。
- [x] **至少 1 个建造/研究流程能走通**  P4 的「水循环回收」研究流程：立项扣料 -> tick 钩子计时 -> 完成结算。
- [x] **存档  读档  世界状态完全一致**  P6 补了 `space.saveMigrations` 迁移框架；`test_arch.js` 逐字段快照往返（含 `chains` / `crisis`），`test_space.js` 验 v1->v2 迁移。
- [x] **所有测试全绿，`validate_space.py` 0 错 0 警**  当前 493/0、0/0 全绿；每完成一个 P 重跑。

## P0 里程碑：真机验证有工具了（2026-10-01）

- 新增 **`tools/browser_check.js`**：用 Edge/Chrome headless 打开 `space-text.html`，在页面里跑断言（boot / 0 错 0 警 / 字号写回 DOM / 布局尺寸 / 15 个视图是否渲染出内容），结果 base64 JSON 打回 stdout。用法 `node tools/browser_check.js 1600,900`；没装浏览器会打印「跳过」并 exit 0。
- `probe.html` 末尾新增「探针结论」汇总（汉字宽比 / 线框字符 / localStorage / 度量表），截图即可判读。
- 实测三种窗口：`1280,720 -> 17px / 133x29`、`1600,900 -> 23px / 124x28`、`1920,1080 -> 28px / 122x28`，都是右侧栏布局，0 报错。
- 发现并记录的真问题：5 个终端视图渲染 empty（交 P1）；`--window-size` 必须用逗号 `W,H`（工具已处理）。
## P1 里程碑：5 个空视图有真实内容了（2026-10-01）

- 新增 5 个顶层数据块（`content/space.json`，插在 `colonies` 之后）：`medical` 12 条 / `armory` 12 条 / `mine` 11 条 / `farm` 11 条 / `defense` 11 条，全部带 `_howToAdd` + `_example`，条目都有 id。
- 字段对齐 5 个终端视图：医疗 `name/state/note`、军械 `name/count/issued`、矿场 `name/depth/state`、农场 `name/crop/state`、防御 `name/ammo/state`；每条另加 `note` 等富字段（世界观：残响议会 / 索尔星系 / 深渊裂隙）。
- `SPACE_BLOCKS` 登记这 5 个块（34 -> 39）；不登记的话 mod 一写就会整块替换。
- 验证：`node tools/browser_check.js` 三窗口 -> 15 个官方视图 `empty=[]` 全通过；375 项回归全绿；validate 0 错 0 警。
- 踩坑：PowerShell `Set-Content -Encoding UTF8` 会给文件加 **BOM**，改了 `engine/space-core.js` 后 `test_build.js` 立刻报「产物与磁盘不一致」。结论：这个仓库的文本文件一律**不带 BOM**（用 Python 写，或 `-Encoding utf8NoBOM`）。

下一步 P2：用 `hooks` + `macros` 把 `missions` 接成一条能接、能完成的任务线。
## P2 里程碑：第一条任务线（深空测绘）能接能完（2026-10-01）

纯 JSON，不碰引擎。链路：和舰队指挥官凯尔对话接取 -> 星图终端派舰队测绘（花 2 支舰队）-> 回凯尔复命领奖。
状态机 = `counters.mission_survey`（0 未接 / 1 进行中 / 2 待复命 / 3 完成）。

**可复制的任务线模式（后续照这个写）**

| 环节 | 用什么 | 本例 |
|---|---|---|
| 接取入口 | 挂在 NPC 日常对话的一个带 `condition` 的选项 | `dlg_fleet_commander` 根节点追加「听说帷幕星云要测绘？」（condition `mission_survey == 0`） |
| 任务身份 | 复用现有 `missions` 条目，不新建块 | 对话节点写 `"mission": "mis_survey"`；目标/奖励文案照那条 |
| 状态追踪 | `counters` | `counters.mission_survey` 0/1/2/3 |
| 推进动作 | 终端视图 `actions[].condition / cost / effects` | `galaxy_map` 加「派舰队测绘」，`cost {counter: fleets, amount: 2}` |
| 完成条件 | `condition`（可复用就写成命名条件宏） | 动作 condition = `{"type":"macro_condition","id":"mis_survey_active"}` |
| 复命 | `npcApproach`（priority 大者先报） | 凯尔 priority 400，condition `mission_survey >= 2` -> `dlg_mis_survey_done` |
| 奖励 | 现有 `resources` / `relics` | `mac_mission_reward`：合金 +40、遗物 +1（勘测仪）、点 `flag mis_survey_done` |
| 提示 / 播报 | `hooks`（`tick` + `once` / `dialogue_end`） | 目标完成播报一次；接取后每次和凯尔说完话提醒去星图 |

- 新增：`macros` 3 条（`mac_mission_accept` / `mac_mission_reward` / 命名条件 `mis_survey_active`）、`hooks` 2 条、对话 1 段 + 凯尔对话加 1 个选项、`npcApproach` 1 条、`galaxy_map` 动作 1 个、`initialState.counters.mission_survey`。
- 验证：`test_world.js` 新增端到端 19 项（接 -> 做 -> 复命 -> 奖励逐项断言）；395 项全绿；validate 0 错 0 警；真浏览器自检全通过。
- 两处**测试加固**（不是迁就内容）：`test_space.js` 凯尔根选项 4 -> 5（内容确实多了一个入口），并新增「第 5 个是测绘入口」断言；`test_arch.js` 两处 `hooksByOn.tick.length === 1` 改成按 id 找 mod 的钩子（原来假设内容里没有 tick 钩子，现在内容有了，按 id 找更稳）。
- 诚实说明：遗物目前没有专门的 `give_relic` 效果，本轮用 `counter_add relic`（resources 里的「遗物」）+ 日志点名「勘测仪」；给遗物加正式效果属于后续引擎改动，不在本 P 范围。

下一步 P3：给 `eventChains`(15) 加推进逻辑（`world.chains[id].step`），让事件链能一步步走到结束。

## P3 里程碑：eventChains 会自己往前走了（2026-10-01）

按计划，本轮是唯一动引擎的地方（`space-core.js`）。

- `world.chains[链id] = { step, done }`：`eventChains[].steps` 是有顺序的事件 id。
- `stepChains()` 在 `onTick()` 里、`checkEvents()` **之前**跑：某一步的事件对话只要被玩家打开过（`world.seenDialogues[ev.dialogue]`），这条链就往前走一步；每 tick 每条链最多推进一步，不会一 tick 把整条链抖出来。
- `checkEvents()` 加 gating：不属于「当前这一步」的链内事件**不挂上报**  第一步没处理，第二步不会冒出来（正是链描述里写的「上一件事没处理干净，就会有下一件」）。
- `chains` 按不变量进档：进 `world`、进 `serialize/deserialize`；热加载时清掉内容里已经没有的链；`test_arch.js` 把 `chains` 加进世界快照逐字段比对。
- 验证：`test_world.js` 新增 3 项  15 条链逐条推到 `done`、gating 卡住第二步、链外事件不受影响；398 项全绿；validate 0/0；真浏览器三窗口自检全通过。

下一步 P4：让一个数据块活起来（挑 `techTree`：研究终端能点、研究完改 `counters`）。

## P4 里程碑：techTree 活起来了（研究流程，2026-10-01）

选 `techTree` 当第一个「活起来」的数据块。

- **引擎开始读它**：`build()` 建 `idx.techs`（按 id 索引科技树），`validate()` 校验每条 `requires` 指向真实存在的科技（写错 id 会被点名）。`techTree` 不再是「只被 report.stats 计数」的数据。
- **玩家能操作它**：研究终端（`tech_tree` 视图，本来就 `source: space.techTree.list`）加了两个动作：「研究：水循环回收（合金 -50）」  `condition` 挡重复立项 + `cost` 扣 50 合金 + `effects` 点进行中 flag；「研究：基础外科（合金 -155）」  `condition` 要求 `tech_water_rec` 已研究（对应 techTree 里那条 `requires`），且 `cost` 付得起才出现。
- **研究真的会跑完**：`hook_research_water_rec`（`on: tick` + `every: 20`）用 `if` 效果词做「进度 +1 / 到点结算」；完成后 `flag_set tech_water_rec`、`counter_add water +40`、`counter_add food +3`、写日志。资源被玩法改变，而且进存档。
- 验证：`test_world.js` 新增 12 项（索引 / 校验 / 动作出现与扣费 / 前置门 / 计时完成 / 资源变化 / 存档往返）；411 项全绿；validate 0/0；真浏览器三窗口自检全通过。
- 诚实说明：研究时长用「tick 钩子 + 计数器」实现（不是新引擎计时器）；这样纯 JSON 可扩展，也顺带把 `if` 效果词第一次用起来。

下一步 P5：`crisisStages`(5) 接进事件系统（每个阶段触发对应事件）。

## P5 里程碑：危机阶段接进事件系统（2026-10-01）

- `crisisStages` 块新增 `counter`（驱动计数器，这里是 `pollution`）和每个阶段的 `events` / `onEnter`；原来的 `effects` 保留为给玩家看的文案。
- 引擎 `stepCrisis()` 在 `onTick` 里跑：按 `counters[counter]` 从低到高找当前阶段，**只进不退**；一次跨多级会把中间阶段都补触发（写 `world.crisis.stage` + `flags.crisis_stage` / `crisis_level`）。
- 每个阶段：`events` 里的 id 走新的 `triggerEvent()` 挂待上报（等价 `pending_set`，同时记 `firedRules`，不会重复触发）；`onEnter` 跑效果（第三阶段真的扣 `food -2`）。
- 阶段配对的事件**全部选不在事件链里**的，避免和 P3 的链式 gating 打架（链内事件由链自己放行）。
- `world.crisis` 进 `newWorld` / `serialize` / `deserialize`；`test_arch.js` 的世界快照纳入它。
- 验证：`test_world.js` 新增 11 项（阶段推进 / 跨级补触发 / 事件挂上报 / 资源变化 / 只进不退 / 存档往返 / 内容完整性）；422 项全绿；validate 0/0；真浏览器自检全通过。

下一步 P6：存档迁移框架 `space.saveMigrations`（读档时按版本跑 effects）。

## P6 里程碑：存档迁移框架（2026-10-01）

- 引擎加 `SAVE_VERSION`（=2，导出给工具/test）；`serialize()` 写 `v: SAVE_VERSION`。
- 读档时如果 `o.v < SAVE_VERSION`，从 `space.saveMigrations` 里按 `from` 一档一档找规则、跑 `effects`，直到追上当前版本；找不到规则只 `warn` 一次、按现状读（绝不崩）。
- 新增内容块 `saveMigrations`（已登记 `SPACE_BLOCKS`，带 `_howToAdd` + `_example`）；本档 `mig_1_to_2`：给 v1 老存档点 `save_v2` + 写一句日志（v1 没有 `world.chains` / `world.crisis`）。
- 验证：`test_space.js` 新增 9 项（导出 / 登记 / 新档版本号 / 当前档不迁移 / v1 老档迁移 + 日志 + 迁移后仍可 tick / 缺规则只警告）；431 项全绿；validate 0/0；真浏览器自检全通过。
- 这说明旧存档不会被新结构弄炸：读进来先补齐、再提示。

下一步 P7（打磨）：NPC 寻路分摊到多帧、F2 超大 JSON、更新两张旧截图、三处版本号统一。

## P7 里程碑：打磨（2026-10-01）

- **NPC 寻路分摊到多帧**：`stepActors()` 每 tick 最多给 `config.npcRepathPerTick`（默认 2）个人重新算路径，其余下几帧再算；已有缓存路径的人照常走。`test_arch.js` 新增 8c：一 tick 移动人数 <= 预算、多跑几帧大家都会动（不是永久卡住）。
- **F2 超大 JSON**：`test_shell.js` 新增 4 项  造一份 > 1.5 MB 的 mod（5000 条记录）跑「粘贴 -> 应用热加载 -> 内容真的进去 -> 进度保留 -> 清空」；实测解析 + 重编译 444ms（预算 4000ms）。
- **两张旧截图换成真的了**：用 Edge headless 重新截 `preview_text.png`（1440x810，游戏画面）与 `preview_probe.png`（1000x1560，诊断探针）。以前那两张是修好字号之前的画面。
- **三处版本号统一**：内核 `VERSION` / 内容 `_version` / 外壳 `VERSION` 全部 = `1.6.0-text`。
- 验证：438 项全绿；validate 0/0；真浏览器三窗口自检全通过。

**P7 之后，「可玩标准」8 条全部打勾。**

## 内容扩充里程碑：五层「只多不少」（2026-10-01）

按需求把底层各层文本整体加厚。`test_space.js` 新增第 14 节，把本轮数字写成**下限**：以后只许多、不许少（少了立即红）。

| 层 | 块 | 之前 -> 现在 |
|---|---|---|
| 空间 | 场景 / 房间 / 人 / 日程 / 对话 / 物件 / 过场 | 25/25/30/30/171/16/42 -> **25/25/38/38/197/20/50** |
| 世界 | 势力 / 外交动作 / 内部政治 / 领袖 / 星系节点 / 行星类型 | 8/20/8/30/36/12 -> **10/30/12/38/48/18** |
| 军事 | 舰队 / 舰队模块 / 设施 / 殖民地 / 资源 | 10/24/24/6/12 -> **14/34/34/10/20** |
| 科技与事件 | 科技节点 / 事件 / 事件链 / 文本池 | 54/120/15/32 -> **72/138/18/44** |
| 物品与危机 | 遗物 / 任务 / 危机阶段 / 胜利 / 失败 | 20/24/5/5/5 -> **28/32/6/7/7** |

要点：
- 空间层：+8 个 NPC（各带日程 + 对话 + 领袖条目；日程坐标程序化选在可走格上）、+4 台新终端（档案 / 气象 / 打捞 / 贸易，真的画进地图并各配一个视图）、+4 对真门（门与过场 1:1）、+8 段对话。
- 世界层：+2 势力（拾荒者联盟 / 静默教团）、+10 外交动作（`list` 与 `actions` 两份同步）、+4 政治派别、+8 领袖、+12 星系节点、+6 行星类型。
- 军事层：+4 舰队、+10 模块、+10 设施、+4 殖民地；**资源补齐**到 20 条  `initialState.counters` 里每个计数器都有对应的 `resources` 条目（护城测试盯着）。
- 科技与事件：+18 科技（6 支各 +3，全部挂进 `branch.nodes`，`requires` 全部指向真实科技）、+18 事件（每条都配对话 + 上报规则）、+3 事件链（每条 3 步，用新事件，不与旧链共用）、+12 文本池。
- 物品与危机：+8 遗物、+8 任务、+1 危机阶段（余波，阈值 15）、胜负各 +2。

踩坑（都被校验器当场抓住）：新事件 id 与既有 `ev_medical_01/02` 撞名（引擎按 id 索引会静默合并同 id）-> 统一改 `ev2_` / `dlg2_` 前缀；新行星类型 `crystal` 与资源 `crystal` 跨块重名 -> 改 `crystal_world`。

验证：442 项全绿；validate 0/0；真浏览器自检 20 个视图全部有内容、三窗口 0 报错。

## 地图设计修正：环形走廊 -> 中央大厅（2026-10-01）

**问题**（用户反馈）：`station_corridor` 是「环形走廊 + 一整块封闭核心」 中间整块走不进去，绕一圈没有意义；八扇门的顺序也没逻辑（指挥中心偏在一侧）。

**改法**（只改内容，不动引擎）：
- **拆掉密封核心**：原来 rows 6-29  cols 8-55 是一整块墙；现在整块打开成大厅，里面只留 4 根 2x2 柱子、4 组 4x1 长椅/绿植、一张 2x4 中央问询台、2 个记录点、8 把椅子，**全部都能绕过去，大厅中间是通的**。
- **不再叫环形走廊**：scene 与 room 的名字都改成 **中央大厅**（`station_corridor` 这个 id 不动，避免牵一发动全身），ambient 重写。
- **动线排序修正**：北墙三扇门从「指挥中心 / 研究所 / 船坞」改成 **研究所(16) / 指挥中心(32，正中) / 船坞(48)**；南墙 居住区 / 通讯室 / 仓库 不变；西 医疗区、东 军械库 不变（医疗挨着居住区、军械挨着船坞，本来就顺）。
- 门坐标、门外门牌（`! ? % & ~ ; : /`）、其余 8 个场景落到走廊的坐标全部同步更新；`sceneTransitions` 按场景对为键，不用改。
- 夜里在走廊待命的 8 个 NPC 坐标 + 8 个门的落点，逐一核对保持可走（脚本里写了断言）。
- `=` 的图例名字从「核心结构」改成「大厅结构」（它现在是柱子/问询台，不是墙）。

**验证**：442 项全绿；validate 0/0；真浏览器实测能走进中央大厅（状态栏显示「中央大厅」，大厅与门牌正常渲染），并重截 `preview_text.png`。
另做了一次全图体检：25 个场景现在没有任何「大块密封结构」（最大实心非可走块 <= 2x2），可走率 65%~90%。

## 地图系统里程碑：门加宽 + 固定取景框 + 地图规则/生成器（2026-10-01）

**1) 门太小 -> 所有门 3 格宽**
- 49 个出口全部沿所在边扩成 3 格门洞；不占地图四角（角上仍是墙），出口格本身永远保留。
- 顺手修了一个真 bug：之前把 `archive_terminal` 放在 station_comm 的 (1,0)，正好挡住拓宽后的门口 -> 挪到 (6,0)。
- `test_world.js` 新增第 10.5 节：门 >= 3 格宽 / 边框不漏 / 四角不开口 / 开敞率 >= 55%（按引擎真编译结果算，不是读源文件）。

**2) 换地图字号乱跳、画面割裂 -> 固定取景框**
- 原因：`resize()` 一直拿「当前场景尺寸」去 autoFit 60x22 的房间用 23px，走进 88x28 的地表就跳成 15px，分栏还会翻。
- 改法：新增 `Game.designBox()`，字号按 `config.mapDesignCols/Rows`（默认 = `mapTargetCols/Rows` = 104x28）算，**不随场景变**；`layout()` 的分栏判断也改用固定框宽。
- 比取景框大的场景（中央大厅 64x36）**滚动显示**，镜头跟着玩家；小的居中。`window.__space.resize` 暴露出来方便自检。
- `tools/browser_check.js` 新增相机自检：26 个场景走一遍，字号 / 画面尺寸 / 分栏必须完全一致。
  实测：1280x720 -> 14px / 162x30；1600x900 -> 19px / 150x30；1920x1080 -> 24px / 143x30，三个分辨率下跨场景都一致。

**3) 完善预设地图 + 随机地图的生成逻辑 -> 规则 + 生成器**
- 新增 `tools/map_rules.py`：一套硬规则 R1~R11（见 README 7.5），预设地图和随机地图共用。
- 新增 `tools/gen_maps.py`：确定性生成器（同 seed 同图），5 种原型 station / colony / surface / ship / rift；`--gen` 出图、`--check` 校验预设、`--selftest N` 每种原型多种子生成并全量校验。
- `validate_space.py` 已并入 R1~R11；`CONTRIBUTING.md` 必跑命令加了 4b / 4c。
- 实测：25 张预设地图 **0 错 0 警**；生成器 **300 张随机图 0 失败**。
- 规则自己也被抓出过两个口径错误：R1 起初不认「门洞整段」（把拓宽出来的两格当成漏风），R8 起初漏了 legend 里的裂隙口（`X`）都按引擎 `compileScene` 的口径修好了。

验证：443 项全绿；validate 0/0；真浏览器三窗口自检全通过（含相机稳定性）；重截 `preview_text.png`。

## 固定视口里程碑：视口固定，场景偏移（2026-10-01）

**问题**：字号按「当前场景尺寸」算、分栏也按场景算  60x22 的房间 23px，走进 88x28 的地表跳到 15px，分栏还会翻。
另外门虽然画成 3 格宽，但判定还在中间的 1 格上（踩边上那格出不去）。

**改法**
- `Game.getViewSize()` + `Game.viewW/viewH`：视口来源 `config.viewW/viewH` -> 旧名 `mapDesignCols/Rows` -> 全部场景的最大宽高（旧档没这个字段也能跑）。
- `layout()` 用视口算分栏和地图区，并给出**视口窗口** `winX/winY/winW/winH`（在地图区里居中）。
- `render()` 用 `originX/originY` 把场景放进窗口：`场景 <= 视口` -> 原点为正、居中、相机固定 (0,0)；`场景 > 视口` -> 原点为负、相机跟随并 clamp 在 `[0, 场景-视口]`。窗口外直接不画。
- `screenToScene()` 改成 `(屏幕 - 窗口) - 原点`；外壳的鼠标点击边界也换到视口窗口。
- 小图四周描一圈 `+ - |` 边框（边缘字符不跟内容混）；大图在状态行显示 `视野 < > ^ v`。
- **门判定跟上外观**：`compileScene` 新增 `doorMap`，把 3 格门洞的每一格都映射到同一扇门（出口自己那格优先，挨着的两扇门不互相覆盖）；`takeExit()` / 查看格子都先查 doorMap。

**验证**：456 项全绿；validate 0/0；真浏览器三分辨率  全部 26 场景相机稳定 + 5 项验收全通过（见交付报告）。

## 副任务里程碑：生成器支持 --wire（2026-10-01）

- 生成器以前只出「门没接线」的骨架；现在加 `--wire`：**一步产出能走的随机站**。
- **接线规则**：先把相邻场景接成一条链保证连通（已经连通的跳过，不重复接）；剩下的门按「方向相对 NS / WE > 门口坐标对齐」两两配掉；每扇门的落点取门内侧最近的可走格；**已有接线一律不覆盖**，冲突只警告。
- **幂等**：同一份文件跑两次 `--wire`，字节完全一致、`sceneTransitions` 数量不变（实测 3 次 SHA256 相同）。
- 顺手修了生成器一个真 bug：`carve_doors` 原来把「3 格门洞的每一格」都登记成独立出口（一张图 6-12 扇门），改成**一扇门只登记中间那一格**，其余两格交给引擎的 `doorMap`（和真实内容一个约定）。
- 新入口 `tools/scaffold_scene.py`（`--scenes N --seed S --wire --out f`）：产出标准 mod 形状，可直接放进 `mods/` 或粘进 F2。
- 新增两个可复现的命令：`gen_maps.py --wire-selftest N`（数据层：全门有 transition / 全图连通 / 幂等）和 `gen_maps.py --check-engine <file>`（**用引擎真跑**：门能不能走 / 全图连通 / 落点可站）。
- 验证：`--wire-selftest 6` 18 张图 0 失败；`--check-engine` 6/6 门能走、连通 3/3、落点全可站；`--selftest 10` 50 张图 0 失败。

**主任务 + 副任务都完成，全绿。**

## 事件  功能文本：情报板（2026-10-01）

**问题**：事件改的是 counters / flags / world.pending，但终端显示的是**静态数据块**（`resources.amount`、`fleets.list`）
玩家根本看不到事件的结果；「待上报事件」和「事件链进度」更是完全没有界面。

**改法**
- 引擎新增 3 个视图提供者（都走 `registerViewProvider`，词表守得住）：`pending_events`（待上报事件，按优先级）、`chain_progress`（每条链走到第几步）、`situation`（活计数器：当前 / 开局 / 变化）。
- `buildViewLines` 支持**段落级 provider**（`sections[].provider`）：一个终端里可以「活数据段 + 静态文案段」混排。
- 新终端 **情报终端**（指挥中心 (50,6)，字符 `v`）+ **情报板**视图，三段全部是活数据。
- 情报板三个动作「调阅最新情报  一 / 二 / 三」-> `pending_set` 触发三条新事件 `ev_intel_01..03`，并用 `intel_N_done` **链式解锁**（做完一条才出下一条）。
- 三条情报事件的选项带**功能效果**：`npc_post`（把测绘员调去登陆点）、`counter_add`（data / alloy / morale / pollution）、`set_tile`（裂隙入口立标记）、`discover`（记录坐标）。
- 资源终端改成「现场盘点（活数据）+ 账面基数（静态）」对照；舰队终端加 `{counters.fleets}` / `{counters.pollution}` 一行。

**闭环**：终端 -> 触发事件 -> 事件选项改世界 -> 终端当场刷新（`viewChoose` 之后 `refreshView()`）。

**验证**：`test_world` 新增 16 项；`test_arch` 新增「视图提供者都注册过」；473 项全绿；validate 0/0；真浏览器自检新增 5 项情报板交互全过。

## 设计层：玩法结构（2026-10-01，进行中）

工程侧功能已够，缺的是「数值的出口」。按设计师视角单开一份文档 **`DESIGN.md`**（只出设计，不写代码、不加内容）：

- **第 1 段（已落盘，待确认）**：AI_CONTEXT 第 6 节的 6 处过时项 + 三个问题（能做什么 / 为什么做 / 30 分钟后想什么）+ 核心循环（读盘 -> 选路 -> 决策 -> 结算 -> 回读 -> 驱动，含每环节消耗与不确定性）+ 三层目标（短期 pending -> 中期链与污染 -> 长期胜负条件）。
- **第 2 段（待写）**：张力曲线 + 深渊设计（3 个场景脚本）+ 20 个数据块的组合矩阵。
- **第 3 段（待写）**：反馈节奏表 + 510 个困难选择 + 设计 -> JSON 映射表。

一句话结论：**内容够了，缺的是把 counters 变成后果的规则。**

（本轮没有改任何代码 / 内容：`space.json`、`engine/`、`tests/` 一字未动。）

## 基础互动内容：12 个只读面板全部可用（2026-10-01）

**问题**：21 台终端里只有 9 台有真动作（星图 / 研究 / 记录点 / 情报板 / 穿梭机列表 / 椅子铺位），其余 12 台面板打开来只有「关闭」
面板是死的，玩家按 E 之后无话可说、无事可做。

**改法**（纯 JSON，只用已有效果词；每个动作的文案里直接写清「代价 -> 收益」）：
- **仓库**：合金换口粮 -20+5 / 调口粮给殖民地 -5民情+8 / 盘点（1 小时）
- **建造**：扩建船台 -30 合金（`start_build`，进度会自己走）/ 加固掩体 -25 合金
- **通讯**：派遣使节（4 天，`random`+`if` 决定成败）/ 粮食援助 -20 口粮 / 情报互换（2 天）
- **医疗**：治伤 -1 药品HP 满 / 隔离观察 -1 药品接触者-1 / 全员体检（3 小时）
- **军械**：领装甲 -5 合金 / 领破门装药 -10 合金 / 交还装甲 +3 合金
- **矿场**：加班出矿 -2 民情今日+30 吨 / 停工检修（2 小时）明日+20
- **农场**：紧急抢收 +4 口粮 / -1 民情 / 育种试验 -5 合金口粮+2
- **防御**：警戒二级（民情-1）/ 补给炮位 -10 合金 / 组织演习（2 小时）民情+2
- **档案**：调阅旧档（1 小时）数据+1 / 解读遗物 -1 遗物数据+2
- **气象**：看天色（不花时间，给提示）/ 露天休整（3 小时，`rest` 回疲劳）
- **打捞**：派打捞队（4 小时）合金+25 / 污染+1 / 只回收登记坐标（2 小时）零件+5
- **贸易**：卖合金换数据 -15+2 / 买燃料 -10+20 / 和拾荒者谈一笔（2 小时，`random` 赚或赔）
- **星图**：补绘星图（1 小时）数据+1（原来只有「任务进行中」才出现的那一个动作，开局是空面板）
- **舰队**：调一支舰队回防索尔 -1 舰队`home_guard`、民情+2 / 解除回防 +1 舰队（这是「舰队离开主防线」的第一个玩法支点）

**验证**：`test_world` 新增第 10.6 节（每个终端面板都必须有「不是关闭」的动作；每个面板当前可用的第一个真动作点下去**必须改变世界**，17 个面板逐个验）；
真浏览器自检新增 5 项（面板动作存在 / 点了数值真变 / 面板还活着 / 舰队面板动作）；475 项全绿；validate 0/0。

## 设计文档补齐：DESIGN.md 第 2/3 段（2026-10-01）

`DESIGN.md` 从「第 1 段」补齐到**三段全**（352 行），设计师视角、不写代码、不加内容：

| 段 | 内容 |
|---|---|
| 第 2 段 | **张力曲线**（D1D13+ 的 010 曲线、紧张源/放松源两张表、「每天怕的东西不一样」递进表）；**深渊作为威胁**（视觉/信息/机制三层施压、为什么不可对话不可谈判、7 个结局的代价表、**3 个场景脚本**）；**20 个数据块组合矩阵**（谁读取/什么条件生效/改变什么/玩家能感知吗/本版本接不接）|
| 第 3 段 | **反馈节奏表**（每 tick / 10 / 100 / 1000 / 5000 tick）；**8 个困难选择**（背景 + 两个都对 + 各自代价收益 + 为什么 5 秒算不出）；**R1R13 设计JSON 映射表**；**自检对账** |

关键结论：
- 20 块里 **10 个已接 / 3 个半接 / 2 个待接 / 5 个明确不接**（矩阵逐块写明）。
- 七个结局里**没有"打赢深渊"**：`win_purge`/`win_seal`/`win_know` 是"处理它"，`win_contain` 是"没赢也没输"的诚实结局。
- **R1R13 全部可纯 JSON 完成**（`end_game` / `random.table` / `if` / `start_build` / `set_tile` / `npc_post` / `advance_ticks` / `rest` 都已存在） 本设计**不需要改引擎**。
- 节奏唯一短板：**每 1000 tick 的"局势级变化"偏慢**（危机要 pollution 到 3 才动），解法是 R4 让"无视类"选项更多 +1 污染。

## 设计映射落地：R1/R2/R3/R5（2026-10-01）

把 `DESIGN.md` 9 映射表的前四组变成 JSON（全部纯 JSON，**没改引擎**）：

| 编号 | 落地内容 |
|---|---|
| **R1 胜负判定** | 9 条 `hook`（`on:"tick"`, `every:60`, `once:true`）：败北 4（污染15 淹没 / 民情0 哗变 / 舰队0 舰队尽没 / 人口0 灭绝）+ 胜利 5（`core_sealed` 封印 / `rifts_closed`+污染0 净化 / `rifts_closed`+污染6+第12天 隔离 / 停火+结盟 共存 / 20 遗物+`gate_read` 答案）。用已有的 `end_game` 效果词收尾。|
| **R2 数值契约** | `lose_pollution` 从 12 改到 **15**，和第六阶段对齐第五阶段（12）成为真正的终局窗口，不再是"一进第五阶段就判负"。|
| **R3 深渊杂音** | `hook_abyss_voice`（`tick` + `every:240` + `condition: pollution>=6`）用 `random.table` 抽三条杂音（其中 3/10 概率什么都不发生）。|
| **R5 遗物来源** | 10 条遗迹事件的「深入勘探」选项各带回 **2 件遗物**（102=20，正好够 `win_know`）；打捞面板「派打捞队」加 35% 概率捞到 1 件。|
| **R6 人口** | `pop` 变成活计数器（2000）+ `resources` 条目；第三阶段 `pop-15`、第四阶段 `pop-25`，让 `lose_extinct` 有来源。|
| 玩家手里的出口 | 星图终端加「组织净化作业 -25 合金  污染-1」「封锁裂隙 -40 合金  裂隙全关」；情报板加「关上裂隙核心（污染12 且 3 支舰队）」；外交终端加「向铁合唱提议停火」「与帷幕公约缔结同盟」；档案终端加「解读「门」（需 20 件遗物）」。|

**顺带抓到一个真 bug（数据不一致）**：`morale` 以前**只有 `resources` 里的静态基数 72，没有 `initialState.counters` 条目**  于是我新加的「民情0  哗变」判定在开局就把 `undefined` 当成 0、直接判负（`test_space` 的星图断言当场变红）。
修法两道：`initialState.counters.morale = 72`（补齐）；`deserialize` 读档时用 `initialState.counters` **兜底补齐缺失的计数器**（老存档不会被新规则误判），并加了 3 项测试守它。

验证：493 项全绿；validate 0/0；真机自检新增 3 项（净化动作点了污染 21、合金 200175；污染 15  判负）全部通过。

## 数值出口二期：R4 舰队稀缺 + R8 科技解锁面板动作（2026-10-01）

按 `DESIGN.md` 9 的建议，把「数值出口」从 R1/R2/R3/R5 推到 R4/R8（**纯 JSON，没改引擎**）。

**R4 舰队稀缺**
- 10 条模板化 `fleet` 类事件的根节点各加第 4 个选项「抽调一支舰队前出盯着（-1 舰队）」：`cost {counter:fleets,amount:1}`、`data +1`、`morale +1`（第 11 条 `ev2_fleet_11` 本来就有自己的选项）。
- 条件带 `not flag:home_guard`：先在舰队终端按过「调一支舰队回防索尔」，这个选项**当场消失**（要恢复机动得先花一个动作解除回防）把 `flags.home_guard` 从文案变成真门槛。
- 舰队因此有了「不可再生的代价」：`fleets` 归零会踩到 R1 的败北线「舰队尽没」。

**R8 科技解锁面板动作**
- 研究终端新增 4 个方向：`tech_rift_detect` 裂隙探测（30）-> `tech_purge1` 初级净化（45）/ `tech_rift_seal` 局部封印（60）-> `tech_purge2` 区域净化（80）。
- 复用水循环回收那套「立项扣合金 -> `hook(tick,every:20)` 推进 -> 到点结算」：4 个新计数器 `research_*` + 4 条 hook，全部进存档。
- **星图终端**：「组织净化作业」加 `flag:tech_purge1`，「封锁裂隙」加 `flag:tech_rift_seal`；`tech_purge2` 新增更强的「部署广域净化场 -60 合金 污染-3」。
- 于是 `techTree` 从「立项完发点资源」升级为「科技是稀有数值的出口」：不研究，污染压不下去、裂隙封不了。

**新增测试**：`test_world.js` 第 9.11 节 15 项（舰队选项可点/扣舰队、`home_guard` 隐藏、净化/封锁无科技不可用、研究立项与完成、完成后面板出现并生效、新计数器进存档）；第 9.10 节补 `tech_purge1` 前置。

**验证**：508 项全绿（world 172 -> 187）；validate 0 错 0 警；地图规则 25 图 0/0；生成器 50 图 / 接线 15 图 0 失败；build exit 0（space-text.html 659.0 KB）；真机 `browser_check` 三档分辨率全过（新增 `acc_purify_gated`）。

## 数值出口三期：R6/R7/R9/R10/R11/R12/R13 收口（2026-10-01）

按 `DESIGN.md` 9 把剩下的接线一次做完（**纯 JSON，没改引擎**）。

| # | 做了什么 | 用了哪些块 |
|---|---|---|
| R6 殖民地 | 加 `hook_colony_supply`（`on:day`）：口粮 >= 12 民情 +1；口粮 < 12 民情 -2、人口 -4（`pop` 是活计数器） | `colonies`（情报板新增列表段）、`hooks`、`counters.pop/morale` |
| R7 派别 | 12 条 `internalPolitics[].support` 变成计数器 `support_*`（初值 = 原 support）；加 `hook_politics_daily`；6 个既有动作会推动支持度；外交终端列出全部派别 | `internalPolitics`、`resources`、`hooks`、`views`、既有动作 |
| R9 遭遇 | 5 个 NPC 日常对话的根节点挂 `dynamicOptions` 指向 `dialoguePools`（站上小聊 / 引擎室 / 仓库 / 殖民地 / 疲惫） | `dialoguePools`（从 0 引用变 5 处） |
| R10 环境 | 7 个 `enter_scene` 钩子按场景抽 `tp_*_ambient` 写 `log`（走廊 / 裂隙 / 舰桥 / 矿场 / 农场 / 医疗区 / 殖民地） | `textPools`、`hooks` |
| R11 hazard | 4 张地表场景标 `planetType`，`enter_scene` 时按 hazard 加疲劳（低温 +3 / 沙暴 +4 / 碎片 +3 / 高温 +5） | `planetTypes`、`scenes`、`hooks`、`stat_add` |
| R12 装模块 | 舰队终端加 6 个「装模块」动作（扣合金 -> `fleet_power` +N -> `installed_*` flag）；面板列出全部 34 条模块 | `fleetModules`、`views`、`counters.fleet_power` |
| R13 抽池 | 打捞 / 矿场 / 农场的动作加 `random.table`，从 `tp_salvage_report` / `tp_colony_report` / `tp_*_ambient` 抽结果文案 | `textPools` |

**新增测试**：`test_world` 第 9.12 节 17 项（支持度初值 / resources / 每日结算 / 动作推支持度 / 殖民地掉人口 / 环境钩子引用 textPools / hazard 加疲劳 / 抽池 / 装模块 / dialoguePools 被引用）。

**验证**：525 项全绿（world 187 -> 204）；validate 0/0；地图规则 25 图 0/0；生成器 50 图 / 接线 15 图 0 失败；真机 `browser_check` 三档分辨率全过；build exit 0（space-text.html 671.5 KB）。

## 世界生成：一个种子一个宇宙（群星  矮人要塞  CDDA，2026-10-01）

玩家反馈「能去的地方太少」。这一轮把「一张固定地图」升级成「可生成、可扩张、可装的世界」。

- **新工具 `tools/gen_world.py`**：一个 seed -> 一个世界。用 `tools/gen_maps.py` 的 5 种原型生成 18 个站点、
  41 张互相连通的地图（同 seed 同世界，幂等；`--selftest` 自检）。
- **站点 = 星系节点**：每个站点同时写进 `galaxy.nodes`（`owner` 归属 / `fleets` 舰队 / `pollution` 污染），星图终端直接显示。
- **能去**：每个站点一条 `shuttles` 目的地 -> 空间站的穿梭机终端（列表菜单，不受 1-9 快捷键限制），
  落地后站点内 2~3 张地图用门连成一片。
- **可装（CDDA 式）**：产物是标准 mod `mods/generated_world/mod.json`，F2 可直接装 / 换。
  换世界：`python tools/gen_world.py --seed 别的 --sites 24`。
- **验收**：`test_build` 新增 6 项（场景合入 / 穿梭机都能落地 / 每站点连通 / 星图节点）。
- **验证**：531 项全绿（build 39 -> 45）；validate 0/0；地图规则 25 图 0/0；`gen_world --selftest` OK；
  真机 `browser_check` 三档全过；产物 671.5 -> 771.8 KB。

## 世界层二期 + 交互反馈：战略动作 / 任务进度 / 阅读弹层（2026-10-01）

新增 `VISION.md` 作为后续 AI 的**目标参考**（群星 / 矮人要塞 / CDDA 三条参照 + 体验目标 + 路线图）。本轮把世界层从「能去」推到「能经营」。

- **站点战略动作**：空间站新增「世界地图终端 W」-> 选站点 -> 档案里做 勘测（数据 +1）/ 宣示主权（-20 合金）/ 建立殖民地（-30 合金 -5 口粮，人口 +20）/ 交涉（-10 口粮，民情 +3）/ 开战威慑（-1 舰队，污染 +1）；每个动作有 condition / cost / effects，并推进站点状态计数器。
- **五个全局指令 + 进度**：`gw_surveyed` / `gw_claimed` / `gw_colonized` / `gw_relations` / `gw_wars`；`missions` 各带 `progress:{counter,target}`。
- **长文本弹层（引擎新增）**：`open_reader` 效果 + `Game.openReader/drawReader`，行级滚动、PgUp/PgDn 翻页；按 `L` 看日志全文，按 `M` 看任务与指令进度（进度条）。长剧情不再塞进侧栏日志。
- **终端反馈（引擎新增）**：`viewChoose` / `viewSelect` 之后把最后一条日志显示成 **flash**（终端标题右侧高亮），动作的后果一眼可见。
- **生成世界升级**：`tools/gen_world.py` 产出 18 站点 / 44 场景 / 20 视图 / 18 穿梭机 / 18 星图节点 / 5 指令；站点名改用 ASCII 分隔符（`` 会被 ASCII 映射，真机标题对不上）。
- **UX 约定**：只做玩家主动打开的弹层（对话 / 终端 / L / M），仍然没有自动弹窗；写进 `VISION.md` 第 5 节。

**验证**：547 项全绿（shell 78 -> 86 / build 45 -> 53）；validate 0/0；地图规则 25 图 0/0；生成器 50 图 / 接线 15 图 / 世界 0 失败；真机 `browser_check` 三档全过；产物 771.8 -> 864.2 KB。

## 站点内内容：NPC / 采集点 / 到达事件（2026-10-01）

`VISION.md` 路线图第 1 条。`tools/gen_world.py` 现在给每个生成站点注入站内内容（纯 JSON，没改引擎）；生成地图 44 -> 46 张。

- **站点 NPC**：每站 1 个（值班员 / 工头 / 勘探员 / 舰员 / 观测员），带日程（站在开阔地板上）+ 对话（介绍站点 / 指引采集 / 阅读完整档案 / 一次性小礼物）。
- **采集点**：每站 1 个，按原型给不同产出：中继控制台（数据 +1）/ 采集井（合金 +5）/ 地表采样站（今日矿石 +25、疲劳 +3）/ 打捞吊臂（零件 +8）/ 裂隙观测仪（数据 +2、30% 污染 +1）。采集动作只在**站在该站点地图上**时出现（`scene` 条件），不能远程采集。
- **到达事件**：每站 1 条 `visited` 触发的事件 + 1 条 `npcApproach`；到站点会挂 pending，走到站点 NPC 面前他会报告一件现场事，2 个选项（收益 / 稳妥）真的改 counters / flags。
- **放置**：NPC 日程点只选 `.` 地板；采集点用 `tileEdits` 放在 `#` / `^` 实心格上（不改变连通性）；地图规则 R1~R11 不变。
- **测试**：`test_build` 新增 10 项（日程点可走 / 采集点开自己档案 / 到达事件 pending / NPC 上报 / 选项改世界 / 站内可见采集 / 远程隐藏）。

**验证**：557 项全绿（build 53 -> 63）；validate 0/0；地图规则 25 图 0/0；`gen_world --selftest` OK；真机三档全过；产物 864.2 -> 939.6 KB。

## 修复卡关：生成站点回家路径（2026-10-01）

玩家反馈：走到生成站点后没有回家的办法，是卡关。

- **原因**：`shuttles` 只连「空间站 -> 站点」，生成站点里既没有穿梭机终端，也没有回索尔的目的地；走出穿梭机就回不去了。
- **修法（双保险）**：
  1. 每个生成站点首图用 `tileEdits` 放一台 **`shuttle_terminal`**（和采集点各占一格实心格，互不覆盖）；
  2. `shuttles` 加一条全局 **「返回索尔空间站」** 目的地（`scene: station_command`，2 小时），任何穿梭机终端都能选到；
  3. 站点档案里再加一个 **「返回索尔空间站（2 小时）」** 动作（`not scene:station_command` 时才出现），找不到终端也能走。
- **测试**：`test_build` 新增 4 项返回目的地在列表里 / 每个站点首图都有穿梭机终端 / 站点档案有返航动作 / 点返航真的回到 `station_command`。
- 生成地图 46 -> 42 张（修 cells 时多用了随机数，RNG 流变化，同 seed 仍确定性）。

**验证**：561 项全绿（build 63 -> 67）；validate 0/0；地图规则 25 图 0/0；`gen_world --selftest` OK；真机三档全过；产物 939.6 -> 933.0 KB。

## 修两个严重问题：单向卡关 + 结束无法重开（2026-10-01）

玩家要求「思考两个严重问题，让基础架构能循环游玩」。实测确认并修复：

1. **上船回不来（单向卡关）**：base 的 `sh_flag`（旗舰）目的地是 `ship_bridge`，而 `ship_bridge` / `ship_engine` / `ship_medbay` / `ship_cargo` 既没有穿梭机终端、也没有门能走回有终端的场景玩家上船就出不来。
   - 修法：base `shuttles` 加一条全局 **「返回索尔空间站」**（`sh_return`  `station_command`）；`ship_bridge` 用 `tileEdits` 放一台 `shuttle_terminal`；生成站点首图也放穿梭机终端（回程目的地由 base 提供）。
   - 防回归：`test_world` 5.5「每个场景都能走回一台穿梭机终端」；`test_build`「全图（含生成站点）没有单向场景」。
2. **结束即死局（无法重开）**：`end_game` 只写 `world.gameOver` + 一行日志；没有结束画面、没有重开入口，`tryMove` / `interact` 直接返回 false，世界还在继续 tick。
   - 修法：引擎加 `drawGameOver` 结束叠加（胜负 + 原因 + 天数/舰队/污染/民情 + `[R] 重新开始`）；`tickOnce` / `onTick` 在 gameOver 后直接返回（冻结）；外壳加 `newGame()`（同一份内容重开一局）与 `R` 键；信息栏显示结束提示。
   - 防回归：`test_shell` 6.6「污染15判负 / 结束画面有重开提示 / 冻结 / R 重开回到起点 / 新局能继续走」；真机 `acc_gameover_screen` / `acc_gameover_frozen` / `acc_restart`。
3. **顺带修一个真 bug**：`resolveLegendEntry` 会把 `tileEdits` 里显式的 `ch: undefined` 覆盖到已解析的 interactable symbol 上  所有用 `tileEdits` 放的物件（含生成站点的采集点 / 穿梭机终端）在画面上是空字符。改成「显式 undefined 不覆盖」。

**验证**：570 项全绿（world 204 -> 206 / shell 86 -> 92 / build 67 -> 68）；validate 0/0；地图规则 25 图 0/0；`gen_world --selftest` OK；真机三档全过（含结束/重开 3 项）；产物 933.0 -> 935.5 KB。

## VISION 第 6 节推进：站点内容加深 + 战略层深化 + 三层生成 + 回程硬校验（2026-10-01）

- **站点内容加深**：每个生成站点从「1 NPC + 1 采集点」加到 **2 NPC + 专属建筑 + 随机遭遇 + 采集点**：
  - 第 2 个 NPC（技师 / 农民 / 拾荒者 / 轮机长 / 教徒）带日程 + 紧凑对话（指引建筑 / 阅读档案 / 一次性小礼物）；
  - **站点专属建筑**（补给站 / 粮仓 / 信标塔 / 拆解台 / 封印桩）各带一个有代价有后果的动作 + 阅读弹层；
  - **随机遭遇钩子**（`on:tick every:120` + `random.table`）：风味 / 小发现（数据 +1）/ 小麻烦（民情 -1）。
- **战略层深化**：新增引擎能力 **`galaxy_set` 效果 + `galaxy_live` 视图提供者 + `world.galaxy` 存档字段**。
  「宣示 / 殖民 / 交涉 / 开战」现在真的改星图节点的归属 / 关系 / 舰队 / 污染：星图终端（改走 `galaxy_live` provider）当场刷新，并随存档往返。
- **三层生成**：站点加了 **区域（4 个星区）** 与 **地下层**（每站 1 张 `under` 地图，门连通，可「地下开采」）；地图生成器新增 `under` 原型（`gen_maps --selftest` 60 图 0 失败）。
- **回程硬校验（第 2 个要求）**：
  - `tools/map_rules.py` 新增 **R13 回程安全**：每个场景必须能沿门走回一台穿梭机终端；`validate_space.py` / `map_rules.py` 自动检查，不过就是错误。
  - `tools/gen_world.py` 新增 `generated_return_unsafe`：**生成期就复核**每个生成场景能回到穿梭机终端，并复核 base；不安全直接 `RuntimeError` 拒绝产出（`--selftest` 也查）。
  - 原来的 `test_world` 5.5 / `test_build` 全图单向检查保留。
- **测试**：`test_build` 新增 10 项（地下层 / 首图三类物件 / 2 NPC + 遭遇 / 区域 / 建筑动作 / 地下开采仅地下层 / 宣示改星图 / 星图显示关系 / 存档往返）。真机三档全过（现在要开 58 个视图）。

**验证**：580 项全绿（build 68 -> 78）；validate 0/0（含 R13）；地图规则 25 图 0/0；生成器 60 图 0 失败；`gen_world --selftest` OK；真机三档全过；产物 935.5 -> 1070.8 KB；生成世界 18 站点 / 64 场景 / 36 NPC / 54 对话 / 55 物件 / 38 视图 / 18 遭遇。

## 地图视觉重设计：字符集 / 调色板 / 轮廓化 / 区域地板（2026-10-01）

**先纠正一个前提**：屏幕上的字其实**已经**是 ASCII —— `space-textout.js` 的 `toAscii()` 在黑白和彩色
两种模式下都会先跑一遍，`█→#`、`░→.`、`◆→*`。所以「把墙的字符从 █ 换成 #」本身接近视觉空操作，
真正决定观感的是**颜色、字形碰撞、以及墙有没有形状**。原诊断的三个结构性问题（对比度倒挂 / 视觉语言
不统一 / 没有层次）都确实存在，按下面的改法解决。

- **字符与语义（content/space.json）**：
  - `presets`：墙 `█`→`#`、地板 `░`→`.`、岩石 `◆`→`^`、货架 `#`→`[`，并给墙补 `"kind": "wall"`
    （以前墙格的 `kind` 是 `floor`，图例没法把 `- | +` 归回「墙」一条）。
  - **12 个「`#` 当货架」的场景做了结构性拆分**（指挥中心 / 研究所 / 船坞 / 通讯 / 仓库 / 军械 /
    矿场 / 工厂 / 防御 / 舰桥 / 引擎室 / 货舱）：这些图以前把**船体 / 房间骨架**也登记成「货架」，
    侧栏图例对着舱壁写「货架」，墙和货架还共用 `#`。现在按四邻自动分开：**完全孤立的 `#` 是货架**（改写成 `[`），
    挨着任何实心结构（含门框）的算结构骨架。312 格变 `[`、2461 格留在结构里；**通行性一格没变**。
- **调色板按信息优先级分层**：地板 `#333340`/黑、墙 `#4a4a5a`、门与记录点 `#ffcc44`、物体 `#559966`、
  岩石 `#6a5540`、未探明 `#0b0b12`（比虚空 `#06060a` 亮一档）、玩家 `@` `#55e6ff` 最亮；
  另补 `info` / `dim` 两个日志色（内容的 407 条 `info` / 60 条 `dim` 以前都落到兜底灰 `#c9c9d8`）。
- **墙轮廓化（引擎，`shapeWalls()`）**：成行的实心结构按四邻画成 `-` `|` `+`，端点与孤立格留 `#`；
  门算结构邻格，所以门口两侧的墙不会被当成端点。**只改显示字符，不动 `pass` / `kind` / 物件引用**。
  侧栏图例按类别字符归一：墙只列一条 `#`（不会因为 `- | +` 列出三四条，也不和门的 `+` 撞名）。
- **地板按场景类型分层（引擎，`config.floorByType`）**：空间站 `.` / 地表 `,` / 裂隙 `;` / 舰内 `:` /
  殖民地 `'`。**映射全写在内容里，内核不认识任何场景类型**；生成世界的 65 个场景自动跟着变（它们也有
  `type`），不用重跑生成器。图例里显示对应名字（地表 / 舰内地板 / …）。
- **未探明改成空白**：`config.fogChar` 从 `·`（会被映射成 `,`）改成一个空格，靠背景色比虚空亮一档区分；
  地表从此是「走过的路 + 记忆 + 一片黑」，而不是一整屏逗号。
- **小图不再重复描边**：场景自带一圈墙（门不算漏，`ringClosed()`）时跳过 `render()` 的 `+-|` 描边 ——
  否则新画出来的 `- | +` 墙会和描边叠成两层。
- **污染投影阶梯**改成 ASCII 原生且语义递进：`. : % X`（以前 `░▒▓█` 会被映射成 `.%%#`，中间两级重合）。
- **新工具 `tools/shot.js`**：Edge/Chrome headless 截彩色 PNG（`node tools/shot.js station_command 1440,810`）。
  默认是黑白模式，调色板只有切彩色才看得到，而黑白模式下 `toAscii` 会把块字符全映射掉 —— 截图是唯一可靠的
  「人工看一眼」。`preview_text.png` 用它重截。
- 第 5 步（小图边框换 `─│┌┐`）**故意没做**：`toAscii` 会把它们映射回 `- | +`，两种模式下都是空操作。

**验证**：607 项全绿（arch 73→100，新增 27 项：轮廓化 / floorByType / 货架拆分 / 图例归一 / ringClosed）；
validate 0/0；地图规则 25 图 0/0；生成器自检与真机三档全过；产物 1070.8 → 1075.6 KB。

## 发布：上传到 GitHub（Kono1357/space-game）+ GitHub Pages（2026-10-02）

- 新增两个**仓库专用**文件（不参与构建、不影响产物）：
  - `index.html` —— 给 GitHub Pages 用的入口壳，`meta refresh` 跳到产物 `space-text.html`（不复制产物，避免两份漂移；页面里写明「要改就改内容/引擎再 build」）。
  - `.gitignore` —— `__pycache__/` `*.pyc` `.ctx_stamp` + 编辑器/系统垃圾。
- `README.md` 顶部加「在线玩」链接：<https://kono1357.github.io/space-game/>。
- 上传方式：**本机没有 git**（PATH 与常见安装位置都没有 `git.exe`），所以用 **GitHub Git Data API** 走一次「blob → tree → commit → ref」，得到**一个干净的初始提交**；token 只走请求头，**没有写进项目或任何文件**。
- 产物与内容**一个字节都没改**：`space-text.html` 仍是 1101821 B。

**验证**：构建 exit 0；`node tests/run_all.js` 607 项全绿；validate 0 错 0 警；仓库 `Kono1357/space-game` 默认分支 `main` 建立成功；Pages 入口可访问。

## 让命令链不再依赖机器：性能预算系数 + 产物换行符（2026-10-02）

### A 性能预算的环境系数

- **背景（真问题，不是洁癖）**：第 3 步里有 7 条断言量的是**毫秒数**，而毫秒数取决于机器。在比开发机慢的机器上（Android 容器）实测 2 条红：`单帧合成 < 6ms` 实测 6.2250ms（超 3.7%）、`路径缓存之后每 tick < 3ms` 实测 3.033ms（超 1.1%）。按 `CONTRIBUTING.md` 第 5 步「测试不全绿 → `update_context.py` 拒绝写文档」，整条命令链会**卡死在第 5 步** —— 于是任何改动都无法按协议交付，只能绕过去。机器速度不该冒充代码回归。
- 新增 **`tests/perf_budget.js`**：性能预算的乘子。取值优先级 `SPACE_PERF_SLACK` 环境变量 > 仓库根 `.perf_slack` 文件（内容就是一个数字，已加进 `.gitignore`）> **默认 1.0**。
- 7 条毫秒断言**全部**改成 `PERF.budget(N)`（`test_space.js` 2 条：单 tick / 单帧；`test_arch.js` 5 条：30 人重寻路 / 缓存后每 tick / 20000 tick / findPath / 单帧）。**不是只改红的那两条** —— 只改红的，下次机器再慢一点就会翻别的。
- **防「偷偷放水」三道闸**（缩放的绿灯必须一眼看得出来，不许冒充真绿灯）：
  1. `tests/run_all.js` 原来只回显 FAIL 行和汇总行，会把 `⚠` 吞掉 —— 现在把 `⚠` 行原样带出，并在末尾追加一条总提示；
  2. 缩放生效时断言标题会带 `[预算×1.5]`，光看通过清单就知道哪几条被放松过；
  3. `tools/update_context.py` 用 `capture_output=True` 跑回归，`⚠` 到不了屏幕 —— 现在它读原文里的 `⚠`，额外打印一条警告，写 `AI_CONTEXT.md` 时那行也变成「测试 607 项全绿（性能预算已缩放，非开发机数据）」。
- **默认 1.0** 意味着开发机上逐字节和以前完全一样：判定写法没改、被测代码没改、没有跳过任何一条测试。
- 系数取 1.5 的依据：实测超标幅度 1%~4%，1.5 留够余量，又不足以掩盖真实回归（性能真退化 50% 照样红）。
- 协议变更按 §E 登记进 `CONTRIBUTING.md`「补充约定」。

### B 产物换行符与平台解绑（顺手修的既有 bug）

- **`build_space.py:102` 原来没写 `newline=`**，Python 默认会把 `\n` 翻成 `os.linesep`：于是**同一个仓库在 Windows 上构建出 CRLF、在 Linux 上构建出 LF**，产物字节不一致。
- 证据：仓库里 HEAD 的 `space-text.html` 是 **3977 行全 CRLF**（Windows 构建的产物），而 `content/space.json` / `engine/*.js` / `space-text.tpl.html` / `README.md` 全是 LF —— 说明当初的产物是在 Windows 上构建的。
- 危害有三：① `AI_CONTEXT.md` 记的产物体积（1076.0 KB ↔ 1072.1 KB）随机器变，制造假的「文档过时」；② 换机器构建一次，`git diff space-text.html` 就是整文件 3977 行；③ 「产物与磁盘一致」这类判断失去意义。
- 修法：`io.open(OUT, 'w', encoding='utf-8', newline='\n')` —— **产物一律 LF，与平台无关**，和仓库其余内容文件的写法一致。
- 一次性代价：产物从 CRLF 翻成 LF，本次提交里 `space-text.html` 会显示为整个文件重写（3977 行）；此后任何机器上构建都是同一串字节。

**验证**：`node --check` 三个引擎文件 OK；`build_space.py` exit 0；`node tests/run_all.js` **607 / 0**（性能预算已缩放，⚠ 如期出现在链的输出里）；`validate_space.py` 0 错 0 警；`map_rules.py` 25 个场景全过；`gen_maps --selftest 10` 60 张图 0 失败；`gen_maps --wire-selftest 5` 15 张图 0 失败；`gen_world --selftest` OK；`update_context.py` 复跑幂等（「已是最新，仓库未变」）。整链耗时 101s。

## mod 安全网：校验器终于看得懂 mod（第 1 期，2026-10-02）

### 为什么这是当前最该修的东西

`tools/validate_space.py` 以前**只吃一个文件、独立校验**。拿一个 mod 喂它：

```
$ python tools/validate_space.py mods/example_mod/mod.json
  场景 0 / 人 0 / 对话 0 / 物件 0 / 视图 0 / 日程 0
  错误 0 / 警告 0          ← 官方示例 mod，静默假通过
```

而 mod 是**被合并进产物**的。于是「玩家改坏了 mod → 校验器说没问题 → 进游戏地图整片变实心」是一条完全通畅的路。**低门槛 CDDA 路线的致命伤不在功能，在这里** —— 门槛低但踩雷没人拦，比门槛高更劝退。

### 做了什么

- **`tools/space_merge.py`（新）**：把引擎的合并语义（`normalizeSpace` / `applyMod` / `mergeBlock` / `mergeAtPath` / `patchItem` / `deepMerge`）逐条移植到 Python，纯标准库、不需要 Node。`SPACE_BLOCKS` / `NESTED_BLOCKS` **从 `engine/space-core.js` 里读**，不另抄一份 —— 加了新块只要改引擎，Python 自动跟上；解析不出来直接报错，绝不静默兜底。
- **`tools/validate_space.py` 改造**：
  - 新增 `--mods <文件...>` / `--mods-dir <目录>`：合并之后再校验，**结论以合并结果为准**；合并期问题（撞 id、没声明 `allowRemove` 就删、条目缺 id）也进结论；
  - **把 mod 当内容传进来会明确拒绝**（exit 2 + 正确用法），不再输出「场景 0 / 错误 0」冒充通过；
  - 老用法（不带参数 / 传一个内容文件）**逐字不变**，命令链第 4 步照旧。
- **`build_space.py` 加构建期闸门**：合并 mod 后校验，有错误 **exit 1 且不写产物**（闸在写文件之前，验证过产物 mtime 不动）。逃生口 `--no-check`。`CONTRIBUTING` 第 2 步本来就写着「看报错：…校验器报了错误」，只是以前没接上。
- **`tools/map_rules.py` 两个失真修复**（都是为了「规则看到的就是引擎看到的」）：
  1. **`grid_of` 不看 `tileEdits`**：mod 用 `tileEdits` 凿出来的门，在规则眼里仍是一堵墙。实测 `mods/example_mod` 在 `station_corridor (0,6)` 凿的门，引擎 `isPassable()` 返回 **true**，规则却报「R4 出口不可走 (0,6)」——**对完全合法的内容报假错**。现在新增 `eff_tiles()` 按引擎 `compileScene` 的口径把编辑盖上去（含 `resolve_ch`、越界跳过）。
  2. **可走性判定与引擎相反**：规则用 `bool(entry['passable'])`，引擎用 `pass = 0 if (d.passable === false or d.solid) else 1`。对「既没写 `passable` 也没写 `solid`」的图例条目，引擎说可走、规则说墙。新增 `entry_passable()` 照引擎抄（含 `=== false` 的严格比较）。
  3. `scene_exits(scene, space)` 也跟着用 `eff_tiles`，否则 `tileEdits` 写进去的出口字符会被漏掉。
- **三条新测试，护住上面这些承诺**：
  - `tests/test_merge_parity.js`（26 项）：20 个语义角落各一个 mod（四种 `_op`、`_append`、`defaultOp`、嵌套块 4 种、块内子键、`_howToAdd`/`_example`、白名单外自定义块、priority/order、config/palette/presets、缺 id、删不存在的 id、扁平 mod 形状、未知 `_op`），加真实内容 + 两个真 mod 的全量合并，**两边结果的 JSON 必须逐字节一致**；另有反向保险确认比较器抓得住人为篡改。
  - `tests/test_maprules_parity.js`（11 项）：**90 个场景 / 135160 格逐格比对**规则矩阵与引擎编译出来的 `pass`，并专门钉死 `tileEdits` 那个坑，再用「拆掉 tileEdits 应变回墙」做反向保险。
  - `tests/test_validate.js`（29 项）：假通过必须死（exit 2）、`--mods` 合并后校验、坏 mod 报错 exit 1、构建期闸门不写产物、撞 id 要可见、参数错误要说清楚。

### 顺带抓出来的真问题（以前谁都看不见）

校验器一旦看得见 mod，**第一件事就是报出了官方示例 mod 的问题**：

- `mods/example_mod/mod.json` 的 `mod_observatory` 是 **30×12**，而 R9 要求宽 44~104、高 14~36 且都是偶数 —— 违规；
- 它的门只有 **1 格**（`+` 在第 6 行右边框），而 R2 要求门洞 **>= 3 格**；基础内容里每个门都是 `##+++##`（README 第 7.5 节和 `station_corridor (0,18)` 都能对上），示例 mod 没照这个约定写；
- 它给 `station_corridor` 用 `_append` 凿的门也只有 1 格高 —— 同一处违规。

已修：观景台改成 **44×14**、门开到右边框 **3 格**（第 5/6/7 行），中央大厅的门凿成 **(0,5)(0,6)(0,7) 三格**，并给场景加了 `_howToAdd` 说明门必须 3 格。修完 `--mods-dir mods` 恢复 **0 错 0 警**。

> 这条值得记：示例 mod 是发给每个新手的模板，它自己违规 = 教错所有人。以前校验器看不见 mod，所以这个错误一直没有出口。

**验证**：`node tests/run_all.js` **673 / 0**（原 607 + 新增 66：merge_parity 26 / maprules_parity 11 / validate 29）；`validate_space.py` 基础内容 0 错 0 警、`--mods-dir mods` 合并后 0 错 0 警；`build_space.py` exit 0（新增「校验 合并 2 个 mod 后：错误 0 / 警告 0」一行）；带坏 mod 构建 exit 1 且产物未被写；`map_rules.py` 25 场景全过；`gen_maps --selftest 10` 60 张图 0 失败；`--wire-selftest 5` 15 张图 0 失败；`gen_world --selftest` OK。整链 125s。

## 命名与文化体系：名字终于有「谁起的」了（第 2 期，2026-10-02）

### 改之前是什么样

名字来自**一个全局音节池**：`SYL_A`（28 字）+ `SYL_B`（24 字）+ 12 个类型词，`unique_name(rnd, used)` ——
签名里根本没有「这是谁的站点」。于是深渊的矿站、铁合唱的前哨、残响议会的殖民地，起名的是同一个脑子：

```
远锚-残骸区   索谷-残骸区   尘镜北尔-荒野   环丘灰湾-观测点      （谁都像，也谁都不像）
值班员 环塞   技师 灯尔     工头 晨脊       农民 索台
```

而手写层是另一套，而且明显更好：**索尔 / 长夜锚地 / 回声枢纽 / 铁砧 / 帷幕星云 / 凯尔 / 石川** ——
都是**有意义的词**。两层名字互不相干，`gen_world.py` 完全读不到手写层，看起来不像同一个宇宙。

### 做了什么

- **新内容块 `nameCultures`**（`content/space.json`，登记进 `SPACE_BLOCKS`）：每套「语言」= 一组词表
  - `owners`：哪些派系说这套话（决定用哪套词）
  - `placeA` / `placeB`：地名用词（词干 + 可选后缀字）
  - `personA` / `personB`：人名用字（`personB` 里放空串 = 这个名字只有一个字）
  - 块级 `fallback` 指定没有认领者时用哪套；`_howToAdd` / `_example` 齐全
  - **7 套语言覆盖全部 10 个派系**：索尔残响语 / 帷幕礼典语 / 共同体通用语 / 铁之锻语 / 深渊啧语 / 故帝国官话 / 边地土话
- **`tools/gen_world.py` 改成文化驱动**：
  - `load_cultures(space)` 读表（坏条目跳过并记问题，不崩）；`culture_for(by_owner, fallback, owner)` 选语言
  - `place_name(rnd, used, cult, kind)` / `person_name(rnd, cult)` 取代 `unique_name`
  - **归属要在起名之前定**：地名用的是归属方的语言，所以 `pick_kind` + `pick_owner` 上移到 `build_site` 之前
    （副作用：RNG 流变了，`gw1/18` 的世界从 64 场景变成 55 场景 —— 世界仍然合法可玩，只是换了张脸）
  - **类型词按站点种类挑**（新增 `KIND_SUF`）：裂隙带不会被叫成中继站
- **手写层与生成层并到一张命名表上**：`SITE_NAMES` 一开始就装进手写层的星系节点名与场景名，
  所以生成的地名**不可能**和手写的撞车（`索尔` 不会被生成器再起一遍）
- **`hub_cell()` 的真 bug**：它只扫地图内部找「墙 + 挨着地板」的格子，而中央大厅改成开阔大 hall 之后内部再没有 `#`，
  于是**每次都走兜底 `(1,1)`** —— 世界地图终端一直落在过道上，而且这正是签入仓库的
  `mods/generated_world/mod.json` **无法由代码复现**的原因。现在先扫内部、再扫整张图。
- **重新生成 `mods/generated_world/mod.json`**：产物与代码重新对齐（可复现性验过：重算 sha 与产物一致）。

### 现在的样子

```
tongue_frontier  矿脉场-殖民地  砾堆-殖民地  镐湾-穹顶  锈-残骸区      沙子 尘头 锈子 尘子 锈 砾头
tongue_veil      薄暮-中继站    白纱-中继站  缄台-观测点  灰烬阶-荒野    纱兰 空兰 暮妮 白娅 息妮
tongue_sol       穹顶台-锚地                                      岩见 铜满 铜尔 青川 铁尔 薇芙
tongue_iron      熔池环-穹顶    锻台-驿站                         锻号 铁一 铆三 炉七 钢号
tongue_abyss     断章冢-裂隙带                                    锈恩 沉 锈 烛姆 夜 灰斯
```

（`tongue_sol` 那套是照着手写层的词拟的，所以残响议会地盘上生成的站点和人，跟凯尔、石川听着像一个地方出来的。）

### 一个踩到的坑（值得记）

文化 id 一开始我写的是 `abyss` / `old_empire`，**和派系 id 撞了** —— 引擎会打印
「ID 跨块重复：abyss 同时出现在 factions 和 nameCultures」（`space-core.js` 的 `dupCheck` 是**跨所有块**查重的）。
现在全部改成 `tongue_` 前缀，并在块的 `_howToAdd` 里写明「id 跟所有块共用一个命名空间」，
省得下一个加语言的人再踩一次。

### 测试

新增 `tests/test_names.js`（30 项），守的是「数据驱动」而不是「换个写法硬编码」：

- 每套语言的**每个**生成名字，词干必须来自它自己的 `placeA`/`placeB`，人名必须来自它自己的 `personA`/`personB` ★
- 没有哪个站点用了**别的语言独有的词** ★（风格差异是被证明的，不是看着像）
- 类型词与站点种类对得上 ★；同 seed 确定；站点名不重复；**不和手写层 48 个地名撞车** ★
- **mod 加一套新语言 → 生成器真的用它** ★（`tests/fixtures/mod_new_culture.json`，一个字都不改 `gen_world.py`）
- 抢别人认领的派系**会报出来**（不是静默顶掉）★
- **坏掉的文化表只降级不崩** ★（`tests/fixtures/mod_bad_culture.json`：缺词表的、连 id 都没有的，跳过 + 报问题，生成照常）

顺手修的两处**坏断言**：`test_merge_parity.js` / `test_validate.js` 里把合并后的场景数**写死成 90** ——
内容一长大就得改测试。现在改成现算「基础内容的 id ∪ mods 带来的新 id」，是真正的不变量。

**验证**：`node tests/run_all.js` **705 / 0**（原 673 + 新增 32：test_names 30、parity 与 validate 改断言后各 +1）；
`validate_space.py` 基础内容 0 错 0 警、`--mods-dir mods` 合并后 0 错 0 警；`build_space.py` exit 0；
`map_rules.py` 25 场景全过；`gen_maps --selftest 10` 60 张图 0 失败；`--wire-selftest 5` 15 张图 0 失败；
`gen_world --selftest` OK（含新加的命名断言）；生成的 mod 与代码 sha 一致（可复现）。

## 0 一句话现状

底层框架（内容层 / 内核 / 外壳）已经完整可用，**607 项回归全绿**，开放性做到了：

> **只用 JSON、加东西不用改引擎、装了就能热加载（进度不丢）、合不进去会被点名。**

**本轮按 P0-P7 自主推进**，顺序：P0 真机验证（已完成）-> P1 补 5 个空视图数据（medical/armory/mine/farm/defense）-> P2 用 hooks+macros 接一条任务线 -> P3 `eventChains` 推进逻辑 -> P4 让一个数据块活起来（科技/建造）-> P5 危机阶段 -> P6 存档迁移 -> P7 打磨。验收口径见文首「可玩标准」。
框架本身不再大改，真要动只动两处：新词表（效果/判定）和新的钩子时刻。

---

## 1 命令清单

```bash
# 构建（改了 content/ 或 engine/ 之后必须跑，否则 test_build 会红）
python build_space.py
python build_space.py --kernel ..\zhanyi.json      # 顺手挂兵棋内核
python build_space.py --spec 别的.json --out x.html --mods 别的mod目录

# 回归（全绿基线：607 项）
node tests/run_all.js

# 内容层静态校验（纯 Python，不用 Node）
python tools/validate_space.py                     # 错误 0 / 警告 0

# 终端里看画面（坐标现算，改地图不会坏）
node tools/preview.js 100 30

# 起一个新 mod 的骨架（房间+门+人+对话+终端+宏+钩子+私有块，全部能跑）
python tools/scaffold_mod.py 我的房间 --id my_room

# 浏览器诊断（字号 / 等宽对齐 / 汉字宽比 / localStorage）
# 用浏览器打开 probe.html；用浏览器打开 space-text.html 就是游戏
```

---

## 2 当前基线（数字）

| 项 | 数量 |
|---|---|
| 内容（content/space.json，1.6.0-text） | 场景 25 / 房间 25 / 人 38 / 日程 38 / 对话 200（955 节点）/ 物件 21 / 视图 20 / 穿梭机 6 / 投影 2 |
| 规则 | 事件 141 / 事件链 18（有推进逻辑）/ 上报规则 145 / 文本池 44 / 教程 5 步 / 宏 3 / 钩子 30（胜负 9 + 深渊 + 研究 4 + 政治/殖民地每日 2 + 环境 7 + hazard 4）|
| 世界 | 势力 10 / 外交动作 30 / 内部政治 12 / 领袖 38 / 星系节点 48 / 行星类型 18 / 舰队 14 / 舰队模块 34 / 设施 34 / 殖民地 10 / 资源 38 / 科技 72 / 遗物 28 / 任务 32 / 危机 6 阶段 / 胜负 7+7 |
| 后勤 | 医疗名册 12 / 军械装备 12 / 矿井巷道 11 / 水培架 11 / 防御炮位 11 |
| 引擎词表 | 效果词 39（含 `stop` / `macro` / `open_reader`）/ 判定词 21（含 `not` `all` `any` `macro_condition`）/ 视图提供者 8（含 `pending_events` / `chain_progress` / `situation`） |
| 可合并的块 | 顶层 40 + 嵌套 5（`galaxy.nodes` `techTree.list` `techTree.branches` `diplomacy.actions` `tutorial.steps`） |
| 测试 | 6 个文件 607 项：space 101 / world 206 / arch 100 / text 30 / shell 92 / build 78 |
| 产物 | space-text.html 一个自包含文件（约 1075.6 KB，含 SPACE_SPEC / SPACE_MODS / SPACE_STARTER） |

---

## 3 架构与不变量

架构一页纸在 `README.md` 的 0。四条不变量（改代码时别破坏，测试会红）：

1. **内核不认内容**：字句/数值/条件/效果全在数据里；内容引用未注册的词会被 `validate()` 和 `test_arch.js` 点名。
2. **一切皆 id 皆可合并**：`SPACE_BLOCKS`(34) + `NESTED_BLOCKS`(5) 里登记的块按 id 合并，`append` 绝不覆盖原内容。
   **加新块一定要登记**，否则 mod 一写就把整块替换掉（`test_arch.js` 会拿内容里真实存在的块逐个实测）。
3. **坏数据只降级不崩**：载入期问题进 `report.errors/warnings`；运行期未知效果/判定只 warn。
4. **存档 = 世界快照**：`world` 每个字段要么进档、要么在派生白名单（`vis` `npcPaths` `path` `kernelOps` `proj`）里；
   随机数状态也要进档（`rng`），否则「存档可复现」是假的。

---

## 4 开放性：玩家能加什么、怎么加

### 四种上手方式（门槛从低到高）

| 方式 | 怎么做 | 适合 |
|---|---|---|
| 游戏里 F2  填入示例模板 | 点一下就有个能跑的房间，改几个字再点「应用并重载」 | 第一次玩数据 |
| 游戏里 F2  粘 JSON / 选 json 文件 | 别人给的 mod.json 直接贴/选进来，**热加载，进度保留** | 玩家装 mod |
| `python tools/scaffold_mod.py 名字 --id x` | 生成 `mods/x/mod.json` 骨架（房间+门+人+对话+终端+宏+钩子+私有块） | 想写自己的 mod |
| 直接改 `content/space.json` | 官方内容也只是一份 JSON | 做主线内容 |

### 能加什么（全都只是 JSON）

场景 / 房间 / 人 / 日程 / 对话（节点图）/ 物件 / 终端视图 / 穿梭机 / 投影 / 事件 / 上报规则 /
势力 / 外交动作 / 领袖 / 星系 / 舰队 / 舰队模块 / 设施 / 殖民地 / 资源 / 科技 / 遗物 / 任务 /
危机阶段 / 胜负条件 / 文本池 / 教程步骤 / **宏** / **钩子** / **自己起名的任意块**。

### 三个「扩展点」是这一轮新加的（重点）

1. **宏 `macros`**：内容层的函数。`{"type":"macro","id":"my_hello","params":{"who":"客人"}}`，
   内部用 `{args.who}` 取值；带 `condition` 还能当命名条件复用（`{"type":"macro_condition","id":"x"}`）。
2. **钩子 `hooks`**：挂在引擎已有的 8 个时刻上，**不用改引擎**：
   `game_start` / `tick`（可带 `every`）/ `day` / `enter_scene` / `interact` / `npc_talk` / `dialogue_end` / `build_done`。
   过滤器：`scene` / `interactable` / `npcId` / `dialogue` / `buildId` / `event`；`once:true` 只跑一次；
   `priority` 大者先跑。
3. **停手权 `stop`**：钩子或物件的效果链里放 `{"type":"stop"}`，就能**换掉默认行为**（比如把某个终端改成别的东西），
   而不是被框架写死。

### 为什么不会被框架限制住

- **内核不认内容**：引擎里没有任何场景/人/物件的名字，全是数据里的 id；`views` 的 `source` 能读**任意路径**
  （包括你自己起的块，例如 `space.myNotes.list`）。
- **未知键一律原样保留**：`applyMod` 遇到不认识的块直接塞进 `space`，不报错。
- **合并是安全的**：`append` 遇到同 id 会跳过并警告（绝不覆盖别人的内容），要改别人的东西必须显式写 `_op:"patch"`。
- **装错会被点名**：`report.warnings` + F3 诊断页 + `test_arch.js` 的块登记表逐个实测 + `validate_space.py`。

---

## 5 里程碑

| 版本 | 内容 |
|---|---|
| v1.0 | 内核骨架：Screen 合成 / 载入合并 / 场景编译 / tick / 对话 / 效果 |
| v1.3 | 纯文本化（零 Canvas）：`<pre>` + ASCII 映射 + 自适应字号 |
| v1.4 | 13 个场景图例缺失（整图实心）、房间没门、Tab 视图坏、文案与实现不符  全修 + `test_world.js` |
| 架构审计轮 | 块登记表（1232）、随机数状态进档、findPath limit（NPC 瞬移）、世界快照往返  `test_arch.js` |
| 自主推进 P0 | 真机验证常态化：`tools/browser_check.js`（Edge headless 页面内断言）+ `probe.html` 结论汇总；三种窗口实测字号 / 布局 / 0 报错 |
| **v1.5（本轮）** | **开放性**：宏 / 钩子 / stop / `reloadContent` 热加载 / F2 面板 v2（选文件模板逐个移除导出）/ `tools/starter_mod.json` + `scaffold_mod.py` / `DEVLOG.md` |

---

## 6 已知问题 / 未验证（诚实清单）

1. **没有在真浏览器里跑过**：字号落地、鼠标坐标、F2 面板排版、汉字是否正好 2 格宽，
   只靠假 DOM 冒烟测试（`test_shell.js`）+ `probe.html`。**下次开对话第一件事：用浏览器打开 `space-text.html` 和 `probe.html` 各看一眼。**
2. **存档没有版本迁移**：只有兼容守卫（版本号不同会警告、场景没了会回退到起始场景），没有字段级升级钩子。
3. **`world.kernelOps` 是出站队列**：宿主（兵棋内核桥接层）不取走会一直攒着；它不进存档。
4. **最坏帧 17ms**：30 个人同时在同一场景重新寻路的那一 tick（一次性，之后 0.29ms/tick）。NPC 数量翻几倍要再看。
5. **mod 面板没测超大 JSON**（几 MB）：现在是全量 JSON.parse + 全量重编译。
6. **两张旧截图** `preview_probe.png` / `preview_text.png` 是修好字号之前的画面，与现在不符（未删）。
7. **规则层还没开始**：教学只有 5 步提示；`missions`(24) `relics`(20) 还没接进玩法；事件链 `eventChains` 没有推进逻辑；
   `kernel` 效果只是把 op 排队，没有真的驱动兵棋层。

---

## 7 下一步计划（按优先级）

1. **规则层：把现有规则重写成数据（用 hooks + macros）**
   - 教学：5 步  一条 `missions` 任务线（触发点用 `hooks`：`enter_scene` / `npc_talk` / `interact`）。
   - 事件：120 条事件现在靠 `events` 判定 + `npcApproach` 上报，可以顺手用 `macros` 抽出公共「派登陆队 / 轨道轰炸 / 舰队前压」，
     让新事件只写判定 + 文案。
   - 事件链 `eventChains`(15)：加一个「链的下一步」推进机制（`world.chains[id].step`），
     用 `hooks` 触发检查，而不是把条件写死在引擎里。
   - 随机遭遇 `dialoguePools`(20)：用 `hooks` 的 `tick` + `every` + `random` 判定直接触发，做成能关掉的开关。
2. **战斗/兵棋桥**：`kernel` 效果双向（读 `opts.kernel` 的值  投影到地图；写 op  兵棋层）。
   挂上 `zhanyi.json` 之后要能看到舰队/污染真的动起来（目前 `projections` 只读 counters）。
3. **存档迁移框架**：`space.saveMigrations` = 一串 `{from, to, effects}`，读档时按版本跑。
4. **NPC 寻路分摊**：把 30 人的重新寻路摊到多帧（每 tick 最多算 2 个人），最坏帧压到 <5ms。
5. **mod 生态**：多文件 mod（mod.json + 内容文件）、`mods/` 目录热扫描、mod 冲突检查（同 id patch 顺序提示）、
   导出成可分享的包。
6. **内容扩充 / cookbook**：README 的「加东西改哪里」扩成一份 cookbook（每样东西一个最小例子，全部用 `tools/starter_mod.json` 的写法）。

---

## 8 约定与坑（给下一个我）

- **改了 `content/` 或 `engine/` 必须 `python build_space.py`**：`test_build.js` 会比对产物与磁盘上的一致性。
- **别用 PowerShell 管道接 `Select-Object -First` 跑长输出命令**：node 不被杀会挂到 300 秒超时并重置 shell。
  长输出一律 `> tmp.txt 2>&1` 再 `Get-Content -Encoding UTF8 tmp.txt`。
- **这个工具链的 heredoc 会吃掉 `  ` 之类符号**（中文没事）：文档里用 ASCII 画图（`|` `v`），
  代码里需要符号就用 `\uXXXX` 转义（引擎里的 ASCII 映射表就是这么写的）。
- **改引擎后先 `node --check engine/*.js`**，再 `node tests/run_all.js`。
- **加新机制必须配测试**：架构级不变量放 `tests/test_arch.js`，世界/内容放 `tests/test_world.js`，外壳放 `tests/test_shell.js`。
- **加新块要登记**：`SPACE_BLOCKS`（顶层）或 `NESTED_BLOCKS`（嵌套），并写 `_howToAdd` + `_example`。
- **加新词要注册**：`registerEffect` / `registerCondition` / `registerViewProvider`，然后 `test_arch.js` 的词表检查会替你守。
- 文件换行：内容/引擎多为 CRLF，新文件用 LF（构建和测试都能吃，别混着改同一个文件就行）。
- 现有内容风格：每个块都带 `_howToAdd`（怎么加）和 `_example`（抄一条），照这个风格写。

---

## 9 文件索引 / 测试索引

```
content/space.json            全部内容（每个块都有 _howToAdd / _example）
engine/space-core.js          词表 / 载入合并 / 场景编译 / tick / 对话 / 效果 / 视图 / 存档 / 屏幕合成 / 宏 / 钩子 / 热加载
engine/space-textout.js       字符网格 -> ASCII 文本（字号真的写回 <pre>）
engine/space-textshell.js     键盘鼠标 / 自适应字号 / 存档桥 / F2 mod 面板 / 鼠标走路
space-text.tpl.html           页面骨架（含 F2 面板）
build_space.py                构建：内容 + 引擎 -> space-text.html（注入 SPACE_SPEC / SPACE_MODS / SPACE_STARTER）
space-text.html               产物（自包含）
probe.html                    浏览器诊断探针
tools/starter_mod.json        起手 mod（能跑；F2 -> 填入示例模板）
tools/scaffold_mod.py         生成新 mod 骨架
tools/validate_space.py       纯 Python 内容校验
AI_CONTEXT.md                 AI 上下文说明书（项目定位/数据/架构/约束/术语 + 精简包）
CONTRIBUTING.md               改动协议（必跑命令 / 改动文档对照 / AI 交付格式）
.ctx_stamp                    文档同步脚本的仓库指纹（缓存，不进文件树）
tools/preview.js              终端里看画面
tests/run_all.js              跑全部：test_space / test_world / test_arch / test_text / test_shell / test_build
```

| 测试 | 守什么 |
|---|---|
| `test_space.js` | 内核：内容校验 / 移动与时间 / 日程 / 对话与效果 / 事件上报 / 终端菜单 / 存档 / 合成 / mod 合并 |
| `test_world.js` | 世界：图例覆盖 / 房间单连通 / 门能走通 / 世界连通 / 物件够得着 / 终端都能开 / 每个对话每个选项 / 事件有上报人 / 教学 |
| `test_arch.js` | 架构：块登记表逐个实测 / 四种 `_op` / 嵌套与点路径 / 词表一致 / 世界快照+rng 往返 / 全图寻路 / NPC 不瞬移 / **宏钩子stop热加载私有块** |
| `test_text.js` | ASCII 映射 / 中文两列对齐 / 自适应字号（假 DOM） |
| `test_shell.js` | 外壳：按键 / Tab / X / F3 / 鼠标寻路 / 存档桥 / **F2 面板 v2（热加载保进度移除模板导出坏 JSON）** / 内核桥 |
| `test_build.js` | 产物语法逐块校验 / 零外链 / 产物与磁盘一致 / mods 干净合并 / 起手 mod 能跑 |
