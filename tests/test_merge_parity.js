/* =============================================================================
 * test_merge_parity.js  Python 合并器与引擎合并语义的等价性
 *   node tests/test_merge_parity.js
 *
 * 为什么必须有这个测试：
 *   tools/space_merge.py 把引擎的合并语义（normalizeSpace / applyMod / mergeBlock /
 *   mergeAtPath / patchItem / deepMerge）移植到了 Python —— 因为 Python 侧的校验器和
 *   构建器必须看懂 mod（否则「校验通过、进游戏地图整片变实心」）。
 *   但**两份实现就有跑偏的可能**，而且跑偏之后校验器的结论会变成假的，
 *   比没有校验器更危险。
 *
 *   所以这里把同一批 mod 同时喂给引擎和 Python，要求两边合并结果的 JSON
 *   **逐字节一致**（都按键排序后比较，排除键序差异的干扰）。
 *   模块注释里也写了：「和引擎的一致性靠 tests/test_merge_parity.js 保证」。
 *
 * 覆盖到的语义角落（A 部分每一条都有一个专门的 mod）：
 *   append 新增 / append 撞 id 不覆盖 / patch 字段级合并 / patch + _append /
 *   replace / remove 缺 allowRemove / remove 带 allowRemove / manifest 级 defaultOp /
 *   条目级 _op 覆盖 defaultOp / 嵌套块 galaxy.nodes + techTree.list + diplomacy.actions
 *   + tutorial.steps / 块内子键（techTree.branches）/ _howToAdd 与 _example 的带出 /
 *   白名单外的自定义块 / 全新顶层字段 / priority 与 order 排序 / config+palette+presets /
 *   条目缺 id / 删不存在的 id / manifest 与扁平两种 mod 形状
 * ========================================================================== */
var path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
var ROOT = path.join(__dirname, '..');
var Core = require(path.join(ROOT, 'engine', 'space-core.js'));

var pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond){ pass++; console.log('  ok   ' + name); }
  else { fail++; console.log('  FAIL ' + name + (extra !== undefined ? '   -> ' + extra : '')); }
}
function section(t){ console.log('\n=== ' + t + ' ==='); }

/* ---------------------------------------------------------------- 找 Python */
function findPython(){
  var cands = [process.env.SPACE_PYTHON, 'python3', 'python', 'py'];
  for (var i = 0; i < cands.length; i++){
    if (!cands[i]) continue;
    var r = cp.spawnSync(cands[i], ['-c', 'import sys;sys.stdout.write(str(sys.version_info[0]))'],
                         { encoding: 'utf8' });
    if (r.status === 0 && (r.stdout || '').trim() === '3') return cands[i];
  }
  return null;
}
var PY = findPython();

/* ---------------------------------------------------------------- 规范化比较 */
/* JS 的对象键序是「整数键在前 + 其余按插入序」，Python 的 dict 是插入序 ——
   直接 JSON.stringify 比较会被键序差异干扰。两边都递归按键排序后再比。 */
function canon(v){
  if (Array.isArray(v)) return v.map(canon);
  if (v !== null && typeof v === 'object'){
    var o = {};
    Object.keys(v).sort().forEach(function (k){ o[k] = canon(v[k]); });
    return o;
  }
  return v;
}
function canonText(v){ return JSON.stringify(canon(v)); }

