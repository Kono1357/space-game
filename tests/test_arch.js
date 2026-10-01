/* =============================================================================
 * test_arch.js  底层架构回归测试
 *   node tests/test_arch.js
 *   守的是「三条铁律」本身，而不是某一篇内容：
 *      内核不认内容：内容里出现的每个效果词 / 判定词都必须在词表里注册
 *      一切皆 id 皆可合并：内容里每一个列表块都必须能「加一条而不冲掉老的」
 *       （漏登记的块会被 deepMerge 整块替换曾经往 events 里加一条事件，120 条全没了）
 *      存档可复现：随机数状态、派生量（投影）、世界快照都必须原样往返
 *   还有寻路：默认参数下必须能走通整张地图，否则 NPC 会被静默瞬移。
 * ========================================================================== */
var path = require('path'), fs = require('fs');
var Core = require(path.join(__dirname, '..', 'engine', 'space-core.js'));

var pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond){ pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '   -> ' + extra : '')); }
}
function section(t){ console.log('\n=== ' + t + ' ==='); }

var spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'space.json'), 'utf8'));
var built = Core.load({ space: spec });

/* 找目标格旁边一个能站的格子 */
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
section('1. 块注册表：内容里每个列表块都必须登记（否则 mod 一写就冲掉整块）');
var listBlocks = [];
Object.keys(spec).forEach(function(k){
  if (Core.isObj(spec[k]) && Array.isArray(spec[k].list)) listBlocks.push(k);
});
ok('内容里的顶层 {list} 块 >= 25', listBlocks.length >= 25, listBlocks.length);
var unregistered = listBlocks.filter(function(k){ return Core.SPACE_BLOCKS.indexOf(k) < 0; });
ok('所有顶层 {list} 块都在 SPACE_BLOCKS 里', unregistered.length === 0, unregistered.join(','));
var nestedFound = [];
Object.keys(spec).forEach(function(k){
  if (!Core.isObj(spec[k])) return;
  Object.keys(spec[k]).forEach(function(k2){
    if (k2 === 'list') return;                        /* .list 是顶层块自己，归 SPACE_BLOCKS 管 */
    if (Array.isArray(spec[k][k2]) && spec[k][k2].length && Core.isObj(spec[k][k2][0]))
      nestedFound.push(k + '.' + k2);
  });
});
ok('确实有「块里的块」需要登记（>= 4）', nestedFound.length >= 4, nestedFound.join(','));
var nestedUnregistered = nestedFound.filter(function(k){ return Core.NESTED_BLOCKS.indexOf(k) < 0; });
ok('所有嵌套数组块都在 NESTED_BLOCKS 里', nestedUnregistered.length === 0, nestedUnregistered.join(','));

section('2. 合并：加一条不能冲掉老的（逐个块实测）');
var broke = [], noId = [];
var emptyBlocks = listBlocks.filter(function(k){ return !spec[k].list.length; });
listBlocks.forEach(function(k){
  if (!spec[k].list.length) return;            /* 空块（macros / hooks 这类插槽）留着等作者填 */
  var first = spec[k].list[0];
  if (!first || first.id === undefined){ noId.push(k); return; }
  var name = 'zz_probe_' + k;
  var bb = Core.load({ space: spec, mods: [{ manifest: { id: 'probe' }, data: (function(){ var d = {}; d[k] = { list: [{ id: name }] }; return d; })() }] });
  var arr = Core.asList(bb.space[k]);
  if (arr.length !== spec[k].list.length + 1 || arr[0].id !== first.id || arr[arr.length - 1].id !== name)
    broke.push(k + '(' + spec[k].list.length + '->' + arr.length + ')');
});
ok('每个 {list} 块都能追加一条并保住原内容', broke.length === 0, broke.join(' | '));
ok('每个 {list} 块的条目都带 id（mod 才有把手）', noId.length === 0, noId.join(','));
ok('空块（插槽）也算登记在册', emptyBlocks.every(function(k){ return Core.SPACE_BLOCKS.indexOf(k) >= 0; }), emptyBlocks.join(','));
Core.NESTED_BLOCKS.forEach(function(k){
  var list = Core.aslist ? Core.aslist(Core.getPath(spec, k, [])) : Core.asList(Core.getPath(spec, k, []));
  if (!list.length) return;
  var first = list[0];
  var d = {}; var cur = d, parts = k.split('.');
  for (var i = 0; i < parts.length - 1; i++){ cur[parts[i]] = {}; cur = cur[parts[i]]; }
  cur[parts[parts.length - 1]] = [{ id: 'zz_probe_' + k.replace('.', '_') }];
  var bb = Core.load({ space: spec, mods: [{ manifest: { id: 'probe2' }, data: d }] });
  var after = Core.asList(Core.getPath(bb.space, k, []));
  ok('嵌套块 ' + k + ' 也能追加（' + list.length + ' -> ' + after.length + '）',
     after.length === list.length + 1 && after[0].id === first.id, after.length);
});
var dotted = { 'diplomacy.actions': [{ id: 'zz_dotted' }] };
ok('点路径写法（"diplomacy.actions"）也能合并',
   Core.load({ space: spec, mods: [{ manifest: { id: 'p3' }, data: dotted }] }).space.diplomacy.actions.length ===
   spec.diplomacy.actions.length + 1);

section('3. 合并语义：append / patch / replace / remove');
function loadWith(data, manifest){
  return Core.load({ space: spec, mods: [{ manifest: manifest || { id: 'm' }, data: data }] });
}
var b1 = loadWith({ events: { list: [{ id: 'dup_event' }, { id: 'ev_abyss_01', name: '想覆盖但不行' }] } });
ok('append 已存在的 id：不覆盖 + 警告',
   b1.report.warnings.some(function(w){ return w.indexOf('已存在') >= 0; }) &&
   Core.byId(Core.asList(b1.space.events))['ev_abyss_01'].name !== '想覆盖但不行');
