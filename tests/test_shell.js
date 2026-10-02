/* =============================================================================
 * test_shell.js  外壳冒烟测试（node + 一个极简假 DOM，不开浏览器）
 *   node tests/test_shell.js
 *   外壳是玩家真正碰到的那一层：键盘 / 鼠标走路 / Tab 环顾 / F2 装 mod /
 *   记录点终端的存档桥。这里用一个假 document / 假 localStorage 把它跑起来，
 *   按一遍键、点一下鼠标、粘一个 mod，确认不炸且真的管用。
 * ========================================================================== */
var path = require('path'), fs = require('fs'), vm = require('vm');
var Core = require(path.join(__dirname, '..', 'engine', 'space-core.js'));
var T    = require(path.join(__dirname, '..', 'engine', 'space-textout.js'));
var spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'space.json'), 'utf8'));
var shellSrc = fs.readFileSync(path.join(__dirname, '..', 'engine', 'space-textshell.js'), 'utf8');

var pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond){ pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '   -> ' + extra : '')); }
}
function section(t){ console.log('\n=== ' + t + ' ==='); }

/* ---------------- 极简假 DOM ---------------- */
function fakeClassList(){
  var set = {};
  return {
    add: function(c){ set[c] = 1; },
    remove: function(c){ delete set[c]; },
    contains: function(c){ return !!set[c]; },
    toggle: function(c){ if (set[c]) delete set[c]; else set[c] = 1; }
  };
}
function FakeEl(tag, id){
  this.tagName = tag; this.id = id || '';
  this.style = {}; this.classList = fakeClassList();
  this.textContent = ''; this.innerHTML = ''; this.value = '';
  this.children = []; this.listeners = {};
  this.clientWidth = 1200; this.clientHeight = 700;
}
FakeEl.prototype.addEventListener = function(type, fn){ (this.listeners[type] = this.listeners[type] || []).push(fn); };
FakeEl.prototype.appendChild = function(c){ this.children.push(c); return c; };
FakeEl.prototype.focus = function(){};
FakeEl.prototype.getBoundingClientRect = function(){
  var m = /(\d+(?:\.\d+)?)px/.exec(this.style.font || '');
  var size = m ? Number(m[1]) : 15;
  var lines = String(this.textContent).split('\n');
  var cols = 0;
  for (var i = 0; i < lines.length; i++) cols = Math.max(cols, lines[i].length);
  return { width: cols * size * 0.6, height: lines.length * size * 1.15, left: 0, top: 10 };
};
FakeEl.prototype.fire = function(type, ev){
  ev = ev || {};
  var ls = this.listeners[type] || [];
  for (var i = 0; i < ls.length; i++) ls[i].call(this, ev);
};

