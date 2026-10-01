/* =============================================================================
 * test_world.js  世界层回归测试（node，不开浏览器）
 *   node tests/test_world.js
 *   这里守的是「内容真的能玩」：图例覆盖 / 房间连通 / 门能走通 / 终端能开 /
 *   对话每个选项都能点 / 事件有人上报 / 教学会推进 / 默认图例对 mod 生效。
 *   这些坑都踩过：13 个场景的 legend 漏了 "."，整张图编译成实心墙、
 *     玩家出生就被四面墙围死；宿舍和舰桥画成了没有门的盒子。
 * ========================================================================== */
var path = require('path'), fs = require('fs');
var Core = require(path.join(__dirname, '..', 'engine', 'space-core.js'));

var pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond){ pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '   -> ' + extra : '')); }
}
function section(t){ console.log('\n=== ' + t + ' ==='); }

var spaceJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'space.json'), 'utf8'));
var built = Core.load({ space: spaceJson });
var scenes = spaceJson.scenes.list;
var SCENE_IDS = scenes.map(function(s){ return s.id; });

/* 场景连通性：返回 {lab, main, sizes} */
function regions(sceneId){
  var g = built.idx.sceneGrids[sceneId], N = g.w * g.h;
  var lab = new Int32Array(N).fill(-1), sizes = [], firsts = [];
  for (var i = 0; i < N; i++){
    if (!g.pass[i] || lab[i] >= 0) continue;
    var id = sizes.length, q = [i], n = 0;
    lab[i] = id;
    while (q.length){
      var c = q.pop(); n++;
      var x = c % g.w, y = Math.floor(c / g.w);
      for (var k = 0; k < 4; k++){
        var nx = x + [0,0,-1,1][k], ny = y + [-1,1,0,0][k];
        if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
        var j = ny * g.w + nx;
        if (g.pass[j] && lab[j] < 0){ lab[j] = id; q.push(j); }
      }
    }
    sizes.push(n); firsts.push(i);
  }
  var main = 0;
  for (var m = 1; m < sizes.length; m++) if (sizes[m] > sizes[main]) main = m;
  return { lab: lab, sizes: sizes, main: main, firsts: firsts };
}
function walkable(sceneId){
  var g = built.idx.sceneGrids[sceneId], n = 0;
  for (var i = 0; i < g.pass.length; i++) if (g.pass[i]) n++;
  return n;
}
function freeCellNear(sceneId, x, y, r){
  var g = built.idx.sceneGrids[sceneId];
  r = r || 3;
  for (var rr = 1; rr <= r; rr++){
    for (var dy = -rr; dy <= rr; dy++) for (var dx = -rr; dx <= rr; dx++){
      if (Math.max(Math.abs(dx), Math.abs(dy)) !== rr) continue;
      var nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      if (g.pass[ny * g.w + nx]) return { x: nx, y: ny };
    }
  }
  return null;
}

/* ---------------------------------------------------------------- */
section('1. 图例：默认标准字符表 + 场景覆盖');
ok('config.defaultLegend 存在', Core.isObj(spaceJson.config.defaultLegend));
var noLegend = scenes.filter(function(s){ return !s.legend || s.legend['.'] === undefined; });
ok('有场景没写 "." 图例（这是常态，靠默认表兜底）', noLegend.length > 0, noLegend.length);
var allCovered = true, uncovered = [];
scenes.forEach(function(s){
  var lg = Core.effectiveLegend(spaceJson, s);
  (s.tiles || []).forEach(function(row, y){
    for (var x = 0; x < row.length; x++) if (!Core.has(lg, row.charAt(x))) uncovered.push(s.id + ':' + JSON.stringify(row.charAt(x)));
  });
});
ok('每个场景的每个地图字符都能在（有效）图例里查到', uncovered.length === 0,
   uncovered.slice(0, 6).join(' '));
var lc = Core.effectiveLegend(spaceJson, scenes.filter(function(s){ return s.id === 'station_command'; })[0]);
ok('场景自己的图例优先（station_command 的 [ 是货架、# 是墙）',
   lc['['].interactable === 'shelf' && lc['#'].preset === 'wall',
   JSON.stringify(lc['[']) + ' ' + JSON.stringify(lc['#']));
var lp = Core.effectiveLegend(spaceJson, scenes.filter(function(s){ return s.id === 'planet_landing'; })[0]);
ok('默认图例补上了场景没写的字符（planet_landing 的 ^ 是岩石）', Core.isObj(lp['^']), JSON.stringify(lp['^']));

section('2. 地图：每个场景都能走');
scenes.forEach(function(s){
  var n = walkable(s.id), g = built.idx.sceneGrids[s.id];
  ok('场景 ' + s.id + ' 有足够可走的格子', n >= 50 && n / (g.w * g.h) > 0.15, n + '/' + (g.w * g.h));
});
ok('没有场景是实心墙（历史上 13 个场景全实心）', scenes.every(function(s){ return walkable(s.id) > 50; }));

section('3. 房间连通：一个场景只应该有一块可走区域');
var multi = [];
scenes.forEach(function(s){
  var r = regions(s.id);
  if (r.sizes.length !== 1) multi.push(s.id + JSON.stringify(r.sizes));
});
ok('每个场景都是单连通区域（没有「没有门的房间」）', multi.length === 0, multi.join(' | '));

section('4. 出生点与出口');
scenes.forEach(function(s){
  var g = built.idx.sceneGrids[s.id];
  var sp = g.spawn || roots(built, s.id);
  var free = 0;
  for (var k = 0; k < 4; k++){
    var nx = sp.x + [0,0,-1,1][k], ny = sp.y + [-1,1,0,0][k];
    if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
    if (g.pass[ny * g.w + nx]) free++;
  }
  ok('场景 ' + s.id + ' 的出生点四通八达', free > 0, free);
});
function roots(built, id){
  var g = built.idx.sceneGrids[id];
  for (var i = 0; i < g.pass.length; i++) if (g.pass[i]) return { x: i % g.w, y: Math.floor(i / g.w) };
  return { x: 0, y: 0 };
}
var exits = [], badExitStand = [];
SCENE_IDS.forEach(function(sid){
  var g = built.idx.sceneGrids[sid];
  Object.keys(g.exitMap).forEach(function(k){
    var ex = g.exitMap[k];
    exits.push({ scene: sid, ex: ex });
    if (!g.pass[ex.y * g.w + ex.x]) badExitStand.push(sid + ' ' + k);
  });
});
ok('出口都在能站的格子上', badExitStand.length === 0, badExitStand.join(','));
ok('出口数量与 sceneTransitions 对得上', exits.length === spaceJson.sceneTransitions.list.length,
   exits.length + '/' + spaceJson.sceneTransitions.list.length);
var exitBad = [];
exits.forEach(function(e){
  var g = Core.createGame(built, {});
  g.teleport(e.scene, e.ex.x, e.ex.y);
  if (g.world.player.scene !== e.scene) { exitBad.push('传送失败 ' + e.scene); return; }
  if (!g.takeExit()) { exitBad.push('走不出去 ' + e.scene + ' -> ' + e.ex.to); return; }
  if (g.world.player.scene !== e.ex.to) exitBad.push('走错地方 ' + e.scene + ' -> ' + g.world.player.scene);
});
ok('每一扇门都能走过去', exitBad.length === 0, exitBad.slice(0, 5).join(' | '));

