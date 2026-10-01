/* =============================================================================
 * test_validate.js  tools/validate_space.py 的 mod 能力与「不再假通过」
 *   node tests/test_validate.js
 *
 * 守的是第 1 期的核心承诺：**校验器必须看得懂 mod，而且不许说假话。**
 *
 * 修之前的样子（实测）：
 *     $ python tools/validate_space.py mods/example_mod/mod.json
 *       场景 0 / 人 0 / 对话 0 / 物件 0 / 视图 0 / 日程 0
 *       错误 0 / 警告 0            <- 静默假通过，什么都验不出来
 * 于是「玩家改坏了 mod -> 校验器说没问题 -> 进游戏地图整片变实心」。
 * 低门槛路线的致命伤不在功能，在这里。
 *
 * 现在要有：
 *   ① 把 mod 当内容传 -> 明确拒绝（exit 2），不再假通过；
 *   ② --mods / --mods-dir 合并后校验，结论以**合并结果**为准；
 *   ③ 坏 mod 要报出错误并 exit 1（R9 尺寸 / R4 出口 / R7 开敞率…）；
 *   ④ 老用法（不带参数、或传一个内容文件）逐字不变；
 *   ⑤ mod 撞 id 这类合并期问题要出现在结论里，不能静默丢掉。
 * ========================================================================== */
var path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
var ROOT = path.join(__dirname, '..');
var TOOL = path.join(ROOT, 'tools', 'validate_space.py');
var BUILDER = path.join(ROOT, 'build_space.py');

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
  console.log('  ！找不到 Python 3（可用 SPACE_PYTHON=<路径> 指定）——校验器是 Python 写的，没它就测不了');
  console.log('\n通过 0 / 失败 1');
  process.exit(1);
}

function run(args, cwd){
  var r = cp.spawnSync(PY, [TOOL].concat(args), { encoding: 'utf8', cwd: cwd || ROOT, maxBuffer: 64 * 1024 * 1024 });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function lastLine(s){ return s.trim().split('\n').pop(); }

var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'space-val-'));

/* ---------------------------------------------------------------- ① 老用法不变 */
section('① 老用法逐字不变（命令链第 4 步就靠它）');

var r0 = run([]);
ok('不带参数：exit 0', r0.code === 0, 'exit=' + r0.code + ' ' + r0.out.slice(0, 200));
ok('不带参数：仍然是 0 错 0 警', /错误 0 \/ 警告 0/.test(r0.out), lastLine(r0.out));
ok('不带参数：仍然报 25 个场景', /场景 25 /.test(r0.out), r0.out.split('\n')[1]);

var r1 = run([path.join('content', 'space.json')]);
ok('传内容文件：exit 0 且结论相同', r1.code === 0 && /错误 0 \/ 警告 0/.test(r1.out));

/* ---------------------------------------------------------------- ② 不再假通过 */
section('② 把 mod 当内容传：必须明确拒绝（这是修掉的那个假通过）★');

var r2 = run([path.join('mods', 'example_mod', 'mod.json')]);
ok('exit 2（不是 0）★', r2.code === 2, 'exit=' + r2.code);
ok('明确说「看起来是一个 mod 文件」★', /看起来是一个 \*\*mod 文件\*\*/.test(r2.out), r2.out.slice(0, 200));
ok('给出正确用法（--mods）★', /--mods/.test(r2.out));
ok('不再打印「错误 0 / 警告 0」冒充通过 ★', !/错误 0 \/ 警告 0/.test(r2.out), lastLine(r2.out));

/* ---------------------------------------------------------------- ③ 合并后校验 */
section('③ --mods / --mods-dir：以合并结果为准');

var r3 = run(['--mods-dir', 'mods']);
ok('--mods-dir mods：exit 0', r3.code === 0, r3.out.slice(0, 300));
ok('报的是合并后的场景数（25 -> 90）★', /场景 90 /.test(r3.out), r3.out.split('\n').filter(function (l){ return /场景/.test(l); })[0]);
ok('打印每个 mod 的增量', /generated_world/.test(r3.out) && /example_mod/.test(r3.out));
ok('合并后仍然 0 错 0 警', /错误 0 \/ 警告 0/.test(r3.out), lastLine(r3.out));

var r4 = run(['--mods', path.join('mods', 'example_mod', 'mod.json')]);
ok('单个 mod 走 --mods：exit 0', r4.code === 0, r4.out.slice(0, 300));

/* ---------------------------------------------------------------- ④ 坏 mod 要被抓住 */
section('④ 坏 mod 必须报错并 exit 1 ★');

