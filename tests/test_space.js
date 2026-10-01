/* =============================================================================
 * test_space.js  场景层框架回归测试（node，无需浏览器）
 *   node tests/test_space.js
 * ========================================================================== */
var path = require('path'), fs = require('fs');
var Core = require(path.join(__dirname, '..', 'engine', 'space-core.js'));
var PERF = require(path.join(__dirname, 'perf_budget.js'));
if (PERF.banner()) console.log(PERF.banner());

var pass = 0, fail = 0, notes = [];
function ok(name, cond, extra){
  if (cond){ pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '   -> ' + extra : '')); }
}
var asList = function(v){ return Core.asList(v); };
function section(t){ console.log('\n=== ' + t + ' ==='); }

var spacePath = path.join(__dirname, '..', 'content', 'space.json');
var spaceJson = JSON.parse(fs.readFileSync(spacePath, 'utf8'));


/* ---------- 动态定位工具：不写死坐标，改地图也不会坏 ---------- */
function gridOf(id){ return built.idx.sceneGrids[id]; }
function findCell(sceneId, pred){
  var g = gridOf(sceneId); if (!g) return null;
  for (var i = 0; i < g.ch.length; i++) if (pred(g, i)) return { x: i % g.w, y: (i / g.w) | 0 };
  return null;
}
function findObject(sceneId, id){
  return findCell(sceneId, function(g, i){ return g.kind[i] === 'interactable' && g.ref[i] === id; });
}
function floorNear(sceneId, x, y){
  var g = gridOf(sceneId); if (!g) return null;
  for (var r = 0; r < 8; r++){
    for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++){
      var nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      var i = ny * g.w + nx;
      if (g.pass[i] && g.kind[i] !== 'interactable' && g.kind[i] !== 'exit') return { x: nx, y: ny };
    }
  }
  return null;
}
function npcPost(npcId){
  var sc = built.idx.schedules[npcId];
  var slot = sc && sc.slots && sc.slots[0];
  return slot ? { scene: slot.scene, x: slot.x, y: slot.y } : null;
}

section('1. 载入与校验');
var built = Core.load({ space: spaceJson });
var g = Core.createGame(built, {});
ok('无致命错误', built.report.errors.length === 0, JSON.stringify(built.report.errors));
ok('有内容（场景 >= 7）', built.report.stats.scenes >= 7, built.report.stats.scenes);
ok('NPC >= 5', built.report.stats.npcs >= 5);
ok('对话 >= 8', built.report.stats.dialogues >= 8);
ok('物件 >= 8', built.report.stats.interactables >= 8);
ok('视图 >= 8', built.report.stats.views >= 8);
ok('每个 NPC 都有日程', built.space.npcs.list.every(function(n){
  return !!built.idx.schedules[n.id];
}));
ok('每个场景网格行宽正确', Object.keys(built.idx.sceneGrids).every(function(k){
  var gr = built.idx.sceneGrids[k];
  for (var i = 0; i < gr.ch.length; i++) if (typeof gr.ch[i] !== 'string' || gr.ch[i].length !== 1) return false;
  return true;
}));
notes.push('警告 ' + built.report.warnings.length + ' 条（孤岛场景等预期警告）');

section('2. 玩家与时间');
ok('玩家在起始场景', g.world.player.scene === 'station_command', g.world.player.scene);
var spawn = spaceJson.playerCharacter.position;
ok('玩家在出生点', g.world.player.x === spawn.x && g.world.player.y === spawn.y, g.world.player.x + ',' + g.world.player.y);
var t0 = g.world.tick;
var stepDir = null;
[[0,-1],[0,1],[-1,0],[1,0]].forEach(function(d){
  if (!stepDir && g.isPassable(g.world.player.scene, g.world.player.x + d[0], g.world.player.y + d[1])) stepDir = d;
});
ok('出生点至少有一个方向能走（不是被四面墙围死）', !!stepDir);
var p0 = { x: g.world.player.x, y: g.world.player.y };
if (stepDir) g.tryMove(stepDir[0], stepDir[1]);
ok('走一格消耗 1 tick', g.world.tick === t0 + 1, g.world.tick - t0);
ok('玩家位置更新', g.world.player.x !== p0.x || g.world.player.y !== p0.y, g.world.player.x + ',' + g.world.player.y);
ok('视野已计算', !!g.world.vis.flags && g.world.vis.scene === 'station_command');
var stuck = g.world.player.x;
g.tryMove(0, -99);
ok('越界移动被拒绝', g.world.player.x === stuck);

