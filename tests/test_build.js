/* =============================================================================
 * test_build.js  验证构建产物 space-text.html（纯文本版）
 *   node tests/test_build.js
 *   重点：每个 <script> 块都必须能通过语法解析  上一次"全黑"就是构建时
 *         把代码里的 /</g 误改成 /<\/g 导致整块语法错误、根本不执行。
 * ========================================================================== */
var fs = require('fs'), path = require('path'), vm = require('vm');
var ROOT = path.join(__dirname, '..');
var pass = 0, fail = 0;
function ok(n, c, x){ if (c){ pass++; console.log('  ok   ' + n); } else { fail++; console.log('  FAIL ' + n + (x !== undefined ? '  -> ' + x : '')); } }

function extract(text, marker){
  var i = text.indexOf(marker);
  if (i < 0) return null;
  var j = i + marker.length;
  while (j < text.length && ' \t\r\n'.indexOf(text[j]) >= 0) j++;
  var open = text[j], close = (open === '{') ? '}' : ']';
  if (open !== '{' && open !== '[') return null;
  var depth = 0, inStr = false, esc = false, k = j;
  for (; k < text.length; k++){
    var ch = text[k];
    if (inStr){
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === open) depth++;
    else if (ch === close) { depth--; if (depth === 0){ k++; break; } }
  }
  return JSON.parse(text.slice(j, k));
}

var htmlPath = path.join(ROOT, 'space-text.html');
ok('space-text.html 存在', fs.existsSync(htmlPath));
var html = fs.readFileSync(htmlPath, 'utf8');
ok('HTML 结构完整', html.indexOf('<!DOCTYPE html>') === 0 && html.indexOf('</html>') > 0);
ok('没有外链资源（零依赖）', !/<script[^>]+src=/.test(html) && !/<link[^>]+href=/.test(html) && !/<img/.test(html));
ok('没有 canvas（纯文本模式）', html.indexOf('<canvas') < 0);
ok('有 <pre id="screen">', /<pre id="screen"/.test(html));

/* ---- 每个 script 块语法必须正确 ---- */
var blocks = [], re = /<script>([\s\S]*?)<\/script>/g, m;
while ((m = re.exec(html))) blocks.push(m[1]);
ok('至少有 4 个 script 块', blocks.length >= 4, blocks.length);
var badBlock = -1, badMsg = '';
for (var i = 0; i < blocks.length; i++){
  try { new vm.Script(blocks[i], { filename: 'block' + i }); }
  catch (e) { badBlock = i; badMsg = e.message; break; }
}
ok('每个 script 块都能通过语法解析（上次全黑的元凶）', badBlock < 0,
   badBlock >= 0 ? ('块 ' + badBlock + ': ' + badMsg) : '');
ok('代码里的 < 没有被误转义', html.indexOf('.replace(/<\\/g') < 0 && html.indexOf(".replace(/</g") >= 0);
ok('没有把 </ 全部转义', html.indexOf("'<\\/'") < 0 && html.indexOf('"<\\/"') < 0);

var spec = extract(html, 'window.SPACE_SPEC =');
ok('能解出 SPACE_SPEC', !!spec && !!spec.scenes);
var mods = extract(html, 'window.SPACE_MODS =');
ok('能解出 SPACE_MODS', Array.isArray(mods));
ok('示例 mod 被编译进去', mods.length >= 1, JSON.stringify((mods[0] || {}).manifest && mods[0].manifest.id));

var Core = require(path.join(ROOT, 'engine', 'space-core.js'));
var built = Core.load({ space: spec, mods: mods });
ok('构建产物无致命错误', built.report.errors.length === 0, JSON.stringify(built.report.errors).slice(0, 200));
ok('mods/ 里的 mod 合进来不报警（引用都对得上）', built.report.warnings.length === 0,
   JSON.stringify(built.report.warnings.slice(0, 3)));
ok('示例 mod 场景已合入', !!built.idx.scenes.mod_observatory);
ok('_append 给走廊开了新门', !!built.idx.sceneGrids.station_corridor.exitMap['0,6']);

/* ---- 起手 mod 模板（F2 -> 填入示例模板）也编在产物里，而且必须是真的能跑 ---- */
var starter = extract(html, 'window.SPACE_STARTER =');
ok('产物里带着起手 mod 模板', !!starter && !!starter.data && !!starter.id, starter && starter.id);
var bStarter = Core.load({ space: spec, mods: [{ manifest: starter, data: starter.data }] });
ok('起手 mod 能干净地合并', bStarter.report.errors.length === 0 && bStarter.report.warnings.length === 0,
   JSON.stringify(bStarter.report.errors.concat(bStarter.report.warnings).slice(0, 3)));