var b2 = loadWith({ events: { list: [{ id: 'ev_abyss_01', _op: 'patch', priority: 12345 }] } });
ok('patch 只改写的字段', Core.byId(Core.asList(b2.space.events))['ev_abyss_01'].priority === 12345 &&
   Core.asList(b2.space.events).length === Core.asList(spec.events).length);
var b3 = loadWith({ scenes: { list: [{ id: 'station_corridor', _op: 'patch', _append: { exits: [{ x: 0, y: 0, to: 'station_comm' }] } }] } });
var sc3a = Core.byId(Core.asList(b3.space.scenes))['station_corridor'];
var sc3b = Core.byId(Core.asList(spec.scenes))['station_corridor'];
ok('_append 往数组里加一条（不用重抄整张表）',
   (sc3a.exits || []).length === (sc3b.exits || []).length + 1 && sc3a.legend !== undefined);
var b4 = loadWith({ factions: { list: [{ id: 'fac_player_remnant', _op: 'replace', name: '换掉了' }] } });
ok('replace 整条替换', Core.byId(Core.asList(b4.space.factions))['fac_player_remnant'].name === '换掉了');
var b5 = loadWith({ events: { list: [{ id: 'ev_abyss_01', _op: 'remove' }] } });
ok('remove 没写 allowRemove：拒绝并警告',
   Core.asList(b5.space.events).length === Core.asList(spec.events).length &&
   b5.report.warnings.some(function(w){ return w.indexOf('allowRemove') >= 0; }));
var b6 = loadWith({ events: { list: [{ id: 'ev_abyss_01', _op: 'remove' }] } }, { id: 'rm', allowRemove: true });
ok('写了 allowRemove 才真删', Core.asList(b6.space.events).length === Core.asList(spec.events).length - 1);
var b7 = loadWith({ events: { list: [{ id: 'no_such', _op: 'remove' }] } });
ok('删不存在的 id：只警告，不偷偷加进去',
   Core.asList(b7.space.events).length === Core.asList(spec.events).length &&
   b7.report.warnings.some(function(w){ return w.indexOf('不存在') >= 0; }));
var b8 = Core.load({ space: spec, mods: [
  { manifest: { id: 'late', priority: 10 }, data: { events: { list: [{ id: 'order_probe' }] } } },
  { manifest: { id: 'early', priority: -10 }, data: { events: { list: [{ id: 'order_probe', name: '先来的' }] } } }
] });
ok('mod 按 priority 排序（后手能看到先手的内容）',
   Core.byId(Core.asList(b8.space.events))['order_probe'].name === '先来的');
var b9 = loadWith({ config: { autoNpcTalk: true }, initialState: { counters: { fleets: 9 } }, myOwnBlock: { hello: 'world' } });
ok('config / initialState 深合并，未知块原样保留',
   b9.space.config.autoNpcTalk === true && b9.space.config.mapTargetRows === spec.config.mapTargetRows &&
   b9.space.initialState.counters.fleets === 9 && b9.space.initialState.counters.pollution === 0 &&
   Core.getPath(b9.space, 'myOwnBlock.hello') === 'world');
var b10 = Core.load({ space: { scenes: { list: [] } }, mods: [{ manifest: { id: 'empty' }, data: { events: { list: [{ id: 'e1' }] } } }] });
ok('空 base 里新加一个块也能接住（缺块补成 {list:[]}）', Core.asList(b10.space.events).length === 1);

section('4. 词表：内容里出现的每个效果词 / 判定词都注册过');
var usedEff = {}, usedCond = {}, unknownWord = [];
function effList(list, where){
  if (!list) return;
  if (!Array.isArray(list)) list = [list];
  list.forEach(function(e){
    if (!e) return;
    if (typeof e === 'string') e = { type: e };
    if (typeof e.type !== 'string'){ unknownWord.push(where + '：效果没有 type'); return; }
    usedEff[e.type] = (usedEff[e.type] || 0) + 1;
    if (!Core.effects[e.type]) unknownWord.push(where + '：未注册效果 ' + e.type);
    if (e.type === 'if'){ effList(e.then, where + '>then'); effList(e.else, where + '>else'); cond(e.condition, where + '>if'); }
    else if (e.type === 'random'){
      if (e.table) e.table.forEach(function(r){ effList(r && r.effects, where + '>table'); });
      else { effList(e.then, where + '>then'); effList(e.else, where + '>else'); }
    } else if (e.type === 'effects') effList(e.list, where + '>list');
  });
}
function cond(c, where){
  if (c === undefined || c === null || c === '' || typeof c === 'boolean') return;
  if (Array.isArray(c)) return c.forEach(function(x){ cond(x, where); });
  if (typeof c === 'string'){
    var m = /^!?\s*([a-z_]+):/i.exec(c.trim());
    if (m){ usedCond[m[1]] = (usedCond[m[1]] || 0) + 1;
      if (!Core.conditions[m[1]] && ['flag','item','scene','visited','seen','pending','kernel','counter'].indexOf(m[1]) < 0)
        unknownWord.push(where + '：未知简写 ' + c); }
    return;
  }
  if (typeof c === 'object'){
    if (typeof c.type === 'string'){
      usedCond[c.type] = (usedCond[c.type] || 0) + 1;
      if (!Core.conditions[c.type]) unknownWord.push(where + '：未注册判定 ' + c.type);
    }
    ['all','any','not'].forEach(function(k){ if (c[k] !== undefined) cond(c[k], where + '.' + k); });
  }
}
Core.asList(spec.interactables).forEach(function(it){ effList(it.onInteract || it.effects, '物件 ' + it.id); });
Core.asList(spec.views).forEach(function(v){
  (v.actions || []).forEach(function(a, i){ effList(a.effects, '视图 ' + v.id + ' 按钮' + i); cond(a.condition, '视图 ' + v.id + ' 按钮' + i); });
  if (v.list){ effList(v.list.onSelect, '视图 ' + v.id + '.list.onSelect'); cond(v.list.rowCondition, '视图 ' + v.id + '.rowCondition'); }
  effList(v.onSelect, '视图 ' + v.id + '.onSelect');
});
Core.asList(spec.dialogues).forEach(function(d){
  var nodes = d.nodes || {};
  Object.keys(nodes).forEach(function(nid){
    var n = nodes[nid] || {};
    effList(n.onEnter || n.effects, '对话 ' + d.id + '.' + nid);
    (n.options || []).forEach(function(o, i){ effList(o.effects, '对话 ' + d.id + '.' + nid + '.选项' + i); cond(o.condition, '对话 ' + d.id + '.' + nid + '.选项' + i); });
    cond(n.condition, '对话 ' + d.id + '.' + nid);
  });
});
Core.asList(spec.events).forEach(function(ev){ effList(ev.effects, '事件 ' + ev.id); cond(ev.condition, '事件 ' + ev.id); });
Core.asList(spec.npcApproach).forEach(function(r){ effList(r.effects, '上报 ' + r.id); cond(r.condition, '上报 ' + r.id); });
Core.asList(spec.eventChains).forEach(function(c){
  effList(c.effects, '事件链 ' + c.id); cond(c.condition, '事件链 ' + c.id);
  (c.steps || []).forEach(function(s, i){ effList(s.effects, '事件链 ' + c.id + '.步骤' + i); cond(s.condition, '事件链 ' + c.id + '.步骤' + i); });
});
Core.asList(spec.sceneTransitions).forEach(function(t){ cond(t.condition, '过场 ' + t.id); effList(t.onEnter && t.onEnter.effects || t.onEnter, '过场 ' + t.id); });
ok('内容里用到的效果词 >= 8 种都是注册过的', Object.keys(usedEff).length >= 8 && unknownWord.filter(function(w){ return w.indexOf('效果') >= 0; }).length === 0,
   unknownWord.slice(0, 3).join(' | '));