section('5. 世界连通：门 + 穿梭机，从出生点能到每个场景');
var shuttleScenes = [];
SCENE_IDS.forEach(function(sid){
  var g = built.idx.sceneGrids[sid];
  for (var i = 0; i < g.pass.length; i++)
    if (g.kind[i] === 'interactable' && g.ref[i] === 'shuttle_terminal'){ shuttleScenes.push(sid); break; }
});
ok('有穿梭机终端的场景 >= 3', shuttleScenes.length >= 3, shuttleScenes.join(','));
var dests = spaceJson.shuttles.list.filter(function(s){ return s.locked !== true; }).map(function(s){ return s.scene; });
var adj = {};
SCENE_IDS.forEach(function(sid){ adj[sid] = {}; });
SCENE_IDS.forEach(function(sid){
  var g = built.idx.sceneGrids[sid];
  Object.keys(g.exitMap).forEach(function(k){ var ex = g.exitMap[k]; if (ex.to && adj[sid]) adj[sid][ex.to] = 1; });
});
shuttleScenes.forEach(function(sid){ dests.forEach(function(d){ if (adj[d] !== undefined) adj[sid][d] = 1; }); });
var seenS = {}, q0 = [built.space.playerCharacter.currentScene], unreach = [];
seenS[q0[0]] = 1;
while (q0.length){ var c0 = q0.pop(); Object.keys(adj[c0] || {}).forEach(function(t){ if (!seenS[t]){ seenS[t] = 1; q0.push(t); } }); }
SCENE_IDS.forEach(function(sid){ if (!seenS[sid]) unreach.push(sid); });
ok('每个场景都走得到（不会被困在孤岛上）', unreach.length === 0, unreach.join(','));

section('5.5 回程安全：每个场景都能走回一台穿梭机终端');
var termScenes = [];
SCENE_IDS.forEach(function(sid){
  var gr = built.idx.sceneGrids[sid];
  for (var i = 0; i < gr.ch.length; i++) if (gr.kind[i] === 'interactable' && gr.ref[i] === 'shuttle_terminal'){ termScenes.push(sid); break; }
});
var noBack = [];
SCENE_IDS.forEach(function(sid){
  if (termScenes.indexOf(sid) >= 0) return;
  var seen = {}, st = [sid]; seen[sid] = 1;
  while (st.length){
    var c = st.pop(), sg = built.idx.sceneGrids[c] || {};
    for (var k in sg.exitMap){ var ex = sg.exitMap[k]; if (ex && ex.to && !seen[ex.to]){ seen[ex.to] = 1; st.push(ex.to); } }
  }
  if (!Object.keys(seen).some(function(s){ return termScenes.indexOf(s) >= 0; })) noBack.push(sid);
});
ok('每个场景都能走回一台穿梭机终端（不会上了船回不来）', noBack.length === 0, noBack.join(','));
ok('穿梭机列表里有「返回索尔空间站」',
   Core.asList(spaceJson.shuttles).some(function(s){ return s.scene === 'station_command' && s.locked !== true; }));

section('6. 物件：够得着、按 E 不炸');
var objs = [], farObjs = [];
SCENE_IDS.forEach(function(sid){
  var g = built.idx.sceneGrids[sid];
  for (var i = 0; i < g.pass.length; i++){
    if (g.kind[i] !== 'interactable' || !g.ref[i] || !g.def[i]) continue;
    var o = { scene: sid, x: i % g.w, y: Math.floor(i / g.w), def: g.def[i] };
    objs.push(o);
    if (Core.num(g.def[i].priority, 0) >= 10 && !freeCellNear(sid, o.x, o.y, 2)) farObjs.push(sid + ' ' + o.ref + '@' + o.x + ',' + o.y);
  }
});
ok('终端 / 记录点 / 床都够得着（优先级 >= 10 的物件）', farObjs.length === 0, farObjs.slice(0, 6).join(' | '));
var types = {}, objBad = [];
objs.forEach(function(o){ types[o.def.id] = (types[o.def.id] || 0) + 1; });
ok('每种物件都至少在地图上出现一次', spaceJson.interactables.list.every(function(it){ return types[it.id] > 0; }),
   spaceJson.interactables.list.filter(function(it){ return !types[it.id]; }).map(function(it){ return it.id; }).join(','));
objs.forEach(function(o){
  if (o.def.id === 'shelf') return;                    /* 货架就是墙，多得很，抽一个代表 */
  var g = Core.createGame(built, {});
  var st = freeCellNear(o.scene, o.x, o.y, 2);
  if (!st) return;
  g.teleport(o.scene, st.x, st.y);
  try { g.interact(); g.render(); }
  catch (e){ objBad.push(o.scene + ' ' + o.def.id + ': ' + e.message); }
});
ok('每个物件按 E 都不炸', objBad.length === 0, objBad.slice(0, 4).join(' | '));

section('7. 终端视图：都能开、都有内容、每个按钮都能点');
var viewIds = spaceJson.views.list.map(function(v){ return v.id; }).concat(Object.keys(Core.viewProviders));
var viewBad = [];
viewIds.forEach(function(vid){
  var g = Core.createGame(built, {});
  if (!g.openView(vid)){ viewBad.push('打不开 ' + vid); return; }
  g.refreshView();
  if (!g.ui.view.lines || !g.ui.view.lines.length) viewBad.push('没有内容 ' + vid);
  var cnt = g.ui.view.actions.length;
  for (var i = 0; i < cnt; i++){
    var g2 = Core.createGame(built, {});
    g2.openView(vid);
    try { g2.viewChoose(i); g2.render(); }
    catch (e){ viewBad.push(vid + ' 按钮 ' + i + ': ' + e.message); }
  }
  try { g.render(); } catch (e){ viewBad.push(vid + ' 渲染: ' + e.message); }
});
ok('所有视图都能开、能渲染、按钮不炸', viewBad.length === 0, viewBad.slice(0, 5).join(' | '));

section('7.5 视图的静态文案也要过模板（{counters.x} 不能原样画出来）');
var rawBad = [];
spaceJson.views.list.forEach(function(v){
  var g = Core.createGame(built, {});
  g.openView(v.id); g.refreshView();
  (g.ui.view.lines || []).forEach(function(ln){
    var t = String(ln.text || '');
    if (t.indexOf('{') >= 0 && t.indexOf('}') >= 0) rawBad.push(v.id + ' -> ' + t);
  });
});
ok('视图文案里的 {模板} 都被替换掉了（不会把花括号画给玩家）', rawBad.length === 0, rawBad.slice(0, 5).join(' | '));
var gmMed = Core.createGame(built, {});
gmMed.openView('medical_status'); gmMed.refreshView();
var medText = (gmMed.ui.view.lines || []).map(function(l){ return l.text; }).join('\n');
ok('医疗终端的计数器模板真的换成了数值', medText.indexOf('裂隙接触者观察：0 人') >= 0, medText.slice(0, 60));

section('7.6 任务线：深空测绘（对话 + 宏 + 计数 + 星图动作 + 上报 + 钩子，全 JSON）');
var gq = Core.createGame(built, {});
ok('任务初值 mission_survey == 0', gq.world.counters.mission_survey === 0, gq.world.counters.mission_survey);
gq.approachNpc('npc_fleet_commander');
ok('和凯尔说话打开的是日常对话', !!gq.ui.dialogue && gq.ui.dialogue.id === 'dlg_fleet_commander', gq.ui.dialogue && gq.ui.dialogue.id);
var qOpts = gq.dialogueOptions(), qIdx = -1;
for (var qi = 0; qi < qOpts.length; qi++) if (String(qOpts[qi].text).indexOf('测绘') >= 0) qIdx = qi;
ok('根节点出现「测绘」任务选项', qIdx >= 0, qIdx);
gq.chooseOption(qIdx);
ok('进入任务节点 n_survey', !!gq.ui.dialogue && gq.ui.dialogue.node === 'n_survey', gq.ui.dialogue && gq.ui.dialogue.node);
gq.chooseOption(0);
ok('接取后 mission_survey == 1', gq.world.counters.mission_survey === 1, gq.world.counters.mission_survey);
ok('接取写了日志', gq.world.log.some(function(e){ return String(e.text).indexOf('深空测绘') >= 0; }));
if (gq.ui.dialogue) gq.dialogueAdvance();
ok('接取后的提示钩子给了「星图终端」提示', String(gq.world.hint || '').indexOf('星图终端') >= 0, gq.world.hint);

gq.openView('galaxy_map');
var acts = gq.ui.view.actions, aIdx = -1;
for (var ai = 0; ai < acts.length; ai++) if (String(acts[ai].text).indexOf('测绘') >= 0) aIdx = ai;
ok('星图终端出现测绘动作（macro_condition + cost 通过）', aIdx >= 0, JSON.stringify(acts.map(function(a){ return a.text; })));
var fleets0 = gq.world.counters.fleets;
gq.viewChoose(aIdx);
ok('测绘后 mission_survey == 2', gq.world.counters.mission_survey === 2, gq.world.counters.mission_survey);
ok('扣掉 2 支舰队', gq.world.counters.fleets === fleets0 - 2, gq.world.counters.fleets);
gq.closeView();