var badDir = path.join(tmp, 'mods', 'bad_mod');
fs.mkdirSync(badDir, { recursive: true });
fs.writeFileSync(path.join(badDir, 'mod.json'), JSON.stringify({
  id: 'bad_mod', name: '坏 mod', priority: 99,
  data: { scenes: { list: [{
    id: 'bad_scene', name: '小房间', type: 'space_station',
    size: { w: 10, h: 6 },
    tiles: ['##########', '#........#', '#........#', '#........#', '#........#', '##########'],
    legend: {}, exits: [{ x: 0, y: 2, to: 'station_corridor', at: { x: 2, y: 6 } }], lit: true
  }] } }
}));
var r5 = run(['--mods-dir', path.join(tmp, 'mods')]);
ok('坏 mod：exit 1 ★', r5.code === 1, 'exit=' + r5.code);
ok('报出 R9 尺寸越界 ★', /R9 尺寸越界：10x6/.test(r5.out), lastLine(r5.out));
ok('报出 R4 出口不可走 ★', /R4 出口不可走 \(0,2\)/.test(r5.out));
ok('报出 R7 开敞率太低 ★', /R7 开敞率太低/.test(r5.out));

section('④b 只把一个 mod 弄坏，基础内容本身仍是好的');

var r6 = run(['--mods', path.join('mods', 'example_mod', 'mod.json')]);
ok('同一个基础内容 + 好 mod：0 错（说明错是 mod 带进来的，不是基础内容坏了）',
   r6.code === 0 && /错误 0 \/ 警告 0/.test(r6.out), lastLine(r6.out));

/* ---------------------------------------------------------------- ⑤ 冲突可见 */
section('⑤ mod 之间撞 id：要出现在结论里，不能静默丢掉 ★');

var clashDir = path.join(tmp, 'clash');
fs.mkdirSync(clashDir, { recursive: true });
fs.writeFileSync(path.join(clashDir, 'a.json'), JSON.stringify({
  manifest: { id: 'mod_a', priority: 1, defaultOp: 'patch' },
  data: { scenes: { list: [{ id: 'station_corridor', name: 'A 改的名字' }] } }
}));
fs.writeFileSync(path.join(clashDir, 'b.json'), JSON.stringify({
  manifest: { id: 'mod_b', priority: 2, defaultOp: 'patch' },
  data: { scenes: { list: [{ id: 'station_corridor', name: 'B 改的名字' }] } }
}));
fs.writeFileSync(path.join(clashDir, 'c.json'), JSON.stringify({
  manifest: { id: 'mod_c', priority: 3 },
  data: { scenes: { list: [{ id: 'station_corridor', name: 'C 想 append 覆盖（应该不生效）' }] } }
}));
var r7 = run(['--mods', path.join(clashDir, 'a.json'), path.join(clashDir, 'b.json'), path.join(clashDir, 'c.json')]);
ok('撞 id 的 mod：仍然 exit 0（只警告不报错）', r7.code === 0, 'exit=' + r7.code);
ok('结论里出现「append 模式不覆盖」★', /append 模式不覆盖/.test(r7.out), lastLine(r7.out));
ok('提到是哪个 mod 做的 ★', /mod\[mod_c\]/.test(r7.out));
ok('给了解法提示（要用 _op:"patch"）', /_op:"patch"/.test(r7.out));

/* ---------------------------------------------------------------- ⑥ 参数错误 */
section('⑥ 参数与路径出错时要说清楚');

var r8 = run(['--mods-dir', path.join(tmp, '不存在的目录')]);
ok('目录不存在：exit 2 并说明', r8.code === 2 && /目录不存在/.test(r8.out), 'exit=' + r8.code + ' ' + r8.out.slice(0, 120));
var r9 = run(['--瞎写的参数']);
ok('未知参数：exit 2', r9.code === 2, 'exit=' + r9.code);
var r10 = run([path.join(tmp, '没有这个文件.json')]);
ok('文件不存在：exit 2', r10.code === 2, 'exit=' + r10.code);

/* ---------------------------------------------------------------- ⑦ 构建期那道闸 */
section('⑦ build_space.py 也校验合并结果（坏 mod 不许出厂）★');

var badBuild = cp.spawnSync(PY, [BUILDER, '--no-context', '--mods', path.join(tmp, 'mods')],
                            { encoding: 'utf8', cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
var bOut = (badBuild.stdout || '') + (badBuild.stderr || '');
ok('构建带坏 mod：exit 非 0 ★', badBuild.status !== 0, 'exit=' + badBuild.status);
ok('构建报出校验没过 ★', /内容校验没过/.test(bOut), bOut.slice(0, 200));
ok('构建提示了逃生口 --no-check', /--no-check/.test(bOut));

var htmlPath = path.join(ROOT, 'space-text.html');
var stampBefore = fs.existsSync(htmlPath) ? fs.statSync(htmlPath).mtimeMs : 0;
cp.spawnSync(PY, [BUILDER, '--no-context', '--mods', path.join(tmp, 'mods')], { encoding: 'utf8', cwd: ROOT });
var stampAfter = fs.existsSync(htmlPath) ? fs.statSync(htmlPath).mtimeMs : 0;
ok('校验没过时产物没被写（闸在写文件之前）★', stampBefore === stampAfter,
   'mtime ' + stampBefore + ' -> ' + stampAfter);

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e){}

console.log('\n========================================');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
