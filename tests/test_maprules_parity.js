/* =============================================================================
 * test_maprules_parity.js  规则引擎与游戏引擎「看到的是同一张图」吗
 *   node tests/test_maprules_parity.js
 *
 * 为什么必须有这个测试：
 *   tools/map_rules.py 是**独立于引擎**重写的一套规则实现。它对每一格算出
 *   「可走 / 不可走」，然后据此判 R1/R2/R3/R4/R5/R7/R10。只要它和引擎
 *   engine/space-core.js 对任何一格的结论不一致，校验器的结论就是假的：
 *   校验通过的内容进游戏可能卡死，或者完全合法的内容被误判成不合规。
 *
 *   实测踩过两次：
 *     ① map_rules.grid_of 只读 scene['tiles']，**完全不应用 tileEdits** ——
 *        mod 用 tileEdits 凿出来的门在规则眼里仍然是一堵墙，
 *        于是对完全合法的 example_mod 报「R4 出口不可走 (0,6)」；
 *        而引擎 isPassable('station_corridor', 0, 6) 返回 true。
 *     ② map_rules 用 bool(entry['passable']) 判可走，引擎用
 *        pass = 0 if (d.passable === false or d.solid) else 1 ——
 *        对「既没写 passable 也没写 solid」的图例条目，两边结论相反。
 *
 *   所以这里做最直接的验证：**把每个场景的每一格都比一遍**。
 *   引擎这边用 Core.createGame(...).grid(scene).pass（游戏真正跑的那张图），
 *   Python 那边用 tools/map_rules.py --dump-pass。
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
  var cands = [process.env.SPACE_PYTHON, 'python3', 'python', 'py'];
  for (var i = 0; i < cands.length; i++){
    if (!cands[i]) continue;
    var r = cp.spawnSync(cands[i], ['-c', 'import sys;sys.stdout.write(str(sys.version_info[0]))'], { encoding: 'utf8' });
    if (r.status === 0 && (r.stdout || '').trim() === '3') return cands[i];
  }
  return null;
}
var PY = findPython();
if (!PY){
  console.log('  ！找不到 Python 3（可用 SPACE_PYTHON=<路径> 指定）——这个测试没有它就等于没跑');
  console.log('\n通过 0 / 失败 1');
  process.exit(1);
}

var base = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'space.json'), 'utf8'));
var modPaths = ['example_mod', 'generated_world'].map(function (d){
  return path.join(ROOT, 'mods', d, 'mod.json');
}).filter(function (p){ return fs.existsSync(p); });
var mods = modPaths.map(function (p){ return JSON.parse(fs.readFileSync(p, 'utf8')); });

var r = cp.spawnSync(PY, [path.join(ROOT, 'tools', 'map_rules.py'), '--dump-pass',
                         path.join(ROOT, 'content', 'space.json')].concat(modPaths),
                     { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
if (r.status !== 0){
  ok('python map_rules --dump-pass 能跑通', false, ((r.stderr || '') + (r.stdout || '')).slice(0, 400));
  console.log('\n通过 ' + pass + ' / 失败 ' + fail);
  process.exit(1);
}
var pyGrids = JSON.parse(r.stdout);

var built = Core.load({ space: base, mods: mods });
var g = Core.createGame(built, {});

section('规则矩阵 vs 引擎编译出来的可走矩阵（逐格）');

var sceneIds = Object.keys(pyGrids);
ok('两边场景数一致（' + sceneIds.length + ' 个）',
   sceneIds.length === Core.asList(built.space.scenes).length,
   sceneIds.length + ' vs ' + Core.asList(built.space.scenes).length);

var mismatchedScenes = [], totalCells = 0, checkedScenes = 0;
sceneIds.forEach(function (id){
  var grid;
  try { grid = g.grid(id); } catch (e){ mismatchedScenes.push(id + '（引擎取不到网格：' + e.message + '）'); return; }
  if (!grid){ mismatchedScenes.push(id + '（引擎没有这张图）'); return; }
  var pm = pyGrids[id];
  if (grid.w !== pm[0].length || grid.h !== pm.length){
    mismatchedScenes.push(id + '（尺寸 ' + grid.w + 'x' + grid.h + ' vs ' + pm[0].length + 'x' + pm.length + '）');
    return;
  }
  var bad = [];
  for (var y = 0; y < grid.h; y++){
    for (var x = 0; x < grid.w; x++){
      totalCells++;
      var eng = grid.pass[y * grid.w + x] ? 1 : 0;
      var py = pm[y][x];
      if (eng !== py && bad.length < 6) bad.push('(' + x + ',' + y + ') 引擎=' + eng + ' 规则=' + py);
    }
  }
  checkedScenes++;
  if (bad.length) mismatchedScenes.push(id + '：' + bad.join(' , '));
});

ok('每个场景的每一格，规则与引擎结论一致 ★', mismatchedScenes.length === 0,
   mismatchedScenes.slice(0, 4).join('  |  '));
ok('确实比对到了内容（' + checkedScenes + ' 个场景 / ' + totalCells + ' 格）',
   checkedScenes > 80 && totalCells > 100000, checkedScenes + ' 场景 / ' + totalCells + ' 格');

section('tileEdits 必须被规则看见（踩过的坑）');

(function (){
  /* example_mod 在 station_corridor (0,6) 凿了一扇门。以前 map_rules 不看 tileEdits，
     把那格当墙，于是报 R4「出口不可走」。这里把它钉死。 */
  var cor = Core.asList(built.space.scenes).filter(function (s){ return s.id === 'station_corridor'; })[0];
  var edits = (cor && cor.tileEdits) || [];
  var door = edits.filter(function (e){ return e.x === 0 && e.y === 6; })[0];
  ok('合并后 station_corridor 在 (0,6) 有一处 tileEdit', !!door, JSON.stringify(edits.map(function (e){ return [e.x, e.y]; })));
  ok('引擎认为 (0,6) 可走（门生效了）', g.isPassable('station_corridor', 0, 6));
  ok('引擎认为 (0,5) 也不可走之外的那格——(0,4) 仍是墙', !g.isPassable('station_corridor', 0, 4));
  var pm = pyGrids['station_corridor'];
  ok('规则矩阵里 (0,6) 也是可走 ★', pm[6][0] === 1, '规则说 ' + pm[6][0]);
  ok('规则矩阵里 (0,5) 也可走（三格门）★', pm[5][0] === 1, '规则说 ' + pm[5][0]);
  ok('规则矩阵里 (0,7) 也可走（三格门）★', pm[7][0] === 1, '规则说 ' + pm[7][0]);
  ok('规则矩阵里 (0,4) 是墙', pm[4][0] === 0, '规则说 ' + pm[4][0]);
})();