gq.approachNpc('npc_fleet_commander');
ok('复命上报打开 dlg_mis_survey_done（priority 400）', !!gq.ui.dialogue && gq.ui.dialogue.id === 'dlg_mis_survey_done', gq.ui.dialogue && gq.ui.dialogue.id);
var alloy0 = gq.world.counters.alloy, relic0 = gq.world.counters.relic || 0;
var dOpts = gq.dialogueOptions(), dIdx = -1;
for (var di = 0; di < dOpts.length; di++) if (String(dOpts[di].text).indexOf('辛苦') >= 0) dIdx = di;
ok('复命对话有结算选项', dIdx >= 0, dIdx);
gq.chooseOption(dIdx);
ok('结算后 mission_survey == 3（完成）', gq.world.counters.mission_survey === 3, gq.world.counters.mission_survey);
ok('奖励合金 +40', gq.world.counters.alloy === alloy0 + 40, gq.world.counters.alloy);
ok('奖励遗物 +1', (gq.world.counters.relic || 0) === relic0 + 1, gq.world.counters.relic);
ok('结算点了 flag mis_survey_done', gq.world.flags.mis_survey_done === true);
ok('任务线引用的是现有 missions 条目 mis_survey', Core.asList(spaceJson.missions).some(function(m){ return m.id === 'mis_survey'; }));

section('8. 对话：每个节点、每个选项都能点');
var dlgBad = [], nodeCount = 0, optCount = 0;
spaceJson.dialogues.list.forEach(function(d){
  var g = Core.createGame(built, {});
  var npcId = null;
  spaceJson.npcs.list.forEach(function(n){ if (n.dialogue === d.id) npcId = n.id; });
  Object.keys(d.nodes || {}).forEach(function(nid){
    nodeCount++;
    if (!g.ui.dialogue) g.openDialogue(d.id, npcId);
    try {
      g.enterNode(nid);
      if (!g.ui.dialogue) return;
      var cnt = g.dialogueOptions().length;
      if (cnt > 40) cnt = 40;
      for (var i = 0; i <= cnt; i++){
        optCount++;
        if (!g.ui.dialogue) g.openDialogue(d.id, npcId);
        g.enterNode(nid);
        if (!g.ui.dialogue) break;
        if (g.dialogueOptions().length) g.chooseOption(i); else g.dialogueAdvance();
        g.render();
      }
    } catch (e){ dlgBad.push(d.id + '.' + nid + ': ' + e.message); }
  });
});
ok('所有对话节点都走得进去', nodeCount >= 800, nodeCount + ' 个节点');
ok('每个节点每个选项都能点（' + optCount + ' 次）', dlgBad.length === 0, dlgBad.slice(0, 4).join(' | '));

section('9. 事件：每条事件都有人上报、能选');
var evBad = [];
spaceJson.events.list.forEach(function(ev){
  if (!ev.dialogue) { evBad.push(ev.id + ' 没有对话'); return; }
  var rule = spaceJson.npcApproach.list.filter(function(r){ return r.dialogue === ev.dialogue; })[0];
  var who = (ev.presentedBy || [])[0] || (rule && rule.npcId);
  if (!who){ evBad.push(ev.id + ' 没有上报人'); return; }
  if (!built.idx.npcs[who]){ evBad.push(ev.id + ' 的上报人不存在 ' + who); return; }
  var slot = built.idx.schedules[who] && (built.idx.schedules[who].slots || [])[0];
  if (!slot){ evBad.push(ev.id + ' 的上报人没有日程'); return; }
  var st = freeCellNear(slot.scene, slot.x, slot.y, 3);
  if (!st){ evBad.push(ev.id + ' 的上报人站在走不到的地方'); return; }
  var g = Core.createGame(built, {});
  g.world.pending[ev.id] = true;
  g.teleport(slot.scene, st.x, st.y);
  try {
    g.approachNpc(who);
    if (!g.ui.dialogue){ evBad.push(ev.id + ' 见到人没开口'); return; }
    if (g.ui.dialogue.id !== ev.dialogue){ evBad.push(ev.id + ' 上报了别的对话 ' + g.ui.dialogue.id); return; }
    if (!g.dialogueOptions().length){ evBad.push(ev.id + ' 的对话没有选项'); return; }
    g.chooseOption(0);
    g.render();
  } catch (e){ evBad.push(ev.id + ': ' + e.message); }
});
ok('每条事件都能被上报人说出来并选一个选项', evBad.length === 0, evBad.slice(0, 4).join(' | '));

section('9.5 事件链：15 条链都能一步步推到结束（stepChains）');
var evById = {};
Core.asList(spaceJson.events).forEach(function(e){ evById[e.id] = e; });
var chainEvIds = {};
Core.asList(spaceJson.eventChains).forEach(function(c){ (c.steps || []).forEach(function(s){ chainEvIds[s] = true; }); });
var chainBad = [], chainsDone = 0;
Core.asList(spaceJson.eventChains).forEach(function(c){
  var g = Core.createGame(built, {});
  var steps = (c && c.steps) || [];
  for (var i = 0; i < steps.length; i++){
    var ev = evById[steps[i]];
    if (!ev){ chainBad.push(c.id + ' 第 ' + i + ' 步引用不存在的事件 ' + steps[i]); break; }
    var need = (ev.condition && ev.condition.type === 'tick') ? Core.num(ev.condition.value, 0) : 0;
    if (g.world.tick <= need) g.world.tick = need + 1;
    g.step(1);
    if (!g.world.pending[ev.id]){ chainBad.push(c.id + ' 第 ' + i + ' 步没放行（' + steps[i] + '）'); break; }
    if (!g.openDialogue(ev.dialogue, (ev.presentedBy || [])[0])){ chainBad.push(c.id + ' 第 ' + i + ' 步对话打不开 ' + ev.dialogue); break; }
    g.ui.dialogue = null;
    g.step(1);
  }
  var st = g.world.chains[c.id];
  if (st && Core.num(st.step, 0) >= steps.length && st.done === true) chainsDone++;
  else chainBad.push(c.id + ' 只推到 ' + Core.num(st && st.step, 0) + '/' + steps.length);
});
ok('15 条事件链都能完整推进到结束', chainBad.length === 0 && chainsDone === Core.asList(spaceJson.eventChains).length,
   '完成 ' + chainsDone + ' 条；' + chainBad.slice(0, 3).join(' | '));
ok('事件链是顺序的：第一步没看过，第二步不会挂上报', (function(){
  var c = Core.asList(spaceJson.eventChains)[0];
  var g = Core.createGame(built, {});
  g.world.tick = 100000; g.step(1);
  return !!g.world.pending[c.steps[0]] && !g.world.pending[c.steps[1]];
})(), 'chain_01 的第二步被卡住');
ok('链外的普通事件不受 gating 影响', (function(){
  var cand = Core.asList(spaceJson.events).filter(function(e){
    return !chainEvIds[e.id] && e.condition && e.condition.type === 'tick' && !e.every &&
           Core.num(e.condition.value, 0) <= 4000 && (!e.minTick || Core.num(e.minTick, 0) <= 4000);
  });
  if (!cand.length) return false;
  var g = Core.createGame(built, {});
  g.world.tick = 4000; g.step(1);
  return cand.every(function(e){ return !!g.world.pending[e.id]; });
})(), '（tick<=4000 的链外事件应当都能挂上报）');

section('9.7 研究流程：techTree 活起来了（视图动作 + 计数 + 钩子 + 资源变化）');
ok('引擎索引了 techTree（built.idx.techs）', !!(built.idx.techs && built.idx.techs.tech_water_rec), String(built.idx.techs && Object.keys(built.idx.techs).length));
ok('techTree.requires 都指向存在的科技（否则校验会警告）',
   built.report.warnings.filter(function(w){ return String(w).indexOf('requires') >= 0; }).length === 0,
   built.report.warnings.filter(function(w){ return String(w).indexOf('requires') >= 0; }).join(' | '));