function starterRegion(){
  var g = bStarter.idx.sceneGrids.my_room, n = g.w * g.h;
  var lab = new Int32Array(n).fill(-1), size = 0, start = -1;
  for (var i = 0; i < n; i++) if (g.pass[i]){ start = i; break; }
  var q = [start]; lab[start] = 1;
  while (q.length){
    var c = q.pop(); size++;
    var x = c % g.w, y = Math.floor(c / g.w);
    for (var k = 0; k < 4; k++){
      var nx = x + [0,0,-1,1][k], ny = y + [-1,1,0,0][k];
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h) continue;
      var j = ny * g.w + nx;
      if (g.pass[j] && lab[j] < 0){ lab[j] = 1; q.push(j); }
    }
  }
  var walk = 0;
  for (var w2 = 0; w2 < n; w2++) if (g.pass[w2]) walk++;
  return { size: size, walk: walk };
}
var sr = starterRegion();
ok('起手 mod 的房间是单连通（没有没门的盒子）', sr.size === sr.walk && sr.walk > 40, JSON.stringify(sr));
var gs2 = Core.createGame(bStarter, {});
[['my_room', 13, 3], ['station_corridor', 0, 10]].forEach(function(t){
  gs2.teleport(t[0], t[1], t[2]);
});
/* 两扇门都走一遍 */
var doorA = Core.createGame(bStarter, {});
doorA.teleport('my_room', 13, 3);
ok('起手 mod：自己房间的门通向环形走廊', doorA.takeExit() === true && doorA.world.player.scene === 'station_corridor',
   doorA.world.player.scene);
var doorB = Core.createGame(bStarter, {});
doorB.teleport('station_corridor', 0, 10);
ok('起手 mod：走廊上凿出来的门通回新房间', doorB.takeExit() === true && doorB.world.player.scene === 'my_room',
   doorB.world.player.scene);
ok('起手 mod：宏 / 钩子 / 私有块 / 终端 / 对话都在',
   !!bStarter.idx.macros.my_hello && (bStarter.idx.hooksByOn.enter_scene || []).length >= 1 &&
   !!(bStarter.space.myNotes && bStarter.space.myNotes.list.length) &&
   !!bStarter.idx.interactables.my_terminal && !!bStarter.idx.dialogues.dialogue_my_guest);

/* ---- 产物必须是「刚构建过」的：内容与引擎都得和磁盘上的一致 ---- */
var specOnDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'space.json'), 'utf8'));
ok('产物里的内容 = content/space.json（改完内容记得重新构建）',
   JSON.stringify(spec) === JSON.stringify(specOnDisk));
var htmlN = html.replace(/\r\n/g, '\n');          /* 构建产物在 Windows 上是 CRLF，比之前先归一 */
['space-core.js', 'space-textout.js', 'space-textshell.js'].forEach(function(f){
  var code = fs.readFileSync(path.join(ROOT, 'engine', f), 'utf8').replace(/\r\n/g, '\n');
  ok('产物里的引擎 = engine/' + f + '（改完引擎记得重新构建）', htmlN.indexOf(code.slice(0, 400)) >= 0);
});
ok('外壳带着字号写回 DOM 的代码（纯文本版头号坑）',
   html.indexOf('TextOut.prototype.applyFont') >= 0 && html.indexOf('pre.style.font = this.fontCss()') >= 0);
ok('页面里有 F2 装 mod 的面板', /id="modpanel"/.test(html) && /id="modtext"/.test(html) && /id="modapply"/.test(html));
ok('内核默认图例进了产物', CoreDefaultLegendCheck(spec));
function CoreDefaultLegendCheck(sp){
  return !!(sp.config && sp.config.defaultLegend && sp.config.defaultLegend['.'] && sp.config.defaultLegend['#']);
}

/* ---- 出生点不再残留 @ ---- */
var g = Core.createGame(built, {});
var grid = built.idx.sceneGrids.station_command;
var spawnAt = grid.spawn;
ok('场景里记录了出生点', !!spawnAt);
ok('出生点格子显示为地板（不是 @）', grid.ch[spawnAt.y * grid.w + spawnAt.x] !== '@',
   grid.ch[spawnAt.y * grid.w + spawnAt.x]);