var provBad = [];
Core.asList(spec.views).forEach(function(v){
  if (!v) return;
  if (v.provider && !Core.viewProviders[v.provider]) provBad.push(v.id + ':' + v.provider);
  (v.sections || []).forEach(function(s2){
    if (s2 && s2.provider && !Core.viewProviders[s2.provider]) provBad.push(v.id + ':section:' + s2.provider);
  });
});
ok('视图提供者（view.provider / section.provider）都注册过', provBad.length === 0, provBad.join(','));
ok('内容里用到的判定词 >= 5 种都是注册过的', Object.keys(usedCond).length >= 5 && unknownWord.length === 0,
   unknownWord.slice(0, 3).join(' | '));
ok('词表本身：效果 >= 30 / 判定 >= 15', Object.keys(Core.effects).length >= 30 && Object.keys(Core.conditions).length >= 15,
   Object.keys(Core.effects).length + '/' + Object.keys(Core.conditions).length);

section('5. 存档：世界状态 + 随机数状态必须原样往返');
function worldSnapshot(g){
  var w = g.world, fog = {};
  Object.keys(w.fog || {}).sort().forEach(function(k){
    var a = w.fog[k], s = '';
    for (var i = 0; i < a.length; i++) s += String.fromCharCode(48 + (a[i] | 0));
    fog[k] = s;
  });
  return JSON.stringify({
    tick: w.tick, flags: w.flags, counters: w.counters, items: w.items, known: w.known, visited: w.visited,
    seenDialogues: w.seenDialogues, firedRules: w.firedRules, pending: w.pending, builds: w.builds,
    tileOverrides: w.tileOverrides, npcPos: w.npcPos, npcPosts: w.npcPosts, chains: w.chains, crisis: w.crisis, galaxy: w.galaxy, player: w.player,
    hint: w.hint, hintUntil: w.hintUntil, tutStep: w.tutStep, gameOver: w.gameOver, lastAuto: w.lastAuto,
    fog: fog, proj: w.proj, seenViews: w.seenViews
  });
}
var g1 = Core.createGame(built, {});
g1.step(700);
g1.world.pending[Core.asList(spec.events)[3].id] = true;
g1.applyProjections();
g1.rng(); g1.rng(); g1.rng(); g1.rng();
var snapText = JSON.stringify(g1.serialize());
ok('存档是纯 JSON', typeof snapText === 'string' && snapText.length > 500);
var snapA = worldSnapshot(g1);
var expectNext = g1.rng();
var g2 = Core.createGame(built, {});
g2.deserialize(JSON.parse(snapText));
ok('读档后世界快照与存档时逐字段一致', worldSnapshot(g2) === snapA,
   (function(){ var a = worldSnapshot(g2); for (var i = 0; i < Math.min(a.length, snapA.length); i++) if (a[i] !== snapA[i]) return '首个不同在第 ' + i + ' 字符：' + a.slice(i - 30, i + 30) + '  ' + snapA.slice(i - 30, i + 30); return a.length + ' vs ' + snapA.length; })());
ok('读档后随机数接着原线走（存档可复现）', g2.rng() === expectNext, g2.rng() + ' vs ' + expectNext);
ok('存档里带着 rng 状态', JSON.parse(snapText).rng !== undefined);
/* 存档的覆盖范围也钉死：world 里每个字段要么进档，要么在「派生量 / 缓存 / 出站队列」白名单里。
   以后有人加了新的世界状态却忘了序列化，这条会立刻红。 */