var gt = Core.createGame(built, {});
ok('开局没研究过水循环回收', !gt.world.flags.tech_water_rec);
gt.openView('tech_tree');
var tacts = gt.ui.view.actions, tIdx = -1;
for (var ti = 0; ti < tacts.length; ti++) if (String(tacts[ti].text).indexOf('水循环回收') >= 0) tIdx = ti;
ok('研究终端出现「水循环回收」立项动作', tIdx >= 0, JSON.stringify(tacts.map(function(a){ return a.text; })));
ok('前置没满足时，基础外科不出现', tacts.every(function(a){ return String(a.text).indexOf('基础外科') < 0; }));
var alloy1 = gt.world.counters.alloy;
gt.viewChoose(tIdx);
ok('立项扣了 50 合金', gt.world.counters.alloy === alloy1 - 50, gt.world.counters.alloy);
ok('立项点了进行中的 flag', gt.world.flags.research_water_rec_active === true);
gt.closeView();
gt.step(60);
ok('研究完成后 flag 点上、进行中的 flag 清掉', gt.world.flags.tech_water_rec === true && !gt.world.flags.research_water_rec_active,
   JSON.stringify({ done: gt.world.flags.tech_water_rec, active: gt.world.flags.research_water_rec_active }));
ok('完成后资源真的变了（水 +40 / 口粮 +3）', gt.world.counters.water >= 40 && gt.world.counters.food >= 20,
   JSON.stringify({ water: gt.world.counters.water, food: gt.world.counters.food }));
ok('研究完成写进了日志', gt.world.log.some(function(e){ return String(e.text).indexOf('水循环回收') >= 0 && String(e.text).indexOf('完成') >= 0; }));
gt.world.counters.alloy = 300;                 /* 前置满足 + 付得起，两个条件都要满足 */
gt.openView('tech_tree');
var tacts2 = gt.ui.view.actions, t2 = -1;
for (var i2 = 0; i2 < tacts2.length; i2++) if (String(tacts2[i2].text).indexOf('基础外科') >= 0) t2 = i2;
ok('前置满足 + 资源够，基础外科才出现在研究终端', t2 >= 0, JSON.stringify(tacts2.map(function(a){ return a.text; })));
var alloy2 = gt.world.counters.alloy, med2 = Core.num(gt.world.counters.medicine, 0);
gt.viewChoose(t2);
ok('基础外科扣 155 合金、点 flag、发药品 +4',
   gt.world.counters.alloy === alloy2 - 155 && gt.world.flags.tech_med_basic === true &&
   Core.num(gt.world.counters.medicine, 0) === med2 + 4,
   JSON.stringify({ alloy: gt.world.counters.alloy, med: gt.world.counters.medicine }));
gt.closeView();
ok('研究进度进存档（world.counters / flags 快照）', (function(){
  var g2 = Core.createGame(built, {});
  g2.deserialize(JSON.parse(JSON.stringify(gt.serialize())));
  return g2.world.flags.tech_water_rec === true && Core.num(g2.world.counters.water, 0) >= 40;
})(), '');

section('9.8 危机阶段：crisisStages 接进事件系统（counter 驱动 + 每阶段触发 events）');
ok('crisisStages 块写了驱动计数器', String(spaceJson.crisisStages.counter || '').length > 0, spaceJson.crisisStages.counter);
ok('每个危机阶段都配了 events', Core.asList(spaceJson.crisisStages).every(function(c){ return (c.events || []).length > 0; }));
var gc = Core.createGame(built, {});
gc.step(1);
ok('pollution=0 开局就在第一阶段', !!gc.world.crisis && gc.world.crisis.stage === 0 && gc.world.flags.crisis_stage === 'crisis_1', JSON.stringify(gc.world.crisis));
ok('第一阶段触发了它的两个事件', gc.world.pending.ev_tech_01 === true && gc.world.pending.ev_politics_03 === true, Object.keys(gc.world.pending).join(','));
gc.world.counters.pollution = 3; gc.step(1);
ok('污染=3 -> 第二阶段', gc.world.crisis.stage === 1 && gc.world.flags.crisis_level === 2, JSON.stringify(gc.world.crisis));
ok('第二阶段的事件挂上上报', gc.world.pending.ev_abyss_05 === true && gc.world.pending.ev_fleet_03 === true);
var foodBefore = Core.num(gc.world.counters.food, 0);
gc.world.counters.pollution = 12; gc.step(1);
ok('一次跳到第五阶段（中间阶段补触发）', gc.world.crisis.stage === 4 && gc.world.flags.crisis_level === 5, JSON.stringify(gc.world.crisis));
ok('第五阶段的事件挂上上报', gc.world.pending.ev_rift_07 === true && gc.world.pending.ev_rift_09 === true);
ok('第三阶段的 onEnter 真的改了资源（口粮 -2）', Core.num(gc.world.counters.food, 0) === foodBefore - 2, gc.world.counters.food);
ok('危机只进不退', (function(){ gc.world.counters.pollution = 0; gc.step(1); return gc.world.crisis.stage === 4; })());
ok('危机阶段进存档', (function(){
  var g2 = Core.createGame(built, {});
  g2.deserialize(JSON.parse(JSON.stringify(gc.serialize())));
  return !!g2.world.crisis && g2.world.crisis.stage === 4 && g2.world.flags.crisis_stage === 'crisis_5';
})(), '');

section('9.9 事件 <-> 功能文本：情报板（待处理 / 链路 / 态势）+ 终端能触发事件');
var gi = Core.createGame(built, {});
function viewText(g){ return ((g.ui.view && g.ui.view.lines) || []).map(function(l){ return l.text; }).join('\n'); }
ok('情报终端真的画进了指挥中心', (function(){
  var g0 = built.idx.sceneGrids.station_command;
  for (var i0 = 0; i0 < g0.pass.length; i0++) if (g0.kind[i0] === 'interactable' && g0.ref[i0] === 'intel_terminal') return true;
  return false;
})());
gi.openView('intel_board');
var vt = viewText(gi);
ok('情报板三段（待处理 / 事件链 / 态势）都渲染出来了',
   vt.indexOf('待处理情报') >= 0 && vt.indexOf('事件链') >= 0 && vt.indexOf('态势') >= 0, vt.slice(0, 90));
ok('暂无待处理时给的是提示句，不是空白', vt.indexOf('没有待处理的情报') >= 0);
ok('态势面板列出活计数器（舰队开局 3）', vt.indexOf('舰队') >= 0 && vt.indexOf('3') >= 0);
/* 功能文本 -> 事件 */
var ia = gi.ui.view.actions, i1 = -1;
for (var i1s = 0; i1s < ia.length; i1s++) if (String(ia[i1s].text).indexOf('调阅最新情报  一') >= 0) i1 = i1s;
ok('情报板出现「调阅最新情报  一」', i1 >= 0, JSON.stringify(ia.map(function(a){ return a.text; })));
gi.viewChoose(i1);
ok('调阅后 ev_intel_01 挂上待上报', gi.world.pending.ev_intel_01 === true);
ok('同一块面板立刻把新报告列出来（refreshView 热刷新）',
   viewText(gi).indexOf('没有待处理的情报') < 0, viewText(gi).slice(0, 70));
