# 朔  场景层框架  项目说明书（AI 上下文文件）

> 本文件由脚本扫描仓库生成（数字、字段、示例均从真实文件现算/现摘，未手抄）。
> 生成时间：2026-10-02 02:38 +08:00　|　生成时基线：`node tests/run_all.js` 通过 607 / 失败 0
> 位置：`D:/大肥鱼工作区/朔/space/AI_CONTEXT.md`

## 怎么用这份文件

- 只想拿最少上下文：读「第 0 节 一页摘要」+「第 10 节 精简版上下文包」。
- 要改内容（加房间/人/对话/终端/事件/宏/钩子）：读「第 4 节 数据结构」+「第 7 节 硬约束」+「第 10 节」。
- 要改引擎（加词、加机制、改渲染）：读「第 5 节 代码架构」+「第 7 节 硬约束」+「第 8 节 已知问题」。
- 要知道还剩什么没做：读「第 6 节 待完成」。
- 数字对不上时：说明代码/内容变了，请先跑「附录 A 命令」再更新本文件。

**同仓库的三份文档分工**

| 文件 | 给谁看 | 内容 |
|---|---|---|
| `README.md` | 人（玩家/使用者） | 玩法、操作键位、地图字符、开放契约、内容清单 |
| `DEVLOG.md` | 人 + AI（续作） | 开发进度、里程碑、下一步计划、约定与坑 |
| `AI_CONTEXT.md`（本文件） | AI | 定位 / 技术栈 / 功能状态 / 数据结构 / 代码架构 / 约束 / 术语 + 精简包 |

---

## 0 一页摘要

`朔` 是一个**纯文本（ASCII）场景层框架**：玩家以一个 `@` 存在于世界里，走到哪哪就是界面；
画面是一个 `<pre>` 里的纯文本，零 Canvas、零像素操作、地图全是 ASCII 字符。
所有内容都在单一 JSON（`content/space.json`）里，引擎零外链零依赖，
`build_space.py` 把「内容 + 引擎」编成一个自包含的 `space-text.html`。

三条铁律：**内核不认内容 / 内容不写代码 / 一切皆 id 皆可合并**。
四条不变量（每条都有测试守）：内核不认内容（内容只用注册词表）、
块登记表合并不覆盖（`SPACE_BLOCKS` 40 + `NESTED_BLOCKS` 5）、
坏数据只降级不崩（`report.errors/warnings`）、存档 = 世界快照（`world` 字段要么进档要么在派生白名单）。

现状（生成时实测）：构建 exit 0；`node tests/run_all.js` **607 项全绿**；
`python tools/validate_space.py` 错误 0 / 警告 0；内容 25 场景 / 38 人 / 200 段对话 / 141 条事件。
**未在真浏览器里验证过**（见第 8 节）。

---

## 1 项目定位

| 项 | 内容 |
|---|---|
| 名称 | `朔  场景层框架（纯文本模式）`（产物标题 `朔  纯文本模式`；内容 `_version` = `1.6.0-text`）|
| 类型 | 数据驱动的**场景层框架** + 纯文本（ASCII）界面 + 自包含单文件网页产物 |
| 自述 | `_description` = "空间层内容。玩家以 @ 存在于此，走到哪，哪就是界面。" |
| 参照物 | 内核段标题原文「14  屏幕合成（CDDA 式字符网格）」；README 10 与同工作区的兵棋数据层 `zhanyi.json`（**不在本项目目录内**）配对；README 附录提到历史 Canvas 版「Canvas 版已删除」|
| 明确排除 | 零 Canvas / 零像素操作 / 无外链资源 / 无弹窗（`autoInteract` `autoNpcTalk` 默认 false）/ 不用 requestAnimationFrame / 内容不写代码 / 不改 `zhanyi.json` |
| 目标平台 | 浏览器（README「用浏览器打开 space-text.html 即可」）；具体浏览器范围、移动端、PWA【待确认】|
| 运行方式 | 浏览器打开 `space-text.html`（自包含）；另可 `python build_space.py --kernel ../zhanyi.json` 挂内核 |

---

## 2 技术栈与文件结构

| 项 | 内容 |
|---|---|
| 语言 | JavaScript（ES5 风格 IIFE，UMD 式导出；无打包器、无 npm 依赖）；Python 3 仅工具链 |
| 渲染 | `Screen` 字符网格（每格 `ch/fg/bg`）-> `space-textout.js` ASCII 映射 -> 写入一个 `<pre>` |
| 字号 | 外壳算出后用 `TextOut.applyFont()` 写回 `<pre>.style.font`；`_measure()` 用隐藏 `<pre>` 量「100 列 x 2 行」 |
| 数据 | `content/space.json`（唯一内容源）+ mod JSON（`mods/` 目录 / F2 粘贴 / localStorage[`space_mods`]）+ 存档（localStorage[`space_save_<n>`]）|
| 依赖 | 运行期零依赖；测试只用 Node 内置 `path/fs/vm/child_process`；工具只用 Python 标准库 |
| 构建注入 | `SPACE_SPEC / SPACE_MODS / ZHANYI_KERNEL / SPACE_STARTER`（模板占位符 `/*__CORE__*/` `/*__SPEC__*/` `/*__MODS__*/` `/*__TEXTOUT__*/` `/*__SHELL__*/`）|
| 页面元素 id | `stage`, `screen`, `info`, `err`, `modpanel`, `modmsg`, `modtext`, `modapply`, `modfile`, `modtemplate`, `modexport`, `modclear`, `modclose`, `modlist` |

**文件结构（42 个文件，行数实测）**

```
  .gitignore                                     14 行      0.3 KB
  .perf_slack                                     2 行      0.0 KB
  AI_CONTEXT.md                                 856 行     64.2 KB
  CONTRIBUTING.md                               166 行     10.1 KB
  DESIGN.md                                     392 行     32.3 KB
  DEVLOG.md                                     683 行     67.4 KB
  HANDOFF.md                                    254 行     29.2 KB
  README.md                                     504 行     35.3 KB
  VISION.md                                      88 行      5.4 KB
  build_space.py                                143 行      6.7 KB
  content/space.json                          35565 行    748.1 KB
  engine/space-core.js                         3261 行    155.5 KB
  engine/space-textout.js                       194 行      8.0 KB
  engine/space-textshell.js                     458 行     22.5 KB
  index.html                                     22 行      0.9 KB
  mods/example_mod/README.md                     36 行      1.7 KB
  mods/example_mod/mod.json                     263 行      5.5 KB
  mods/generated_world/mod.json               23912 行    594.3 KB
  preview_probe.png                             二进制     42.9 KB
  preview_text.png                              二进制     69.5 KB
  probe.html                                    119 行      5.3 KB
  space-text.html                              3978 行   1072.1 KB
  space-text.tpl.html                            67 行      3.5 KB
  tests/perf_budget.js                           52 行      2.6 KB
  tests/run_all.js                               25 行      1.5 KB
  tests/test_arch.js                            602 行     37.7 KB
  tests/test_build.js                           390 行     24.6 KB
  tests/test_shell.js                           401 行     21.5 KB
  tests/test_space.js                           359 行     19.7 KB
  tests/test_text.js                             96 行      5.8 KB
  tests/test_world.js                           957 行     54.0 KB
  tools/browser_check.js                        365 行     20.9 KB
  tools/gen_maps.py                             529 行     25.4 KB
  tools/gen_world.py                            780 行     44.2 KB
  tools/map_rules.py                            221 行     10.2 KB
  tools/preview.js                               94 行      3.4 KB
  tools/scaffold_mod.py                         104 行      5.2 KB
  tools/scaffold_scene.py                        55 行      2.4 KB
  tools/shot.js                                  95 行      4.9 KB
  tools/starter_mod.json                        290 行      6.7 KB
  tools/update_context.py                       317 行     15.1 KB
  tools/validate_space.py                       173 行      9.5 KB
```

---

## 3 已完成功能（逐条：功能 / 状态 / 相关文件 / 关键实现）

状态口径：**完整** = 有实现有内容有测试；**机制完整（内容为空）** = 引擎支持但内容里还没写数据；**半成品** = 只做了一部分；**占位（仅数据）** = 只有 JSON，引擎逻辑不读。

### 3.1 内容层（数据与合并）

| 功能 | 状态 | 相关文件 | 关键实现 |
|---|---|---|---|
| 内容载入 + mod 合并（`append`/`patch`/`replace`/`remove`、`_append`、`priority`/`order` 排序、未知键原样保留） | 完整 | `space-core.js`、`mods/example_mod/` | `load -> normalizeSpace -> applyMod -> mergeBlock / patchItem / mergeAtPath`（`test_arch.js` 逐个块实测「加一条不冲掉老的」）|
| 块登记表（顶层 34 + 嵌套 5） | 完整 | `space-core.js` | `SPACE_BLOCKS` / `NESTED_BLOCKS`；未登记的块会被 deepMerge 整块替换 |
| 全局默认字符表 | 完整 | `content/space.json` `config.defaultLegend` | `effectiveLegend()`：默认表垫底、`scene.legend` 覆盖 |
| 场景编译（tiles+legend+presets、`tileEdits`、`props`、`exits`、出生点） | 完整 | `space-core.js` | `compileScene()` / `resolveLegendEntry()`；产出网格 `ch fg bg pass kind ref name def exitMap spawn props` |
| 内容校验（图例覆盖/可走格/出生点/连通区/日程点/对话 goto/调色板/物件视图/动态池/缺 id） | 完整 | `space-core.js` `validate()`、`tools/validate_space.py` | 载入期收集 `report.errors/warnings`，只报警不崩 |
| 教学步骤（5 步提示） | 半成品 | `content/space.json` `tutorial.steps` | `stepTutorial()` 推进 + 借状态行显示 `hint`；**未接任务线** |