section('3. NPC 与日程');
var npcsHere = g.npcsHere('station_command');
ok('指挥中心里有 NPC', npcsHere.length >= 1, npcsHere.join(','));
ok('舰队指挥官在岗', npcsHere.indexOf('npc_fleet_commander') >= 0, npcsHere.join(','));
var before = Object.keys(g.world.npcPos).length;
ok('所有 NPC 都已就位', before >= 5, before);
var npcTick = g.world.tick;
g.step(60);
ok('推进 60 tick = 1 小时', g.world.tick === npcTick + 60);

section('4. 对话');
var cmdPost = npcPost('npc_fleet_commander');
var cmdStand = floorNear(cmdPost.scene, cmdPost.x, cmdPost.y);
g.teleport(cmdPost.scene, cmdStand.x, cmdStand.y);
ok('传送到指挥官旁边', g.npcsNear(1).some(function(a){ return a.npcId === 'npc_fleet_commander'; }));
g.approachNpc('npc_fleet_commander');
ok('对话已打开', !!g.ui.dialogue && g.ui.dialogue.id === 'dlg_fleet_commander',
   g.ui.dialogue && g.ui.dialogue.id);
var opts = g.dialogueOptions();
ok('根节点有 5 个可见选项（新增「听说帷幕星云要测绘？」任务线入口）', opts.length === 5, opts.length);
ok('任务线入口就挂在日常对话的最后一位', String(opts[4] && opts[4].text).indexOf('测绘') >= 0, opts[4] && opts[4].text);
g.chooseOption(0);
ok('跳到第一个话题节点 n1', g.ui.dialogue && g.ui.dialogue.node === 'n1', g.ui.dialogue && g.ui.dialogue.node);
ok('话题节点有 2 个选项', g.dialogueOptions().length === 2, g.dialogueOptions().length);
g.chooseOption(0);
ok('「再说说别的」能回到 root', g.ui.dialogue && g.ui.dialogue.node === 'root', g.ui.dialogue && g.ui.dialogue.node);
g.chooseOption(0);
g.chooseOption(1);
ok('对话走到 end 节点', g.ui.dialogue && g.ui.dialogue.node === 'end', g.ui.dialogue && g.ui.dialogue.node);
g.dialogueAdvance();
ok('对话关闭', !g.ui.dialogue);

section('5. 事件  主动上报');
g.world.pending.derelict_signal = true;
g.approachNpc('npc_fleet_commander');
ok('NPC 主动上报事件对话', g.ui.dialogue && g.ui.dialogue.id === 'dialogue_derelict_signal',
   g.ui.dialogue && g.ui.dialogue.id);
g.chooseOption(0);
ok('选了「派遣登陆队」后 pending 清空', !g.world.pending.derelict_signal);
ok('下发内核指令', g.world.kernelOps.length >= 1, JSON.stringify(g.world.kernelOps[0] && g.world.kernelOps[0].op));
if (g.ui.dialogue) g.dialogueAdvance();