var atCount = 0;
for (var q = 0; q < grid.ch.length; q++) if (grid.ch[q] === '@') atCount++;
ok('整张场景图里没有残留的 @ 字符', atCount === 0, atCount);

/* ---- 默认不自动弹窗 ---- */
ok('config.autoInteract 默认关闭', spec.config.autoInteract !== true, spec.config.autoInteract);
ok('config.autoNpcTalk 默认关闭', spec.config.autoNpcTalk !== true, spec.config.autoNpcTalk);
ok('所有物件 auto 都是 false', (spec.interactables.list || []).every(function(it){ return it.auto !== true; }),
   (spec.interactables.list || []).filter(function(it){ return it.auto === true; }).map(function(it){ return it.id; }).join(','));

/* ---- 靠近终端不会自动打开 ---- */
var gb = g.grid('station_command');
var tp = null;
for (var q2 = 0; q2 < gb.ch.length; q2++) if (gb.kind[q2] === 'interactable' && gb.ref[q2] === 'star_map_terminal'){ tp = { x: q2 % gb.w, y: (q2 / gb.w) | 0 }; break; }
g.teleport('station_command', tp.x - 1, tp.y);
g.autoInteract();
ok('走到终端旁边不会自动弹终端', !g.ui.view, g.ui.view && g.ui.view.id);
g.interact();
ok('按 E 才打开终端', !!g.ui.view, g.ui.view && g.ui.view.id);
g.closeView();

/* ---- 撞到 NPC 不会自动开口 ---- */
var cs = built.idx.schedules['npc_fleet_commander'].slots[0];
g.teleport(cs.scene, cs.x, cs.y + 1);
g.tryMove(0, -1);                                /* 撞上指挥官 */
ok('撞到 NPC 不会自动开始对话', !g.ui.dialogue);
g.interact();
ok('按 E 才开始对话', !!g.ui.dialogue, g.ui.dialogue && g.ui.dialogue.id);

/* ---- 生成世界 mod（tools/gen_world.py 产出）：多站点 / 多场景 / 穿梭机 / 星图 ---- */
var gwMan = null;
mods.forEach(function(mm){ if (mm.manifest && mm.manifest.id === 'generated_world') gwMan = mm; });
ok('生成世界 mod 已编入（tools/gen_world.py）', !!gwMan, gwMan && gwMan.manifest.name);
var gwSceneIds = Object.keys(built.idx.scenes).filter(function(k){ return k.indexOf('gw_') === 0; });
ok('生成世界的场景都合了进来（>= 20 张）', gwSceneIds.length >= 20, gwSceneIds.length);
var gwShuttles = (built.space.shuttles.list || []).filter(function(s){ return String(s.id).indexOf('gw_') === 0; });
ok('生成世界的穿梭机目的地 >= 15', gwShuttles.length >= 15, gwShuttles.length);
var gwTravelBad = [];
gwShuttles.forEach(function(sh){
  var gg = Core.createGame(built, {});
  gg.teleport(sh.scene, NaN, NaN);
  if (gg.world.player.scene !== sh.scene || !gg.isPassable(sh.scene, gg.world.player.x, gg.world.player.y)) gwTravelBad.push(sh.id);
});
ok('生成世界：每条穿梭机都能落到可走格', gwTravelBad.length === 0, gwTravelBad.slice(0, 3).join(','));
var gwGroups = {};
gwSceneIds.forEach(function(id){ var k = id.replace(/_[a-z]$/, ''); (gwGroups[k] = gwGroups[k] || []).push(id); });
var gwBad = [];
Object.keys(gwGroups).forEach(function(k){
  var first = gwGroups[k][0], seen = {}, st = [first]; seen[first] = 1;
  while (st.length){
    var cur = st.pop(), gr = built.idx.sceneGrids[cur];
    Object.keys((gr && gr.exitMap) || {}).forEach(function(pos){
      var ex = gr.exitMap[pos];
      if (ex && ex.to && gwGroups[k].indexOf(ex.to) >= 0 && !seen[ex.to]){ seen[ex.to] = 1; st.push(ex.to); }
    });
  }
  if (Object.keys(seen).length !== gwGroups[k].length) gwBad.push(k);
});
ok('生成世界：每个站点的场景用门连成一片（' + Object.keys(gwGroups).length + ' 个站点）', gwBad.length === 0, gwBad.slice(0, 3).join(','));
ok('生成世界：星系图节点已追加（>= 15）',
   (built.space.galaxy.nodes || []).filter(function(n){ return String(n.id).indexOf('gw_') === 0; }).length >= 15);