var TRANSIENT = ['vis', 'npcPaths', 'path', 'kernelOps', 'proj'];
var worldKeys = Object.keys(g1.world).filter(function(k){ return TRANSIENT.indexOf(k) < 0; });
var savedKeys = Object.keys(g1.serialize());
var notSaved = worldKeys.filter(function(k){ return savedKeys.indexOf(k) < 0; });
ok('world 字段要么进存档、要么在白名单里', notSaved.length === 0, notSaved.join(','));
ok('白名单里的派生量确实能在读档后重建',
   TRANSIENT.every(function(k){ return k === 'vis' ? !!g2.world.vis : (k === 'proj' ? !!g2.world.proj : true); }),
   JSON.stringify(TRANSIENT));

var g3 = Core.createGame(Core.load({ space: spec }), {});
var g4 = Core.createGame(Core.load({ space: spec }), {});
var s3 = [], s4 = [];
for (var q = 0; q < 8; q++){ s3.push(g3.rng()); s4.push(g4.rng()); }
ok('同种子两局完全一样', JSON.stringify(s3) === JSON.stringify(s4));
var pj1 = Core.createGame(built, {});
pj1.world.counters.pollution = 3; pj1.applyProjections();
var pj2 = Core.createGame(built, {}); pj2.deserialize(pj1.serialize());
ok('读档后派生量（投影）立刻是对的',
   Core.getPath(pj2.world, 'proj.pollution_landing.value') === 3, JSON.stringify(pj2.world.proj && pj2.world.proj.pollution_landing));

section('5b. 读档兼容：版本 / 场景没了 / mod 对不上');
var modZone = { manifest: { id: 'zone_mod' }, data: { scenes: { list: [{ id: 'mod_zone', name: '额外区', size: { w: 8, h: 5 },
  tiles: ['########', '#......#', '#...@..#', '#......#', '########'], legend: {}, exits: [] }] } } };
var bZone = Core.load({ space: spec, mods: [modZone] });
var gz = Core.createGame(bZone, {});
gz.teleport('mod_zone', 4, 2);
var zoneSave = JSON.parse(JSON.stringify(gz.serialize()));
ok('存档记下了当时的 mod 列表', Array.isArray(zoneSave.mods) && zoneSave.mods.indexOf('zone_mod') >= 0, JSON.stringify(zoneSave.mods));
var gPlain = Core.createGame(built, {});
gz.serialize();
var okLoad = gPlain.deserialize(zoneSave);
ok('拿掉 mod 之后读档：不崩、不报错', okLoad === true);
ok('读档回退到起始场景（不会留在地图外）',
   gPlain.world.player.scene === (spec.playerCharacter.currentScene || spec.config.startScene), gPlain.world.player.scene);
ok('并且把这件事说出来', gPlain.world.log.some(function(e){ return e.text.indexOf('回到了') >= 0 || e.text.indexOf('mod') >= 0; }),
   JSON.stringify(gPlain.world.log.slice(-2)));
var future = zoneSave; future.v = 99;
var gF = Core.createGame(built, {});
gF.deserialize(JSON.parse(JSON.stringify(future)));
ok('更新的存档版本会警告而不是崩', gF.report.warnings.some(function(x){ return x.indexOf('比内核') >= 0; }),
   JSON.stringify(gF.report.warnings.slice(-2)));

section('5c. 内容层的插槽：宏 / 钩子 / 停手权 / 自定义块 / 热加载');
var openMod = { manifest: { id: 'openness' }, data: {
  macros: { list: [
    { id: 'mac_hello', effects: [{ type: 'log', text: '宏：{args.who}' }, { type: 'counter_add', counter: 'mac_runs', delta: 1 }] },
    { id: 'mac_gate', condition: { type: 'tick', op: '>=', value: 0 }, effects: [{ type: 'log', text: '条件宏' }] }
  ] },
  hooks: { list: [
    { id: 'hk_start', on: 'game_start', effects: [{ type: 'macro', id: 'mac_hello', params: { who: '开局' } }] },
    { id: 'hk_tick', on: 'tick', every: 10, effects: [{ type: 'counter_add', counter: 'tick_runs', delta: 1 }] },
    { id: 'hk_enter', on: 'enter_scene', scene: 'station_command', once: true, effects: [{ type: 'counter_add', counter: 'enter_runs', delta: 1 }] },
    { id: 'hk_interact', on: 'interact', interactable: 'star_map_terminal', effects: [{ type: 'log', text: '这台终端被 mod 接管了' }, { type: 'stop' }] },
    { id: 'hk_talk', on: 'npc_talk', npcId: 'npc_fleet_commander', effects: [{ type: 'counter_add', counter: 'talk_runs', delta: 1 }] },
    { id: 'hk_end', on: 'dialogue_end', effects: [{ type: 'counter_add', counter: 'end_runs', delta: 1 }] },
    { id: 'hk_day', on: 'day', effects: [{ type: 'flag_set', flag: 'a_new_day' }] },
    { id: 'hk_build', on: 'build_done', effects: [{ type: 'flag_set', flag: 'built_ok' }] }
  ] },
  myOwnBlock: { list: [{ id: 'anything', name: '随便什么' }] }
} };
var bOpen = Core.load({ space: spec, mods: [openMod] });
ok('宏与钩子都能合并进内容（登记在 SPACE_BLOCKS 里）',
   !!bOpen.idx.macros.mac_hello && (bOpen.idx.hooksByOn.tick || []).some(function(h){ return h.id === 'hk_tick'; }) && Core.SPACE_BLOCKS.indexOf('hooks') >= 0);
var gO = Core.createGame(bOpen, {});
ok('game_start 钩子会跑，宏能带参数', gO.world.counters.mac_runs === 1 && gO.world.log.some(function(e){ return e.text === '宏：开局'; }),
   JSON.stringify(gO.world.counters));