section('5b. 世界层与事件链路');
ok('势力 >= 5', asList(built.space.factions).length >= 5, asList(built.space.factions).length);
ok('星系节点 >= 30', (built.space.galaxy.nodes || []).length >= 30, (built.space.galaxy.nodes || []).length);
ok('舰队 >= 8', asList(built.space.fleets).length >= 8, asList(built.space.fleets).length);
ok('舰队模块 >= 20', asList(built.space.fleetModules).length >= 20, asList(built.space.fleetModules).length);
ok('设施 >= 20', asList(built.space.facilities).length >= 20, asList(built.space.facilities).length);
ok('科技节点 >= 50', asList(built.space.techTree).length >= 50, asList(built.space.techTree).length);
ok('事件 >= 120', asList(built.space.events).length >= 120, asList(built.space.events).length);
ok('事件链 >= 15', asList(built.space.eventChains).length >= 15, asList(built.space.eventChains).length);
ok('文本池 >= 30', asList(built.space.textPools).length >= 30, asList(built.space.textPools).length);
ok('遗物 >= 20', asList(built.space.relics).length >= 20, asList(built.space.relics).length);
ok('任务 >= 20', asList(built.space.missions).length >= 20, asList(built.space.missions).length);
ok('危机阶段 >= 5', asList(built.space.crisisStages).length >= 5, asList(built.space.crisisStages).length);
ok('胜利/失败条件各 >= 5', asList(built.space.victoryConditions).length >= 5 && asList(built.space.defeatConditions).length >= 5);
ok('每条事件都有对应的上报人和对话',
   asList(built.space.events).every(function(ev){
     return ev.dialogue && built.idx.dialogues[ev.dialogue] && (ev.presentedBy || []).length;
   }));
ok('每条事件都有 npcApproach 规则',
   asList(built.space.events).every(function(ev){
     return asList(built.space.npcApproach).some(function(r){ return r.dialogue === ev.dialogue; });
   }));
ok('每个 NPC 都有对话', asList(built.space.npcs).every(function(n){ return !!built.idx.dialogues[n.dialogue]; }));

var g9 = Core.createGame(built, {});
g9.world.tick = 900; g9.step(1);
ok('事件会自己挂上待上报标记', Object.keys(g9.world.pending).length > 0, Object.keys(g9.world.pending).length);
g9.teleport('station_command', 18, 7);
g9.approachNpc('npc_fleet_commander');
ok('走到人面前他会主动上报', /^dlg_ev_/.test(g9.ui.dialogue && g9.ui.dialogue.id), g9.ui.dialogue && g9.ui.dialogue.id);
ok('事件对话有 3 个选项', g9.dialogueOptions().length === 3, g9.dialogueOptions().length);
var c0 = g9.world.counters.pollution;
g9.chooseOption(0);
ok('选项会改变世界状态', g9.world.counters.pollution !== c0 || Object.keys(g9.world.flags).length > 0);
g9.ui.dialogue = null;

section('6. 物件与终端视图');
var tPost = findObject('station_command', 'star_map_terminal');
var tStand = floorNear('station_command', tPost.x, tPost.y);
g.teleport('station_command', tStand.x, tStand.y);
var cells = g.cellsNear(1);
ok('星图终端在相邻格', cells.some(function(c){ return c.def.id === 'star_map_terminal'; }),
   cells.map(function(c){ return c.def.id; }).join(','));
g.interact();
ok('打开星图视图', !!g.ui.view && g.ui.view.id === 'galaxy_map', g.ui.view && g.ui.view.id);
g.refreshView();
ok('星图有内容行', g.ui.view.lines.length > 0, g.ui.view.lines.length);
ok('记录已看过的视图', g.world.seenViews.galaxy_map === true);
g.closeView();

section('7. 穿梭机（列表即菜单）');
var shPost = findObject('station_warehouse', 'shuttle_terminal');
var shStand = floorNear('station_warehouse', shPost.x, shPost.y);
g.teleport('station_warehouse', shStand.x, shStand.y);
g.interact();
ok('打开穿梭机目的地', !!g.ui.view && g.ui.view.id === 'shuttle_destinations', g.ui.view && g.ui.view.id);
g.refreshView();
ok('锁定目的地被过滤（剩 6 个，含 1 条返回索尔）', g.ui.view.rows.length === 6, g.ui.view.rows.length);
var tickBefore = g.world.tick;
g.viewSelect();
ok('出发到殖民地', g.world.player.scene === 'colony_command', g.world.player.scene);
ok('旅行消耗 tick', g.world.tick >= tickBefore + 240, g.world.tick - tickBefore);