/* ---------------------------------------------------------------- 跑两边 */
function runPython(basePath, modPaths){
  var r = cp.spawnSync(PY, [path.join(ROOT, 'tools', 'space_merge.py'), '--dump-json', basePath].concat(modPaths),
                       { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0){
    return { err: 'python 退出码 ' + r.status + '：' + ((r.stderr || '') + (r.stdout || '')).slice(0, 400) };
  }
  try { return { space: JSON.parse(r.stdout) }; }
  catch (e){ return { err: 'python 输出不是 JSON：' + (r.stdout || '').slice(0, 200) }; }
}
function runEngine(baseObj, modObjs){
  var built = Core.load({ space: baseObj, mods: modObjs });
  return built.space;
}

/* 把一批 mod 写进临时目录，两边各跑一次并比较 */
var tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-parity-'));
var tmpSeq = 0;
function parity(title, baseObj, modObjs){
  tmpSeq++;
  var dir = path.join(tmpDir, 'case' + tmpSeq);
  fs.mkdirSync(dir, { recursive: true });
  var basePath = path.join(dir, 'base.json');
  fs.writeFileSync(basePath, JSON.stringify(baseObj));
  var modPaths = modObjs.map(function (m, i){
    var p = path.join(dir, 'mod' + i + '.json');
    fs.writeFileSync(p, JSON.stringify(m));
    return p;
  });
  var py = runPython(basePath, modPaths);
  if (py.err){ ok(title, false, py.err); return null; }
  var js = runEngine(baseObj, modObjs);
  var a = canonText(js), b = canonText(py.space);
  if (a === b){ ok(title, true); return js; }
  /* 找出第一处不同的路径，别只丢一个「不相等」 */
  var where = firstDiff(canon(js), canon(py.space), '');
  ok(title, false, '引擎与 Python 结果不同，首处差异 ' + where);
  return null;
}
function firstDiff(a, b, p){
  /* 先做一次整体相等判断：不然走到空数组 / 空对象那种「容器相同但没得比」的地方，
     下面会掉进兜底的 return，把「相等」误报成「不同」。（这个 bug 是 C 部分的反向保险抓出来的） */
  if (JSON.stringify(a) === JSON.stringify(b)) return '';
  var ta = a === null ? 'null' : typeof a, tb = b === null ? 'null' : typeof b;
  if (ta !== tb) return p + '（类型 ' + ta + ' vs ' + tb + '）';
  if (ta === 'object'){
    var ka = Array.isArray(a) ? null : Object.keys(a), kb = Array.isArray(b) ? null : Object.keys(b);
    if (ka && kb){
      var all = ka.concat(kb.filter(function (k){ return ka.indexOf(k) < 0; }));
      for (var i = 0; i < all.length; i++){
        if (ka.indexOf(all[i]) < 0) return p + '.' + all[i] + '（只在 Python 里有）';
        if (kb.indexOf(all[i]) < 0) return p + '.' + all[i] + '（只在引擎里有）';
        var d = firstDiff(a[all[i]], b[all[i]], p + '.' + all[i]);
        if (d) return d;
      }
      return p;
    }
    if (a.length !== b.length) return p + '（长度 ' + a.length + ' vs ' + b.length + '）';
    for (var j = 0; j < a.length; j++){
      var d2 = firstDiff(a[j], b[j], p + '[' + j + ']');
      if (d2) return d2;
    }
    return '';
  }
  return p + '（' + JSON.stringify(a).slice(0, 60) + ' vs ' + JSON.stringify(b).slice(0, 60) + '）';
}

/* ================================================================ 开跑 */
console.log('test_merge_parity.js  —— Python 合并器 vs 引擎合并语义');
if (!PY){
  console.log('  ！找不到可用的 Python 3（可用 SPACE_PYTHON=<路径> 指定）');
  console.log('  ！这个测试是 Python 合并器不跑偏的唯一保证，跳过等于放弃它。');
  console.log('\n通过 0 / 失败 1');
  process.exit(1);
}
console.log('  用 ' + PY + '；仓库 ' + ROOT);

/* ---------------------------------------------------------------- A 合成内容 */
section('A. 语义角落：合成内容 + 每种行为一个 mod');

var base = {
  config: { defaultLegend: { '#': { name: '墙', solid: true }, '.': { name: '地面' } } },
  palette: { accent: '#fff' },
  presets: { a: { x: 1 } },
  scenes: { list: [
    { id: 'sc1', name: '甲', size: { w: 4, h: 3 }, tiles: ['####', '#..#', '####'], legend: {}, exits: [], lit: true },
    { id: 'sc2', name: '乙', size: { w: 4, h: 3 }, tiles: ['####', '#..#', '####'], legend: {}, exits: [], lit: true }
  ], _howToAdd: '原有说明' },
  npcs: { list: [{ id: 'n1', name: '甲人', symbol: 'A', color: 'accent', desc: '原来的描述',
                   tags: ['x'], extra: { a: 1, b: 2 } }] },
  views: { list: [{ id: 'v1', title: '原视图', lines: ['一'] }] },
  hooks: { list: [{ id: 'h1', on: 'tick', priority: 1 }] },
  galaxy: { nodes: [{ id: 'g1', name: '甲星' }, { id: 'g2', name: '乙星' }] },
  techTree: { list: [{ id: 't1', name: '科技一' }], branches: [{ id: 'b1', name: '支一' }] },
  diplomacy: { actions: [{ id: 'd1', name: '动作一' }] },
  tutorial: { steps: [{ id: 's1', text: '第一步' }] }
};

parity('1 append：新 id 直接进去',
  base, [{ manifest: { id: 'm_add' }, data: { scenes: { list: [{ id: 'sc9', name: '新场景' }] } } }]);

parity('2 append：撞已有 id 不覆盖（引擎会警告）',
  base, [{ manifest: { id: 'm_clash' }, data: { scenes: { list: [{ id: 'sc1', name: '想改名' }] } } }]);

parity('3 patch：字段级合并，没写的字段留着',
  base, [{ manifest: { id: 'm_patch' }, data: { npcs: { list: [
    { id: 'n1', _op: 'patch', name: '改过的名字', extra: { a: 9 } }] } } }]);

parity('4 patch + _append：数组追加、对象合并',
  base, [{ manifest: { id: 'm_append' }, data: { npcs: { list: [
    { id: 'n1', _op: 'patch', _append: { tags: ['y', 'z'], extra: { c: 3 } } }] } } }]);

parity('5 replace：整条换掉，多余字段不残留',
  base, [{ manifest: { id: 'm_repl' }, data: { npcs: { list: [
    { id: 'n1', _op: 'replace', name: '只留名字' }] } } }]);

parity('6 remove 没声明 allowRemove：忽略 + 警告',
  base, [{ manifest: { id: 'm_rm_no' }, data: { npcs: { list: [{ id: 'n1', _op: 'remove' }] } } }]);

parity('7 remove 声明了 allowRemove：真删',
  base, [{ manifest: { id: 'm_rm_yes', allowRemove: true }, data: { npcs: { list: [{ id: 'n1', _op: 'remove' }] } } }]);

parity('8 manifest.defaultOp=patch，条目仍然没写 _op',
  base, [{ manifest: { id: 'm_dop', defaultOp: 'patch' }, data: { npcs: { list: [
    { id: 'n1', name: '默认 patch 改的名' }] } } }]);

parity('9 manifest.defaultOp=replace，但条目 _op 覆盖回 patch',
  base, [{ manifest: { id: 'm_dop2', defaultOp: 'replace' }, data: { npcs: { list: [
    { id: 'n1', _op: 'patch', name: '条目说了算' }] } } }]);

parity('10 嵌套块：galaxy.nodes / techTree.list / diplomacy.actions / tutorial.steps',
  base, [{ manifest: { id: 'm_nested' }, data: {
    galaxy: { nodes: [{ id: 'g3', name: '丙星' }, { id: 'g1', name: '想覆盖甲星' }] },
    techTree: { list: [{ id: 't2', name: '科技二' }] },
    diplomacy: { actions: [{ id: 'd2', name: '动作二' }] },
    tutorial: { steps: [{ id: 's2', text: '第二步' }] }
  } }]);

parity('11 块内子键：techTree.branches 是嵌套块，别的子键走 deepMerge',
  base, [{ manifest: { id: 'm_sub' }, data: {
    techTree: { branches: [{ id: 'b2', name: '支二' }], note: '写着玩的' } } }]);

parity('12 _howToAdd / _example：只在原来没有的时候带出来',
  base, [{ manifest: { id: 'm_how' }, data: {
    scenes: { list: [], _howToAdd: '该被忽略（原来就有）' },
    views: { list: [], _howToAdd: '视图的说明', _example: { id: 'vx' } } } }]);

parity('13 白名单外的自定义块：deepMerge（数组整体替换）',
  base, [{ manifest: { id: 'm_custom' }, data: { myNotes: { list: [{ id: 'x1' }] }, newTop: 42 } },
         { manifest: { id: 'm_custom2', priority: 10 }, data: { myNotes: { list: [{ id: 'x2' }] } } }]);

parity('14 priority + order 排序：数字大的后合并因而占上风',
  base, [
    { manifest: { id: 'm_late', priority: 10, defaultOp: 'patch' }, data: { npcs: { list: [{ id: 'n1', name: '后合并的' }] } } },
    { manifest: { id: 'm_early', priority: 1, defaultOp: 'patch' }, data: { npcs: { list: [{ id: 'n1', name: '先合并的' }] } } },
    { manifest: { id: 'm_tie', priority: 10, order: 5, defaultOp: 'patch' }, data: { npcs: { list: [{ id: 'n1', name: '同优先级但 order 更大' }] } } }
  ]);

parity('15 config / palette / presets 走 deepMerge',
  base, [{ manifest: { id: 'm_cfg', config: { defaultLegend: { '~': { name: '水' } } },
                       palette: { warn: '#f00' }, presets: { b: { y: 2 } } },
           data: { scenes: { list: [{ id: 'sc3', name: '丙' }] } } }]);

parity('16 条目缺 id：跳过 + 警告，其余照常',
  base, [{ manifest: { id: 'm_noid' }, data: { scenes: { list: [{ name: '没 id' }, { id: 'sc4', name: '有 id' }] } } }]);

parity('17 删一个不存在的 id：警告后跳过',
  base, [{ manifest: { id: 'm_rmmiss', allowRemove: true }, data: { scenes: { list: [{ id: '不存在', _op: 'remove' }] } } }]);

parity('18 扁平形状的 mod（没有 manifest 包装）',
  base, [{ id: 'm_flat', name: '扁平', defaultOp: 'patch',
           data: { views: { list: [{ id: 'v1', title: '扁平改的标题' }] } } }]);

parity('19 未知的 _op：落到 append 分支（只警告）',
  base, [{ manifest: { id: 'm_badop' }, data: { npcs: { list: [{ id: 'n1', _op: '瞎写', name: 'x' }] } } }]);

parity('20 同一个 mod 加一堆块：顺序与相互影响',
  base, [{ manifest: { id: 'm_mix' }, data: {
    scenes: { list: [{ id: 'sc5', name: '戊' }, { id: 'sc1', name: '撞车的' }] },
    npcs: { list: [{ id: 'n1', _op: 'patch', _append: { tags: ['w'] } }] },
    views: { list: [{ id: 'v1', _op: 'replace', title: '换掉' }] }
  } }]);

/* ---------------------------------------------------------------- B 真实内容 */
section('B. 真实仓库：content/space.json + mods/ 下的真 mod');

var realBase = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'space.json'), 'utf8'));
var realModPaths = [];
['example_mod', 'generated_world'].forEach(function (d){
  var p = path.join(ROOT, 'mods', d, 'mod.json');
  if (fs.existsSync(p)) realModPaths.push(p);
});
ok('找得到真 mod 文件（' + realModPaths.length + ' 个）', realModPaths.length > 0, realModPaths.join(', '));