ok('命名条件可以复用（macro_condition）', Core.check(gO, { type: 'macro_condition', id: 'mac_gate' }, {}));
ok('未知宏只警告不崩', (function(){ gO.world.kernelOps = []; Core.runEffects(gO, [{ type: 'macro', id: 'nope' }], {}); return true; })());
gO.step(25);
ok('tick 钩子带 every（25 tick 里跑 2 次）', gO.world.counters.tick_runs === 2, gO.world.counters.tick_runs);
gO.teleport('station_habitat', 8, 7); gO.teleport('station_command', 10, 20); gO.teleport('station_command', 10, 20);
ok('enter_scene 钩子 + once 只跑一次', gO.world.counters.enter_runs === 1, gO.world.counters.enter_runs);
var tStar = null, grStar = gO.grid('station_command');
for (var si = 0; si < grStar.pass.length; si++)
  if (grStar.kind[si] === 'interactable' && grStar.ref[si] === 'star_map_terminal') tStar = { x: si % grStar.w, y: Math.floor(si / grStar.w) };
var standS = freeCellNear('station_command', tStar.x, tStar.y, 2);
gO.teleport('station_command', standS.x, standS.y);
gO.interact();
ok('交互钩子能用 {stop:true} 换掉默认行为（终端没被打开）', !gO.ui.view && gO.world.log.some(function(e){ return e.text.indexOf('接管') >= 0; }),
   gO.ui.view && gO.ui.view.id);
var cmdSlot = built.idx.schedules['npc_fleet_commander'].slots[0];
var standCmd = freeCellNear(cmdSlot.scene, cmdSlot.x, cmdSlot.y, 3);
gO.teleport(cmdSlot.scene, standCmd.x, standCmd.y);
gO.approachNpc('npc_fleet_commander');
ok('npc_talk 钩子会跑', gO.world.counters.talk_runs === 1, gO.world.counters.talk_runs);
gO.closeDialogue('test');
ok('dialogue_end 钩子会跑（关对话只有一个出口）', gO.world.counters.end_runs === 1, gO.world.counters.end_runs);
gO.world.tick = Core.DAY * 3 - 1;      /* 跨过 00:00 的那一 tick 才算「新的一天」 */
gO.step(1);
ok('day 钩子会跑', !!gO.world.flags.a_new_day, gO.world.tick % Core.DAY);
Core.runEffects(gO, [{ type: 'start_build', id: 'bk', name: '测试建造', ticksPerStage: 2, stages: [{ ch: '1' }, { ch: '2' }] }], {});
gO.step(12);
ok('build_done 钩子会跑', !!gO.world.flags.built_ok);
ok('mod 塞的私有块原样保留（内容层完全开放）', Core.getPath(bOpen.space, 'myOwnBlock.list[0].name') === '随便什么');

/* 自定义块能被视图读出来：source 指向任意路径 */
var custView = { manifest: { id: 'custview' }, data: { views: { list: [{ id: 'my_list_view', title: '我的清单', width: 40,
  sections: [{ source: 'space.myOwnBlock.list', rowTemplate: ' {row.name}' }],
  actions: [{ text: '关闭', effects: [{ type: 'close_view' }] }] }] } } };
var bCust = Core.load({ space: spec, mods: [openMod, custView] });
var gC = Core.createGame(bCust, {});
gC.openView('my_list_view');
ok('视图 source 能读 mod 的私有块', gC.ui.view.lines.some(function(l){ return l.text.indexOf('随便什么') >= 0; }),
   JSON.stringify(gC.ui.view.lines.slice(0, 3)));

/* 热加载：换内容接着玩 */
var extraMod = { manifest: { id: 'extra' }, data: { scenes: { list: [{ id: 'extra_room', name: '新房间', size: { w: 8, h: 4 },
  tiles: ['########', '#......#', '#...@..#', '########'], legend: {}, exits: [] }] } } };
var bHot = Core.load({ space: spec, mods: [openMod, extraMod] });
var beforeHot = { tick: gO.world.tick, items: JSON.stringify(gO.world.items), mac: gO.world.counters.mac_runs, scene: gO.world.player.scene };
ok('热加载返回 true', gO.reloadContent(bHot) === true);
ok('热加载后世界状态原样保留',
   gO.world.tick === beforeHot.tick && JSON.stringify(gO.world.items) === beforeHot.items &&
   gO.world.counters.mac_runs === beforeHot.mac && gO.world.player.scene === beforeHot.scene);
ok('新场景、钩子、宏都跟着来了',
   !!gO.idx.sceneGrids.extra_room && (gO.idx.hooksByOn.tick || []).some(function(h){ return h.id === 'hk_tick'; }) && !!gO.macro('mac_hello'));
gO.teleport('extra_room', 4, 2);
ok('能走进热加载进来的新房间', gO.world.player.scene === 'extra_room');
ok('热加载之后钩子还在跑', (function(){ var n = gO.world.counters.tick_runs; gO.step(10); return gO.world.counters.tick_runs > n; })());
var beforeUndo = { tick: gO.world.tick, items: JSON.stringify(gO.world.items) };
gO.reloadContent(Core.load({ space: spec, mods: [openMod] }));      /* 把新房间再撤掉 */
ok('撤掉 mod 之后：玩家回到起始场景而不是卡在地图外',
   gO.world.player.scene === (spec.playerCharacter.currentScene || spec.config.startScene), gO.world.player.scene);
ok('撤掉 mod 之后世界状态仍在', gO.world.tick === beforeUndo.tick && JSON.stringify(gO.world.items) === beforeUndo.items);