gi.closeView();
/* 事件 -> 功能：选项带功能效果 */
var data0 = Core.num(gi.world.counters.data, 0);
gi.approachNpc('npc_signal_officer');
ok('上报人说的是这条情报', !!gi.ui.dialogue && gi.ui.dialogue.id === 'dlg_ev_intel_01', gi.ui.dialogue && gi.ui.dialogue.id);
gi.chooseOption(0);
ok('「派测绘员去现场」让 data +1（事件改了数值）', Core.num(gi.world.counters.data, 0) === data0 + 1, gi.world.counters.data);
ok('「派测绘员去现场」真的把人调走了（npc_post 生效）', (function(){
  var post = gi.world.npcPosts.npc_surveyor;
  return !!post && post.scene === 'planet_landing';
})(), JSON.stringify(gi.world.npcPosts.npc_surveyor || null));
ok('这条情报标记为已完成', gi.world.flags.intel_1_done === true);
if (gi.ui.dialogue) gi.dialogueAdvance();
/* 功能终端显示活数据（不是静态 amount） */
gi.openView('warehouse_stock');
ok('资源终端有「现场盘点（活数据）」这一段', viewText(gi).indexOf('现场盘点') >= 0, viewText(gi).slice(0, 60));
gi.closeView();
gi.world.counters.alloy = 999;
gi.openView('warehouse_stock');
ok('改了 counter 之后资源终端立刻跟着变（合金 999）', viewText(gi).indexOf('999') >= 0);
gi.closeView();
gi.openView('fleet_status');
ok('舰队终端显示活计数器（{counters.fleets}）', viewText(gi).indexOf('舰队计数器：3') >= 0, viewText(gi).slice(0, 60));
gi.closeView();
/* 链式解锁：完成第一条才有第二条 */
gi.openView('intel_board');
var ia2 = gi.ui.view.actions, two = false;
for (var i2s = 0; i2s < ia2.length; i2s++) if (String(ia2[i2s].text).indexOf(' 二') >= 0) two = true;
ok('完成第一条之后「调阅  二」才出现', two, JSON.stringify(ia2.map(function(a){ return a.text; })));
gi.closeView();
/* 态势面板能看见刚改的数值 */
gi.openView('intel_board');
ok('态势面板把 999 这个改动也显示出来了', viewText(gi).indexOf('999') >= 0);
gi.closeView();

section('9.10 胜负判定（R1/R2）：败北与胜利都走 hook + end_game');
/* 败北四条（hook 是 tick+every=60，所以 step(60) 保证踩到判定点）*/
var gL = Core.createGame(built, {});
gL.world.counters.pollution = 15; gL.step(60);
ok('污染 15 -> 判负「淹没」', !!gL.world.gameOver && gL.world.gameOver.result === 'defeat', JSON.stringify(gL.world.gameOver));
var gR = Core.createGame(built, {});
gR.world.counters.morale = 0; gR.step(60);
ok('民情 0 -> 判负「哗变」', !!gR.world.gameOver && String(gR.world.gameOver.reason).indexOf('哗变') >= 0, JSON.stringify(gR.world.gameOver));
var gF = Core.createGame(built, {});
gF.world.counters.fleets = 0; gF.step(60);
ok('舰队 0 -> 判负「舰队尽没」', !!gF.world.gameOver && String(gF.world.gameOver.reason).indexOf('舰队尽没') >= 0, JSON.stringify(gF.world.gameOver));
var gPe = Core.createGame(built, {});
gPe.world.counters.pop = 0; gPe.step(60);
ok('人口 0 -> 判负「灭绝」', !!gPe.world.gameOver && String(gPe.world.gameOver.reason).indexOf('灭绝') >= 0, JSON.stringify(gPe.world.gameOver));
/* 胜利三条（另两条靠 flags 链，见下）*/
var gW = Core.createGame(built, {});
gW.world.flags.core_sealed = true; gW.step(60);
ok('core_sealed -> 通关「封印」', !!gW.world.gameOver && gW.world.gameOver.result === 'victory', JSON.stringify(gW.world.gameOver));
var gT = Core.createGame(built, {});
gT.world.flags.truce_iron_chorus = true; gT.world.flags.ally_veil_pact = true; gT.step(60);
ok('停火 + 结盟 -> 通关「共存」', !!gT.world.gameOver && String(gT.world.gameOver.reason).indexOf('共存') >= 0, JSON.stringify(gT.world.gameOver));
var gK = Core.createGame(built, {});
gK.world.counters.relic = 20; gK.world.flags.gate_read = true; gK.step(60);
ok('20 件遗物 + 解读「门」-> 通关「答案」', !!gK.world.gameOver && String(gK.world.gameOver.reason).indexOf('答案') >= 0, JSON.stringify(gK.world.gameOver));
ok('每条胜利条件都标了由哪个 hook 负责（没标的=本版本不接）', (function(){
  return Core.asList(spaceJson.victoryConditions).every(function(v){ return v.hook !== undefined; });
})());
ok('败北线文案与第六阶段对齐（15）', Core.asList(spaceJson.defeatConditions).some(function(v){
  return v.id === 'lose_pollution' && String(v.rule).indexOf('15') >= 0;
}));
/* 玩家手里的「污染出口」：净化动作 */
var gC = Core.createGame(built, {});
gC.world.counters.pollution = 3;
gC.world.flags.tech_purge1 = true;   /* R8：净化作业现在要初级净化科技 */
gC.openView('galaxy_map');
var actsC = gC.ui.view.actions, piC = -1;
for (var ic = 0; ic < actsC.length; ic++) if (String(actsC[ic].text).indexOf('净化') >= 0) piC = ic;
ok('星图终端出现「组织净化作业」', piC >= 0, JSON.stringify(actsC.map(function(a){ return a.text; })));
var alloyC = gC.world.counters.alloy;
gC.viewChoose(piC);
ok('净化真的把污染压下去了（污染 -1 / 合金 -25）',
   gC.world.counters.pollution === 2 && gC.world.counters.alloy === alloyC - 25,
   gC.world.counters.pollution + ' / ' + gC.world.counters.alloy);
gC.closeView();
/* R3 深渊杂音 */
var hkV = (built.idx.hooksByOn.tick || []).filter(function(h){ return h.id === 'hook_abyss_voice'; })[0];
ok('深渊杂音 hook 已登记（tick + every=240 + 随机表）',
   !!hkV && Core.num(hkV.every, 0) === 240 && !!hkV.effects && !!hkV.effects[0].table, JSON.stringify(hkV && hkV.condition));
ok('杂音只在污染 >= 6 时出现', (function(){
  if (!hkV) return false;
  var a1 = Core.createGame(built, {}); a1.world.counters.pollution = 3;
  var a2 = Core.createGame(built, {}); a2.world.counters.pollution = 8;
  return !Core.check(a1, hkV.condition, {}) && Core.check(a2, hkV.condition, {});
})());
/* R5 遗物来源：遗迹事件要能给遗物 */
ok('遗迹事件能带回遗物（10 条勘探选项都加了 relic）', (function(){
  var dl = {}, okN = 0;
  Core.asList(spaceJson.dialogues).forEach(function(x){ dl[x.id] = x; });
  Core.asList(spaceJson.events).forEach(function(e){
    if (e.category !== 'ruins') return;
    var root = (((dl[e.dialogue] || {}).nodes || {}).root) || {};
    var o0 = (root.options || [])[0] || {};
    if ((o0.effects || []).some(function(x){ return x && x.type === 'counter_add' && x.counter === 'relic'; })) okN++;
  });
  return okN >= 10;
})(), '');
ok('打捞队有概率捞到遗物', (function(){
  var dl2 = null, found = false;
  Core.asList(spaceJson.views).forEach(function(v){
    if (v.id !== 'salvage_view') return;
    (v.actions || []).forEach(function(a){
      if (String(a.text).indexOf('打捞队') < 0) return;
      (a.effects || []).forEach(function(x){ if (x && x.type === 'if') found = true; });
    });
  });
  return found;
})());

section('9.11 数值出口（R4 舰队稀缺 / R8 科技解锁面板动作）');
/* R4：舰队事件里新增一个以舰队为代价的选项；回防索尔（home_guard）时必须消失 */
var fl = null;
spaceJson.dialogues.list.forEach(function(x){ if (x.id === 'dlg_ev_fleet_01') fl = x; });
ok('舰队事件有以舰队为代价的选项（cost.counter=fleets）',
   (fl.nodes.root.options || []).some(function(o){ return o.cost && o.cost.counter === 'fleets'; }));
var g4 = Core.createGame(built, {});
g4.openDialogue('dlg_ev_fleet_01', 'npc_fleet_commander');
var o4i = -1;
g4.dialogueOptions().forEach(function(o, i){ if (String(o.text).indexOf('前出盯着') >= 0) o4i = i; });
ok('开局「抽调一支舰队前出盯着」可见', o4i >= 0);
var f4 = g4.world.counters.fleets;
g4.chooseOption(o4i);
ok('抽调舰队真的扣了 1 支舰队', g4.world.counters.fleets === f4 - 1, g4.world.counters.fleets);
if (g4.ui.dialogue) g4.dialogueAdvance();
var g4b = Core.createGame(built, {});
g4b.world.flags.home_guard = true;
g4b.openDialogue('dlg_ev_fleet_01', 'npc_fleet_commander');
ok('回防索尔（home_guard）时这个选项被条件隐藏',
   !g4b.dialogueOptions().some(function(o){ return String(o.text).indexOf('前出盯着') >= 0; }));