### 3.2 内核（玩法）

| 功能 | 状态 | 相关文件 | 关键实现 |
|---|---|---|---|
| 时间与 tick（1 tick = 1 分钟） | 完整 | `space-core.js` | `HOUR = 60`、`DAY = 24 * HOUR`；`tickOnce`/`onTick`/`minuteOfDay`/`clockText` |
| 玩家移动 / 等待 / 门与过场 / 传送 | 完整 | `space-core.js` | `tryMove`/`wait`/`takeExit`/`findTransition`/`teleport` |
| 视野与迷雾 | 完整 | `space-core.js` | `computeVision`/`lineOfSight`/`fogOf`/`updateVision`；`lit` 房间全亮 |
| NPC 日程 + 寻路 | 完整 | `space-core.js` | `sampleSchedule`/`placeNpc`/`enterScene`/`findPath`(BFS, TypedArray)/`stepActors` |
| 交互（优先级挑选、按 E、自动触发两级开关） | 完整 | `space-core.js` | `cellsNear`/`bestTarget`/`interact`/`autoInteract` |
| 对话运行（节点图 / 条件 / 代价 / 子池 / 单一关闭出口） | 完整 | `space-core.js` | `openDialogue`/`enterNode`/`dialogueOptions`/`chooseOption`/`closeDialogue` |
| 效果词 38 / 判定词 21 / 简写判定 | 完整 | `space-core.js` 2-4 | `registerEffect`/`registerCondition`/`check`/`runEffects` |
| 宏 `macros`（内容层函数 + `{args.x}` + `macro_condition`） | 机制完整（内容为空） | `space-core.js`、`content/space.json` `macros` | `registerEffect('macro')`/`Game.macro`/`idx.macros` |
| 钩子 `hooks`（8 火点 + 6 过滤器 + `once`/`priority`/`every`） | 机制完整（内容为空） | 同上 | `fireHooks`/`idx.hooksByOn`/`HOOK_FILTERS` |
| 停手权 `stop`（拦掉默认行为） | 机制完整 | `space-core.js` | `registerEffect('stop')` 返回 `{stop:true}` |
| 事件与上报（events / npcApproach） | 完整 | `content/space.json` | `checkEvents` 挂 `pending`；`pickApproachDialogue` 按 `priority` 挑 |
| 投影（counters -> 地图字符） | 完整（2 条） | `content/space.json`、`space-core.js` | `projectValue`/`applyProjections` + `setTile` |
| 视图/终端（15 views + 4 provider） | 完整（其中 5 个视图 source 缺数据，见第 8 节） | 同上 | `resolveView`/`buildViewLines`/`buildViewList`/`viewChoose`/`viewSelect` |
| 存档/读档（fog 位串、rng 状态、兼容守卫） | 完整 | `space-core.js` | `serialize`/`deserialize`（版本号、场景缺失回退、mod 差异提示）|
| 热加载 `reloadContent`（换内容保留世界状态） | 完整 | `space-core.js` | 场景/人/位置失效兜底 + 重算视野与投影 |
| 屏幕合成（标题/状态/地图/侧栏或下方日志/光标/叠加层/宽字占位） | 完整 | `space-core.js` 14 | `Screen`/`layout`/`render`/`drawDialogue`/`drawView` |

### 3.3 界面与工程

| 功能 | 状态 | 相关文件 | 关键实现 |
|---|---|---|---|
| 纯文本输出（ASCII 映射 + 宽字续格 + 增量重绘） | 完整 | `space-textout.js` | `ASCII_MAP`/`toAscii`/`paint`（`lastText` 缓存）|
| 自适应字号（两遍跟随分栏、字号真写回 DOM） | 完整（真浏览器未验证） | `space-textout.js`、`space-textshell.js` | `applyFont`/`_measure`(隐藏 pre 量 100x2)/`autoFit`/`fit` |
| 键盘操作 | 完整 | `space-textshell.js` | `onKey` 分支：WASD/方向键、空格/`.`、E/回车、1-9、Tab、X、?//、Esc、C、F2/F3/F4、1-5 速度、+/-/0 缩放 |
| 鼠标点格子寻路（暂停时也走） | 完整 | 同上 | `pre.click` -> `out.cellW/cellH` 反算 -> `screenToScene` -> `pathTo` |
| 存档桥（kernel op save/load/export -> localStorage） | 完整 | 同上 | `onKernel` |
| F2 mod 面板（粘贴/选文件/示例模板/逐个移除/导出/显示警告） | 完整（超大 JSON 未测） | 同上 + `space-text.tpl.html` | `applyMods`/`renderModList`/`importFile`/`fillTemplate`/`exportMods`/`parseModText` |
| mod 三入口（mods 目录 / F2 热加载 / scaffold 生成骨架） | 完整 | `build_space.py`、`tools/scaffold_mod.py`、`tools/starter_mod.json` | 构建时扫描 `mods/*/mod.json|manifest.json` |
| 回归与校验（4 文件 607 项） | 完整 | `tests/*`、`tools/validate_space.py` | 见附录 A |
| 世界数据块（势力/领袖/科技/舰队/模块/设施/殖民地/资源/星系/行星/政治/遗物/任务/危机/胜负/文本池/事件链/对话池/场景类型/房间） | 占位（仅数据） | `content/space.json` | 引擎里除 `report.stats` 计数外不读；部分由 `views[].sections.source` 展示 |

### 3.4 生成时实测

```
python build_space.py         -> exit 0（space-text.html 1072.1 KB，起手模板已编入）
node tests/run_all.js         -> exit 0  合计：通过 607 / 失败 0
python tools/validate_space.py -> exit 0  错误 0 / 警告 0
node tools/preview.js 80 24   -> exit 0（终端里打印画面）
```

---

## 4 数据结构

### 4.0 顶层键（41 个数据键）

```
_description, _version, _howToAdd, sceneTypes, scenes, rooms, config, palette, presets, initialState, playerCharacter, interactables, npcs, schedules, shuttles, sceneTransitions, dialogues, dialoguePools, views, projections, events, npcApproach, macros, hooks, tutorial, galaxy, resources, techTree, fleets, factions, diplomacy, internalPolitics, leaders, planetTypes, fleetModules, facilities, colonies, eventChains, textPools, relics, missions, crisisStages, victoryConditions, defeatConditions
```

块形状：除 `config` `palette` `presets` `initialState` `playerCharacter` `galaxy` `techTree` `diplomacy` `tutorial` 外，都是 `{ "_howToAdd"?, "_example"?, "list": [...] }`。
嵌套数组：`tutorial.steps` `galaxy.nodes` `techTree.branches` `diplomacy.actions`。

### 4.1 全局配置（原文摘录）

```json
{
 "startScene": "station_command",
 "startTick": 360,
 "screenW": 100,
 "screenH": 40,
 "logRows": 5,
 "visionRange": 8,
 "fogChar": " ",
 "defaultFloor": ".",
 "defaultLegend": {
  "_howToAdd": "全局标准字符表。每个场景的 legend 会盖在上面，所以这里是「没写就用这个」。地图里的标准字符一旦漏写就会被当成墙（整张图变实心）。字符只管形状：实心结构统一用 #（引擎会按四邻把成行的墙轮廓化成 - | +，孤立的 # 留给货架一类的家具），可走的底面用 .（各场景类型可在 config.floorByType 里换成 , ; : ' 作出区域感）。",
  "#": {
   "preset": "wall"
  },
  ".": {
   "preset": "floor"
  },
  "+": {
   "preset": "door"
  },
  "^": {
   "preset": "rock"
  },
  " ": {
   "preset": "void"
  },
  "*": {
   "interactable": "save_point"
  },
  "h": {
   "interactable": "chair"
  },
  ",": {
   "ch": ",",
   "fg": "fog_fg",
   "bg": "fog_bg",
   "passable": false,
   "solid": true,
   "name": "未探明的雾"
  },
  "[": {
   "interactable": "shelf"
  }
 },
 "floorByType": {
  "space_station": "floor",
  "planet_surface": "floor_surface",
  "rift_interior": "floor_rift",
  "ship_interior": "floor_ship",
  "colony": "floor_colony"
 },
 "dialogueWidth": 66,
 "fatiguePerTick": 0.02,
 "ticksPerSecond": 4,
 "speeds": [
  0,
  1,
  2,
  4,
  8
 ],
 "font": "bold 22px \"Consolas\", monospace",
 "autoInteract": false,
 "fontSize": 22,
 "autoZoom": true,
 "autoZoomMin": 9,
 "autoZoomMax": 30,
 "autoNpcTalk": false,
 "eventCooldownTicks": 120,
 "mapTargetCols": 104,
 "mapTargetRows": 28
}
```