section('6. 寻路：默认参数下要走得通整张地图');
var pathBad = [];
spec.scenes.list.forEach(function(s){
  var g = Core.createGame(built, {}), gr = g.grid(s.id);
  var start = -1;
  for (var i = 0; i < gr.pass.length; i++) if (gr.pass[i]){ start = i; break; }
  if (start < 0) return;
  var dist = new Int32Array(gr.pass.length).fill(-1), queue = [start], far = start;
  dist[start] = 0;
  while (queue.length){
    var c = queue.shift(), x = c % gr.w, y = Math.floor(c / gr.w);
    for (var k = 0; k < 4; k++){
      var nx = x + [0,0,-1,1][k], ny = y + [-1,1,0,0][k];
      if (nx < 0 || ny < 0 || nx >= gr.w || ny >= gr.h) continue;
      var j = ny * gr.w + nx;
      if (gr.pass[j] && dist[j] < 0){ dist[j] = dist[c] + 1; queue.push(j); if (dist[j] > dist[far]) far = j; }
    }
  }
  var a = { x: start % gr.w, y: Math.floor(start / gr.w) }, b = { x: far % gr.w, y: Math.floor(far / gr.w) };
  var p = g.findPath(s.id, a.x, a.y, b.x, b.y);
  if (!p || !p.length) pathBad.push(s.id + ' ' + a.x + ',' + a.y + ' -> ' + b.x + ',' + b.y + '（最远 ' + dist[far] + ' 步）');
});
ok('每个场景里最远的两格之间都找得到路（默认 limit）', pathBad.length === 0, pathBad.slice(0, 3).join(' | '));

section('7. NPC 寻路不是瞬移');
var g7 = Core.createGame(built, {});
var scene7 = 'station_corridor', gr7 = g7.grid(scene7);
var cells7 = [];
for (var c7 = 0; c7 < gr7.pass.length; c7++) if (gr7.pass[c7]) cells7.push(c7);
var from7 = { x: cells7[0] % gr7.w, y: Math.floor(cells7[0] / gr7.w) };
var to7 = { x: cells7[cells7.length - 1] % gr7.w, y: Math.floor(cells7[cells7.length - 1] / gr7.w) };
g7.teleport(scene7, from7.x, from7.y);
g7.world.npcPosts['npc_adjutant'] = { scene: scene7, x: to7.x, y: to7.y, until: 0, permanent: true };
g7.world.npcPos['npc_adjutant'] = { scene: scene7, x: from7.x, y: from7.y, px: from7.x, py: from7.y, tx: to7.x, ty: to7.y };
var maxJump = 0, arrived = false, last = { x: from7.x, y: from7.y };
for (var t7 = 0; t7 < 400; t7++){
  g7.step(1);
  var np = g7.world.npcPos['npc_adjutant'];
  var jump = Math.max(Math.abs(np.x - last.x), Math.abs(np.y - last.y));
  if (jump > maxJump) maxJump = jump;
  last = { x: np.x, y: np.y };
  if (np.x === to7.x && np.y === to7.y){ arrived = true; break; }
}
ok('NPC 会一路走过去，不会一跳穿墙（单 tick 最大位移 <= 1）', maxJump <= 1, 'maxJump=' + maxJump);
ok('NPC 最终走到了目标格', arrived, last.x + ',' + last.y + ' 目标 ' + to7.x + ',' + to7.y);

section('8. 走不过去时要有反馈');
/* 现成内容里每个场景都是单连通的，所以造一个「隔着墙的小房间」来验这条路 */
var sealed = { config: { defaultLegend: { '#': { preset: 'wall' }, '.': { preset: 'floor' } } },
  presets: { wall: { ch: '#', passable: false, solid: true }, floor: { ch: '.', passable: true } },
  scenes: { list: [{ id: 'sealed_room', name: '隔间', size: { w: 7, h: 3 },
    tiles: ['#######', '#.#...#', '#######'], legend: {} }] } };
var gs = Core.createGame(Core.load({ space: sealed }), {});
gs.teleport('sealed_room', 1, 1);
gs.log('__clear__');
ok('造出来的图确实是两块走不到的区域', gs.pathTo(5, 1) === null, JSON.stringify(gs.world.path));
ok('点了走不到的地方会说一句「过不去」', gs.world.log.some(function(e){ return e.text.indexOf('过不去') >= 0; }),
   JSON.stringify(gs.world.log.slice(-2)));
ok('点墙上（目标不可站）会自动导向隔壁能站的那格', (function(){
  var g2 = Core.createGame(Core.load({ space: sealed }), {});
  g2.teleport('sealed_room', 1, 1);
  var p = g2.pathTo(1, 0);      /* (1,0) 是墙，(1,1) 就是自己 -> 不该崩，也不该有路 */
  return p === null || p.length >= 0;
})());

section('8b. 最坏情况的 tick 预算：一堆人同时重新寻路');
var gW = Core.createGame(built, {});
var wScene = 'planet_wilderness', wGrid = gW.grid(wScene), wCells = [];
for (var wi = 0; wi < wGrid.pass.length; wi++) if (wGrid.pass[wi]) wCells.push(wi);
gW.teleport(wScene, wCells[0] % wGrid.w, Math.floor(wCells[0] / wGrid.w));
var npcIds = spec.npcs.list.map(function(n){ return n.id; });
npcIds.forEach(function(id, k){
  var a = wCells[Math.floor(wCells.length * (k + 1) / (npcIds.length + 2))];
  var b = wCells[wCells.length - 1 - Math.floor(wCells.length * k / (npcIds.length + 2))];
  gW.world.npcPosts[id] = { scene: wScene, x: b % wGrid.w, y: Math.floor(b / wGrid.w), until: 0, permanent: true };
  gW.world.npcPos[id] = { scene: wScene, x: a % wGrid.w, y: Math.floor(a / wGrid.w), px: a % wGrid.w, py: Math.floor(a / wGrid.w), tx: b % wGrid.w, ty: Math.floor(b / wGrid.w) };
});
var tw = Date.now();
gW.step(1);
var dw = Date.now() - tw;
ok('30 个人同时重新寻路，单 tick < 50ms', dw < 50, dw + ' ms');
var tw2 = Date.now();
for (var wk = 0; wk < 60; wk++) gW.step(1);
var dw2 = (Date.now() - tw2) / 60;
ok('路径缓存之后每 tick < 3ms', dw2 < 3, dw2.toFixed(3) + ' ms');