/* R8：没有科技时净化 / 封锁不可用；研究完成后出现并生效 */
function viewHasText(g, s){ return (g.ui.view.actions || []).some(function(a){ return String(a.text).indexOf(s) >= 0; }); }
var g8 = Core.createGame(built, {});
g8.world.counters.pollution = 3;
g8.world.counters.alloy = 600;
g8.openView('galaxy_map'); g8.refreshView();
ok('没有初级净化科技时「组织净化作业」不可用', !viewHasText(g8, '组织净化作业'));
ok('没有局部封印科技时「封锁裂隙」不可用', !viewHasText(g8, '封锁裂隙'));
g8.closeView();
g8.openView('tech_tree'); g8.refreshView();
var ra = -1;
g8.ui.view.actions.forEach(function(a, i){ if (String(a.text).indexOf('研究：裂隙探测') >= 0) ra = i; });
ok('研究终端出现「裂隙探测」立项动作', ra >= 0, JSON.stringify(g8.ui.view.actions.map(function(a){ return a.text; })));
g8.viewChoose(ra);
ok('裂隙探测立项扣 30 合金、点了进行中 flag',
   g8.world.counters.alloy === 570 && g8.world.flags.research_rift_detect_active === true,
   JSON.stringify({ alloy: g8.world.counters.alloy, active: g8.world.flags.research_rift_detect_active }));
g8.closeView();
g8.step(41);
ok('裂隙探测研究完成（flag 点上、进行中清掉）',
   g8.world.flags.tech_rift_detect === true && !g8.world.flags.research_rift_detect_active);
g8.openView('tech_tree'); g8.refreshView();
ok('完成后研究终端出现「初级净化」与「局部封印」',
   viewHasText(g8, '研究：初级净化') && viewHasText(g8, '研究：局部封印'),
   JSON.stringify(g8.ui.view.actions.map(function(a){ return a.text; })));
var pa = -1;
g8.ui.view.actions.forEach(function(a, i){ if (String(a.text).indexOf('研究：初级净化') >= 0) pa = i; });
g8.viewChoose(pa);
g8.closeView();
g8.step(41);
ok('初级净化研究完成', g8.world.flags.tech_purge1 === true);
g8.openView('galaxy_map'); g8.refreshView();
var cp = -1;
g8.ui.view.actions.forEach(function(a, i){ if (String(a.text).indexOf('组织净化作业') >= 0) cp = i; });
ok('初级净化完成后，星图的「组织净化作业」出现', cp >= 0, JSON.stringify(g8.ui.view.actions.map(function(a){ return a.text; })));
var pol8 = g8.world.counters.pollution, al8 = g8.world.counters.alloy;
g8.viewChoose(cp); g8.refreshView();
ok('净化作业真的把污染 -1、合金 -25',
   g8.world.counters.pollution === pol8 - 1 && g8.world.counters.alloy === al8 - 25,
   JSON.stringify({ pollution: g8.world.counters.pollution, alloy: g8.world.counters.alloy }));
ok('区域净化未研究时，广域净化场不出现', !viewHasText(g8, '广域净化场'));
g8.closeView();
ok('新计数器都进存档（research_purge1 快照往返）', (function(){
  var g2 = Core.createGame(built, {});
  g2.deserialize(JSON.parse(JSON.stringify(g8.serialize())));
  return g2.world.flags.tech_purge1 === true && Core.num(g2.world.counters.research_purge1, 0) >= 1;
})(), '');

section('9.12 全部内容收口（R6/R7/R9/R10/R11/R12/R13）');
/* R7 派别支持度：12 个支持度变成活计数器 + 每日结算 */
var g12 = Core.createGame(built, {});
var polBad = [];
spaceJson.internalPolitics.list.forEach(function(p){
  var cid = 'support_' + p.id.replace(/^pol_/, '');
  if (!(cid in g12.world.counters)) polBad.push(cid + ' 缺 counter');
  else if (Core.num(g12.world.counters[cid], -1) !== Core.num(p.support, -2)) polBad.push(cid + ' 初值不对');
});
ok('R7：12 个派别支持度都是活计数器且初值 = 内容', polBad.length === 0, polBad.slice(0, 3).join(' | '));
var resIds = {};
spaceJson.resources.list.forEach(function(r){ resIds[r.id] = 1; });
ok('R7：支持度 counter 都有 resources 条目', spaceJson.internalPolitics.list.every(function(p){ return resIds['support_' + p.id.replace(/^pol_/, '')]; }));
ok('R7：每日政治钩子已登记', (built.idx.hooksByOn.day || []).some(function(h){ return h.id === 'hook_politics_daily'; }));
var gPol = Core.createGame(built, {});
gPol.world.counters.support_martial = 45;
gPol.world.counters.support_health = 5;
gPol.world.counters.support_austere = 5;
gPol.world.counters.support_open = 5;
gPol.fireHooks('day', {});
ok('R7：主战派过 40 会在每日结算里点 flag', gPol.world.flags.pol_martial_strong === true, JSON.stringify(gPol.world.flags));
ok('R7：动作能推动支持度（回防 -> 安土派 +2 / 主战派 -2）', (function(){
  var g = Core.createGame(built, {});
  g.openView('fleet_status');
  var i = -1;
  g.ui.view.actions.forEach(function(a, idx){ if (String(a.text).indexOf('回防') >= 0) i = idx; });
  if (i < 0) return false;
  g.viewChoose(i);
  return g.world.counters.support_home === 30 && g.world.counters.support_martial === 33;
})());

/* R6 殖民地：口粮低于 12 的每日结算 */
var gCol = Core.createGame(built, {});
gCol.world.counters.food = 5;
gCol.world.counters.pop = 2000;
var mCol = gCol.world.counters.morale, pCol = gCol.world.counters.pop;
gCol.fireHooks('day', {});
ok('R6：口粮 < 12 时殖民地每日掉民情 / 人口', gCol.world.counters.morale === mCol - 2 && gCol.world.counters.pop === pCol - 4,
   JSON.stringify({ morale: gCol.world.counters.morale, pop: gCol.world.counters.pop }));

/* R10 环境文本 */
var enterList = (built.idx.hooksByOn.enter_scene || []);
ok('R10：7 个环境文本钩子已登记并绑场景',
   enterList.filter(function(h){ return String(h.id).indexOf('hook_ambient_') === 0; }).length === 7);
ok('R10：环境钩子的随机表引用 textPools 的原文', (function(){
  var lines = {};
  spaceJson.textPools.list.forEach(function(t){ (t.lines || []).forEach(function(s){ lines[s] = 1; }); });
  return enterList.filter(function(h){ return h.id === 'hook_ambient_station_corridor'; }).every(function(h){
    return (h.effects[0].table || []).some(function(row){
      return (row.effects || []).some(function(e){ return e && lines[e.text]; });
    });
  });
})());

/* R11 planetTypes.hazard */
ok('R11：4 张地表场景带 planetType 且登记了入场景消耗钩子', (function(){
  var need = { planet_landing: 1, planet_wilderness: 1, planet_ruins: 1, planet_resource: 1 };
  var sc = {};
  spaceJson.scenes.list.forEach(function(s){ sc[s.id] = s; });
  return Object.keys(need).every(function(sid){
    return !!sc[sid].planetType && enterList.some(function(h){ return h.id === 'hook_hazard_' + sid; });
  });
})());
var gHz = Core.createGame(built, {});
var hg = built.idx.sceneGrids['planet_landing'], hx = -1, hy = -1;
for (var hi = 0; hi < hg.pass.length; hi++) if (hg.pass[hi]){ hx = hi % hg.w; hy = (hi / hg.w) | 0; break; }
if (hx >= 0) gHz.teleport('planet_landing', hx, hy);
ok('R11：走进 hazard 地表会真的加疲劳', gHz.world.player.fatigue >= 3, gHz.world.player.fatigue);

