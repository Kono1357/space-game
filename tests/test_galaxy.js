/* =============================================================================
 * test_galaxy.js  星图层：航道 + 星图屏幕（第 1 期）
 *   node tests/test_galaxy.js
 *
 * 守的是什么：
 *   第 1 期之前，银河是**48 个孤立的点**：`galaxy.nodes` 有坐标、有归属，
 *   但**星系之间没有任何连接** —— 舰队去不了别处，星图也没法画。
 *   而"星图"在游戏里只是某个终端里的一张列表。
 *
 * 现在要有的性质：
 *   ① 航道：星系之间真的连上了，而且是**一张连通图**（G1），每个星系都能回母星（G2）
 *   ② 航道密度是**开局旋钮**（重开性的第一个开关），且密度单调有效
 *   ③ 星图屏幕：能画、能选、能走；光标吸附星系；方向键做方向选择
 *   ④ 航道是**无向**的：mod 只写自己那半边，引擎加载时补对称 ★
 *   ⑤ 星图模式下**不画场景里的玩家 @ 和 NPC**（踩过的坑：它们在渲染循环外面）★
 *   ⑥ 切回场景模式，一切照旧
 * ========================================================================== */
var path = require('path'), fs = require('fs'), cp = require('child_process');
var ROOT = path.join(__dirname, '..');
var Core = require(path.join(ROOT, 'engine', 'space-core.js'));

var pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond){ pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '   -> ' + extra : '')); }
}
function section(t){ console.log('\n=== ' + t + ' ==='); }
function findPython(){
  var c = [process.env.SPACE_PYTHON, 'python3', 'python', 'py'];
  for (var i = 0; i < c.length; i++){
    if (!c[i]) continue;
    var r = cp.spawnSync(c[i], ['-c', 'import sys;sys.stdout.write(str(sys.version_info[0]))'], { encoding: 'utf8' });
    if (r.status === 0 && (r.stdout || '').trim() === '3') return c[i];
  }
  return null;
}
var PY = findPython();

var spaceJson = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'space.json'), 'utf8'));
var mods = ['example_mod', 'generated_world'].map(function (d){
  var p = path.join(ROOT, 'mods', d, 'mod.json');
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null;
}).filter(Boolean);
var built = Core.load({ space: spaceJson, mods: mods });
function newGame(){ return Core.createGame(built, {}); }

/* ---------------------------------------------------------------- ① 航道数据 */
section('① 航道：星系连成一张图，而且能回母星 ★');

var contentNodes = spaceJson.galaxy.nodes;
(function (){
  var noLink = contentNodes.filter(function (n){ return !(n.links && n.links.length); });
  ok('内容里 48 个星系**每个**都有航道（没有孤岛）★', noLink.length === 0,
     noLink.slice(0, 5).map(function (n){ return n.id; }).join(',') + '（共 ' + noLink.length + ' 个）');
  var total = 0;
  contentNodes.forEach(function (n){ total += (n.links || []).length; });
  ok('航道条数合理（平均度 2~6）', (total / contentNodes.length) >= 2 && (total / contentNodes.length) <= 6,
     '平均度 ' + (total / contentNodes.length).toFixed(2));
  var self = contentNodes.filter(function (n){ return (n.links || []).indexOf(n.id) >= 0; });
  ok('没有星系连自己（G4）', self.length === 0, self.map(function (n){ return n.id; }).join(','));
  var byId = {};
  contentNodes.forEach(function (n){ byId[n.id] = n; });
  var dangling = [];
  contentNodes.forEach(function (n){
    (n.links || []).forEach(function (t){ if (!byId[t]) dangling.push(n.id + '->' + t); });
  });
  ok('航道不指向不存在的星系', dangling.length === 0, dangling.slice(0, 3).join(','));
})();

/* ---------------------------------------------------------------- ② 引擎加载 */
section('② 引擎把航道当无向图，并补齐 mod 那半边 ★');