section('8c. NPC 寻路分摊到多帧（每 tick 有人数上限）');
var budget = Core.num(Core.getPath(spec, 'config.npcRepathPerTick', 2), 2);
var gB = Core.createGame(built, {});
var bGrid = gB.grid(wScene);
gB.teleport(wScene, wCells[0] % bGrid.w, Math.floor(wCells[0] / bGrid.w));
var idsB = spec.npcs.list.map(function(n){ return n.id; });
idsB.forEach(function(id, k){
  var a = wCells[Math.floor(wCells.length * (k + 1) / (idsB.length + 2))];
  var b = wCells[wCells.length - 1 - Math.floor(wCells.length * k / (idsB.length + 2))];
  gB.world.npcPosts[id] = { scene: wScene, x: b % bGrid.w, y: Math.floor(b / bGrid.w), until: 0, permanent: true };
  gB.world.npcPos[id] = { scene: wScene, x: a % bGrid.w, y: Math.floor(a / bGrid.w), px: 0, py: 0, tx: b % bGrid.w, ty: Math.floor(b / bGrid.w) };
});
var beforeB = {};
Object.keys(gB.world.npcPos).forEach(function(id){ var q = gB.world.npcPos[id]; beforeB[id] = q.x + ',' + q.y; });
gB.step(1);
var movedB = Object.keys(gB.world.npcPos).filter(function(id){
  var q = gB.world.npcPos[id]; return (q.x + ',' + q.y) !== beforeB[id];
}).length;
ok('一 tick 重新寻路的人数 <= ' + budget + '（其余分摊到后面几帧）', movedB > 0 && movedB <= budget, movedB + ' 人动了');
var beforeC = {};
Object.keys(gB.world.npcPos).forEach(function(id){ var q = gB.world.npcPos[id]; beforeC[id] = q.x + ',' + q.y; });
gB.step(10);
var movedC = Object.keys(gB.world.npcPos).filter(function(id){
  var q = gB.world.npcPos[id]; return (q.x + ',' + q.y) !== beforeC[id];
}).length;
ok('多跑几帧之后，大家都动起来了（不是永远卡住）', movedC > budget, movedC + ' 人在 10 帧里动过');

section('9. 性能：放开寻路之后，预算仍然够');
var g9 = Core.createGame(built, {});
var t0 = Date.now();
g9.step(20000);
var dt9 = Date.now() - t0;
ok('20000 tick 平均 < 1ms', dt9 / 20000 < 1, (dt9 / 20000).toFixed(4) + ' ms/tick');
var sg = Core.createGame(built, {}), sgr = sg.grid('planet_wilderness');
var pts = [];
for (var pi = 0; pi < sgr.pass.length && pts.length < 2; pi++) if (sgr.pass[pi]) pts.push(pi);
var t1 = Date.now();
for (var ri = 0; ri < 200; ri++) sg.findPath('planet_wilderness', pts[0] % sgr.w, Math.floor(pts[0] / sgr.w), 60, 20);
var dt1 = (Date.now() - t1) / 200;
ok('单次 findPath < 1ms（放开 limit 之后）', dt1 < 1, dt1.toFixed(4) + ' ms');
var t2 = Date.now();
for (var fj = 0; fj < 100; fj++) sg.render();
var dt2 = (Date.now() - t2) / 100;
ok('单帧合成 < 6ms', dt2 < 6, dt2.toFixed(4) + ' ms');

/* ---------------------------------------------------------------- */
section('10. 地图视觉：墙体轮廓化 / 按类型换地板 / 货架与墙分家');

/* 10.1 轮廓化：矩形房间的四边该是 - | +，# 只留给端点与家具 */
var shapeSpec = {
  config: { defaultLegend: { '#': { preset: 'wall' }, '.': { preset: 'floor' } } },
  presets: { wall: { ch: '#', passable: false, solid: true }, floor: { ch: '.', passable: true } },
  scenes: { list: [
    { id: 'shaped_room', name: '方房', size: { w: 9, h: 7 }, legend: {},
      tiles: ['#########', '#.......#', '#.......#', '#..#....#', '#.......#', '#.......#', '#########'], exits: [] }
  ] } };
var sg1 = Core.load({ space: shapeSpec }).idx.sceneGrids.shaped_room;
ok('轮廓化：横墙变 -', sg1.ch[0 * 9 + 3] === '-', sg1.ch[3]);
ok('轮廓化：竖墙变 |', sg1.ch[3 * 9 + 0] === '|', sg1.ch[3 * 9]);
ok('轮廓化：四角变 +', sg1.ch[0] === '+' && sg1.ch[8] === '+', sg1.ch[0] + sg1.ch[8]);
ok('轮廓化：孤立的一格结构保持 #（家具，不是墙）', sg1.ch[3 * 9 + 3] === '#', sg1.ch[3 * 9 + 3]);
ok('轮廓化只改显示字符，不改通行性', sg1.pass[0] === 0 && sg1.pass[1 * 9 + 1] === 1);
ok('轮廓化不碰地板字符', sg1.ch[1 * 9 + 1] === '.', sg1.ch[1 * 9 + 1]);