/* ---- 站点战略动作：世界地图终端 / 勘测推进 / 指令进度 / 阅读弹层 ---- */
var gwTermPlaced = false;
(function(){
  var gr = built.idx.sceneGrids.station_command;
  if (!gr) return;
  for (var i = 0; i < gr.ch.length; i++) if (gr.kind[i] === 'interactable' && gr.ref[i] === 'gw_world_terminal'){ gwTermPlaced = true; return; }
})();
ok('生成世界：世界地图终端已定义并放进指挥中心', !!built.idx.interactables.gw_world_terminal && gwTermPlaced);
var gws = Core.createGame(built, {});
gws.openView('gw_world_map');
ok('生成世界：世界地图终端能打开并列出站点', !!gws.ui.view && gws.ui.view.rows.length >= 15, gws.ui.view && gws.ui.view.rows.length);
gws.ui.view.cursor = 0; gws.viewSelect();
ok('生成世界：选中站点会打开它的档案视图', !!gws.ui.view && /^gw_site_/.test(gws.ui.view.id), gws.ui.view && gws.ui.view.id);
var sv = -1;
gws.ui.view.actions.forEach(function(a, i){ if (String(a.text).indexOf('勘测') >= 0) sv = i; });
ok('生成世界：档案里有「勘测」战略动作', sv >= 0, JSON.stringify(gws.ui.view.actions.map(function(a){ return a.text; })));
var sv0 = gws.world.counters.gw_surveyed || 0, st0 = gws.world.counters.gw_st_01;
gws.viewChoose(sv);
ok('生成世界：勘测真的推进指令计数 + 站点状态',
   (gws.world.counters.gw_surveyed || 0) === sv0 + 1 && gws.world.counters.gw_st_01 === 1,
   JSON.stringify({ surveyed: gws.world.counters.gw_surveyed, st: gws.world.counters.gw_st_01 }));
ok('生成世界：终端动作后给了 flash 反馈', !!(gws.ui.flash && gws.ui.flash.text), JSON.stringify(gws.ui.flash));
ok('生成世界：有指令进度视图 + 带 progress 的 missions',
   Object.keys(built.idx.views).indexOf('gw_orders') >= 0 &&
   (built.space.missions.list || []).filter(function(m){ return m.progress && m.progress.counter; }).length >= 5);
ok('引擎：阅读弹层能装长文本并给出任务进度',
   (function(){ var rr = Core.createGame(built, {}); rr.openReader({ title: '测试', text: '一段很长的剧情文本。'.repeat(20) }); return rr.ui.reader.rows.length >= 1 && rr.readerOrders().length >= 5; })());

/* ---- 站点内内容：NPC / 采集点 / 到达事件（tools/gen_world.py 注入） ---- */
var gwNpcs = (built.space.npcs.list || []).filter(function(n){ return String(n.id).indexOf('gwn_') === 0; });
var gwSchs = (built.space.schedules.list || []).filter(function(s){ return String(s.npcId).indexOf('gwn_') === 0; });
var gwDlgs = (built.space.dialogues.list || []).filter(function(d){ return String(d.id).indexOf('dlg_gw_') === 0 || String(d.id).indexOf('dlg_gwe_') === 0; });
var gwEvs = (built.space.events.list || []).filter(function(e){ return String(e.id).indexOf('gwe_') === 0; });
var gwApps = (built.space.npcApproach.list || []).filter(function(r){ return String(r.id).indexOf('gwa_') === 0; });
var gwObjs = (built.space.interactables.list || []).filter(function(o){ return String(o.id).indexOf('gwo_') === 0; });
ok('站点内内容：站点各有 NPC / 日程 / 采集点', gwNpcs.length >= 15 && gwSchs.length >= 15 && gwObjs.length >= 15,
   JSON.stringify({ npc: gwNpcs.length, sch: gwSchs.length, obj: gwObjs.length }));
ok('站点内内容：对话 / 到达事件 / 上报规则都齐', gwDlgs.length >= 30 && gwEvs.length >= 15 && gwApps.length >= 15,
   JSON.stringify({ dlg: gwDlgs.length, ev: gwEvs.length, app: gwApps.length }));