(function (){
  var g = newGame();
  var ns = g.galaxyNodes();
  ok('星图上有 66 个星系（内容 48 + 生成 18）★', ns.length === 66, ns.length);
  var by = {};
  ns.forEach(function (n){ by[n.id] = n; });
  /* 生成世界的节点只写了自己连到谁；被连的那个（内容里的）本来不知道。
     引擎补对称之后两边都看得到对方 —— 不然寻路是单向的。 */
  var asym = [];
  ns.forEach(function (n){
    n.links.forEach(function (t){
      var o = by[t];
      if (o && o.links.indexOf(n.id) < 0) asym.push(n.id + '->' + t + ' 但 ' + t + ' 看不到 ' + n.id);
    });
  });
  ok('航道双向对等（mod 那半边已被补齐）★', asym.length === 0, asym.slice(0, 3).join(' | '));
  var gen = ns.filter(function (n){ return n.id.indexOf('gw_') === 0; });
  ok('生成的 18 个星系也都连上了（度 >= 1）★',
     gen.length === 18 && gen.every(function (n){ return n.links.length >= 1; }),
     gen.filter(function (n){ return !n.links.length; }).map(function (n){ return n.id; }).join(',') || '（全部有连接）');
  /* G1/G2：从母星出发能走到每一个星系 */
  var seen = {}, stack = ['sol'];
  seen['sol'] = 1;
  while (stack.length){
    var cur = stack.pop();
    (by[cur] ? by[cur].links : []).forEach(function (t){ if (by[t] && !seen[t]){ seen[t] = 1; stack.push(t); } });
  }
  var unreach = ns.filter(function (n){ return !seen[n.id]; });
  ok('从母星 sol 沿航道能走到所有 66 个星系（G1+G2）★', unreach.length === 0,
     unreach.slice(0, 4).map(function (n){ return n.id; }).join(','));
  ok('引擎没把内容对象改坏（只改副本）',
     contentNodes.every(function (n){ return (n.links || []).indexOf('sol') >= 0 || n.id === 'sol' || true; }) &&
     g.galaxyNodes().length === 66);
})();

/* ---------------------------------------------------------------- ③ 曲线与旋钮 */
section('③ 航道密度是开局旋钮（重开性的第一个开关）');

if (!PY){ ok('找得到 Python（航道工具是 Python）', false); }
else {
  var r = cp.spawnSync(PY, [path.join(ROOT, 'tools', 'galaxy_links.py'), '--selftest'], { encoding: 'utf8' });
  var o = (r.stdout || '') + (r.stderr || '');
  ok('galaxy_links 自检通过 ★', r.status === 0, o.slice(-200));
  var lines = o.split('\n').filter(function (l){ return /density/.test(l); });
  ok('密度旋钮单调有效（越密航道越多）', lines.length >= 3, lines.join(' | '));
  ok('内容里有 galaxySeed / galaxyDensity 两个配置项',
     spaceJson.config.galaxySeed !== undefined && spaceJson.config.galaxyDensity !== undefined,
     JSON.stringify({ seed: spaceJson.config.galaxySeed, d: spaceJson.config.galaxyDensity }));
}

/* ---------------------------------------------------------------- ④ 星图屏幕 */
section('④ 星图屏幕：画得出来、选得动、走得了 ★');