```json
{
 "wall": {
  "ch": "#",
  "fg": "wall_fg",
  "bg": "wall_bg",
  "passable": false,
  "solid": true,
  "kind": "wall",
  "name": "墙"
 },
 "floor": {
  "ch": ".",
  "fg": "floor_fg",
  "bg": "floor_bg",
  "passable": true,
  "name": "地板"
 },
 "floor_surface": {
  "passable": true,
  "ch": ",",
  "fg": "floor_surface_fg",
  "bg": "floor_bg",
  "name": "地表"
 },
 "floor_rift": {
  "passable": true,
  "ch": ";",
  "fg": "floor_rift_fg",
  "bg": "floor_bg",
  "name": "裂隙地面"
 },
 "floor_ship": {
  "passable": true,
  "ch": ":",
  "fg": "floor_ship_fg",
  "bg": "floor_bg",
  "name": "舰内地板"
 },
 "floor_colony": {
  "passable": true,
  "ch": "'",
  "fg": "floor_colony_fg",
  "bg": "floor_bg",
  "name": "殖民地地面"
 },
 "void": {
  "ch": " ",
  "fg": "fog_fg",
  "bg": "fog_bg",
  "passable": false,
  "solid": true,
  "name": "虚空"
 },
 "door": {
  "ch": "+",
  "fg": "door_fg",
  "bg": "door_bg",
  "passable": true,
  "name": "门"
 },
 "shelf": {
  "ch": "[",
  "fg": "furn_fg",
  "bg": "furn_bg",
  "passable": false,
  "solid": true,
  "name": "货架"
 },
 "chair": {
  "ch": "h",
  "fg": "furn_fg",
  "bg": "furn_bg",
  "passable": true,
  "name": "座椅"
 },
 "rock": {
  "ch": "^",
  "fg": "rock_fg",
  "bg": "rock_bg",
  "passable": false,
  "solid": true,
  "name": "岩石"
 }
}
```

```json
initialState = {"counters": {"fleets": 3, "pollution": 0, "alloy": 120, "food": 17, "ore_today": 120, "ore_tomorrow": 140, "rift_touched": 0}, "items": {"ration": 5, "medkit": 2}, "flags": {}}
playerCharacter = {"id": "player_character", "name": "指挥官", "symbol": "@", "color": "player", "title": "残响议会最高指挥官", "faction": "player_remnant", "stats": {"moveSpeed": 1.0, "maxHp": 10, "hp": 10, "visionRange": 12}, "skills": {"management": 5, "diplomacy": 3, "science": 2, "combat": 1}, "equipment": ["personal_pda"], "currentScene": "station_command", "position": {"x": 10, "y": 20}}
```

**关键字段**：`startScene`/`startTick` 开局；`defaultFloor` 行宽不足时的填充；`defaultLegend` 全局字符表（被场景 legend 覆盖）；`fogChar` 未探索字符（现在是空格：未探明 = 一片黑，比虚空亮一档）；`floorByType` 按场景 `type` 换地板 preset（`.` `,` `;` `:` `'`，内核不认识任何类型，值全在内容里）；`ticksPerSecond` 自动推进基准；`speeds` 速度档位（`[0,1,2,4,8]`）；`mapTargetCols/mapTargetRows` 自适应字号目标（104x28）；`autoInteract`/`autoNpcTalk` 自动触发两级开关（默认 false）；`dialogueWidth` 对话框宽；`fatiguePerTick` 疲劳；`eventCooldownTicks`。

### 4.2 空间

| 块 | 条数 | 字段（出现次数）|
|---|---|---|
| `sceneTypes` | 5 | id(5) name(5) desc(5) rooms(5) |
| `rooms` | 25 | id(25) name(25) scene(25) type(25) |
| `scenes` | 25 | id(25) name(25) type(25) size(25) tiles(25) legend(25) exits(25) ambient(25) lit(19) visionRange(6) |

```json
{"id": "station_command", "name": "指挥中心", "type": "space_station", "size": {"w": 72, "h": 24}, "lit": true, "tiles": ["#+++####################################################################", "#......................................................................#", "#......................................................................#", "#......................................................................#", "#......................................................................#", "#......................................................................#", "#...................T.............................v[...................#", "#.........................====================....[....................#"]} ...(截断)
```

`sceneTypes[0]` = {"id": "space_station", "name": "空间站", "desc": "大本营。指挥、研究、船坞、居住、通讯、仓库、医疗、军械。", "rooms": ["command_center", "research_lab", "shipyard", "habitat", "comm_room", "warehouse", "medical_bay", "armory", "corridor"]}

`rooms[0]` = {"id": "station_corridor", "name": "中央大厅", "scene": "station_corridor", "type": "space_station"}

场景类型分布：{"space_station": 9, "planet_surface": 4, "rift_interior": 2, "colony": 6, "ship_interior": 4}

**关键字段**：`size.w/h` 必须与 `tiles` 行数/行宽一致；`legend[字符]` 可以是 `{"preset":}` / `{"interactable":id}` / `{"npc":id}` / `{"playerSpawn":true}` / `{"exit"|"to"|"at"}` 或直接写 `ch fg bg passable solid name desc auto priority`；`exits[].at` 是**目标场景内的落点**；`lit` 室内全亮；`visionRange` 覆盖全局；`ambient` 进房间时的环境句（旁白）。

### 4.3 人

| 块 | 条数 | 字段（出现次数）|
|---|---|---|
| `npcs` | 30 | id(30) name(30) symbol(30) color(30) role(30) faction(30) homeScene(30) dialogue(30) desc(30) isLeader(30) relatedLeaderId(30) |
| `schedules` | 30 | id(30) npcId(30) slots(30) |
| `leaders` | 30 | id(30) name(30) npcId(30) role(30) faction(30) desc(30) isLeader(30) |
| `factions` | 8 | id(8) name(8) mark(8) color(8) relation(8) stance(8) desc(8) |

```json
{"id": "npc_fleet_commander", "name": "舰队指挥官 凯尔", "symbol": "K", "color": "npc", "role": "fleet_commander", "faction": "player_remnant", "homeScene": "station_command", "dialogue": "dlg_fleet_commander", "desc": "管着三支舰队。说话短，不喜欢重复第二遍。", "isLeader": true, "relatedLeaderId": "leader_fleet_commander"}
{"id": "sch_fleet_commander", "npcId": "npc_fleet_commander", "slots": [{"hours": [6, 22], "scene": "station_command", "x": 17, "y": 5}, {"hours": [22, 6], "scene": "station_corridor", "x": 7, "y": 5}]}
{"id": "player_remnant", "name": "残响议会", "mark": "●", "color": "player", "relation": "self", "stance": "自己人", "desc": "索尔星系的残存舰队与殖民地。人口两千余，没有母星。"}
```

**关键字段**：`symbol` 必须是单字符；`homeScene` + `dialogue` 必填；`slots[].hours = [起,止]`（不写=全天，可跨夜）；NPC 站在格子上会挡路（`tryMove` 撞人停下）。

### 4.4 交互与终端

| 块 | 条数 | 字段（出现次数）|
|---|---|---|
| `interactables` | 16 | id(16) name(16) symbol(16) color(16) bg(16) passable(16) auto(16) priority(16) onInteract(16) desc(16) |
| `views` | 15 | id(15) title(15) width(15) actions(15) sections(12) lines(2) list(1) _howToAdd(1) provider(1) |
| `dialoguePools` | 20 | id(20) options(20) name(18) |

```json
{"id": "star_map_terminal", "name": "星图终端", "symbol": "T", "color": "accent", "bg": "panel2", "passable": false, "auto": false, "priority": 20, "onInteract": [{"type": "open_view", "view": "galaxy_map"}], "desc": "全息星图。势力分布和舰队位置都投在半空。"}
{"id": "galaxy_map", "title": "星图终端", "width": 78, "sections": [{"title": " 已知星系 ", "source": "space.galaxy.nodes", "rowTemplate": " {row.mark} {row.name}    归属 {row.owner}    污染 {row.pollution}%    舰队 {row.fleets}", "empty": "星图上什么都没有。"}, {"title": " 图例 ", "lines": [" ● 玩家    ○ 中立    ◉ 深渊     航线    ═ 交战"]}], "actions": [{"text": "关闭", "effects": [{"type": "close_view"}]}]}
{"id": "pool_smalltalk", "options": [{"text": "今天天气不错。", "goto": "end"}, {"text": "你忙你的。", "goto": "end"}]}
```

物件 id 全集：`star_map_terminal`, `research_terminal`, `resource_terminal`, `shuttle_terminal`, `build_terminal`, `comm_terminal`, `medical_terminal`, `armory_terminal`, `mine_terminal`, `farm_terminal`, `defense_terminal`, `save_point`, `shelf`, `chair`, `command_chair`, `bed`

视图 id 全集：`galaxy_map`, `tech_tree`, `warehouse_stock`, `shuttle_destinations`, `save_menu`, `help`, `debug`, `fleet_status`, `build_menu`, `diplomacy`, `medical_status`, `armory_status`, `mine_status`, `farm_status`, `defense_status`

**关键字段**：`views[].sections[]` 支持 `title` / `lines` / `source`（数据路径）+ `rowTemplate`（`{row.字段}`）+ `empty`；`views[].list` 支持 `source` + `selectable` + `onSelect`（列表即菜单）；`actions[].effects/condition/cost`；`provider` 指向代码注册的视图（`validation` `projections` `nearby` `recent_log`）。

### 4.5 对话

字段：id(170) npcId(170) entry(170) nodes(170)；统计：**170 段 / 814 节点 / 1094 选项**；id 前缀：`dlg_ev_` 120 段（事件）、`dlg_` 42 段、`dialogue_` 8 段。