var gwSchBad = [];
gwSchs.forEach(function(s){
  (s.slots || []).forEach(function(slot){
    var gr = built.idx.sceneGrids[slot.scene];
    if (!gr || !gr.pass[slot.y * gr.w + slot.x]) gwSchBad.push(s.id + '@' + slot.scene + ' ' + slot.x + ',' + slot.y);
  });
});
ok('站点内内容：NPC 日程点都落在可走格上', gwSchBad.length === 0, gwSchBad.slice(0, 3).join(' | '));
var gwObjBad = [];
gwObjs.forEach(function(o){
  var v = null;
  ((o.onInteract || []).concat(o.effects || [])).forEach(function(a){ if (a && a.type === 'open_view') v = a.view; });
  if (!v || !built.idx.views[v]) gwObjBad.push(o.id);
});
ok('站点内内容：每个采集点都打开自己的站点档案', gwObjBad.length === 0, gwObjBad.slice(0, 3).join(','));
/* 到达事件 -> pending -> 找 NPC -> 事件对话 -> 选择改变世界 */
var gwNode = (built.space.galaxy.nodes || []).filter(function(n){ return n.generated === true; })[0];
var gwNpc = gwNpcs.filter(function(n){ return n.homeScene === gwNode.scene; })[0];
var gwEv = gwEvs.filter(function(e){ return (e.presentedBy || []).indexOf(gwNpc.id) >= 0; })[0];
var gwSlot = built.idx.schedules[gwNpc.id].slots[0];
var evFlag = 'gw_ev_' + String(gwNpc.id).split('_').pop();
var gEv = Core.createGame(built, {});
var evGr = built.idx.sceneGrids[gwNode.scene], evCell = null;
for (var ei = 0; ei < evGr.pass.length; ei++) if (evGr.pass[ei] && evGr.kind[ei] !== 'interactable' && evGr.kind[ei] !== 'exit'){ evCell = { x: ei % evGr.w, y: Math.floor(ei / evGr.w) }; break; }
gEv.teleport(gwNode.scene, evCell.x, evCell.y); gEv.step(1);
ok('站点内内容：到了站点会挂上到达事件', gEv.world.pending[gwEv.id] === true, gwEv.id + ' / ' + Object.keys(gEv.world.pending).join(','));
gEv.teleport(gwSlot.scene, gwSlot.x, gwSlot.y); gEv.approachNpc(gwNpc.id);
ok('站点内内容：NPC 会上报到达事件', gEv.ui.dialogue && gEv.ui.dialogue.id === gwEv.dialogue, gEv.ui.dialogue && gEv.ui.dialogue.id);
var evBefore = JSON.stringify(gEv.world.counters);
gEv.chooseOption(0);
ok('站点内内容：事件选项真的改变世界并点 flag', JSON.stringify(gEv.world.counters) !== evBefore && gEv.world.flags[evFlag] === true,
   JSON.stringify({ flag: gEv.world.flags[evFlag] }));
/* 采集动作：站内可见可点、远程隐藏 */
var gCol = Core.createGame(built, {});
gCol.teleport(gwNode.scene, evCell.x, evCell.y);
gCol.openView(gwNode.view);
var colIdx = -1;
gCol.ui.view.actions.forEach(function(a, idx){ if (String(a.text).indexOf('（1 小时）') >= 0 && String(a.text).indexOf('勘测') < 0) colIdx = idx; });
ok('站点内内容：站内能看到采集动作', colIdx >= 0, JSON.stringify(gCol.ui.view.actions.map(function(a){ return a.text; })));
var colBefore = JSON.stringify(gCol.world.counters);
if (colIdx >= 0) gCol.viewChoose(colIdx);
ok('站点内内容：采集动作发资源并给 flash', JSON.stringify(gCol.world.counters) !== colBefore && !!(gCol.ui.flash && gCol.ui.flash.text));
var gRemote = Core.createGame(built, {});
gRemote.openView(gwNode.view);
ok('站点内内容：离开站点后采集动作消失（不能远程采集）',
   !gRemote.ui.view.actions.some(function(a){ return String(a.text).indexOf('（1 小时）') >= 0 && String(a.text).indexOf('勘测') < 0; }));