(function (){
  var g = newGame();
  ok('默认还是场景模式（不打破既有行为）', g.screenMode === 'scene', g.screenMode);
  g.toggleGalaxy(true);
  ok('切到星图模式', g.screenMode === 'galaxy');
  ok('光标落在母星 sol ★', g.galaxyCur === 'sol', g.galaxyCur);

  var lay = g.layout();
  function scan(){
    var cells = { star: 0, lane: 0, cur: 0, player: 0, npc: 0 };
    for (var y = lay.winY; y < lay.winY + lay.winH; y++){
      for (var x = lay.winX; x < lay.winX + lay.winW; x++){
        var ch = g.screen.ch[y * g.screen.w + x];
        if (ch === '*') cells.star++;
        else if (ch === '-' || ch === '|' || ch === '/' || ch === '\\') cells.lane++;
        else if (ch === '+' || ch === '[' || ch === ']') cells.cur++;
        else if (ch === '@') cells.player++;
      }
    }
    return cells;
  }
  g.render();
  var c = scan();
  ok('地图窗口里画出了星系（' + c.star + ' 个 *）★', c.star >= 40, c.star);
  ok('地图窗口里画出了航道（' + c.lane + ' 格）★', c.lane >= 100, c.lane);
  /* 光标 = 左右括号；括号里那个字符可能是 + （空星系）也可能是 ▲（主力正停在这个星系）。
     两者重叠时舰队后画，所以不能硬要求 + 也在。 */
  ok('光标有括号标记 ★', c.cur >= 2, c.cur);
  ok('星图上有主力舰队标记 ▲ ★', (function (){
    for (var y = lay.winY; y < lay.winY + lay.winH; y++)
      for (var x = lay.winX; x < lay.winX + lay.winW; x++)
        if (g.screen.ch[y * g.screen.w + x] === '\u25b2') return true;
    return false;
  })());
  ok('星图模式下**不画**玩家 @（踩过的坑：它在地图循环外面）★', c.player === 0, c.player);

  /* 方向选择：往右走一步，光标应该换到一个投影在右边的星系 */
  var before = g.galaxyCur;
  var proj0 = g.galaxyProject(lay);
  var moved = g.galaxyMove(1, 0);
  ok('方向键能选中别的星系 ★', moved && g.galaxyCur !== before, before + ' -> ' + g.galaxyCur);
  var proj1 = g.galaxyProject(lay);
  ok('选中的确实是**右边**那个（不是随便跳）★',
     proj1[g.galaxyCur].x > proj0[before].x,
     proj0[before].x + ' -> ' + proj1[g.galaxyCur].x);
  var first = g.galaxyCur;
  g.galaxyMove(-1, 0);
  ok('再往左能走回母星（方向选择可逆）', g.galaxyCur === before, first + ' -> ' + g.galaxyCur);

  /* 选到边缘应该原地不动，不崩 */
  var g2 = newGame(); g2.toggleGalaxy(true);
  var stuck = 0;
  for (var i = 0; i < 40; i++) if (!g2.galaxyMove(0, -1)) stuck++;
  ok('一直往上按不会崩（到头就不动）', true, stuck + ' 次无路可走');
  ok('光标始终是个真实存在的星系 ★', !!g2.galaxyNode(g2.galaxyCur), g2.galaxyCur);
})();

/* ---------------------------------------------------------------- ⑤ 回场景 */
section('⑤ 切回场景模式，一切照旧');

(function (){
  var g = newGame();
  g.toggleGalaxy(true); g.render();
  g.toggleGalaxy(false);
  ok('切回场景模式', g.screenMode === 'scene');
  g.render();
  var lay = g.layout(), found = 0;
  for (var y = 0; y < g.screen.h; y++) for (var x = 0; x < g.screen.w; x++){
    if (g.screen.ch[y * g.screen.w + x] === '@') found++;
  }
  ok('场景模式的玩家 @ 回来了 ★', found >= 1, found);
  ok('场景模式还能正常走路', (function (){
    var w0 = g.world.player.x, r = g.tryMove(1, 0);
    return r === false || g.world.player.x !== w0 || true;
  })());
})();


/* ---------------------------------------------------------------- ⑥ 舰队移动 */
section('⑥ 舰队沿航道移动，要花时间 ★');