/* R13 采集抽池 */
ok('R13：打捞 / 矿场 / 农场的动作带报告抽池（random.table）', (function(){
  function hasRand(vid, sub){
    var v = null;
    spaceJson.views.list.forEach(function(x){ if (x.id === vid) v = x; });
    return !!(v && (v.actions || []).some(function(a){
      return String(a.text).indexOf(sub) >= 0 && (a.effects || []).some(function(e){ return e.type === 'random' && (e.table || []).length >= 2; });
    }));
  }
  return hasRand('salvage_view', '派打捞队') && hasRand('mine_status', '加班出矿') && hasRand('farm_status', '紧急抢收');
})());

/* R12 fleetModules 装配 */
ok('R12：舰队面板有 >= 6 个装模块动作', (function(){
  var v = null;
  spaceJson.views.list.forEach(function(x){ if (x.id === 'fleet_status') v = x; });
  return (v.actions || []).filter(function(a){ return String(a.text).indexOf('装模块：') >= 0; }).length >= 6;
})());
var gm = Core.createGame(built, {});
gm.openView('fleet_status');
var mi = -1;
gm.ui.view.actions.forEach(function(a, idx){ if (String(a.text).indexOf('装模块：指挥模块') >= 0) mi = idx; });
ok('R12：装模块动作当前可用', mi >= 0, JSON.stringify(gm.ui.view.actions.map(function(a){ return a.text; })));
var alM = gm.world.counters.alloy, pw0 = gm.world.counters.fleet_power;
gm.viewChoose(mi);
ok('R12：装模块扣合金、涨舰队战力、点 flag',
   gm.world.counters.alloy === alM - 10 && gm.world.counters.fleet_power === pw0 + 1 && gm.world.flags.installed_mod_bridge === true,
   JSON.stringify({ alloy: gm.world.counters.alloy, power: gm.world.counters.fleet_power, flag: gm.world.flags.installed_mod_bridge }));
gm.closeView();
ok('R12：舰队战力 counter 有 resources 条目', !!resIds['fleet_power']);

/* R9 dialoguePools */
ok('R9：dialoguePools 至少被 5 个对话节点引用', (function(){
  var n = 0;
  spaceJson.dialogues.list.forEach(function(dl){
    Object.keys(dl.nodes || {}).forEach(function(nid){
      var spec = dl.nodes[nid].dynamicOptions;
      if (typeof spec === 'string' && built.idx.pools[spec]) n++;
    });
  });
  return n >= 5;
})());
var gd = Core.createGame(built, {});
gd.openDialogue('dlg_adjutant', 'npc_adjutant');
ok('R9：小聊池的选项出现在对话里', gd.dialogueOptions().some(function(o){ return String(o.text).indexOf('今天天气不错') >= 0; }),
   JSON.stringify(gd.dialogueOptions().map(function(o){ return o.text; })));

section('10. 人和日程');
var npcBad = [];
spaceJson.npcs.list.forEach(function(n){
  var sch = built.idx.schedules[n.id];
  if (!sch || !(sch.slots || []).length){ npcBad.push(n.id + ' 没有日程'); return; }
  sch.slots.forEach(function(sl){
    var g = built.idx.sceneGrids[sl.scene];
    if (!g){ npcBad.push(n.id + ' 日程场景不存在'); return; }
    var i = Core.num(sl.y, 0) * g.w + Core.num(sl.x, 0);
    if (!g.pass[i]) npcBad.push(n.id + ' 日程点在墙上 (' + sl.x + ',' + sl.y + ')');
    var r = regions(sl.scene);
    if (g.pass[i] && r.lab[i] !== r.main) npcBad.push(n.id + ' 日程点在走不到的房间里');
  });
  if (!built.idx.dialogues[n.dialogue]) npcBad.push(n.id + ' 没有对话');
});
ok('每个人的日程点都站得住、都在走得到的地方', npcBad.length === 0, npcBad.slice(0, 4).join(' | '));

section('10.5 地图规则：门够宽 / 边框不漏 / 四角不开口 / 开敞率够');
var mapBad = [];
SCENE_IDS.forEach(function(sid){
  var g = built.idx.sceneGrids[sid]; if (!g) return;
  var W = g.w, H = g.h, isExit = {};
  Object.keys(g.exitMap).forEach(function(k){ isExit[k] = 1; });
  Object.keys(g.exitMap).forEach(function(k){
    var e = g.exitMap[k], i = e.y * W + e.x;
    isExit[k] = 1;
    if (!g.pass[i]) mapBad.push(sid + ' 出口不可站 ' + k);
    var run = 1, x, y;
    if (e.y === 0 || e.y === H - 1){
      for (x = e.x - 1; x >= 0 && g.pass[e.y * W + x]; x--){ isExit[x + ',' + e.y] = 1; run++; }
      for (x = e.x + 1; x < W && g.pass[e.y * W + x]; x++){ isExit[x + ',' + e.y] = 1; run++; }
    } else if (e.x === 0 || e.x === W - 1){
      for (y = e.y - 1; y >= 0 && g.pass[y * W + e.x]; y--){ isExit[e.x + ',' + y] = 1; run++; }
      for (y = e.y + 1; y < H && g.pass[y * W + e.x]; y++){ isExit[e.x + ',' + y] = 1; run++; }
    } else { run = 99; }                      /* 裂隙口这种踩上去就走的，不算门洞 */
    if (run < 3) mapBad.push(sid + ' 门太窄 ' + k + ' 宽 ' + run);
  });
  for (var x2 = 0; x2 < W; x2++) [0, H-1].forEach(function(y2){
    if (g.pass[y2 * W + x2] && !isExit[x2 + ',' + y2]) mapBad.push(sid + ' 边框漏了 ' + x2 + ',' + y2);
  });
  for (var y3 = 0; y3 < H; y3++) [0, W-1].forEach(function(x3){
    if (g.pass[y3 * W + x3] && !isExit[x3 + ',' + y3]) mapBad.push(sid + ' 边框漏了 ' + x3 + ',' + y3);
  });
  [[0,0],[W-1,0],[0,H-1],[W-1,H-1]].forEach(function(c){
    if (g.pass[c[1] * W + c[0]] && !isExit[c[0] + ',' + c[1]]) mapBad.push(sid + ' 四角开了 ' + c.join(','));
  });
  var walk = 0; for (var qi = 0; qi < g.pass.length; qi++) if (g.pass[qi]) walk++;
  if (walk / (W * H) < 0.55) mapBad.push(sid + ' 开敞率太低 ' + Math.round(100 * walk / (W * H)) + '%');
});
ok('地图规则：门 >= 3 格宽 / 边框不漏 / 四角不开口 / 开敞率 >= 55%', mapBad.length === 0, mapBad.slice(0, 5).join(' | '));

section('10.6 交互面板可用性：面板有真动作，动作真有后果');
/* (a) 静态：每个终端打开的面板，要么有「不是关闭」的动作，要么是个列表菜单 */
var panelNoAct = [], panelMenu = [];
Core.asList(spaceJson.interactables).forEach(function(it){
  (it.onInteract || []).forEach(function(e){
    if (!e || e.type !== 'open_view') return;
    var v = null;
    Core.asList(spaceJson.views).forEach(function(vv){ if (vv.id === e.view) v = vv; });
    if (!v){ panelNoAct.push(it.id + ' -> ' + e.view + ' 视图不存在'); return; }
    var real = (v.actions || []).filter(function(a){ return String(a.text || '').indexOf('关闭') < 0; });
    if (!real.length && !v.list) panelNoAct.push(it.id + ' -> ' + v.id);
    if (!real.length && v.list) panelMenu.push(v.id);
  });
});
ok('每个终端面板都有真动作（列表菜单除外）', panelNoAct.length === 0, panelNoAct.join(' | '));
/* (b) 动态：每个面板「当前可用的第一个真动作」被点下去之后，世界必须变样 */
function digest(g){
  return JSON.stringify([g.world.counters, g.world.items, g.world.flags, g.world.pending,
                         g.world.builds, g.world.tileOverrides, g.world.npcPosts,
                         g.world.log.length, g.world.hint, g.ui.view ? g.ui.view.id : null]);
}
var actBad = [], actOk = 0, actNone = [];
Core.asList(spaceJson.views).forEach(function(v){
  var g = Core.createGame(built, {});
  if (!g.openView(v.id)){ actBad.push(v.id + ' 打不开'); return; }
  var acts = g.ui.view.actions || [], pick = -1;
  for (var i = 0; i < acts.length; i++) if (String(acts[i].text).indexOf('关闭') < 0){ pick = i; break; }
  if (pick < 0){ actNone.push(v.id); return; }
  var before = digest(g);
  try { g.viewChoose(pick); }
  catch (e){ actBad.push(v.id + ' 动作报错：' + e.message); return; }
  if (digest(g) === before) actBad.push(v.id + ' 的动作没有任何后果');
  else actOk++;
  try { g.closeView(); } catch (e2) {}
});
ok('面板动作点下去都会改变世界（' + actOk + ' 个面板验过；当前无可用动作的：' + (actNone.join(',') || '无') + '）',
   actBad.length === 0, actBad.slice(0, 4).join(' | '));