/* ---- 回程安全：生成站点必须有回家的办法（修卡关） ---- */
var gwReturn = (built.space.shuttles.list || []).filter(function(s){ return s.scene === 'station_command' && s.locked !== true; });
ok('回程安全：穿梭机列表里有「返回索尔空间站」目的地', gwReturn.length >= 1, JSON.stringify(gwReturn.map(function(s){ return s.id; })));
var gwFirsts = Object.keys(built.idx.scenes).filter(function(k){ return /^gw_.*_a$/.test(k); });
var noTerm = [];
gwFirsts.forEach(function(k){
  var gr = built.idx.sceneGrids[k], has = false;
  for (var i = 0; i < gr.ch.length; i++) if (gr.kind[i] === 'interactable' && gr.ref[i] === 'shuttle_terminal'){ has = true; break; }
  if (!has) noTerm.push(k);
});
ok('回程安全：每个生成站点首图都有穿梭机终端', gwFirsts.length >= 15 && noTerm.length === 0, noTerm.slice(0, 3).join(','));
var allSceneIds = Object.keys(built.idx.scenes);
var termIds = allSceneIds.filter(function(sid){
  var gr = built.idx.sceneGrids[sid];
  for (var i = 0; i < gr.ch.length; i++) if (gr.kind[i] === 'interactable' && gr.ref[i] === 'shuttle_terminal') return true;
  return false;
});
var oneWay = [];
allSceneIds.forEach(function(sid){
  if (termIds.indexOf(sid) >= 0) return;
  var seen = {}, st = [sid]; seen[sid] = 1;
  while (st.length){
    var c = st.pop(), sg = built.idx.sceneGrids[c];
    for (var k in sg.exitMap){ var ex = sg.exitMap[k]; if (ex && ex.to && !seen[ex.to]){ seen[ex.to] = 1; st.push(ex.to); } }
  }
  if (!Object.keys(seen).some(function(s){ return termIds.indexOf(s) >= 0; })) oneWay.push(sid);
});
ok('回程安全：全图（含生成站点）没有单向场景', oneWay.length === 0, oneWay.slice(0, 5).join(','));

var gRet = Core.createGame(built, {});
gRet.teleport(gwNode.scene, evCell.x, evCell.y);
gRet.openView(gwNode.view);
var retIdx = -1;
gRet.ui.view.actions.forEach(function(a, i){ if (String(a.text).indexOf('返回索尔') >= 0) retIdx = i; });
ok('回程安全：站点档案里有「返回索尔」动作', retIdx >= 0, JSON.stringify(gRet.ui.view.actions.map(function(a){ return a.text; })));
if (retIdx >= 0) gRet.viewChoose(retIdx);
ok('回程安全：点返航真的回到索尔空间站', gRet.world.player.scene === 'station_command', gRet.world.player.scene);

/* ---- 站点内容加深 + 三层生成 + 战略层（归属改星图） ---- */
var gwUnder = Object.keys(built.idx.scenes).filter(function(k){ return /^gw_.*_u$/.test(k); });
ok('三层生成：每个站点都有地下层（>= 15）', gwUnder.length >= 15, gwUnder.length);
var siteFirsts = Object.keys(built.idx.scenes).filter(function(k){ return /^gw_.*_a$/.test(k); });
var siteBad = [];
siteFirsts.forEach(function(sid){
  var gr = built.idx.sceneGrids[sid], kinds = {};
  for (var i = 0; i < gr.ch.length; i++) if (gr.kind[i] === 'interactable') kinds[gr.ref[i]] = 1;
  var hasShuttle = !!kinds['shuttle_terminal'];
  var hasObj = Object.keys(kinds).some(function(x){ return x.indexOf('gwo_') === 0; });
  var hasBld = Object.keys(kinds).some(function(x){ return x.indexOf('gwb_') === 0; });
  var uid = sid.replace(/_a$/, '_u'), gru = built.idx.sceneGrids[uid], hasMine = false;
  if (gru) for (var j = 0; j < gru.ch.length; j++) if (gru.kind[j] === 'interactable' && String(gru.ref[j]).indexOf('gwf_') === 0) hasMine = true;
  if (!(hasShuttle && hasObj && hasBld && hasMine)) siteBad.push(sid);
});
ok('站点内容：首图有穿梭机/采集点/建筑，地下层有矿脉', siteFirsts.length >= 15 && siteBad.length === 0, siteBad.slice(0, 3).join(','));
ok('站点内容：每站 2 个 NPC + 随机遭遇钩子',
   (built.space.npcs.list || []).filter(function(n){ return String(n.id).indexOf('gwn_') === 0 || String(n.id).indexOf('gw2_') === 0; }).length >= 30 &&
   (built.space.hooks.list || []).filter(function(h){ return String(h.id).indexOf('gwh_enc_') === 0; }).length >= 15,
   JSON.stringify({ npcs: (built.space.npcs.list || []).filter(function(n){ return String(n.id).indexOf('gwn_') === 0 || String(n.id).indexOf('gw2_') === 0; }).length }));