section('反向保险：把门拆掉，规则必须立刻说不可走');

(function (){
  /* 造一份「没有 tileEdits」的合并结果，规则应把那格判成墙。
     如果它还说是可走的，说明上面的「一致」是碰巧，不是真的一致。 */
  var d = fs.mkdtempSync(require('os').tmpdir() + '/mrp-');
  var noEdit = JSON.parse(JSON.stringify(built.space));
  var cor2 = noEdit.scenes.list.filter(function (s){ return s.id === 'station_corridor'; })[0];
  cor2.tileEdits = [];
  var p = path.join(d, 'noedit.json');
  fs.writeFileSync(p, JSON.stringify(noEdit));
  var r2 = cp.spawnSync(PY, [path.join(ROOT, 'tools', 'map_rules.py'), '--dump-pass', p], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r2.status !== 0){ ok('反向保险能跑', false, ((r2.stderr || '') + (r2.stdout || '')).slice(0, 300)); return; }
  var pm2 = JSON.parse(r2.stdout)['station_corridor'];
  ok('拆掉 tileEdits 后 (0,6) 变回墙 ★', pm2[6][0] === 0, '规则说 ' + pm2[6][0]);
  try { fs.rmSync(d, { recursive: true, force: true }); } catch (e){}
})();

console.log('\n========================================');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