```json
{"id": "dlg_fleet_commander", "npcId": "npc_fleet_commander", "entry": "root", "nodes": {"root": {"text": "指挥官。{counters.fleets} 支舰队在轨道待命，星图上暂时安静。", "options": [{"text": "舰队状况怎么样？", "goto": "n1"}, {"text": "深渊那边有什么动静？", "goto": "n2"}, {"text": "警戒等级提到多少？", "goto": "n3"}, {"text": "没什么，继续忙。", "goto": "end"}]}, "n1": {"text": "『灰烬之矛』守着索尔 III，『长夜』在帷幕星云巡逻，『回声』还在船坞整备。三支都能动，但只有两支能打。", "options": [{"text": "再说说别的。", "goto": "root"}, {"text": "明白了。", "goto": "end"}]}, "n2": {"text": "侦察哨报告帷幕星云边缘的背景星等又降了。不是自然现象有什么东西挡在前面。", "options": [{"text": "再说说别的。", "goto": "root"}, {"text": "明白了。", "goto": "end"}]}, "n3": {"text": "我建议二级。再高就要动员殖民地了，那要走行政流程。", "options": [{"text": "再说说别的。", "goto": "root"}, {"tex ...(截断)
```

```json
{"id": "dlg_ev_abyss_01", "npcId": "npc_fleet_commander", "entry": "root", "nodes": {"root": {"text": "帷幕星云边缘的背景星等又降了 0.04。 你怎么处理？", "options": [{"text": "派舰队前出侦察", "effects": [{"type": "counter_add", "counter": "pollution", "delta": -1}, {"type": "log", "text": "【深渊动向】派舰队前出侦察", "level": "info"}], "goto": "o1"}, {"text": "保持监视，不接触", "effects": [{"type": "counter_add", "counter": "food", "delta": -1}, {"type": "log", "text": "【深渊动向】保持监视，不接触", "level": "info"}], "goto": "o2"}, {"text": "暂时不管", "effects": [{"type": "flag_set", "flag": "abyss_ignored"}, {"type": "log", "text": "【深渊动向】暂时不管", "level": "info"}], "goto": ...(截断)
```

**关键字段**：`entry` 起始节点；节点 `text` 支持模板（如 `{counters.fleets}`）；`options[].goto`（或 `next`）跳节点、`"end"` 结束；`options[].condition` / `cost` / `effects`；节点 `action: "close_dialogue"`；`dynamicOptions`（字符串=池名，引擎支持，**内容 0 处使用**）；`dialoguePools[].options` 是可直接展开的选项。

### 4.6 规则块

| 块 | 条数 | 字段（出现次数）|
|---|---|---|
| `events` | 120 | id(120) name(120) category(120) condition(120) once(120) priority(120) presentedBy(120) dialogue(120) |
| `npcApproach` | 123 | id(123) npcId(123) condition(123) dialogue(123) priority(123) once(120) |
| `projections` | 2 | id(2) from(2) default(2) scale(2) fg(2) bg(2) target(2) |
| `macros` | 0 | (空列表) |
| `hooks` | 0 | (空列表) |

```json
{"id": "ev_abyss_01", "name": "[深渊动向] 帷幕星云边缘的背景星等又", "category": "abyss", "condition": {"type": "tick", "op": ">=", "value": 720}, "once": true, "priority": 100, "presentedBy": ["npc_fleet_commander"], "dialogue": "dlg_ev_abyss_01"}
{"id": "ap_npc_fleet_commander_dialogue_abyss_contact", "npcId": "npc_fleet_commander", "condition": "pending:abyss_contact", "dialogue": "dialogue_abyss_contact", "priority": 100}
{"id": "pollution_landing", "from": "counters.pollution", "default": 0, "scale": [".", ":", "%", "X"], "fg": "abyss", "bg": "fog_bg", "target": {"scene": "planet_landing", "x": 10, "y": 3}}
```

`macros._example` = {"id": "give_ration", "effects": [{"type": "give_item", "item": "ration", "count": "{args.n}"}, {"type": "log", "text": "领到 {args.n} 份口粮。", "level": "good"}]}

`hooks._example` = {"id": "hook_first_visit", "on": "enter_scene", "scene": "planet_ruins", "once": true, "priority": 50, "condition": "!flag:seen_ruins", "effects": [{"type": "flag_set", "flag": "seen_ruins"}, {"type": "log", "text": "这里的刻痕你认得。", "level": "info"}]}

`hooks._howToAdd` 原文："钩子 = 内容层的插槽：不用改引擎，就能挂在引擎已经存在的时刻上。on 的可选值：game_start / tick / day / enter_scene / interact / npc_talk / dialogue_end / build_done。过滤器（写哪个就只在那一种情况下触发）：scene / interactable / npcId / dialogue / buildId / event。priority 大者先跑；once:true 只跑一次；effects 里放 {\"type\":\"stop\"} 可以掐掉这一轮的默认行为。"

`macros._howToAdd` 原文："宏 = 内容层自己的函数：把一串效果打包起个名字，别处一句 {\"type\":\"macro\",\"id\":\"名字\",\"params\":{...}} 就能复用，内部用 {args.键} 取参数。可以带 condition（配合判定词 {\"type\":\"macro_condition\",\"id\":\"名字\"} 复用条件）。宏也是带 id 的列表：mod 可以加、可以 patch、可以 replace。"

`tutorial.steps[0]` = {"id": "walk", "hint": "用 WASD 或方向键走动。你走的每一步，世界都在往前走。", "done": {"type": "tick", "op": ">=", "value": 370}}（共 5 步）

事件分类计数：{"abyss": 10, "fleet": 10, "colony": 10, "ruins": 10, "rift": 10, "politics": 10, "diplomacy": 10, "resource": 10, "tech": 10, "personnel": 10, "security": 10, "medical": 10}

### 4.7 世界数据块（当前仅数据）

| 块 | 条数 | 字段（出现次数）|
|---|---|---|
| `galaxy.nodes` | 36 | id(36) name(36) x(36) y(36) owner(36) pollution(36) fleets(36) mark(36) desc(36) |
| `resources` | 12 | id(12) name(12) amount(12) unit(12) carried(12) |
| `techTree` | 54 | id(54) name(54) branch(54) branchName(54) tier(54) cost(54) requires(54) unlocks(54) desc(54) |
| `fleets` | 10 | id(10) name(10) class(10) status(10) at(10) hp(10) crew(10) flag(1) |
| `fleetModules` | 24 | id(24) name(24) type(24) effect(24) cost(24) |
| `facilities` | 24 | id(24) name(24) kind(24) scene(24) status(24) progress(24) cost(24) days(24) |
| `colonies` | 6 | id(6) name(6) scene(6) pop(6) morale(6) food(6) ore(6) output(6) defense(6) desc(6) |
| `planetTypes` | 12 | id(12) name(12) desc(12) hazard(12) resource(12) |
| `diplomacy` | 20 | id(20) name(20) cost(20) costType(20) effect(20) |
| `diplomacy.actions` | 20 | id(20) name(20) cost(20) costType(20) effect(20) |
| `internalPolitics` | 8 | id(8) name(8) leader(8) support(8) demand(8) desc(8) |
| `eventChains` | 15 | id(15) name(15) steps(15) desc(15) |
| `textPools` | 32 | id(32) name(32) lines(32) |
| `relics` | 20 | id(20) name(20) desc(20) effect(20) |
| `missions` | 24 | id(24) name(24) objective(24) cost(24) reward(24) status(24) |
| `crisisStages` | 5 | id(5) name(5) threshold(5) desc(5) effects(5) |
| `victoryConditions` | 5 | id(5) name(5) rule(5) desc(5) |
| `defeatConditions` | 5 | id(5) name(5) rule(5) desc(5) |
| `shuttles` | 6 | id(6) name(6) scene(6) costTicks(6) desc(6) mark(6) locked(6) |
| `sceneTransitions` | 42 | id(42) from(42) to(42) costTicks(42) |
| `techTree.branches` | 6 | id(6) name(6) nodes(6) |

各块第 1 条原文示例：

