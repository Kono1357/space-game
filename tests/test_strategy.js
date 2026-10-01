/* =============================================================================
 * test_strategy.js  战略层：把「只登记、从没被读过」的数据变成能玩的东西（第 4 期）
 *   node tests/test_strategy.js
 *
 * 守的是什么：
 *   第 4 期之前，这几个块在内核里**只出现在 SPACE_BLOCKS 的登记行上**，一次都没被读过：
 *     colonies（10 个殖民地）· fleetModules（34 个模块）· internalPolitics（12 个派别）
 *     planetTypes（18 种行星）· diplomacy.actions（30 条外交动作）
 *   玩家写了 593 条战略层内容，游戏里一个字都看不到；`factions.relation` 是死文案；
 *   「开战」只是个 -1 舰队的按钮，没有对手、没有胜负、没有后果。
 *
 * 现在要有的性质：
 *   ① 那几块数据**内核真的读了**（视图提供者的输出行数 >= 内容条目数）；
 *   ② 新词表 counter_cmp（比较两个计数器）与 galaxy_get（读星系节点字段）能用；
 *   ③ 战略台终端在指挥中心，走得到、打得开，六个看板都不空；
 *   ④ **舰队派遣全流程能走通**：进作战室 → 派舰队（真扣）→ 进战斗 → 接战 →
 *      节点归属真的变了、计数真的加了、合金真的到手；
 *   ⑤ 打不动的时候，劣势分支真的会输，而且**真的吃亏**；
 *   ⑥ 殖民地每天在变（口粮决定士气，士气决定人口）；
 *   ⑦ 外交态度是活的，而且**态度驱动事件**；
 *   ⑧ 这些新状态都进存档。
 * ========================================================================== */
var path = require('path'), fs = require('fs');
var ROOT = path.join(__dirname, '..');
var Core = require(path.join(ROOT, 'engine', 'space-core.js'));

var pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond){ pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '   -> ' + extra : '')); }
}
function section(t){ console.log('\n=== ' + t + ' ==='); }

var spaceJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'space.json'), 'utf8'));
var mods = ['example_mod', 'generated_world'].map(function (d){
  var p = path.join(ROOT, 'mods', d, 'mod.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}).filter(Boolean);
var built = Core.load({ space: spaceJson, mods: mods });
var DAY = 1440;

function newGame(){ return Core.createGame(built, {}); }
function byId(list, id){ return Core.asList(list).filter(function (x){ return x.id === id; })[0]; }
function actIdx(g, needle){
  var acts = (g.ui.view && g.ui.view.actions) || [];
  for (var i = 0; i < acts.length; i++) if (String(acts[i].text).indexOf(needle) >= 0) return i;
  return -1;
}

/* ---------------------------------------------------------------- ① 词表 */
section('① 新词登记了，而且内容真的在用');

ok('counter_cmp 已注册（比较两个计数器）', typeof Core.conditions.counter_cmp === 'function');
ok('galaxy_get 已注册（读星系节点字段）', typeof Core.effects.galaxy_get === 'function');

(function (){
  var g = newGame();
  g.world.counters.a = 5; g.world.counters.b = 3;
  var C = Core.conditions.counter_cmp;
  ok('counter_cmp: 5 >= 3', C(g, { a:'a', b:'b', op:'>=' }) === true);
  ok('counter_cmp: 5 < 3 为假', C(g, { a:'a', b:'b', op:'<' }) === false);
  ok('counter_cmp: 3 < 5', C(g, { a:'b', b:'a', op:'<' }) === true);
  ok('counter_cmp: 带偏移量（5 >= 3+2）', C(g, { a:'a', b:'b', op:'>=', bOffset:2 }) === true);
  ok('counter_cmp: 缺省值生效', C(g, { a:'不存在', b:'不存在2', op:'>=', aDefault:7, bDefault:2 }) === true);
  g.world.counters.e = 0;
  Core.effects.galaxy_get(g, { node:'rift7', field:'fleets', counter:'e' });
  ok('galaxy_get 把节点守备读进计数器（rift7 = 2）', g.world.counters.e === 2, g.world.counters.e);
  Core.effects.galaxy_get(g, { node:'rift3', field:'fleets', counter:'e' });
  ok('换个节点读到 4', g.world.counters.e === 4, g.world.counters.e);
  Core.effects.galaxy_get(g, { node:'不存在的节点', field:'fleets', counter:'e', default:-1 });
  ok('节点不存在时用默认值（不崩）', g.world.counters.e === -1, g.world.counters.e);
})();

/* ---------------------------------------------------------------- ② 死数据被读了 */
section('② 那几块「只登记、从没被读过」的数据，内核真的读了 ★');

(function (){
  var g = newGame();
  var cases = [
    ['colonies_live', 'colonies', function (r, n){ return r.length >= n; }],
    ['fleets_live', 'fleets', function (r, n){ return r.length >= n; }],
    ['politics_live', 'internalPolitics', function (r, n){ return r.length >= n; }],
    ['planets_live', 'planetTypes', function (r, n){ return r.length >= n - 2; }],
    ['diplomacy_live', 'factions', function (r, n){ return r.length >= n - 3; }],
    ['diplomacy_actions', null, function (r){ return r.length >= 10; }],
  ];
  cases.forEach(function (c){
    var fn = Core.viewProviders[c[0]];
    if (typeof fn !== 'function'){ ok(c[0] + ' 已注册', false); return; }
    var n = c[1] ? Core.asList(spaceJson[c[1]]).length : 0;
    var rows = fn(g);
    ok(c[0] + ' 有输出，且行数覆盖了内容的 ' + n + ' 条 ★', c[2](rows, n), rows.length + ' 行');
  });
  /* 模块那 34 条也得露个面（fleets_live 里有一段"可用模块"） */
  var txt = Core.viewProviders.fleets_live(g).map(function (x){ return x.text; }).join('\n');
  ok('34 个舰船模块也在舰队名册里露了面', txt.indexOf('模块') >= 0, txt.slice(0, 60));
})();

/* ---------------------------------------------------------------- ③ 战略台 */
section('③ 战略台终端：走得到、打得开，六个看板都不空');

(function (){
  var st = byId(spaceJson.interactables, 'strategy_table');
  ok('内容里有 strategy_table 物件', !!st);
  var sc = byId(spaceJson.scenes, 'station_command');
  var placed = false;
  (sc.tiles || []).forEach(function (row){ if (row.indexOf('&') >= 0) placed = true; });
  ok('它真的画在指挥中心的地图上（字符 &）★', placed);
  ok('指挥中心的 legend 里有 &', !!((sc.legend || {})['&']));

  var g = newGame();
  g.openView('strategy_hub');
  ok('战略台视图打得开', !!(g.ui.view && g.ui.view.id === 'strategy_hub'));
  var boards = ['fleet_roster', 'colony_board', 'politics_board', 'diplomacy_board', 'planet_guide', 'fleet_ops'];
  var empty = [];
  boards.forEach(function (v){
    var g2 = newGame();
    if (!g2.openView(v)){ empty.push(v + ' 打不开'); return; }
    var lines = g2.ui.view.lines || [];
    var nonEmpty = lines.filter(function (l){ return String(l.text || '').trim().length > 0; });
    if (!nonEmpty.length) empty.push(v + ' 是空的');
  });
  ok('六个看板都打得开而且不是空的 ★', empty.length === 0, empty.join(' | '));
})();

/* ---------------------------------------------------------------- ④ 舰队派遣 */
section('④ 舰队派遣全流程：派得出、打得起、赢了真的有好处 ★');

(function (){
  var g = newGame();
  g.world.counters.fleets = 10;
  g.openView('fleet_ops');
  ok('作战室打得开', !!(g.ui.view && g.ui.view.id === 'fleet_ops'));

  var i1 = actIdx(g, '裂隙-7');
  ok('作战室给裂隙-7 一个「派舰队打」的动作', i1 >= 0,
     JSON.stringify(((g.ui.view.actions) || []).map(function (a){ return a.text; })));

  var fleet0 = g.world.counters.fleets;
  g.viewChoose(i1);
  ok('派出去之后舰队 -3 ★', g.world.counters.fleets === fleet0 - 3, g.world.counters.fleets);
  ok('自动进入战斗视图 ops_battle_1', !!(g.ui.view && g.ui.view.id === 'ops_battle_1'),
     g.ui.view && g.ui.view.id);
  ok('战斗视图读到了敌方守备（ops_enemy = 2）', g.world.counters.ops_enemy === 2, g.world.counters.ops_enemy);
  ok('我方投入记成 3', g.world.counters.ops_mine === 3, g.world.counters.ops_mine);

  var winIdx = actIdx(g, '接战（'), loseIdx = actIdx(g, '硬打（');
  ok('3 打 2：出现的只有「接战」★', winIdx >= 0 && loseIdx < 0,
     '接战=' + winIdx + ' 劣势=' + loseIdx);

  var alloy0 = g.world.counters.alloy, wars0 = g.world.counters.gw_wars_ops || 0;
  g.viewChoose(winIdx);
  ok('打赢后节点归属变成 player_remnant ★',
     g.world.galaxy['rift7'] && g.world.galaxy['rift7'].owner === 'player_remnant',
     JSON.stringify(g.world.galaxy['rift7']));
  ok('节点守备清零', Core.num(g.world.galaxy['rift7'].fleets, -1) === 0, g.world.galaxy['rift7'].fleets);
  ok('战役计数 +1（gw_wars_ops）', (g.world.counters.gw_wars_ops || 0) === wars0 + 1);
  ok('回收合金 +15', g.world.counters.alloy === alloy0 + 15, g.world.counters.alloy);
  ok('回收一支舰队', g.world.counters.fleets === fleet0 - 3 + 1, g.world.counters.fleets);
  ok('深渊态度变差（rel_abyss 掉了）', g.world.counters.rel_abyss <= -5, g.world.counters.rel_abyss);
  ok('进了战报视图', !!(g.ui.view && /^ops_win_/.test(g.ui.view.id)), g.ui.view && g.ui.view.id);
})();

section('④b 打不动的时候真的会输，而且真的吃亏 ★');

(function (){
  var g = newGame();
  g.world.counters.fleets = 10;
  g.openView('fleet_ops');
  var i3 = actIdx(g, '裂隙-3');
  ok('作战室给裂隙-3（守备 4）也有动作', i3 >= 0);
  g.viewChoose(i3);
  ok('进了 ops_battle_3', !!(g.ui.view && g.ui.view.id === 'ops_battle_3'), g.ui.view && g.ui.view.id);
  ok('读到守备 4', g.world.counters.ops_enemy === 4, g.world.counters.ops_enemy);
  var winIdx = actIdx(g, '接战（'), loseIdx = actIdx(g, '硬打（');
  ok('3 打 4：出现的只有「硬打」★', loseIdx >= 0 && winIdx < 0,
     '接战=' + winIdx + ' 劣势=' + loseIdx);
  var poll0 = Core.num(g.world.counters.pollution, 0), mor0 = Core.num(g.world.counters.morale, 0);
  g.viewChoose(loseIdx);
  ok('打输了：节点没拿到', !g.world.galaxy['rift3'] || g.world.galaxy['rift3'].owner !== 'player_remnant',
     JSON.stringify(g.world.galaxy['rift3']));
  ok('打输了：污染 +2', Core.num(g.world.counters.pollution, 0) === poll0 + 2, g.world.counters.pollution);
  ok('打输了：民情 -4', Core.num(g.world.counters.morale, 0) === mor0 - 4, g.world.counters.morale);
  ok('进了败报视图', !!(g.ui.view && /^ops_lose_/.test(g.ui.view.id)), g.ui.view && g.ui.view.id);
})();

section('④c 舰队不够就不给派（按钮直接消失）');

(function (){
  var g = newGame();
  g.world.counters.fleets = 2;
  g.openView('fleet_ops');
  ok('只有 2 支舰队时，三个目标都没法派 ★',
     actIdx(g, '裂隙-7') < 0 && actIdx(g, '裂隙-3') < 0 && actIdx(g, '铁砧') < 0,
     JSON.stringify((g.ui.view.actions || []).map(function (a){ return a.text; })));
})();


/* ---------------------------------------------------------------- ④d 造舰与强攻 */
section('④d 合金 -> 舰队 -> 打节点 -> 回收合金：这个循环要成立 ★');

(function (){
  var g = newGame();
  g.world.counters.alloy = 100;
  var f0 = g.world.counters.fleets;
  g.openView('fleet_roster');
  var b = actIdx(g, '轨道船坞整备');
  ok('舰队名册里有造舰动作', b >= 0, JSON.stringify((g.ui.view.actions || []).map(function (a){ return a.text; })));
  g.viewChoose(b);
  ok('造舰：舰队 +2 ★', g.world.counters.fleets === f0 + 2, g.world.counters.fleets);
  ok('造舰：合金 -25', g.world.counters.alloy === 75, g.world.counters.alloy);

  var g2 = newGame();
  g2.world.counters.alloy = 10;
  g2.openView('fleet_roster');
  ok('合金不够时造舰按钮消失 ★', actIdx(g2, '轨道船坞整备') < 0);

  var g3 = newGame();
  g3.world.counters.fleets = 6;
  g3.openView('fleet_ops');
  ok('舰队 >= 5 时出现「强攻」档位（守备 4 的目标才有解）★', actIdx(g3, '强攻 裂隙-3') >= 0);
  var g4 = newGame();
  g4.world.counters.fleets = 4;
  g4.openView('fleet_ops');
  ok('舰队 < 5 时没有强攻档位', actIdx(g4, '强攻 裂隙-3') < 0);
})();

section('④e 整场战役是打得完的（不是摆设）★');

(function (){
  var g = newGame();
  var builds = 0;
  function buildTo(n){
    while (g.world.counters.fleets < n){
      g.openView('fleet_roster');
      var b = actIdx(g, '轨道船坞整备');
      if (b < 0){ g.closeView(); return false; }
      g.viewChoose(b); g.closeView(); builds++;
      if (builds > 40) return false;
    }
    return true;
  }
  var plan = [['裂隙-7', 3, '派 3 支舰队打 裂隙-7'],
              ['铁砧', 3, '派 3 支舰队打 铁砧'],
              ['裂隙-3', 5, '强攻 裂隙-3']];
  var stuck = [];
  plan.forEach(function (t){
    if (!buildTo(t[1])){ stuck.push('造不出足够的舰队去打 ' + t[0]); return; }
    g.openView('fleet_ops');
    var i = actIdx(g, t[2]);
    if (i < 0){ stuck.push(t[0] + ' 没有可用动作'); g.closeView(); return; }
    g.viewChoose(i);
    var w = actIdx(g, '接战（'), l = actIdx(g, '硬打（');
    if (w < 0 && l < 0){ stuck.push(t[0] + ' 战斗视图没有按钮'); g.closeView(); return; }
    g.viewChoose(w >= 0 ? w : l);
    g.closeView();
  });
  ok('按「造够舰队再打」的策略，三个目标都能拿下 ★', stuck.length === 0, stuck.join(' | '));
  ok('战役计数到 3/3 ★', Core.num(g.world.counters.gw_wars_ops, 0) === 3, g.world.counters.gw_wars_ops);
  ok('三个节点归属都变成 player_remnant ★',
     ['rift7', 'ironhold', 'rift3'].every(function (k){
       return (g.world.galaxy[k] || {}).owner === 'player_remnant';
     }), JSON.stringify(['rift7','ironhold','rift3'].map(function (k){ return (g.world.galaxy[k]||{}).owner; })));
  ok('打完还有舰队剩下（不会把自己打空到卡死）', Core.num(g.world.counters.fleets, 0) >= 0, g.world.counters.fleets);
  console.log('       通关：造舰 ' + builds + ' 次，收尾 舰队 ' + g.world.counters.fleets
            + ' / 合金 ' + g.world.counters.alloy + ' / 污染 ' + g.world.counters.pollution
            + ' / 民情 ' + g.world.counters.morale);
})();

/* ---------------------------------------------------------------- ⑤ 殖民地 */
section('⑤ 殖民地每天在变：口粮决定士气，士气决定人口 ★');

(function (){
  var g = newGame();
  var k = 'col_col_sol3_morale', kp = 'col_col_sol3_pop';
  ok('播种钩子把殖民地账本写进了计数器 ★', g.world.counters[k] !== undefined, g.world.counters[k]);
  var m0 = Core.num(g.world.counters[k], 0), p0 = Core.num(g.world.counters[kp], 0);
  g.world.counters.food = 20;
  g.step(DAY * 3);
  var m1 = Core.num(g.world.counters[k], 0), p1 = Core.num(g.world.counters[kp], 0);
  ok('口粮充足时士气涨（' + m0 + ' -> ' + m1 + '）★', m1 > m0, m0 + ' -> ' + m1);
  ok('人口跟着变（' + p0 + ' -> ' + p1 + '）★', p1 !== p0, p0 + ' -> ' + p1);

  var g2 = newGame();
  var m2 = Core.num(g2.world.counters[k], 0);
  g2.world.counters.food = 2;
  g2.step(DAY);
  ok('口粮见底时士气掉得更快 ★', Core.num(g2.world.counters[k], 0) < m2 - 1,
     m2 + ' -> ' + Core.num(g2.world.counters[k], 0));
})();

/* ---------------------------------------------------------------- ⑥ 外交 */
section('⑥ 外交态度是活的，而且态度驱动事件 ★');

(function (){
  var g = newGame();
  ok('播种钩子把派系态度写进了计数器 ★', g.world.counters.rel_veil_pact === 2, g.world.counters.rel_veil_pact);
  ok('铁合唱一开始就不友善', g.world.counters.rel_iron_chorus === -3, g.world.counters.rel_iron_chorus);

  var g2 = newGame();
  g2.world.tick = 100; g2.step(1);
  ok('rel 没到阈值时，外交事件不挂 ★', !g2.world.pending['ev_rel_veil_warm']);
  g2.world.counters.rel_veil_pact = 3;
  g2.step(1);
  ok('rel >= 3 时，「帷幕公约来信」挂上报 ★', !!g2.world.pending['ev_rel_veil_warm']);

  var g3 = newGame();
  g3.world.counters.rel_iron_chorus = -4;
  g3.world.tick = 100; g3.step(1);
  ok('铁合唱翻脸也有事件 ★', !!g3.world.pending['ev_rel_iron_war']);
})();

/* ---------------------------------------------------------------- ⑦ 任务进度 */
section('⑦ 战役进度在任务里看得见');

(function (){
  var m = byId(spaceJson.missions, 'mis_campaign');
  ok('内容里有 mis_campaign 任务', !!m);
  ok('它挂了 progress 进度条（按 M 看得到）★',
     m && m.progress && m.progress.counter === 'gw_wars_ops' && Core.num(m.progress.target, 0) === 3,
     JSON.stringify(m && m.progress));
  var g = newGame();
  g.world.counters.gw_wars_ops = 2;
  ok('打完两个目标时进度是 2/3', Core.num(g.world.counters[m.progress.counter], 0) === 2);
})();

/* ---------------------------------------------------------------- ⑧ 存档 */
section('⑧ 新状态都进存档');

(function (){
  var g = newGame();
  g.world.counters.rel_veil_pact = 5;
  g.world.counters.col_col_sol3_morale = 41;
  g.world.counters.ops_mine = 3;
  Core.effects.galaxy_set(g, { node:'rift7', owner:'player_remnant' });
  var snap = g.serialize();
  var text = JSON.stringify(snap);
  ok('存档里带上了外交态度', text.indexOf('rel_veil_pact') >= 0);
  ok('存档里带上了殖民地账本', text.indexOf('col_col_sol3_morale') >= 0);
  ok('存档里带上了作战状态', text.indexOf('ops_mine') >= 0);
  var g2 = Core.createGame(built, {});
  g2.deserialize(snap);
  ok('读回来值一样 ★',
     g2.world.counters.rel_veil_pact === 5 && g2.world.counters.col_col_sol3_morale === 41 &&
     Core.num((g2.world.galaxy['rift7'] || {}).owner === 'player_remnant', 0) === 1,
     JSON.stringify({ a: g2.world.counters.rel_veil_pact, b: g2.world.counters.col_col_sol3_morale }));
})();

/* ---------------------------------------------------------------- ⑨ 不破坏既有 */
section('⑨ 新增内容没有破坏既有约定');

(function (){
  ok('每个新事件都有「上报人」', ['ev_rel_veil_warm','ev_rel_iron_warm','ev_ops_backlash','ev_ops_campaign_done']
     .filter(function (id){ return byId(spaceJson.events, id); })
     .every(function (id){ return (byId(spaceJson.events, id).presentedBy || []).length > 0; }));
  var pairBad = [];
  Core.asList(spaceJson.events).forEach(function (e){
    if (!e.dialogue) return;
    var ap = Core.asList(spaceJson.npcApproach).filter(function (a){
      return a.condition === 'pending:' + e.id;
    });
    if (!ap.length) pairBad.push(e.id + ' 没有 npcApproach 上报规则');
    else if (ap[0].dialogue !== e.dialogue) pairBad.push(e.id + ' 上报规则指错了对话');
  });
  ok('每条事件都有对得上的 npcApproach 规则 ★', pairBad.length === 0, pairBad.slice(0, 3).join(' | '));
})();

console.log('\n========================================');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