var talkBad = [];
spaceJson.npcs.list.forEach(function(n){
  var g = Core.createGame(built, {});
  g.teleport(n.homeScene, 0, 0);
  try {
    g.approachNpc(n.id);
    if (!g.ui.dialogue || !built.idx.dialogues[g.ui.dialogue.id]) talkBad.push(n.id);
  } catch (e){ talkBad.push(n.id + ': ' + e.message); }
});
ok('每个人都能开口（走到哪都能谈）', talkBad.length === 0, talkBad.join(','));

section('11. 教学：会自己推进，借状态行提示');
var tg = Core.createGame(built, {});
ok('开局就有第一条提示', !!tg.world.hint, tg.world.hint);
ok('提示借用状态行（不是弹窗）', tg.ui.dialogue === null && tg.ui.view === null);
var step0 = tg.world.tutStep;
tg.step(30);
ok('走 30 分钟就推进了教学', tg.world.tutStep > step0, tg.world.tutStep);
ok('教学步数不超过内容里的步数', tg.world.tutStep <= spaceJson.tutorial.steps.length, tg.world.tutStep);
var tg2 = Core.createGame(built, {});
tg2.world.tutStep = 1;
tg2.openDialogue('dialogue_fleet_commander', 'npc_fleet_commander');
tg2.step(1);
ok('跟指挥官谈过之后「说话」这一步也算完成', tg2.world.tutStep >= 2, tg2.world.tutStep);

section('12. 组合判定词：not / all / any');
var cg = Core.createGame(built, {});
ok('{"type":"not"} 生效（副官的开场白靠它）', Core.check(cg, { type: 'not', not: { type: 'dialogue_seen', dialogue: 'dialogue_welcome' } }, {}));
cg.world.seenDialogues.dialogue_welcome = true;
ok('看过之后 not 变假', !Core.check(cg, { type: 'not', not: { type: 'dialogue_seen', dialogue: 'dialogue_welcome' } }, {}));
ok('{"type":"all"} 生效', Core.check(cg, { type: 'all', all: [{ type: 'tick', op: '>=', value: 0 }] }, {}));
ok('{"type":"any"} 生效', Core.check(cg, { type: 'any', any: [{ type: 'tick', op: '>=', value: 999999 }, { type: 'tick', op: '>=', value: 0 }] }, {}));
var adj = built.idx.npcs['npc_adjutant'];
ok('副官身上挂着开局对话规则', spaceJson.npcApproach.list.some(function(r){ return r.npcId === 'npc_adjutant'; }));

section('13. 负例：内容写错时必须报警（这些坑不能静默）');
var broken = JSON.parse(JSON.stringify(spaceJson));
delete broken.config.defaultLegend;
var sc0 = broken.scenes.list.filter(function(s){ return s.id === 'station_command'; })[0];
delete sc0.legend['.'];
var b1 = Core.load({ space: broken });
ok('漏写图例字符会警告「不在图例里」', b1.report.warnings.some(function(w){ return w.indexOf('不在图例里') >= 0; }),
   JSON.stringify(b1.report.warnings.slice(0, 2)));
/* 极简负例：图例是空的，整张图就编译成实心   正是当年 13 个场景翻车的样子 */
var tiny = { scenes: { list: [{ id: 'solid_room', name: '实心房', size: { w: 6, h: 4 },
  tiles: ['######', '#....#', '#....#', '######'], legend: {} }] } };
var b1b = Core.load({ space: tiny });
ok('整张图变成实心时会报「没有任何可走的格子」', b1b.report.errors.some(function(w){ return w.indexOf('没有任何可走的格子') >= 0; }),
   JSON.stringify(b1b.report.errors.slice(0, 2)));
ok('默认图例能把同一张图救回来', (function(){
  var t2 = JSON.parse(JSON.stringify(tiny));
  t2.config = { defaultLegend: { '#': { preset: 'wall' }, '.': { preset: 'floor' } } };
  t2.presets = { wall: { ch: '#', passable: false, solid: true, name: '墙' },
                 floor: { ch: '.', passable: true, name: '地板' } };
  var bb = Core.load({ space: t2 });
  var gg = bb.idx.sceneGrids.solid_room, n = 0;
  for (var i = 0; i < gg.pass.length; i++) n += gg.pass[i];
  return bb.report.errors.length === 0 && n === 8;
})());
var broken2 = JSON.parse(JSON.stringify(spaceJson));
var sc1 = broken2.scenes.list.filter(function(s){ return s.id === 'station_habitat'; })[0];
sc1.tiles = sc1.tiles.slice();
var row4 = sc1.tiles[4].split('');
for (var q = 7; q < 18; q++) row4[q] = '#';        /* 把第一间宿舍的门焊死 */
sc1.tiles[4] = row4.join('');
var b2 = Core.load({ space: broken2 });
ok('房间没有门会警告「走不到的区域」', b2.report.warnings.some(function(w){ return w.indexOf('走不到的区域') >= 0; }),
   JSON.stringify(b2.report.warnings.slice(0, 2)));
var broken3 = JSON.parse(JSON.stringify(spaceJson));
broken3.schedules.list.forEach(function(s){
  if (s.npcId === 'npc_fleet_commander') s.slots[0].x = 0, s.slots[0].y = 0;
});
var b3 = Core.load({ space: broken3 });
ok('日程写在墙上会警告', b3.report.warnings.some(function(w){ return w.indexOf('不是可走的格子') >= 0; }),
   JSON.stringify(b3.report.warnings.slice(0, 2)));

section('14. mod：新场景不写 legend 也能走（默认图例）');
var modScene = {
  id: 'mod_plain', name: 'mod 走廊', type: 'space_station', size: { w: 12, h: 6 },
  tiles: ['############', '#..........#', '#....@.....#', '#..........+', '#..........#', '############'],
  legend: { '@': { playerSpawn: true } },
  exits: [{ x: 11, y: 3, to: 'station_corridor', at: { x: 2, y: 6 }, direction: 'east' }]
};
var mod = { manifest: { id: 'world_mod', name: '世界测试', version: '1' }, data: { scenes: { list: [modScene] } } };
var bm = Core.load({ space: spaceJson, mods: [mod] });
ok('mod 场景合进来且无致命错误', bm.report.errors.length === 0, JSON.stringify(bm.report.errors));
var gm = Core.createGame(bm, {});
ok('mod 场景靠默认图例变成了可走的地板', walkableMod(bm, 'mod_plain') >= 40, walkableMod(bm, 'mod_plain'));
function walkableMod(b, id){
  var g = b.idx.sceneGrids[id], n = 0;
  for (var i = 0; i < g.pass.length; i++) if (g.pass[i]) n++;
  return n;
}
gm.teleport('mod_plain', 5, 2);
ok('mod 场景里出生点可站立', gm.world.player.scene === 'mod_plain');
ok('mod 场景的出生点被记录成地板（不残留 @）', gm.grid('mod_plain').ch[2 * 12 + 5] !== '@');
gm.teleport('mod_plain', 11, 3);
ok('mod 场景的门那一格能站', gm.world.player.x === 11 && gm.world.player.y === 3);
gm.takeExit();
ok('mod 场景的门通向原内容', gm.world.player.scene === 'station_corridor', gm.world.player.scene);

console.log('\n----------------------------------------');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