```json
galaxy.nodes[0] = {"id": "sol", "name": "索尔", "x": 10, "y": 14, "owner": "player_remnant", "pollution": 0, "fleets": 3, "mark": "●", "desc": "我方控制"}
resources[0] = {"id": "alloy", "name": "合金", "amount": 120, "unit": "单位", "carried": false}
techTree[0] = {"id": "tech_water_rec", "name": "水循环回收", "branch": "survive", "branchName": "生存", "tier": 1, "cost": 50, "requires": [], "unlocks": "水循环回收 相关能力", "desc": "生存方向：水循环回收"}
fleets[0] = {"id": "fleet_ash", "name": "灰烬之矛", "class": "战列舰", "status": "驻防", "at": "索尔 III", "hp": 100, "crew": 420, "flag": true}
fleetModules[0] = {"id": "mod_bridge", "name": "指挥模块", "type": "nav", "effect": "舰队指挥半径 +1", "cost": {"alloy": 10}}
facilities[0] = {"id": "fac_shipyard_slip", "name": "船台", "kind": "ship", "scene": "station_shipyard", "status": "已建成", "progress": 100, "cost": {"alloy": 30}, "days": 12}
colonies[0] = {"id": "col_sol3", "name": "索尔 III 殖民地", "scene": "colony_command", "pop": 640, "morale": 72, "food": 17, "ore": 120, "output": "口粮、合金", "defense": 2, "desc": "最大的定居点，也是最先挨打的地方。"}
planetTypes[0] = {"id": "rock", "name": "岩质", "desc": "没有大气。白天烫，晚上冻。", "hazard": "低温", "resource": "合金"}
diplomacy[0] = {"id": "dip_send_envoy", "name": "派遣使节", "cost": "4 天", "costType": "time", "effect": "派遣使节（结果由对方态度决定）"}
diplomacy.actions[0] = {"id": "dip_send_envoy", "name": "派遣使节", "cost": "4 天", "costType": "time", "effect": "派遣使节（结果由对方态度决定）"}
internalPolitics[0] = {"id": "pol_martial", "name": "主战派", "leader": "leader_fleet_commander", "support": 35, "demand": "把舰队推到前线", "desc": "认为拖延就是等死。"}
eventChains[0] = {"id": "chain_01", "name": " 深渊动向 后续", "steps": ["ev_abyss_01", "ev_abyss_02", "ev_abyss_03"], "desc": "上一件事没处理干净，就会有下一件。"}
textPools[0] = {"id": "tp_station_ambient", "name": "站内环境", "lines": ["通风管在响。", "灯闪了一下。", "远处有人在敲管道。", "地板微微震动。"]}
relics[0] = {"id": "rel_signal", "name": "旧帝国信标", "desc": "还在发信号。没人知道它在等谁回应。", "effect": "持续提供星图情报"}
missions[0] = {"id": "mis_survey", "name": "深空测绘", "objective": "派舰队测绘帷幕星云边缘", "cost": "2 支舰队", "reward": "星图节点 +3", "status": "待接"}
crisisStages[0] = {"id": "crisis_1", "name": "第一阶段  征兆", "threshold": 0, "desc": "帷幕星云的背景星等在降。仪器说是噪声。", "effects": ["深渊接触事件开始出现", "星图上出现第一个污染标记"]}
victoryConditions[0] = {"id": "win_seal", "name": "封印", "rule": "关闭裂隙核心", "desc": "进入核心区并完成封印。最难，也是唯一不会留下后患的结局。"}
defeatConditions[0] = {"id": "lose_extinct", "name": "灭绝", "rule": "殖民地人口降到 0", "desc": "没有人了，就没什么可守的。"}
shuttles[0] = {"id": "sh_sol3", "name": "索尔 III 殖民地", "scene": "colony_command", "costTicks": 240, "desc": "近地殖民地，4 小时", "mark": ">", "locked": false}
sceneTransitions[0] = {"id": "tr_00_stationcorridor_stationcommand", "from": {"scene": "station_corridor"}, "to": {"scene": "station_command"}, "costTicks": 0}
techTree.branches[0] = {"id": "survive", "name": "生存", "nodes": ["water_rec", "hydro2", "ration_pack", "med_basic", "med_adv", "cold_sleep", "hab_seal", "hab_exp", "pop_boom"]}
```

### 4.8 引擎侧运行时状态（`space-core.js`）

导出 API（`return {  }` 原文）：

```
return {   version: VERSION, HOUR: HOUR, DAY: DAY,   conditions: conditions, effects: effects, viewProviders: viewProviders,   registerCondition: registerCondition, registerEffect: registerEffect, registerViewProvider: registerViewProvider, viewMetas: viewMetas,   check: check, runEffects: runEffects, compare: compare,   load: load, createGame: createGame, byId: byId, asList: asList,   SPACE_BLOCKS: SPACE_BLOCKS, NESTED_BLOCKS: NESTED_BLOCKS, mergeBlock: mergeBlock, mergeAtPath: mergeAtPath,   compileScene: compileScene, validate: validate, shapeWalls: shapeWalls, ringClosed: ringClosed,   tpl: tpl, getPath: getPath, deepMerge: deepMerge, clone: clone, effectiveLegend: effectiveLegend,   resolveColor: resolveColor, shade: shade, makeRng: makeRng,   Screen: Screen, Game: Game,   isObj: isObj, isArr: isArr, isFn: isFn, num: num, str: str, clamp: clamp, has: has,   pad: pad, padL: padL, charW: charW, strW: strW, wrapText: wrapText, cutW: cutW
```

- `Game.world` 键（`newWorld()`）：`tick flags counters items known visited seenDialogues firedRules seenViews npcPos npcPosts npcPaths pending builds tileOverrides fog vis player log kernelOps hint hintUntil tutStep gameOver path lastAuto`
- `serialize()` 存档键：`v spec savedAt tick flags counters items known visited seenDialogues seenViews firedRules pending builds tileOverrides npcPos npcPosts rng fog player log hint hintUntil tutStep gameOver lastAuto mods`
- 派生/缓存/出站白名单（不进档，测试断言）：`vis` `npcPaths` `path` `kernelOps` `proj`
- 词表（效果词 39）：`stop` `macro` `log` `hint` `open_view` `open_reader` `close_view` `open_dialogue` `close_dialogue` `close_all` `flag_set` `flag_clear` `flag_toggle` `counter_add` `counter_set` `stat_add` `stat_set` `give_item` `take_item` `teleport` `travel` `advance_ticks` `spawn_npc` `despawn_npc` `npc_post` `set_tile` `start_build` `kernel` `end_game` `if` `random` `effects` `gain_skill` `tutorial_step` `pending_set` `pending_clear` `discover` `rest` `galaxy_set`
- 判定词（21）：`flag` `counter` `stat` `item` `scene` `visited` `dialogue_seen` `near` `time` `tick` `day` `random` `kernel` `build_done` `tutorial` `not` `all` `any` `macro_condition` `row` `view_seen`
- 视图提供者（8）：`validation` `projections` `nearby` `recent_log` `pending_events` `chain_progress` `situation` `galaxy_live`
- `Game` 方法数：108（关键：`newWorld cellAt isPassable canStand setTile computeVision updateVision findPath stepActors step tickOnce onTick tryMove wait takeExit teleport interact autoInteract pathTo macro fireHooks openDialogue closeDialogue enterNode dialogueOptions chooseOption resolveView openView refreshView viewChoose viewSelect checkEvents projectValue applyProjections serialize deserialize reloadContent layout render drawDialogue drawView`）

---

## 5 代码架构

### 5.1 主循环 / 时间推进

- 外壳：`setInterval(step, 60)`（`space-textshell.js` 注释原文「主循环：setInterval，不用 requestAnimationFrame」）；另有 `setInterval(drawInfo, 250)`。
- 外壳 `step()` 里按速度累加：`acc += 0.06 * SPEEDS[mode] * Core.num(Core.getPath(built.space, "config.ticksPerSecond"), 4)`，取整后 `game.step(n)`；鼠标点出的路径在 `advancePath()` 里推进（与速度无关）。
- 内核：`step(n) -> tickOnce() -> world.tick += 1 -> onTick(dt)`；常量 `HOUR = 60`、`DAY = 24 * HOUR`。
- `onTick(dt)` 顺序（源码原文）：

```js
Game.prototype.onTick = function(dt){
  this.fireHooks('tick', {});
  if (this.world.tick % DAY === 0) this.fireHooks('day', {});
  this.stepTutorial();
  this.updateSchedules();
  this.stepActors();
  this.stepBuilds(dt);
  this.checkEvents();
  this.world.player.fatigue = clamp(num(this.world.player.fatigue, 0) + dt * num(this.cfg.fatiguePerTick, 0.02), 0, 100);
  if (this.world.tick % 60 === 0) this.applyProjections();
};
```

### 5.2 事件分发（三层）

1. **词表**：`conditions{}` / `effects{}` / `viewProviders{}` 三张注册表 + `register*`；`check(game,cond,ctx)` 支持布尔/字符串简写/对象/数组/`all`/`any`/`not`；`runEffects(game,list,ctx)` 支持字符串简写、模板套参，处理函数返回 `{stop:true}` 可中断。
2. **内容钩子**：`fireHooks(on, ctx)`；`idx.hooksByOn` 按 `on` 预索引并按 `priority` 降序；过滤器常量原文 `var HOOK_FILTERS = ['scene', 'interactable', 'npcId', 'dialogue', 'buildId', 'ev`。
3. **事件表**：`checkEvents()` 遍历 `events`，条件成立挂 `world.pending[id]`；玩家靠近 NPC 时 `pickApproachDialogue()` 按 `priority` 取第一条成立的 `npcApproach` 规则并开对话。

### 5.3 渲染更新方式

- 内核 `Game.render()`：`layout()` 决定分栏（`side = (W >= 70 && H >= 18) ? clamp(Math.round(W * 0.26), 24, 42) : 0`，且必须仍放得下整个场景）-> 画标题栏 / 状态行（有 hint 时借用）/ 地图（相机 `_cam`、`isVisible` 视野、迷雾 dim、NPC、玩家 `@`）/ 侧栏（日志 + 附近 + 图例）或下方日志 / 查看光标 / 对话或视图叠加层 -> 合成到 `this.screen`（`Screen`，每格 `ch/fg/bg`）。
- 外壳 `render()`：`game.render()` -> `out.paint(game.screen, false)` -> 只在与 `lastText` 不同时写 `<pre>`（纯文本写 `textContent`，彩色模式写 `<span>`）。
- 字号：`resize()` 调两次 `out.autoFit(...)`（先按分栏算 -> 问内核给不给分栏 -> 不给就按「日志在下方」重算）-> `game.resize(fit.cols, fit.rows)`；`TextOut._measure()` 用隐藏 `<pre>` 量 100 列 x 2 行得到单格宽高。
- 文本输出：`ASCII_MAP` 把地图/线框符号转 ASCII（`WIDE_MARK = "\\u0000"` 是宽字续格，输出时跳过）。