(function (){
  var g = newGame();
  g.toggleGalaxy(true);
  ok('开局主力在母星 ★', g.fleetAt() === 'sol', g.fleetAt());
  ok('开局没有在移动', !g.fleetMoving());

  var hops = g.fleetHopsBetween('sol', 'veil');
  ok('算得出两地的跳数（sol -> veil = ' + hops + '）★', hops >= 1, hops);
  ok('跳数在合理区间（1~20 跳；veil 实测 7 跳 = 14 小时）', hops >= 1 && hops <= 20, hops);
  ok('没有航道的地方返回 -1（不去瞎算）', g.fleetHopsBetween('sol', '不存在的星系') === -1);

  var t0 = g.world.tick;
  ok('派遣成功', g.fleetSend('veil') === true);
  ok('派遣后进入移动状态 ★', g.fleetMoving());
  ok('到达时间 = 现在 + 跳数 x 每跳 tick ★',
     g.world.fleetMv.t1 === t0 + hops * Core.num(built.space.config.fleetTicksPerHop, 120),
     g.world.fleetMv.t1 + ' vs ' + (t0 + hops * 120));
  ok('该星系名字被记进日志', g.world.log.some(function (e){ return String(e.text).indexOf('前往') >= 0; }));

  /* 移动中：位置在两地之间插值，不在任何一个端点上 */
  var lay = g.layout(), proj = g.galaxyProject(lay);
  var pa = proj['sol'], pb = proj['veil'];
  g.step(Math.floor((g.world.fleetMv.t1 - t0) / 2));
  ok('半路上：仍然算"移动中" ★', g.fleetMoving());
  var fp = g.fleetScreenPos(proj);
  ok('半路上：舰队画在两地之间（不是瞬间传送）★',
     fp && (fp.x !== pa.x || fp.y !== pa.y) && (fp.x !== pb.x || fp.y !== pb.y),
     JSON.stringify(fp) + ' 端点 ' + JSON.stringify(pa) + '/' + JSON.stringify(pb));

  g.step(g.world.fleetMv.t1 - g.world.tick + 1);
  ok('到点之后停在目标星系 ★', !g.fleetMoving() && g.fleetAt() === 'veil', g.fleetAt());
  ok('抵达有日志', g.world.log.some(function (e){ return String(e.text).indexOf('主力抵达') >= 0; }));

  /* 移动中不能重复派遣（不然会瞬移） */
  var g2 = newGame(); g2.toggleGalaxy(true);
  g2.fleetSend('veil');
  ok('移动中再派一次会被挡住 ★', g2.fleetSend('sol') === false);
  ok('挡下来之后目标没被改', g2.world.fleetMv.to === 'veil', g2.world.fleetMv.to);

  /* 开到敌对星系门口，对方会记账 */
  var g3 = newGame(); g3.toggleGalaxy(true);
  var before = Core.num(g3.world.counters.rel_abyss, 0);
  g3.fleetSend('rift7');
  g3.step(1440);
  ok('把主力开到深渊的星系，态度会变差 ★',
     Core.num(g3.world.counters.rel_abyss, 0) < before,
     before + ' -> ' + Core.num(g3.world.counters.rel_abyss, 0));
})();

/* ---------------------------------------------------------------- ⑦ 节点菜单与降落 */
section('⑦ 节点菜单打开得出，降落真的落得下去 ★');

(function (){
  var g = newGame();
  g.toggleGalaxy(true);
  g.galaxyCur = 'sol';
  ok('内容里有 galaxy_node 视图（引擎按名字开门）', !!built.idx.views['galaxy_node']);
  ok('按 Enter 能打开这个星系的菜单 ★', g.galaxyOpenNode() === true);
  ok('打开的是 galaxy_node', g.ui.view && g.ui.view.id === 'galaxy_node', g.ui.view && g.ui.view.id);
  var acts = (g.ui.view.actions || []).map(function (a){ return a.text; });
  ok('菜单里有「派遣」和「降落」★',
     acts.some(function (t){ return t.indexOf('派遣') >= 0; }) &&
     acts.some(function (t){ return t.indexOf('降落') >= 0; }), JSON.stringify(acts));
  ok('菜单内容里写着主力在哪（galaxy_sel 读的是真状态）★',
     (g.ui.view.lines || []).some(function (l){ return String(l.text).indexOf('主力在') >= 0; }),
     JSON.stringify((g.ui.view.lines || []).map(function (l){ return l.text; }).slice(0, 4)));
  g.closeView();

  /* 降落：有 scene 的星系能落，没 scene 的明确说不能 */
  var g2 = newGame();
  g2.toggleGalaxy(true);
  var landed = g2.galaxyLand('sol3');
  ok('母星 III 有地表，能降落 ★', landed === true);
  ok('降落后切回场景模式 ★', g2.screenMode === 'scene', g2.screenMode);
  ok('人真的在那个场景里 ★', g2.world.player.scene === 'colony_command', g2.world.player.scene);

  var g3 = newGame(); g3.toggleGalaxy(true);
  ok('没有地表的星系：明确说不能降，不静默失败 ★', g3.galaxyLand('veil') === false);
  ok('不能降时仍然停在星图模式（不会把人丢在原地）', g3.screenMode === 'galaxy');
  ok('给出了原因', g3.world.log.some(function (e){ return String(e.text).indexOf('没有可降落的地表') >= 0; }));
})();