var els = {};
var HIDDEN_AT_BOOT = { err: 1, modpanel: 1 };       /* 模板里这两个是先隐藏的 */
function el(id){
  if (!els[id]){
    els[id] = new FakeEl(id === 'screen' ? 'pre' : 'div', id);
    if (HIDDEN_AT_BOOT[id]) els[id].classList.add('hidden');
    el(id).classList && null;
  }
  return els[id];
}
var times = [];
var sandbox = {};
sandbox.console = console;
sandbox.setTimeout = function(fn){ if (typeof fn === 'function') fn(); return 0; };
sandbox.setInterval = function(fn, ms){ times.push({ fn: fn, ms: ms }); return times.length; };
sandbox.clearInterval = function(){};
var store = {};
sandbox.localStorage = {
  getItem: function(k){ return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem: function(k, v){ store[k] = String(v); },
  removeItem: function(k){ delete store[k]; }
};
sandbox.document = {
  readyState: 'complete',
  body: new FakeEl('body', 'body'),
  createElement: function(t){ return new FakeEl(t); },
  getElementById: function(id){ return el(id); },
  addEventListener: function(){}
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.innerWidth = 1400; sandbox.innerHeight = 800;
sandbox.addEventListener = function(type, fn){ (this._ls = this._ls || {})[type] = (this._ls[type] || []).concat([fn]); };
sandbox.SpaceCore = Core;
sandbox.SpaceTextOut = T;
sandbox.SPACE_SPEC = spec;
sandbox.SPACE_MODS = [];
sandbox.SPACE_STARTER = null;
sandbox.ZHANYI_KERNEL = { meta: { name: '测试内核', version: '9' }, CONTENT: { fleets: [{ id: 'f1' }] }, TEXT: {} };

var ctx = vm.createContext(sandbox);
function keys(k){
  var ls = (sandbox._ls && sandbox._ls.keydown) || [];
  for (var i = 0; i < ls.length; i++) ls[i]({ key: k, preventDefault: function(){} });
}
function runLoop(n){
  var step = null, info = null;
  for (var i = 0; i < times.length; i++){ if (times[i].ms === 60) step = times[i].fn; if (times[i].ms === 250) info = times[i].fn; }
  for (var j = 0; j < n; j++){ if (step) step(); if (info) info(); }
}

section('1. 外壳能启动');
try {
  vm.runInContext(shellSrc, ctx, { filename: 'space-textshell.js' });
  ok('外壳脚本跑完没有抛异常', true);
} catch (e){ ok('外壳脚本跑完没有抛异常', false, e.message); }
var g = sandbox.__game;
ok('拿到了 game 实例', !!g);
ok('画面写进了 <pre>', String(el('screen').textContent).length > 200, String(el('screen').textContent).length);
ok('<pre> 的字号是外壳算出来的（不是模板写死的 15px）', /bold \d+px/.test(el('screen').style.font), el('screen').style.font);
ok('信息栏有位置和按键提示', el('info').textContent.indexOf('位置') >= 0 && el('info').textContent.indexOf('F2') >= 0);
ok('主循环挂了两个 setInterval', times.length >= 2, times.length);
ok('没有任何未捕获错误提示', el('err').classList.contains('hidden'), el('err').textContent);

section('2. 键盘：走路 / 等待 / 环顾 / 帮助 / 查看 / 诊断');
var before = { x: g.world.player.x, y: g.world.player.y, tick: g.world.tick };
keys('d');
ok('按 d 走一格（世界前进一分钟）',
   g.world.player.x !== before.x || g.world.player.y !== before.y, g.world.player.x + ',' + g.world.player.y);
ok('走一步 = 1 tick', g.world.tick === before.tick + 1, g.world.tick - before.tick);
var t0 = g.world.tick;
keys(' ');
ok('空格等一分钟', g.world.tick === t0 + 1);
keys('Tab');
ok('Tab 打开「环顾四周」', !!g.ui.view && g.ui.view.id === 'nearby', g.ui.view && g.ui.view.id);
ok('环顾四周有内容', g.ui.view.lines.length > 5, g.ui.view.lines.length);
ok('环顾四周里写着坐标和方位', /东北|西北|东南|西南|东|西|南|北/.test(
   g.ui.view.lines.map(function(l){ return l.text; }).join(' ')));
keys('Escape');
ok('Esc 关掉终端', !g.ui.view);
keys('?');
/* 第 1 期把 ? 改成了「当前可用按键」——它按你**现在在哪**列键（地表/星图/面板/对话/弹层各不同），
   不再是那张静态的 help。内容里没有 keys 视图时才退回 help。 */
ok('? 打开当前可用按键', !!g.ui.view && (g.ui.view.id === 'keys' || g.ui.view.id === 'help'),
   g.ui.view && g.ui.view.id);
keys('Escape');
keys('x');
ok('X 进入查看模式', !!g.ui.look);
keys('ArrowRight');
ok('查看模式里方向键挪光标', !!g.ui.look);
keys('Escape');
ok('Esc 退出查看模式', !g.ui.look);
keys('F3');
ok('F3 打开诊断（校验报告）', !!g.ui.view && g.ui.view.id === 'debug', g.ui.view && g.ui.view.id);
keys('Escape');
keys('F4');
ok('F4 切换信息栏', el('info').classList.contains('hidden'));
keys('F4');
ok('F4 再按一次切回来', !el('info').classList.contains('hidden'));

section('3. 鼠标点格子自动走过去');
var p0 = { x: g.world.player.x, y: g.world.player.y };
/* 找一个能站、离玩家 4 格以上的目标 */
var gr = g.grid(g.world.player.scene), target = null;
for (var ti = 0; ti < gr.pass.length && !target; ti++){
  if (!gr.pass[ti]) continue;
  var tx = ti % gr.w, ty = Math.floor(ti / gr.w);
  if (Math.abs(tx - p0.x) + Math.abs(ty - p0.y) >= 6) target = { x: tx, y: ty };
}
ok('地图里找到 6 格外的可走格', !!target, JSON.stringify(target));
if (target){
  g.render();
  var cam = g._cam;
  var outNow = sandbox.__space.out;
  /* 新模型：场景格 -> 窗口格 -> 屏幕格（小图居中时 origin 为正） */
  var sx = (cam.winX || 0) + target.x + cam.originX;
  var sy = (cam.winY === undefined ? cam.top : cam.winY) + target.y + cam.originY;
  var rect = el('screen').getBoundingClientRect();
  el('screen').fire('click', {
    clientX: rect.left + sx * outNow.cellW + 1,
    clientY: rect.top + sy * outNow.cellH + 1
  });
  ok('点一下就有了自动寻路', !!g.world.path, g.world.path && g.world.path.length);
  ok('点的格子反算回来正好是目标格', (function(){
    var c = g.screenToScene(sx, sy); return !!c && c.x === target.x && c.y === target.y;
  })(), JSON.stringify(g.screenToScene(sx, sy)));
  ok('点的格子算对了（画面列数 / 单格宽）',
     sandbox.__space.out.cellW > 0 && sandbox.__space.out.cellH > 0,
     sandbox.__space.out.cellW + 'x' + sandbox.__space.out.cellH);
  runLoop(60);
  ok('自动走路真的走到了目标',
     Math.abs(g.world.player.x - target.x) + Math.abs(g.world.player.y - target.y) <= 1,
     g.world.player.x + ',' + g.world.player.y + ' 目标 ' + target.x + ',' + target.y);
  ok('走完路之后不再有寻路', !g.world.path || !g.world.path.length);
}

section('3.5 固定视口：切场景不跳字号 / 场景偏移正确 / 点击反算一致');
var gV = Core.createGame(Core.load({ space: spec }), {});
var vv = gV.getViewSize();
ok('getViewSize 返回 {w,h} 且为正整数', vv && vv.w > 0 && vv.h > 0, JSON.stringify(vv));
gV.teleport('station_command', 1, 1); gV.render();
var camA = gV._cam, viewA = gV.getViewSize(), fontA = sandbox.__space.out.fontSize;
gV.teleport('ship_engine', 1, 1); gV.render();
var camB = gV._cam, viewB = gV.getViewSize(), fontB = sandbox.__space.out.fontSize;
ok('不同尺寸的场景共用同一个视口', viewA.w === viewB.w && viewA.h === viewB.h, JSON.stringify([viewA, viewB]));
ok('切场景字号不变（外壳用视口算 autoFit）', fontA === fontB, fontA + ' vs ' + fontB);
ok('小场景（52x16）居中：originX > 0 且 originY > 0', camB.originX > 0 && camB.originY > 0,
   camB.originX + ',' + camB.originY);
ok('小场景相机固定在 (0,0)', camB.x === 0 && camB.y === 0, camB.x + ',' + camB.y);

/* 荒野 88x28：现在「视口 = 整个地图区」，28 行放得下 -> 整张图可见、居中、不滚动。
   （旧行为是窗口被设计框夹成 24 行、于是纵向滚动；手机上正是这个夹法把地图切了。） */
var bigId = 'planet_wilderness', gbig = gV.grid(bigId);
var vh = gV.layout().mapH;
gV.teleport(bigId, Math.floor(gbig.w / 2), Math.floor(gbig.h / 2)); gV.render();
ok('地图区放得下的场景：整张可见（居中、不滚动）',
   gbig.h <= vh && gV._cam.y === 0 && gV._cam.originY >= 0,
   '场景高 ' + gbig.h + ' 地图区 ' + vh + ' originY=' + gV._cam.originY);
ok('视口 = 整个地图区（不再被设计取景框夹住）', vh === gV.screenH - 2 - (gV.layout().logRows > 0 ? 1 + gV.layout().logRows : 0),
   'mapH=' + vh + ' screenH=' + gV.screenH);
gV.teleport(bigId, Math.floor(gbig.w / 2), 0); gV.render();
ok('玩家到场景上边缘时相机停在 0', gV._cam.y === 0, gV._cam.y);

/* 真正比地图区高的场景才滚动：现造一张 20x60 的竖长图 */
var tallTiles = [];
for (var ty = 0; ty < 60; ty++){
  var trow = '';
  for (var tx = 0; tx < 20; tx++) trow += (tx === 0 || tx === 19 || ty === 0 || ty === 59) ? '#' : '.';
  tallTiles.push(trow);
}
var tallSpec = { config: spec.config, palette: spec.palette, presets: spec.presets,
  scenes: { list: [{ id: 'tall_shaft', name: '竖井', type: 'space_station', size: { w: 20, h: 60 },
    tiles: tallTiles, legend: {}, exits: [] }] },
  playerCharacter: { id: 'pc', name: '指挥官', symbol: '@', currentScene: 'tall_shaft', position: { x: 10, y: 30 } },
  initialState: { counters: {}, items: {}, flags: {} } };
var gt = Core.createGame(Core.load({ space: tallSpec }), {});
gt.render();
ok('比地图区高的场景：玩家在中间时 originY < 0（纵向滚动）', gt._cam.originY < 0,
   'originY=' + gt._cam.originY + ' 地图区 ' + gt.layout().mapH + ' 场景 60');
ok('纵向相机被 clamp 在边界内',
   gt._cam.y >= 0 && gt._cam.y <= 60 - gt.getViewSize().h,
   gt._cam.y + ' / ' + (60 - gt.getViewSize().h));
gt.teleport('tall_shaft', 10, 0); gt.render();
ok('玩家到上边缘时纵向相机停在 0', gt._cam.y === 0, gt._cam.y);

/* 横向滚动：造一张比视口宽的图（预设里最宽 88 = 视口宽，所以要现造一张） */
var wideTiles = [];
for (var wy = 0; wy < 20; wy++){
  var wrow = '';
  for (var wx = 0; wx < 120; wx++) wrow += (wx === 0 || wx === 119 || wy === 0 || wy === 19) ? '#' : '.';
  wideTiles.push(wrow);
}
var wideSpec = { config: spec.config, palette: spec.palette, presets: spec.presets,
  scenes: { list: [{ id: 'wide_hall', name: '横向大厅', type: 'space_station', size: { w: 120, h: 20 },
    tiles: wideTiles, legend: {}, exits: [] }] },
  playerCharacter: { id: 'pc', name: '指挥官', symbol: '@', currentScene: 'wide_hall', position: { x: 60, y: 10 } },
  initialState: { counters: {}, items: {}, flags: {} } };
var gw = Core.createGame(Core.load({ space: wideSpec }), {});
gw.render();
ok('比视口宽的场景：玩家在中间时 originX < 0', gw._cam.originX < 0,
   'originX=' + gw._cam.originX + ' 视口 ' + gw.getViewSize().w + ' 场景 120');
gw.teleport('wide_hall', 0, 10); gw.render();
ok('玩家到场景左边缘时相机停在 0', gw._cam.x === 0, gw._cam.x);
/* 往返一致：场景格 -> 屏幕格 -> 场景格（大图滚动时也一样） */
var scx = gw._cam.x + Math.floor(gw.getViewSize().w / 2), scy = 10;
var sxp = (gw._cam.winX || 0) + scx + gw._cam.originX;
var syp = (gw._cam.winY === undefined ? gw._cam.top : gw._cam.winY) + scy + gw._cam.originY;
var back = gw.screenToScene(sxp, syp);
ok('点场景中心格：屏幕坐标 -> 场景格反算一致', !!back && back.x === scx && back.y === scy,
   JSON.stringify(back) + ' vs ' + scx + ',' + scy);
ok('窗口外的点击反算返回 null', gw.screenToScene((gw._cam.winX || 0) - 1, syp) === null);

section('4. 记录点终端：存档 / 读档落到 localStorage');
g.openView('save_menu');
ok('记录点终端能开', !!g.ui.view && g.ui.view.id === 'save_menu');
g.viewChoose(0);                                    /* 存档到 1 号位 */
ok('存档写进了 localStorage', !!store['space_save_1'], Object.keys(store).join(','));
var snapTicks = g.world.tick, snapScene = g.world.player.scene;
ok('存的是纯 JSON', (function(){ try { JSON.parse(store['space_save_1']); return true; } catch (e){ return false; } })());
g.step(600);
g.world.flags.__probe = true;
g.openView('save_menu');
g.viewChoose(1);                                    /* 读取 1 号位 */
ok('读档还原了时间', g.world.tick === snapTicks, g.world.tick + ' vs ' + snapTicks);
ok('读档还原了场景', g.world.player.scene === snapScene, g.world.player.scene);
ok('读档丢掉了没存进去的 flag', !g.world.flags.__probe);

section('5. F2 装 mod：粘 JSON / 选文件 / 模板 / 移除 / 导出（热加载保进度）');
el('err').textContent = '';
var gBefore = sandbox.__game;
var tickBefore = gBefore.world.tick;
gBefore.step(40);
tickBefore = gBefore.world.tick;
keys('F2');
ok('F2 打开 mod 面板', !el('modpanel').classList.contains('hidden'));
ok('面板里有文本框 / 按钮 / 文件输入 / 已装列表',
   !!el('modtext') && !!el('modapply') && !!el('modfile') && !!el('modtemplate') && !!el('modexport') && !!el('modlist'));
ok('面板里列出了当前 mod 情况', String(el('modlist').innerHTML).length > 0);

/* 1) 粘一段 JSON 应用：热加载，世界状态保留 */
el('modtext').value = JSON.stringify({
  id: 'shell_mod', name: '外壳测试 mod',
  data: { scenes: { list: [{
    id: 'shell_room', name: '外壳房间', type: 'space_station', size: { w: 10, h: 6 },
    tiles: ['##########', '#........#', '#...@....#', '#........#', '#........#', '##########'],
    legend: {}, exits: []
  }] } }
});
el('modapply').fire('click');
ok('还是同一个 game 实例（热加载，不是重建）', sandbox.__game === gBefore);
ok('世界状态没丢（tick 保留）', gBefore.world.tick === tickBefore, gBefore.world.tick + ' vs ' + tickBefore);
ok('mod 场景进了世界', !!gBefore.idx.sceneGrids.shell_room);
ok('mod 记录进了 localStorage（下次打开还在）', !!store['space_mods'] && store['space_mods'].indexOf('shell_room') >= 0);
ok('面板给了成功提示', /热加载|已应用/.test(el('modmsg').textContent), el('modmsg').textContent);
ok('列表里出现了这个 mod，并且带移除按钮',
   /外壳测试 mod/.test(el('modlist').innerHTML) && /data-rm="0"/.test(el('modlist').innerHTML));
gBefore.teleport('shell_room', 4, 2);
ok('能走进 mod 的新房间', gBefore.world.player.scene === 'shell_room');
ok('mod 的私有块可以往内容里塞（完全开放）', (function(){
  el('modtext').value = JSON.stringify({ id: 'priv', name: '私有块', data: { myStuff: { list: [{ id: 's1', text: 'hi' }] } } });
  el('modapply').fire('click');
  return Core.getPath(sandbox.__game.space, 'myStuff.list[0].text') === 'hi';
})());

/* 2) 移除单个 mod：世界状态仍然保留，房间消失时把人送回起始场景 */
el('modlist').fire('click', { target: { getAttribute: function(k){ return k === 'data-rm' ? '0' : null; } } });
ok('移除之后那个房间没了', !sandbox.__game.idx.sceneGrids.shell_room);
ok('移除之后人还在世界里（回到起始场景）', sandbox.__game.world.player.scene === (spec.playerCharacter.currentScene || spec.config.startScene), sandbox.__game.world.player.scene);
ok('移除之后世界状态还在', sandbox.__game.world.tick === tickBefore, sandbox.__game.world.tick);

/* 3) 示例模板：编进产物的 tools/starter_mod.json，点一下填进框里，应用就能跑 */
sandbox.SPACE_STARTER = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools', 'starter_mod.json'), 'utf8'));
el('modtemplate').fire('click');
ok('模板填进了文本框', String(el('modtext').value).length > 500 && /my_room/.test(el('modtext').value));
el('modapply').fire('click');
ok('模板能装上并且无致命错误', !!sandbox.__game.idx.sceneGrids.my_room && /错误 0/.test(el('modmsg').textContent), el('modmsg').textContent);

/* 4) 导出：放到框里 + 试着下载（没有 Blob/URL 也不能崩） */
el('modexport').fire('click');
ok('导出把内容放进了框里', /starter_mod|my_room/.test(el('modtext').value));

/* 5) 坏 JSON：只提示，不动世界 */
var sceneBefore = sandbox.__game.world.player.scene;
el('modtext').value = '{ 这不是 JSON }';
el('modapply').fire('click');
ok('坏 JSON 只提示错误', /装不进去/.test(el('modmsg').textContent), el('modmsg').textContent);
ok('坏 JSON 之后游戏还在（世界没被动过）',
   !!sandbox.__game && sandbox.__game.world.player.scene === sceneBefore);

/* 6) 清空：回到原内容 */
el('modclear').fire('click');
ok('清空之后 mod 场景都没了', !sandbox.__game.idx.sceneGrids.my_room && !sandbox.__game.idx.sceneGrids.shell_room);
ok('清空之后原内容还在', !!sandbox.__game.idx.sceneGrids.station_command);

/* 7) 超大 JSON（几 MB）：解析 + 热加载不能炸，也不能把世界进度弄丢 */
var filler = '';
for (var fz = 0; fz < 30; fz++) filler += '超长记录用来把 JSON 撑大。';
var bigRows = [];
for (var bm = 0; bm < 5000; bm++) bigRows.push({ id: 'big_note_' + bm, name: '大 mod 记录 ' + bm, text: filler + ' 编号 ' + bm });
var bigText = JSON.stringify({ id: 'big_mod', name: '超大 mod', data: { myBigBlock: { list: bigRows } } });
ok('造出来的 JSON 超过 1.5 MB（' + (bigText.length / 1048576).toFixed(2) + ' MB）', bigText.length > 1.5 * 1024 * 1024, bigText.length);
var tickBig = sandbox.__game.world.tick;
var tBig = Date.now();
el('modtext').value = bigText;
el('modapply').fire('click');
var msBig = Date.now() - tBig;
ok('超大 JSON 能装上且内容真的进去了', Core.getPath(sandbox.__game.space, 'myBigBlock.list[4999].id') === 'big_note_4999', el('modmsg').textContent);
ok('超大 JSON 装完世界进度还在', sandbox.__game.world.tick === tickBig, sandbox.__game.world.tick + ' vs ' + tickBig);
ok('超大 JSON 解析 + 重编译在预算内（< 4000ms，实测 ' + msBig + 'ms）', msBig < 4000, msBig + ' ms');
el('modclear').fire('click');
ok('清掉超大 mod 之后原内容还在', !!sandbox.__game.idx.sceneGrids.station_command);
keys('Escape');
ok('Esc 关掉 mod 面板', el('modpanel').classList.contains('hidden'));

section('6. 挂了兵棋内核时读得到它');
ok('opts.kernel = ZHANYI_KERNEL', sandbox.__game.kernelData().meta.name === '测试内核');
ok('内核数据能按路径读（视图 source 用的就是这条路）',
   Core.getPath(sandbox.__game.scope(), 'kernel.CONTENT.fleets[0].id') === 'f1');
sandbox.__game.world.kernelOps = [];
Core.runEffects(sandbox.__game, [{ type: 'kernel', op: 'orbital_bombard', params: { x: 1 } }], {});
ok('effect kernel 把决定写进 kernelOps', sandbox.__game.world.kernelOps.length === 1);
ok('onKernel 回调不吞掉普通 op', sandbox.__game.world.kernelOps[0].op === 'orbital_bombard');

section('6.5 阅读弹层（长文本）与终端反馈');
keys('L');
ok('L 打开日志阅读弹层', !!g.ui.reader, g.ui.reader && g.ui.reader.title);
ok('阅读弹层把日志换成可滚动的行', !!(g.ui.reader && g.ui.reader.rows.length >= 1), g.ui.reader && g.ui.reader.rows.length);
var rscroll = g.ui.reader.scroll;
keys('PageDown');
ok('PgDn 能翻页（长文本不会挤进侧栏）', g.ui.reader.scroll >= rscroll);
keys('Escape');
ok('Esc 关闭阅读弹层', !g.ui.reader);
keys('M');
ok('M 打开任务与指令进度（带进度条）', !!g.ui.reader && String(g.ui.reader.title).indexOf('任务') >= 0, g.ui.reader && g.ui.reader.title);
ok('任务进度里能看到进度条字符', g.ui.reader.rows.some(function(r){ return String(r.text).indexOf('#') >= 0 || String(r.text).indexOf('.') >= 0; }));
keys('Escape');
g.openView('warehouse_stock');
keys('1');
ok('终端动作后设置 flash（顶部高亮显示最近结果）', !!(g.ui.flash && g.ui.flash.text), JSON.stringify(g.ui.flash));
keys('Escape');
ok('关闭终端后 flash 清掉', !g.ui.flash);

section('6.6 结束与重开：不会卡死');
var gOver = sandbox.__game;
gOver.world.counters.pollution = 15;
gOver.step(60);
ok('污染 15 -> 判负', !!gOver.world.gameOver && gOver.world.gameOver.result === 'defeat', JSON.stringify(gOver.world.gameOver));
runLoop(1);
ok('失败后画面给出结束提示与 [R] 重开', String(el('screen').textContent).indexOf('重新开始') >= 0, String(el('screen').textContent).length);
var tickOver = gOver.world.tick;
runLoop(3);
ok('失败后世界冻结（不再 tick）', sandbox.__game.world.tick === tickOver, sandbox.__game.world.tick - tickOver);
keys('R');
var gNew = sandbox.__game;
ok('按 R 开新的一局（不是同一个 game）', gNew !== gOver, '');
ok('新局回到起始场景 / 初始 tick，且没有结束标记',
   gNew.world.player.scene === (spec.config.startScene || 'station_command') &&
   gNew.world.tick === (spec.config.startTick || 0) && !gNew.world.gameOver,
   gNew.world.player.scene + '@' + gNew.world.tick);
var tkNew = gNew.world.tick;
keys('d');
ok('新局能继续走动', gNew.world.tick === tkNew + 1, gNew.world.tick - tkNew);

section('7. 坏 JSON 不会把面板搞崩');
keys('F2');
el('modtext').value = '{ 这不是 JSON }';
el('modapply').fire('click');
ok('坏 JSON 只提示错误', /装不进去/.test(el('modmsg').textContent), el('modmsg').textContent);
ok('坏 JSON 之后游戏还在（没有重建）', !!sandbox.__game);
keys('F2');

console.log('\n----------------------------------------');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