ok('三层生成：生成站点都有区域划分',
   (built.space.galaxy.nodes || []).filter(function(n){ return n.generated; }).every(function(n){ return !!n.region; }));
/* 专属建筑有真动作 */
var bldViews = Object.keys(built.idx.views).filter(function(k){ return /^gw_bld_/.test(k); });
var gB = Core.createGame(built, {}), bIdx = -1, bView = null;
for (var bi = 0; bi < bldViews.length && bIdx < 0; bi++){
  gB.openView(bldViews[bi]);
  for (var bj = 0; bj < gB.ui.view.actions.length; bj++){
    var bt = String(gB.ui.view.actions[bj].text);
    if (bt.indexOf('关闭') < 0 && bt.indexOf('阅读') < 0){ bIdx = bj; bView = bldViews[bi]; break; }
  }
}
var bBefore = JSON.stringify(gB.world.counters);
if (bIdx >= 0) gB.viewChoose(bIdx);
ok('站点内容：专属建筑有真动作并改变世界', bIdx >= 0 && JSON.stringify(gB.world.counters) !== bBefore, bView);
gB.closeView();
/* 地下开采：只在地下层可见 */
var gU = Core.createGame(built, {});
var uid0 = gwNode.scene.replace(/_a$/, '_u'), gru0 = built.idx.sceneGrids[uid0], uCell = null;
for (var ui = 0; ui < gru0.pass.length; ui++) if (gru0.pass[ui] && gru0.kind[ui] !== 'interactable' && gru0.kind[ui] !== 'exit'){ uCell = { x: ui % gru0.w, y: Math.floor(ui / gru0.w) }; break; }
gU.teleport(uid0, uCell.x, uCell.y); gU.openView(gwNode.view);
ok('三层生成：地下层能看到「地下开采」', gU.ui.view.actions.some(function(a){ return String(a.text).indexOf('地下开采') >= 0; }));
var gF0 = Core.createGame(built, {});
var grF = built.idx.sceneGrids[gwNode.scene], fCell = null;
for (var fi = 0; fi < grF.pass.length; fi++) if (grF.pass[fi] && grF.kind[fi] !== 'interactable' && grF.kind[fi] !== 'exit'){ fCell = { x: fi % grF.w, y: Math.floor(fi / grF.w) }; break; }
gF0.teleport(gwNode.scene, fCell.x, fCell.y); gF0.openView(gwNode.view);
ok('三层生成：地下开采在首图隐藏', !gF0.ui.view.actions.some(function(a){ return String(a.text).indexOf('地下开采') >= 0; }));
/* 战略层：宣示真的写入 world.galaxy，并在星图上显示、可存档 */
var gG = Core.createGame(built, {});
gG.openView(gwNode.view);
function gGChoose(sub){ var idx = -1; gG.ui.view.actions.forEach(function(a, i){ if (String(a.text).indexOf(sub) >= 0) idx = i; }); if (idx >= 0) gG.viewChoose(idx); return idx >= 0; }
gGChoose('勘测');
ok('战略层：宣示写入 world.galaxy', (function(){ gGChoose('宣示'); return gG.world.galaxy[gwNode.id] && gG.world.galaxy[gwNode.id].owner === 'player_remnant'; })(),
   JSON.stringify(gG.world.galaxy[gwNode.id]));
gG.closeView(); gG.openView('galaxy_map');
ok('战略层：星图显示新的关系', (gG.ui.view.lines || []).some(function(l){ return String(l.text).indexOf('自己人') >= 0; }));
ok('战略层：星系归属能存进档、读回来', (function(){
  var g2 = Core.createGame(built, {});
  g2.deserialize(JSON.parse(JSON.stringify(gG.serialize())));
  return g2.world.galaxy[gwNode.id] && g2.world.galaxy[gwNode.id].owner === 'player_remnant';
})());

console.log('\n----------------------------------------');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);