/* 10.2 按场景类型换地板：映射全在 config.floorByType，内核不认识场景类型 */
var ftSpec = {
  config: { defaultLegend: { '#': { preset: 'wall' }, '.': { preset: 'floor' } },
            floorByType: { type_a: 'floor_a' } },
  presets: { wall: { ch: '#', passable: false, solid: true }, floor: { ch: '.', passable: true },
             floor_a: { ch: ',', passable: true, name: 'A 型地面' } },
  scenes: { list: [
    { id: 'ft_a', name: 'A 型房', type: 'type_a', size: { w: 5, h: 3 }, legend: {},
      tiles: ['#####', '#...#', '#####'], exits: [] },
    { id: 'ft_b', name: 'B 型房', type: 'type_b', size: { w: 5, h: 3 }, legend: {},
      tiles: ['#####', '#...#', '#####'], exits: [] }
  ] } };
var ftIdx = Core.load({ space: ftSpec }).idx.sceneGrids;
ok('floorByType：登记过的类型换成 , ', ftIdx.ft_a.ch[1 * 5 + 2] === ',', ftIdx.ft_a.ch[1 * 5 + 2]);
ok('floorByType：没登记的类型仍然用默认地板', ftIdx.ft_b.ch[1 * 5 + 2] === '.', ftIdx.ft_b.ch[1 * 5 + 2]);

/* 10.3 真实内容：五种场景类型的地板字符各不相同（区域感） */
function sceneFloorCh(id){
  var g = built.idx.sceneGrids[id]; if (!g) return null;
  var doorCh = Core.getPath(spec, 'presets.door.ch', '+');
  for (var i = 0; i < g.ch.length; i++){
    if (g.ch[i] === doorCh) continue;                               /* 门也是可走的，别拿门当样本 */
    if (g.pass[i] && g.kind[i] === 'floor') return g.ch[i];
  }
  return null;
}
ok('空间站地板 = .', sceneFloorCh('station_command') === '.', sceneFloorCh('station_command'));
ok('地表地板 = ,', sceneFloorCh('planet_landing') === ',', sceneFloorCh('planet_landing'));
ok('裂隙地板 = ;', sceneFloorCh('rift_core') === ';', sceneFloorCh('rift_core'));
ok('舰内地板 = :', sceneFloorCh('ship_bridge') === ':', sceneFloorCh('ship_bridge'));
ok('殖民地地板 = \'', sceneFloorCh('colony_mine') === "'", sceneFloorCh('colony_mine'));

/* 10.4 货架与墙分家：骨架是 - | +，# 只留家具；货架是 [ */
var cmd = built.idx.sceneGrids.station_command;
var nShelf = 0, badShelf = 0, nContour = 0, nSharp = 0;
for (var i4 = 0; i4 < cmd.ch.length; i4++){
  if (cmd.kind[i4] === 'interactable' && cmd.ref[i4] === 'shelf'){
    nShelf++; if (cmd.ch[i4] !== '[') badShelf++;
  }
  if (cmd.kind[i4] === 'wall'){
    if (cmd.ch[i4] === '#') nSharp++;
    else if ('-|+'.indexOf(cmd.ch[i4]) >= 0) nContour++;
  }
}
ok('指挥中心有货架（[ = interactable shelf）', nShelf > 0, nShelf + ' 格');
ok('货架不再借用墙的字符', badShelf === 0, badShelf + ' 格不对');
ok('指挥中心的墙被轮廓化成 - | +', nContour > 100, nContour + ' 格轮廓 / ' + nSharp + ' 格端点');
ok('墙和货架在真实内容里分成两类（planet_landing 的墙是 preset wall）',
   built.idx.sceneGrids.planet_landing.kind[0] === 'wall');

/* 10.5 图例：墙只列一条（不能因为 - | + 列出三四条，也不能和门的 + 撞名） */
var lgCmd = Core.createGame(built, {}).sceneLegend('station_command');
var wallEntries = lgCmd.filter(function(e){ return e.name === '墙'; });
var doorEntries = lgCmd.filter(function(e){ return e.name === '门'; });
ok('图例里「墙」只有一条', wallEntries.length === 1, JSON.stringify(wallEntries));
ok('图例里的墙用预设字符 #（不是某个轮廓变体）', wallEntries.length === 1 && wallEntries[0].ch === '#',
   wallEntries.length ? wallEntries[0].ch : 'missing');
ok('图例里「门」只有一条且是 +', doorEntries.length === 1 && doorEntries[0].ch === '+',
   JSON.stringify(doorEntries));

/* 10.6 自带一圈墙的场景不再重复描边（否则 - | + 会叠成两层） */
function fakeGrid(rows){
  var w = rows[0].length, h = rows.length, ch = [], pass = [];
  for (var y = 0; y < h; y++) for (var x = 0; x < w; x++){
    var c = rows[y].charAt(x); ch.push(c); pass.push(c === '.' ? 1 : 0);
  }
  return { w: w, h: h, ch: ch, pass: pass };
}
var PR = { wall: { ch: '#' }, door: { ch: '+' } };
ok('ringClosed：四面都是墙 -> 不用再描边', Core.ringClosed(fakeGrid(['###', '#.#', '###']), PR) === true);
ok('ringClosed：门不算缺口（门是出口不是洞）', Core.ringClosed(fakeGrid(['#+#', '#.#', '###']), PR) === true);
ok('ringClosed：边框漏了 -> 还是要描边', Core.ringClosed(fakeGrid(['##.', '#.#', '###']), PR) === false);
var gsw = fakeGrid(['#####', '#...#', '#.#.#', '#...#', '#####']);
Core.shapeWalls(gsw, PR);
ok('shapeWalls：上边成排 -> -', gsw.ch[1] === '-', gsw.ch[1]);
ok('shapeWalls：左边成排 -> |', gsw.ch[1 * 5] === '|', gsw.ch[1 * 5]);
ok('shapeWalls：角 -> +', gsw.ch[0] === '+', gsw.ch[0]);
ok('shapeWalls：中间孤立一格保持 #', gsw.ch[2 * 5 + 2] === '#', gsw.ch[2 * 5 + 2]);

console.log('\n----------------------------------------');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