if (realModPaths.length){
  var realMods = realModPaths.map(function (p){ return JSON.parse(fs.readFileSync(p, 'utf8')); });
  var built = parity('21 真实内容 + example_mod + generated_world 全量合并一致', realBase, realMods);
  if (built){
    /* 顺带把「合并后到底有多少内容」钉住 —— 数字变了就说明合并语义动了 */
    ok('合并后场景数合理（25 -> 90）',
       Core.asList(built.scenes).length === 90, Core.asList(built.scenes).length);
    ok('合并后 NPC 数合理（38 -> 75）',
       Core.asList(built.npcs).length === 75, Core.asList(built.npcs).length);
  }
}

/* 真实 mod 单独跑一次：只有 example_mod（生成世界太大，单独验一次更清楚） */
var onlyExample = realModPaths.filter(function (p){ return /example_mod/.test(p); });
if (onlyExample.length){
  parity('22 真实内容 + 只有 example_mod',
    realBase, onlyExample.map(function (p){ return JSON.parse(fs.readFileSync(p, 'utf8')); }));
}

/* ---------------------------------------------------------------- 反向保险 */
section('C. 反向保险：故意造一处不一致，确认比较器真的抓得住');

(function (){
  var d1 = path.join(tmpDir, 'neg');
  fs.mkdirSync(d1, { recursive: true });
  var bp = path.join(d1, 'base.json');
  fs.writeFileSync(bp, JSON.stringify(base));
  var mp = path.join(d1, 'm.json');
  fs.writeFileSync(mp, JSON.stringify({ manifest: { id: 'x' }, data: { scenes: { list: [{ id: 'zz', name: 'n' }] } } }));
  var py = runPython(bp, [mp]);
  if (py.err){ ok('反向保险：Python 能跑', false, py.err); return; }
  var js = runEngine(base, [{ manifest: { id: 'x' }, data: { scenes: { list: [{ id: 'zz', name: 'n' }] } } }]);
  /* 人为把 Python 结果改一个字段，确认 firstDiff 能定位 */
  var tampered = JSON.parse(JSON.stringify(py.space));
  tampered.scenes.list[0].name = '被篡改的名字';
  var where = firstDiff(canon(js), canon(tampered), '');
  ok('比较器能定位到被改的字段', /scenes\.list/.test(where) && /name/.test(where), where || '(没定位到)');
})();

try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e){ /* 临时目录清不掉不影响结论 */ }

console.log('\n========================================');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