### 5.4 输入处理方式

- 键盘：`window.addEventListener('keydown', onKey)`；分支键（实测去重）：`F2 F3 F4 Tab X C Escape ? / space . e E Enter 1-5 + - = 0 _ ArrowUp ArrowDown ArrowLeft ArrowRight w a s d x c`；F2 面板打开时除 `Esc`/`F2` 外按键交给输入框；对话中方向键选、`1-9` 直选、`Enter/空格/e` 继续；视图中方向键移动、`Enter` 选中、`1-9` 按钮、`Tab` 关闭。
- 鼠标：`pre.addEventListener('click', ...)` -> 用 `out.cellW/cellH` 与 `pre.getBoundingClientRect()` 反算格子 -> `game.screenToScene(x, y)` -> 可走则 `pathTo()`，不可走则 `lookAt()`（查看）。

### 5.5 关键函数 / 类及职责

| 名称 | 职责 |
|---|---|
| `Screen(w,h,palette)` | 字符网格缓冲：`set/get/fill/dimRect/text/textRight/center/hline/vline/box/invert`；`text()` 处理宽字符占位 |
| `Game`（108 个 prototype 方法）| 世界与玩法；关键方法：`newWorld findFreeCell cellAt isPassable canStand setTile computeVision updateVision findPath stepActors step tickOnce onTick tryMove wait takeExit teleport interact autoInteract pathTo advancePath macro fireHooks openDialogue closeDialogue enterNode dialogueOptions chooseOption resolveView openView refreshView viewChoose viewSelect viewMove checkEvents projectValue applyProjections serialize deserialize reloadContent layout render drawDialogue drawView` |
| `compileScene / resolveLegendEntry / effectiveLegend` | 场景 JSON -> 网格（`ch fg bg pass kind ref name def exitMap spawn props`）|
| `load / normalizeSpace / applyMod / mergeBlock / mergeAtPath / patchItem / deepMerge` | 载入与 mod 合并（四种 `_op` + `_append` + `priority/order` 排序 + 未知键保留）|
| `validate` | 载入期校验 -> `report.{errors,warnings,stats,mods}` |
| `check / runEffects` + `registerCondition/registerEffect/registerViewProvider` | 词表与执行 |
| `makeRng(seed)` | 确定性随机 + `state()/setState()`（状态进存档）|
| `TextOut` | `fontCss applyFont _measure setFont fit autoFit charW contentLost paint` |
| `boot()`（外壳） | 初始化 + `viewport/resize/render/drawInfo/onKey/resizeIfSceneChanged/step` + `onKernel` 存档桥 + F2 面板（`parseModText/applyMods/renderModList/fillTemplate/exportMods/importFile/removeMod`）|

### 5.6 模块依赖关系

```
content/space.json --build_space.py--> space-text.html
                                  （注入 SPACE_SPEC / SPACE_MODS / SPACE_STARTER / ZHANYI_KERNEL）
      |
      +--(运行时) Core.load() -> {space, idx, report} -> Core.createGame() -> Game
                                                                   ^
        space-textout.js（TextOut，依赖 DOM，无 DOM 时降级估算单格尺寸）  |
        space-textshell.js（boot：键盘鼠标 + 主循环 + F2 面板 + localStorage）--+
```

- `space-core.js`：**不依赖 DOM**（Node 可直接 `require`），只产出网格；
- `space-textout.js`：依赖 DOM（`document` 缺失时用 `fontSize*0.6` / `fontSize*1.15` 估算）；
- `space-textshell.js`：依赖 `Core` + `TextOut` + DOM + `localStorage`。

---

## 6 待完成（按优先级）

来源：`DESIGN.md` 第 9 节的 R1R13 映射 + 本仓库实测。**本节只列「还没做的」；已完成的看第 3 节。**

**已落地（对照 `DESIGN.md` 9）**：R1 胜负判定、R2 数值契约、R3 深渊杂音、R4 舰队稀缺、R5 遗物来源、R6 殖民地补给（`pop` 活计数器 + 每日结算）、
R7 派别支持度（12 个 `support_*` 计数器 + 每日政治钩子 + 动作推动）、R8 科技解锁面板动作、R9 动态闲聊（5 处 `dynamicOptions` 引用 `dialoguePools`）、
R10 环境文本（7 个 `enter_scene` 钩子抽 `textPools`）、R11 `planetTypes.hazard` 变疲劳代价、R13 采集抽池。
**R12 部分**：6 个代表模块有装配动作，全部 34 条列进了舰队面板。
**世界层**：战略动作（勘测 / 宣示 / 殖民 / 交涉 / 开战）+ 指令进度（`M`）+ 阅读弹层（`L` / `open_reader`）+ 终端 flash 反馈 + **站点内内容**（每站 2 NPC / 专属建筑 / 采集点 / 随机遭遇 / 到达事件 / 地下层 / 4 星区）。

**世界层（目标参考 `VISION.md`，设计见 `DESIGN.md` 11）**：

- **已落地**：`tools/gen_world.py` 生成 18 站点 / 64 场景（含地下层）/ 38 视图 / 5 指令；世界地图终端 -> 站点档案 -> 勘测 / 宣示 / 殖民 / 交涉 / 开战；**每站 2 个 NPC + 专属建筑 + 采集点 + 随机遭遇 + 到达事件 + 地下层（可开采）**；**4 个星区**；**宣示 / 殖民 / 交涉 / 开战真的改星图（`galaxy_set` + `galaxy_live` + `world.galaxy`）**；穿梭机终端 + 全局「返回索尔」+ 档案返航动作（不会卡关）；按 `M` 看指令进度；按 `L` / `open_reader` 看长文本弹层。
- **最想做的下一步**：
  1. **站点内容继续加深**：更多可交互物 / 站点专属剧情线 / 随机遭遇变体。
  2. **战略层再绑紧**：外交态度驱动事件；把舰队 / 殖民地 counters 与站点状态联动。
  3. **三层生成扩展**：更多 biome / 派系变体 / 多层楼。

**还没做 / 做了一半**：

1. **R12 的其余模块**：舰队面板只有 1-9 快捷键，一次放 34 个动作点不到；要么做成分页 / 列表菜单，要么维持「列出全部、装配 6 个」。
2. **`factions.relation` 没有数字**：关系仍是文案（`relation` 字符串），没有像支持度那样的活计数器。
3. **`leaders` 只做名录**：`leaders[].npcId` 只被人物卡 / 派别引用，没有专门的规则或终端。
4. **`victoryConditions` / `defeatConditions` 是文案块**：真正判定在 9 条 `hook` + `end_game` 里；改胜负线要两处一起改。
5. **兵棋桥双向**：`kernel` 效果只把 op 推进 `world.kernelOps`（无消费方）；`opts.kernel` 只被 `kernelData()` 与 `kernel:` 判定词读；`projections` 只读 `counters`。
6. **mod 生态**：多文件 mod、`mods/` 目录热扫描、mod 冲突检查、导出成可分享的包。
7. **cookbook**：README「加东西改哪里」扩成最小例子集。
8. **真机断言**：三档全过并覆盖生成站点档案 / 阅读弹层；R4/R8 的完整研究链仍只在 Node 回归里。

---

## 7 硬约束

### 7.1 设计红线（文件原文）

- 「**三条铁律：内核不认内容  内容不写代码  一切皆 id 皆可合并**」（README 5）
- 四条不变量（README 0）：内核不认内容 一切皆 id 皆可合并（`SPACE_BLOCKS`(40) + `NESTED_BLOCKS`(5)，append 永不覆盖原内容）坏数据只降级、不崩 存档 = 世界快照
- 界面：**零 Canvas、零像素操作、地图全是 ASCII 字符**；**没有任何外链资源**；**没有任何东西会自动弹出来**；`不用 requestAnimationFrame`
- 兵棋层：`原 zhanyi.json 一个字节都没动`
- 内核文件头注释：「设计铁律：内核不认内容，内容不写代码。所有玩法元素都从数据里长出来。」
- 「**没有任何弹窗**」（README 6 事件呈现方式）

### 7.2 工程约定（DEVLOG 8 原文）

- 改了 `content/` 或 `engine/` 必须 `python build_space.py`，否则 `test_build.js` 会红（它比对产物与磁盘一致性）
- 加新块要登记进 `SPACE_BLOCKS` / `NESTED_BLOCKS` 并写 `_howToAdd` + `_example`
- 加新词要注册（`registerEffect` / `registerCondition` / `registerViewProvider`）
- 每个块条目必须有 id；`append` 不覆盖别人的内容（要改必须显式 `_op: "patch"`）
- 加新机制必须配测试：架构级 -> `tests/test_arch.js`；世界/内容 -> `tests/test_world.js`；外壳 -> `tests/test_shell.js`
- 改引擎后先 `node --check engine/*.js`，再 `node tests/run_all.js`
- 长输出命令别用 PowerShell 管道 `Select-Object -First`（会挂到超时并重置 shell）；重定向到文件再读

### 7.3 命名与风格（从文件推断）