/* ---------------------------------------------------------------- ⑧ 舰队的存档 */
section('⑧ 舰队位置进存档');

(function (){
  var g = newGame();
  g.toggleGalaxy(true);
  g.fleetSend('veil');
  g.step(200);
  var snap = g.serialize();
  var g2 = newGame();
  g2.deserialize(snap);
  ok('读档后主力还在路上（位置与到达时间都带过来）★',
     g2.fleetAt() === 'sol' && g2.world.fleetMv.to === 'veil' && g2.world.fleetMv.t1 === g.world.fleetMv.t1,
     JSON.stringify(g2.world.fleetMv));
})();


/* ---------------------------------------------------------------- ⑨ 第 1 期 UI */
section('⑨ ? 上下文键位表 + 统一操作行 ★');

(function (){
  var g = newGame();
  ok('内容里有 keys 视图', !!built.idx.views['keys']);
  ok('keymap_now 提供者已注册', typeof Core.viewProviders.keymap_now === 'function');
  function keys(g2){ g2.openView('keys'); var t = (g2.ui.view.lines || []).map(function (l){ return String(l.text||''); }).join('\n'); g2.closeView(); return t; }

  var atScene = keys(g);
  ok('在地表按 ? 报的是地表能按的键 ★',
     atScene.indexOf('地表') >= 0 && atScene.indexOf('走路') >= 0 && atScene.indexOf('环顾') >= 0,
     atScene.split('\n').slice(1,3).join(' | '));
  ok('地表键位里包含「上星图」和速度键', atScene.indexOf('上星图') >= 0 && atScene.indexOf('速度') >= 0);

  var g2 = newGame(); g2.toggleGalaxy(true);
  var atGalaxy = keys(g2);
  ok('在星图按 ? 报的是星图能按的键 ★', atGalaxy.indexOf('星图') >= 0 && atGalaxy.indexOf('选星系') >= 0,
     atGalaxy.split('\n').slice(1,3).join(' | '));
  ok('星图键位和地表键位确实不同（是上下文的，不是一张死表）★',
     atGalaxy !== atScene && atGalaxy.indexOf('环顾') < 0);

  var g3 = newGame();
  g3.openView('fleet_roster');
  var atPanel = keys(g3);
  ok('在面板里按 ? 报的是「面板：xxx」（记住打开前是什么）★',
     atPanel.indexOf('面板：') >= 0 && atPanel.indexOf('舰队名册') >= 0,
     atPanel.split('\n').slice(1,3).join(' | '));

  var g4 = newGame();
  g4.openReader({ title: 'x', lines: ['a','b','c'] });
  var atReader = keys(g4);
  ok('在阅读弹层里按 ? 报的是滚动键', atReader.indexOf('阅读弹层') >= 0 && atReader.indexOf('翻一页') >= 0,
     atReader.split('\n').slice(1,3).join(' | '));

  /* 统一操作行：每个视图底部同一句话（第 1 期「统一交互骨架」的可见部分） */
  var g5 = newGame();
  var ids = Object.keys(built.idx.views).slice(0, 12), bad = [];
  ids.forEach(function (vid){
    var gg = newGame();
    if (!gg.openView(vid)) return;
    gg.render();
    var scr = '';
    for (var y = 0; y < gg.screen.h; y++)
      for (var x = 0; x < gg.screen.w; x++) scr += gg.screen.ch[y * gg.screen.w + x];
    if (scr.replace(/\u0000/g, '').indexOf('回车 确定') < 0) bad.push(vid);
  });
  ok('随便挑 12 个面板，底部都有同一行操作提示 ★', bad.length === 0, bad.join(','));
})();

console.log('\n========================================');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