section('8. 存档 / 读档');
var snap = g.serialize();
var sc = g.world.player.scene, tk = g.world.tick, fl = g.world.flags.veil_expedition;
g.world.player.scene = 'station_command'; g.world.flags.veil_expedition = false; g.world.tick = 0;
g.deserialize(snap);
ok('读档还原场景', g.world.player.scene === sc, g.world.player.scene);
ok('读档还原 tick', g.world.tick === tk, g.world.tick);
ok('读档还原 flag', g.world.flags.veil_expedition === fl);
ok('存档是纯 JSON', JSON.stringify(snap).length > 100);

section('9. 渲染合成（整屏字符网格）');
var scr = g.render();
ok('屏幕尺寸正确', scr.w === g.screenW && scr.h === g.screenH, scr.w + 'x' + scr.h);
var allBg = true, allCh = true, wide = 0;
for (var i = 0; i < scr.n; i++){
  if (typeof scr.bg[i] !== 'string' || !scr.bg[i]) allBg = false;
  if (typeof scr.ch[i] !== 'string' || scr.ch[i].length !== 1) allCh = false;
  if (scr.ch[i] === '\u0000') wide++;
}
ok('每格都有独立背景色块', allBg);
ok('每格都是单字符', allCh);
var COLOR_OK = /^(#[0-9a-fA-F]{3,8}|rgba?\(|hsla?\()/;
var badColor = 0, bgSet = {}, fgSet = {};
for (var cIdx = 0; cIdx < scr.n; cIdx++){
  if (!COLOR_OK.test(scr.bg[cIdx])) { badColor++; if (badColor === 1) console.log('     首个非法背景色: ' + scr.bg[cIdx]); }
  if (!COLOR_OK.test(scr.fg[cIdx])) badColor++;
  bgSet[scr.bg[cIdx]] = 1; fgSet[scr.fg[cIdx]] = 1;
}
ok('每格颜色都是合法 CSS 颜色（不能是调色板名）', badColor === 0, badColor);
ok('背景色块真的分出了层次（>=4 种）', Object.keys(bgSet).length >= 4, Object.keys(bgSet).length);
ok('前景色也不止一种', Object.keys(fgSet).length >= 3, Object.keys(fgSet).length);
ok('最底层背景不是纯黑（调色板生效）', Object.keys(bgSet).some(function(k){ return k !== '#000000'; }));
ok('宽字符占位标记存在（中文排版正确）', wide > 0, wide);
var playerShown = false;
for (var p2 = 0; p2 < scr.n; p2++) if (scr.ch[p2] === '@') playerShown = true;
ok('玩家 @ 出现在屏幕上', playerShown);

section('10. 叠加层渲染');
g.openView('galaxy_map'); g.render();
ok('视图叠加不报错', !!g.ui.view);
g.closeView();
g.openDialogue('dialogue_fleet_commander', 'npc_fleet_commander'); g.render();
ok('对话叠加不报错', !!g.ui.dialogue);
g.ui.dialogue = null;

section('11. 性能预算（单 tick < 1ms）');
var g2 = Core.createGame(Core.load({ space: spaceJson }), {});
var t1 = Date.now();
g2.step(20000);
var dt = Date.now() - t1;
ok('20000 tick 完成', g2.world.tick > 20000);
ok('单 tick 平均 < 1ms' + PERF.note, dt / 20000 < PERF.budget(1), (dt / 20000).toFixed(4) + ' ms/tick, ' + dt + 'ms total');
for (var w0 = 0; w0 < 20; w0++) g2.render();     /* 预热 */
var t2 = Date.now();
for (var r = 0; r < 200; r++) g2.render();
var dt2 = Date.now() - t2;
ok('单帧合成 < 6ms（' + g2.screen.n + ' 格）' + PERF.note, dt2 / 200 < PERF.budget(6), (dt2 / 200).toFixed(4) + ' ms/frame');

section('12. mod 合并（开放性）');
var mod = { manifest: { id: 'test_mod', name: '测试 mod', version: '1' }, data: {
  scenes: { list: [ { id: 'mod_room', name: 'mod 房间', type: 'space_station', size: { w: 8, h: 6 },
    tiles: ['\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588','\u2588......\u2588','\u2588......\u2588',
            '\u2588......\u2588','\u2588......\u2588','\u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2588'],
    legend: { '\u2588': { preset: 'wall' }, '.': { preset: 'floor' } }, exits: [] } ] },
  npcs: { list: [ { id: 'npc_mod', name: 'mod 角色', symbol: 'M', homeScene: 'mod_room', dialogue: 'dialogue_adjutant' } ] },
  myOwnBlock: { hello: 'world' }
} };
var built2 = Core.load({ space: spaceJson, mods: [mod] });
ok('mod 场景已合并', !!built2.idx.scenes.mod_room);
ok('mod NPC 已合并', !!built2.idx.npcs.npc_mod);
ok('mod 自定义块被保留（完全开放）', Core.getPath(built2.space, 'myOwnBlock.hello') === 'world');
ok('mod 合并后仍无致命错误', built2.report.errors.length === 0, JSON.stringify(built2.report.errors));
var g3 = Core.createGame(built2, {});
ok('可以在 mod 场景里开局', !!g3.idx.sceneGrids.mod_room);
g3.teleport('mod_room', 1, 1);
ok('mod 场景可以进入', g3.world.player.scene === 'mod_room');
var dupMod = { manifest: { id: 'dup' }, data: { scenes: { list: [{ id: 'station_command', name: 'X' }] } } };
var built3 = Core.load({ space: spaceJson, mods: [dupMod] });
ok('重复 id 默认不覆盖（保护原内容）', built3.idx.scenes.station_command.name === '指挥中心',
   built3.idx.scenes.station_command.name);
var patchMod = { manifest: { id: 'patch' }, data: { scenes: { list: [{ id: 'station_command', _op: 'patch', ambient: '改过了。' }] } } };
var built4 = Core.load({ space: spaceJson, mods: [patchMod] });
ok('_op:patch 可以局部改', built4.idx.scenes.station_command.ambient === '改过了。');

section('12.5 读档兜底：老存档缺了新计数器不会被当成 0');
var gBk = Core.createGame(built, {});
var snapBk = JSON.parse(JSON.stringify(gBk.serialize()));
delete snapBk.counters.morale; delete snapBk.counters.pop;   /* 假装是加这两个计数器之前的老档 */
var gBk2 = Core.createGame(built, {});
gBk2.deserialize(snapBk);
ok('缺的计数器用 initialState 兜底（morale = 72）', Core.num(gBk2.world.counters.morale, -1) === 72, gBk2.world.counters.morale);
ok('pop 也补上了（2000）', Core.num(gBk2.world.counters.pop, -1) === 2000, gBk2.world.counters.pop);
ok('补齐之后不会误判败北', gBk2.world.gameOver === null, JSON.stringify(gBk2.world.gameOver));

section('13. 存档迁移：saveMigrations 按版本号一档一档跑');
ok('saveMigrations 登记在册', Core.SPACE_BLOCKS.indexOf('saveMigrations') >= 0);
ok('内核导出了 SAVE_VERSION（>=2）', Core.num(Core.SAVE_VERSION, 1) >= 2, Core.SAVE_VERSION);
var gMig = Core.createGame(built, {});
var curSnap = JSON.parse(JSON.stringify(gMig.serialize()));
ok('新存档带当前版本号', Core.num(curSnap.v, 1) === Core.num(Core.SAVE_VERSION, 1), curSnap.v);
var gFresh = Core.createGame(built, {});
gFresh.deserialize(JSON.parse(JSON.stringify(curSnap)));
ok('当前版本存档不跑迁移', gFresh.world.flags.save_v2 !== true);
/* 假装这是一份 v1 老存档：抹掉 v2 才有的字段 */
var oldSnap = JSON.parse(JSON.stringify(curSnap));
oldSnap.v = 1;
delete oldSnap.chains; delete oldSnap.crisis;
var gOld = Core.createGame(built, {});
var okRead = gOld.deserialize(oldSnap);
ok('v1 老存档能读进来（不崩）', okRead === true);
ok('读老存档时跑了迁移（save_v2 点上）', gOld.world.flags.save_v2 === true, JSON.stringify(gOld.world.flags));
ok('迁移写了日志', gOld.world.log.some(function(e){ return String(e.text).indexOf('迁到') >= 0; }));
ok('迁移后世界仍然可用', (function(){ gOld.step(1); return gOld.world.tick === Core.num(oldSnap.tick, 0) + 1 && !!gOld.world.crisis; })());
ok('没有对应迁移规则时只警告不崩', (function(){
  var gx = Core.createGame(built, {});
  var s0 = JSON.parse(JSON.stringify(gx.serialize()));
  s0.v = 0;
  var r = gx.deserialize(s0);
  return r === true && built.report.warnings.some(function(w){ return String(w).indexOf('迁移规则') >= 0; });
})(), '');

section('14. 五层内容规模下限（只多不少）+ 资源补齐');
var floors = {
  'scenes': 25, 'rooms': 25, 'npcs': 38, 'schedules': 38, 'dialogues': 197,
  'interactables': 20, 'sceneTransitions': 50,
  'factions': 10, 'diplomacy.actions': 30, 'internalPolitics': 12, 'leaders': 38,
  'galaxy.nodes': 48, 'planetTypes': 18,
  'fleets': 14, 'fleetModules': 34, 'facilities': 34, 'colonies': 10, 'resources': 20,
  'techTree.list': 72, 'events': 138, 'eventChains': 18, 'textPools': 44,
  'relics': 28, 'missions': 32, 'crisisStages': 6,
  'victoryConditions': 7, 'defeatConditions': 7
};
function countOf(path){
  var v = Core.getPath(spaceJson, path, []);
  if (Core.isArr(v)) return v.length;
  if (v && Core.isArr(v.list)) return v.list.length;
  return 0;
}
var low = [];
Object.keys(floors).forEach(function(k){ var c = countOf(k); if (c < floors[k]) low.push(k + ' ' + c + '<' + floors[k]); });
ok('五层内容都不低于本轮下限（只多不少，不许回退）', low.length === 0, low.join(' | '));
ok('资源补齐：每个计数器都有对应的 resources 条目', (function(){
  var res = {}; asList(spaceJson.resources).forEach(function(r){ res[r.id] = 1; });
  return Object.keys(spaceJson.initialState.counters).every(function(k){ return res[k]; });
})(), Object.keys(spaceJson.initialState.counters).join(','));
ok('每个科技节点都能在某个分支的 nodes 里找到', (function(){
  var inBranch = {};
  asList(spaceJson.techTree.branches).forEach(function(b){ (b.nodes || []).forEach(function(n){ inBranch[n] = 1; }); });
  return asList(spaceJson.techTree.list).every(function(t){ return inBranch[String(t.id).replace(/^tech_/, '')]; });
})());
ok('每条事件链的 steps 都指向真实事件、且同一步只属于一条链', (function(){
  var evIds = {}, owner = {}, bad = [];
  asList(spaceJson.events).forEach(function(e){ evIds[e.id] = 1; });
  asList(spaceJson.eventChains).forEach(function(c){
    (c.steps || []).forEach(function(s){
      if (!evIds[s]) bad.push(c.id + '->' + s);
      if (owner[s] && owner[s] !== c.id) bad.push('链共用事件 ' + s);
      owner[s] = c.id;
    });
  });
  return bad.length === 0;
})());

console.log('\n----------------------------------------');
console.log('通过 ' + pass + ' / 失败 ' + fail);
notes.forEach(function(n){ console.log('注：' + n); });
process.exit(fail ? 1 : 0);