- 文件名：`space-core.js` / `space-textout.js` / `space-textshell.js` / `space-text.tpl.html` / `space-text.html`
- 块级元字段：`_description` / `_version` / `_howToAdd` / `_example`
- id 前缀：`npc_` `sch_` `dlg_` `dlg_ev_` `dialogue_` `ev_` `ap_` `tr_` `fac_` `tech_` `pol_` `rel_` `mis_` `crisis_` `win_` `lose_` `sh_` `col_` `fleet_` `mod_` `hook_` `pool_` `tp_` `leader_`
- 文本风格：中文短句、第二人称（`你`）；日志行 `[HH:MM] 文本`（`logLine()`）；`_howToAdd` 用「教你怎么写」的口吻
- 注释风格：中文；段落用 `/* ===== 数字 标题 ===== */`；解释「为什么」而不只是「做什么」

---

## 8 已知问题

- **`world.kernelOps` 是出站队列**：宿主（兵棋桥）不取走会一直攒着；它不进存档。
- **胜负有两个真相**：`victoryConditions` / `defeatConditions` 是文案块，真正判定在 9 条 `hook` + `end_game` 里；改胜负线要两边一起改。
- **R12 只是部分接线**：34 条 `fleetModules` 全部列进了舰队面板，但只有 6 个做成装配动作（面板只有 1-9 键）。
- **真机断言覆盖不全**：三档分辨率全过；R4/R8 的完整研究链与 R6R13 的新面板还没全部进 `browser_check`。
- **`factions.relation` / `leaders`** 仍是文案 / 名录（见第 6 节）。
- **生成世界的内容还浅**：每站已有 1 个 NPC + 1 个采集点 + 1 个到达事件，但没有随机遭遇 / 站点专属建筑 / 更多 NPC；战略层也还没真正改星图归属。（**回程已修**：站点首图穿梭机终端 + 穿梭机列表返回目的地 + 档案返航动作。）
- **长文本走弹层**：`open_reader` + `L` / `M`；终端动作有 flash（见 `VISION.md` 第 5 节）。
- **星图是活数据**：`galaxy_live` provider 合并 `space.galaxy.nodes` 与 `world.galaxy`；`galaxy_set` 改归属 / 关系 / 舰队 / 污染，存档往返。
- **回程是硬约束**：`map_rules.py` R13 + `gen_world.py` 生成期复核；加新场景 / 新目的地必须先能走回穿梭机终端。
- **结束与重开**：`drawGameOver` 结束叠加 + `R` 重开；gameOver 后 `tickOnce` / `onTick` 冻结（`test_shell` 6.6 / 真机 `acc_gameover_*` / `acc_restart` 守）。
- **旅行必有回程**：base `sh_return`  `station_command`，旗舰舰桥与生成站点首图都有穿梭机终端；`test_world` 5.5 / `test_build`「全图无单向场景」守。
- **视口固定**：`config.viewW/viewH = 88x24` 比最高场景矮，预设里没有横向滚动（只在 mod 地图上出现）。
- **相机不做补间**：切场景瞬间重算（有意为之）。
- **`test_shell.js` 用假 DOM**：真机行为靠 `tools/browser_check.js`。
- **文档矛盾来源**：`AI_CONTEXT.md` 的数字与附录 B 全部由 `tools/update_context.py` 重算；手改数字会被下次构建覆盖。

---

## 9 术语表

| 术语 | 含义 |
|---|---|
| 朔 | 项目名；本项目为「场景层框架（纯文本模式）」 |
| 空间层 / 场景层 | `SPACE`：场景 / 人 / 对话 / 物件 / 终端 / 穿梭机 / 投影 / 教程 |
| 兵棋层 / 兵棋数据层 | `zhanyi.json` 的 `RULE / TEXT / CONTENT`（舰队、外交、科技、事件、战斗），本项目不改它 |
| 内核 | `engine/space-core.js`（`Core`） |
| 外壳 | `engine/space-textshell.js` |
| 内容层 | `content/space.json`（纯 JSON，无代码） |
| 块 / block | 带 id 的列表容器（`{"list": [...]}` 或裸数组） |
| `_op` | 合并方式：缺省 `append` / `patch` / `replace` / `remove`（remove 需 `allowRemove`） |
| `_append` | patch 时只往数组里追加，不必重抄整张表 |
| legend / 图例 | 场景内「字符 -> 含义」映射 |
| preset | 可复用的格子定义（墙/地板/虚空/门/货架/座椅/岩石） |
| `config.defaultLegend` | 全局标准字符表，被场景 `legend` 覆盖 |
| `tiles` | ASCII 字符地图（每行长度必须等于 `size.w`） |
| `exits[].at` | 过门后落在目标场景的坐标 |
| `props` / `tileEdits` | 在坐标上额外摆物件 / 改单格地形（mod 开一扇门不必重抄地图） |
| 物件 / interactable | 地图上的可交互格（终端/记录点/货架/座椅等） |
| 记录点 / save_point | 打开 `save_menu` 的物件（`symbol: "\u25c6"`） |
| 视图 / view / 终端 | 叠加在地图上的字符面板（`lines` / `sections` / `list`） |
| provider | 代码注册的视图内容提供者（`validation` `projections` `nearby` `recent_log`） |
| `source` | 视图数据来源路径（可读 `space.*` / `counters.*` / `kernel.*`，含自定义块） |
| `rowTemplate` | 表格行模板（`{row.字段}`） |
| 效果词 / effect | `runEffects` 支持的动作原语（38 个） |
| 判定词 / condition | `check` 支持的条件原语（21 个） |
| 简写判定 | 字符串形式：`flag:x` `!flag:x` `counter.gold>=10` `scene:ruins` `kernel:xxx` |
| 宏 / macro | 内容层的「函数」：命名效果组，`{args.键}` 取参，`macro_condition` 复用条件 |
| 钩子 / hook | 挂在引擎既有时刻上的内容插槽（8 个 `on` 值） |
| `stop` | 效果词，返回 `{stop:true}` 掐掉这一轮的默认行为 |
| counters / flags / items | 世界计数器 / 布尔标记 / 物品 |
| tick | 时间单位：1 tick = 1 游戏分钟；`HOUR = 60`、`DAY = 1440` |
| 迷雾 / fog | 未探索格（`config.fogChar`）；`fog` 数组是「看过」的记忆位 |
| 视野 / vision | `lit` 室内全亮，否则按 `visionRange` + 视线（`lineOfSight`） |
| 房间 / rooms | 给编辑器用的软引用（`{id, name, scene, type}`），引擎逻辑未读 |
| 日程 / schedule | NPC 的 `slots[{hours, scene, x, y}]` |
| 上报 / npcApproach | 走到 NPC 面前时他说哪段对话的规则（按 `priority`） |
| 事件 / events | 只判定并挂 `pending` 标记；由 NPC 主动上报 |
| 事件链 / eventChains | `steps: [事件 id ...]`（当前无推进逻辑） |
| 投影 / projection | 把数值画到地图某格（`from` + `scale` + `target`） |
| 存档快照 | `serialize()` 的字段集合；派生白名单 = `vis npcPaths path kernelOps proj` |
| 热加载 / `reloadContent` | 换内容保留世界状态；场景/人/位置失效时兜底 |
| kernel op | `effect "kernel"` 写进 `world.kernelOps` 的出站决定（`op` + `params`） |
| CDDA 式字符网格 | 内核段标题原文「14  屏幕合成（CDDA 式字符网格）」 |
| ASCII 映射 / `WIDE_MARK` | `space-textout.js` 的地图字符 -> ASCII 表；`WIDE_MARK` 是宽字续格 |
| 探针 / probe | `probe.html`：浏览器端诊断页（字号 / 等宽对齐 / 汉字宽比 / localStorage） |
| 起手 mod / starter | `tools/starter_mod.json`（F2「填入示例模板」） |

---

## 10 精简版上下文包（< 2000 字，可直接粘进新对话）

【项目】朔 = 纯文本(ASCII)场景层框架：玩家一个 @ 存在于世界，走到哪哪就是界面；画面是一个 <pre> 里的纯文本，零 Canvas、零像素、零外链。数据驱动，三条铁律：内核不认内容、内容不写代码、一切皆 id 皆可合并。位置 D:/大肥鱼工作区/朔/space。

【技术栈】JS(ES5 IIFE，无框架无 npm) + Python3 工具链；内核把世界+UI 合成 Screen 字符网格 -> ASCII -> 一个 <pre>；数据 = content/space.json 单一 JSON + mod JSON（mods/ 或 F2 粘贴，存 localStorage）；运行期零依赖。

【命令】python build_space.py（改内容或引擎后必须跑）｜node tests/run_all.js（607 项全绿）｜python tools/validate_space.py（0 错 0 警）｜python tools/scaffold_mod.py 我的房间 --id my_room。

【已完成】场景编译(tiles+legend+presets+defaultLegend)、校验、tick、移动与门、视野迷雾、NPC 日程+BFS 寻路、交互、对话节点图、效果词 38+判定词 21、事件 141+上报 145、投影、视图(20，7 provider)、存档(含 rng)、热加载 reloadContent、整屏合成；开放性：宏 macros、钩子 hooks(8 火点)、stop 停手权、块全量 id 合并、私有块与 source 任意路径；外壳：键盘与鼠标寻路、Tab 环顾、X 查看、F3 诊断、自适应字号、F2 面板(粘/选文件/模板/移除/导出)。

【核心数据】块形状 {list:[...]}；scenes: id,name,type,size{w,h},tiles,legend{字符:预设/物件/playerSpawn},exits[{x,y,to,at}],lit；npcs(id,name,symbol,color,homeScene,dialogue)；dialogues(id,npcId,entry,nodes{节点:{text,options[{text,goto,effects,condition,cost}]}})；hooks(id,on,condition,过滤器,once,priority,effects)。其余块（schedules/interactables/views/macros/世界数据）字段见第 4 节。

【示例】legend 写法 {"T": {"interactable": "star_map_terminal"}, "@": {"playerSpawn": true}, "#": {"preset": "wall"}}；exits 写法 [{"x": 36, "y": 23, "to": "station_corridor", "at": {"x": 16, "y": 2}}]

【架构】space-core.js = 词表注册表 + load/applyMod/mergeBlock/compileScene/effectiveLegend/validate + Game(108 方法) + Screen；space-textout.js = ASCII 映射与自适应字号；space-textshell.js = 键盘鼠标/主循环 setInterval(step,60)/onKernel 存档桥/F2 面板；build_space.py 编成自包含 space-text.html。

【红线】内核不认内容；内容不写代码；一切皆 id 皆可合并（SPACE_BLOCKS 40 + NESTED_BLOCKS 5，append 永不覆盖）；零 Canvas、零外链、无弹窗、不自动触发、不用 rAF；改内容或引擎必须重新构建；加新块要登记并写 _howToAdd 与 _example；加新词要 register*；条目必须有 id；新机制必须配测试。

【进度与坑】R1R13 已全部或部分落地；世界层：18 站点 / 64 场景、战略动作 + 指令进度（M）+ 阅读弹层（L）+ flash + 每站 2 NPC / 专属建筑 / 采集点 / 随机遭遇 / 到达事件 / 地下层 / 4 星区；战略层：`galaxy_set` + `galaxy_live` 让归属真的改星图并进存档；回程硬校验 R13 + 生成期复核。下一步见 VISION.md 第 6 节：站点内容继续加深、战略层再绑紧、三层生成扩展。详见 DEVLOG.md 与本文档第 4/6 节。

（上面 1921 字；完整版见本文件第 1-9 节，开发进度见 `DEVLOG.md`。）

---

## 附录 A 命令与验证基线

```bash
python build_space.py                 # 生成 space-text.html（改内容/引擎后必须跑）
python build_space.py --kernel ../zhanyi.json    # 顺带挂兵棋内核（注入 ZHANYI_KERNEL）
python build_space.py --spec x.json --out y.html --mods 别的mod目录
node tests/run_all.js                 # 回归：test_space/test_world/test_arch/test_text/test_shell/test_build
python tools/validate_space.py        # 纯 Python 内容校验（不需 Node）
node tools/preview.js 100 30          # 终端里打印画面
python tools/scaffold_mod.py 我的房间 --id my_room   # 生成新 mod 骨架
node --check engine/space-core.js     # 改引擎后先过语法
```

**生成时基线（本文件生成时实测）**

| 检查 | 命令 | 结果 |
|---|---|---|
| 构建 | `python build_space.py` | exit 0，`space-text.html` 1072.1 KB |
| 回归 | `node tests/run_all.js` | exit 0，通过 607 / 失败 0 |
| 内容校验 | `python tools/validate_space.py` | exit 0，错误 0 / 警告 0 |
| 预览 | `node tools/preview.js 80 24` | exit 0 |

测试文件与项数（实测）：world 206 项、text 30 项、shell 92 项、build 78 项

## 附录 B 数据块计数表（生成时现算）

| 块 | 条数 | 形状 |
|---|---|---|
| `sceneTypes` | 5 | {list} |
| `scenes` | 25 | {list} |
| `rooms` | 25 | {list} |
| `interactables` | 21 | {list} |
| `npcs` | 38 | {list} |
| `schedules` | 38 | {list} |
| `shuttles` | 7 | {list} |
| `sceneTransitions` | 50 | {list} |
| `dialogues` | 200 | {list} |
| `dialoguePools` | 20 | {list} |
| `views` | 20 | {list} |
| `projections` | 2 | {list} |
| `events` | 141 | {list} |
| `npcApproach` | 145 | {list} |
| `macros` | 3 | {list} |
| `hooks` | 30 | {list} |
| `saveMigrations` | 1 | {list} |
| `resources` | 38 | {list} |
| `techTree` | 72 | {list} |
| `fleets` | 14 | {list} |
| `factions` | 10 | {list} |
| `diplomacy` | 30 | {list} |
| `internalPolitics` | 12 | {list} |
| `leaders` | 38 | {list} |
| `planetTypes` | 18 | {list} |
| `fleetModules` | 34 | {list} |
| `facilities` | 34 | {list} |
| `colonies` | 10 | {list} |
| `medical` | 12 | {list} |
| `armory` | 12 | {list} |
| `mine` | 11 | {list} |
| `farm` | 11 | {list} |
| `defense` | 11 | {list} |
| `eventChains` | 18 | {list} |
| `textPools` | 44 | {list} |
| `relics` | 28 | {list} |
| `missions` | 32 | {list} |
| `crisisStages` | 6 | {list} |
| `victoryConditions` | 7 | {list} |
| `defeatConditions` | 7 | {list} |
| `galaxy.nodes` | 48 | 嵌套数组 |
| `techTree.branches` | 6 | 嵌套数组 |
| `diplomacy.actions` | 30 | 嵌套数组 |
| `tutorial.steps` | 5 | 嵌套数组 |
| `techTree.list` | 72 | 嵌套（顶层块同名的 .list）|

`SPACE_BLOCKS`（40）：`sceneTypes` `scenes` `rooms` `interactables` `npcs` `schedules` `dialogues` `dialoguePools` `shuttles` `sceneTransitions` `views` `projections` `events` `eventChains` `npcApproach` `textPools` `factions` `internalPolitics` `leaders` `planetTypes` `fleets` `fleetModules` `facilities` `colonies` `medical` `armory` `mine` `farm` `defense` `resources` `relics` `missions` `crisisStages` `victoryConditions` `defeatConditions` `diplomacy` `techTree` `macros` `hooks` `saveMigrations`

`NESTED_BLOCKS`（5）：`galaxy.nodes` `techTree.list` `techTree.branches` `diplomacy.actions` `tutorial.steps`

词表：效果词 39 个、判定词 21 个、视图提供者 8 个。
## 附录 C 测试覆盖（各文件小节标题原文）

- `tests/test_space.js`：1. 载入与校验 / 2. 玩家与时间 / 3. NPC 与日程 / 4. 对话 / 5. 事件  主动上报 / 5b. 世界层与事件链路 / 6. 物件与终端视图 / 7. 穿梭机（列表即菜单） / 8. 存档 / 读档 / 9. 渲染合成（整屏字符网格） / 10. 叠加层渲染 / 11. 性能预算（单 tick < 1ms） / 12. mod 合并（开放性）
- `tests/test_world.js`：1. 图例：默认标准字符表 + 场景覆盖 / 2. 地图：每个场景都能走 / 3. 房间连通：一个场景只应该有一块可走区域 / 4. 出生点与出口 / 5. 世界连通：门 + 穿梭机，从出生点能到每个场景 / 6. 物件：够得着、按 E 不炸 / 7. 终端视图：都能开、都有内容、每个按钮都能点 / 8. 对话：每个节点、每个选项都能点 / 9. 事件：每条事件都有人上报、能选 / 10. 人和日程 / 11. 教学：会自己推进，借状态行提示 / 12. 组合判定词：not / all / any / 13. 负例：内容写错时必须报警（这些坑不能静默） / 14. mod：新场景不写 legend 也能走（默认图例）
- `tests/test_arch.js`：1. 块注册表：内容里每个列表块都必须登记（否则 mod 一写就冲掉整块） / 2. 合并：加一条不能冲掉老的（逐个块实测） / 3. 合并语义：append / patch / replace / remove / 4. 词表：内容里出现的每个效果词 / 判定词都注册过 / 5. 存档：世界状态 + 随机数状态必须原样往返 / 5b. 读档兼容：版本 / 场景没了 / mod 对不上 / 5c. 内容层的插槽：宏 / 钩子 / 停手权 / 自定义块 / 热加载 / 6. 寻路：默认参数下要走得通整张地图 / 7. NPC 寻路不是瞬移 / 8. 走不过去时要有反馈 / 8b. 最坏情况的 tick 预算：一堆人同时重新寻路 / 9. 性能：放开寻路之后，预算仍然够
- `tests/test_shell.js`：1. 外壳能启动 / 2. 键盘：走路 / 等待 / 环顾 / 帮助 / 查看 / 诊断 / 3. 鼠标点格子自动走过去 / 4. 记录点终端：存档 / 读档落到 localStorage / 5. F2 装 mod：粘 JSON / 选文件 / 模板 / 移除 / 导出（热加载保进度） / 6. 挂了兵棋内核时读得到它 / 7. 坏 JSON 不会把面板搞崩
- `tests/test_text.js`：纯文本输出器 ===
- `tests/test_build.js`：（无 section 标题，按 ok() 断言组织）

---

## 怎么更新这份文件

1. 改完内容或引擎后跑一遍：`python build_space.py` -> `node tests/run_all.js` -> `python tools/validate_space.py`。
2. 数字（块条数、测试项数、行数）如果变了，请同步更新本文件里对应段落；示例请从 `content/space.json` 现摘，不要手写。
3. 有意义的进度变化请写进 `DEVLOG.md`（里程碑 / 已知问题 / 下一步），本文件只描述「当前状态」。
4. 本文件由一次扫描生成（2026-10-01 09:42 +08:00），生成时基线：`node tests/run_all.js` 通过 607 / 失败 0。
