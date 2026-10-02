/* =============================================================================
 * test_terrain.js  地形连贯性与群系（第 3 期）
 *   node tests/test_terrain.js
 *
 * 守的是什么：
 *   改之前，地表是「先整片挖成地板、再随机撒几团石头」，裂隙是「0.63 均匀随机 + 三次元胞平滑」——
 *   都是**白噪声**：整张图哪儿都一样，没有山脊、没有河谷、没有林间空地。
 *   地形和行星类型毫无关系：岩质星球和丛林星球的地表长得一模一样。
 *
 * 现在要有的性质（每条都有断言）：
 *   ① **连贯**：地形是「大块连着的」，不是麻点 —— 用同样密度的白噪声做对照，
 *      最大连通实心块要比它大一个数量级；这一条是本期最核心的证据；
 *   ② 群系决定**材质**：岩脊 ^ / 熔岩沟与沼面 ~ / 林间 %；
 *   ③ 群系决定**形状**：成团(blobs) / 长条(cracks) / 台地(plateaus) / 残墙(ruins) 统计上分得开；
 *   ④ 行星类型 18 种全部映射到存在的群系；
 *   ⑤ 噪声确定：同参数同结果、不同种子不同结果；
 *   ⑥ 生成的图**一条规则都不破**：R1~R13 无错误，而且 R6 连警告都没有
 *      （VISION 明说不为生成器放宽规则，所以是生成器守规矩，不是规则让步）；
 *   ⑦ 世界层面：生成的宇宙里出现多种地貌，走进去按 X 能看到地貌名。
 * ========================================================================== */
var path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');
var ROOT = path.join(__dirname, '..');

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
  console.log('  ！找不到 Python 3（可用 SPACE_PYTHON=<路径> 指定）——地形生成器是 Python 写的');
  console.log('\n通过 0 / 失败 1');
  process.exit(1);
}

var probePath = process.env.SPACE_TERRAIN_PROBE || '/tmp/space_terrain_probe.py';
fs.writeFileSync(probePath, [
"import sys, os, json, random",
"ROOT = sys.argv[1]; MODE = sys.argv[2]",
"sys.path.insert(0, os.path.join(ROOT, 'tools'))",
"import gen_maps as GM, gen_world as GW, map_rules as MR",
"SOLID = set(GM.SOLID_CHARS)",
"def out(o): sys.stdout.write(json.dumps(o, ensure_ascii=False, separators=(',', ':')))",
"def clusters(tiles):",
"    H, W = len(tiles), len(tiles[0]); seen = [[0]*W for _ in range(H)]; res = []",
"    for y in range(H):",
"        for x in range(W):",
"            if tiles[y][x] not in SOLID or seen[y][x]: continue",
"            st = [(x, y)]; seen[y][x] = 1; n = 0; xs = set(); ys = set()",
"            while st:",
"                cx, cy = st.pop(); n += 1; xs.add(cx); ys.add(cy)",
"                for nx, ny in ((cx-1,cy),(cx+1,cy),(cx,cy-1),(cx,cy+1)):",
"                    if 0 <= nx < W and 0 <= ny < H and tiles[ny][nx] in SOLID and not seen[ny][nx]:",
"                        seen[ny][nx] = 1; st.append((nx, ny))",
"            res.append({'n': n, 'w': max(xs)-min(xs)+1, 'h': max(ys)-min(ys)+1})",
"    res.sort(key=lambda c: -c['n']); return res",
"def stat(tiles):",
"    cl = clusters(tiles); tot = sum(c['n'] for c in cl) or 1",
"    return {'count': len(cl), 'max': cl[0]['n'] if cl else 0,",
"            'top5': [c['n'] for c in cl[:5]],",
"            'elong': (cl[0]['w'] / float(cl[0]['h'])) if cl else 0}",
"if MODE == 'biomes':",
"    res = {}",
"    for b in GM.BIOMES:",
"        rows = []",
"        for s in range(6):",
"            sc = GM.gen_scene('surface', 't%d|%s' % (s, b), 't_%s_%d' % (b, s), 3, biome=b, planet_type='rock')",
"            tiles = sc['tiles']; W, H = sc['size']['w'], sc['size']['h']",
"            chars = {}",
"            for row in tiles:",
"                for ch in row: chars[ch] = chars.get(ch, 0) + 1",
"            errs, warns = MR.check_scene(GM.SPACE, sc, GM.PASSABLE, None)",
"            rows.append({'stat': stat(tiles), 'open': (chars.get('.', 0) + chars.get('+', 0)) / float(W*H),",
"                         'chars': chars, 'errs': errs, 'warns': warns})",
"        res[b] = {'rows': rows, 'solid': GM.BIOMES[b]['solid'], 'pattern': GM.BIOMES[b]['pattern'],",
"                  'name': GM.BIOMES[b]['name']}",
"    out(res)",
"elif MODE == 'control':",
"    # 对照组：同样密度的白噪声 —— 旧做法（随机撒点）的本质",
"    res = {}",
"    for dens in (0.18, 0.30):",
"        rnd = random.Random(7); W, H = 80, 26",
"        tiles = [''.join('^' if rnd.random() < dens else '.' for _ in range(W)) for _ in range(H)]",
"        res[str(dens)] = stat(tiles)",
"    out(res)",
"elif MODE == 'noise':",
"    a = GM.fbm(40, 20, 12345, 4, 8.0)",
"    b = GM.fbm(40, 20, 12345, 4, 8.0)",
"    c = GM.fbm(40, 20, 999, 4, 8.0)",
"    flat = [v for row in a for v in row]",
"    # 相邻格差值的均值：白噪声约 1/3，连贯场应该小得多",
"    dif = []",
"    for y in range(20):",
"        for x in range(1, 40): dif.append(abs(a[y][x] - a[y][x-1]))",
"    dif2 = []",
"    rnd = random.Random(3)",
"    for y in range(20):",
"        for x in range(1, 40): dif2.append(abs(rnd.random() - rnd.random()))",
"    out({'same': a == b, 'diff': a != c,",
"         'lo': min(flat), 'hi': max(flat), 'mean': sum(flat)/len(flat),",
"         'neigh': sum(dif)/len(dif), 'white_neigh': sum(dif2)/len(dif2)})",
"elif MODE == 'maptypes':",
"    sp = GM.SPACE",
"    pts = [p['id'] for p in sp['planetTypes']['list']]",
"    res = {}",
"    for p in pts: res[p] = GM.biome_of(p)",
"    out({'planet_types': pts, 'map': res, 'biomes': sorted(GM.BIOMES),",
"         'under': {p: GM.under_biome(p) for p in pts}})",
"elif MODE == 'world':",
"    w = GW.make_world('terrain', 14)",
"    scs = w['data']['scenes']['list']",
"    bio = {}",
"    for s in scs:",
"        a = s.get('ambient') or ''",
"        if '地貌：' in a:",
"            nm = a.split('地貌：')[-1].rstrip('。').split('（')[0]",
"            bio[nm] = bio.get(nm, 0) + 1",
"    chars = {}",
"    for s in scs:",
"        for row in (s.get('tiles') or []):",
"            for ch in row: chars[ch] = chars.get(ch, 0) + 1",
"    out({'biomes': bio, 'chars': chars, 'scenes': len([s for s in scs if s.get('tiles')])})",
"else: out({'error': 'unknown mode'})",
].join('\n'), 'utf8');

function probe(mode){
  var r = cp.spawnSync(PY, [probePath, ROOT, mode], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  var txt = (r.stdout || '').trim();
  if (r.status !== 0 || !txt){
    return { __err: 'python 退出码 ' + r.status + '：' + ((r.stderr || '') + txt).slice(0, 400) };
  }
  try { return JSON.parse(txt); }
  catch (e){ return { __err: '输出不是 JSON：' + txt.slice(0, 200) }; }
}

console.log('test_terrain.js  —— 地形连贯性与群系');
console.log('  用 ' + PY);

/* ---------------------------------------------------------------- ① 连贯性 */
section('① 连贯：地形是「大块连着的」，不是麻点（用白噪声做对照）★');

var B = probe('biomes'), CTRL = probe('control');
if (B.__err || CTRL.__err){ ok('跑得动地形生成', false, B.__err || CTRL.__err); }
else {
  /* 别写死 CTRL['0.30']：Python 的 str(0.30) 是 '0.3'，键名跟 JS 里想的不一样。按键遍历最稳。 */
  var ctrlKeys = Object.keys(CTRL);
  var ctrlMax = Math.max.apply(null, ctrlKeys.map(function (k){ return CTRL[k].max; }));
  var ctrlCount = Math.min.apply(null, ctrlKeys.map(function (k){ return CTRL[k].count; }));
  ok('白噪声对照组算出来了（两档密度）', ctrlKeys.length === 2, ctrlKeys.join(','));
  var worstMax = Math.min.apply(null, Object.keys(B).map(function (k){
    return Math.min.apply(null, B[k].rows.map(function (r){ return r.stat.max; }));
  }));
  ok('每一种群系的最大实心连通块都远大于同密度白噪声 ★',
     worstMax > ctrlMax * 4, '地形最差 ' + worstMax + ' 格 vs 白噪声最好 ' + ctrlMax + ' 格');
  var worstCount = Math.max.apply(null, Object.keys(B).map(function (k){
    return Math.max.apply(null, B[k].rows.map(function (r){ return r.stat.count; }));
  }));
  ok('实心块的数量远少于白噪声（不是碎成一地）★',
     worstCount < ctrlCount / 2, '地形最多 ' + worstCount + ' 块 vs 白噪声最少 ' + ctrlCount + ' 块');
  console.log('       ' + '群系'.padEnd(10) + '实心块数  最大块  开敞率  材质  图案');
  Object.keys(B).forEach(function (k){
    var r = B[k].rows[0];
    console.log('       ' + k.padEnd(12) + String(r.stat.count).padStart(4)
      + String(r.stat.max).padStart(8) + ('  ' + Math.round(r.open * 100) + '%').padStart(8)
      + '   ' + B[k].solid + '    ' + B[k].pattern);
  });
  console.log('       白噪声对照：' + ctrlKeys.map(function (k){
    return '密度' + k + ' 最大块 ' + CTRL[k].max + ' / ' + CTRL[k].count + ' 块';
  }).join('，'));
}

/* ---------------------------------------------------------------- ② 材质 */
section('② 群系决定材质：岩脊 ^ / 熔岩沟与沼面 ~ / 林间 %');

if (!B.__err){
  var badMat = [];
  Object.keys(B).forEach(function (k){
    var want = B[k].solid;
    B[k].rows.forEach(function (r){
      if (!(r.chars[want] > 0)) badMat.push(k + ' 没有生成 ' + want);
      if (r.chars['~'] && want !== '~') badMat.push(k + ' 混进了 ~');
      if (r.chars['%'] && want !== '%') badMat.push(k + ' 混进了 %');
    });
  });
  ok('每张图都用了它该用的材质，且不混别的群系材质 ★', badMat.length === 0, badMat.slice(0, 4).join(' | '));
  ok('三种材质在全部群系里都出现过（^ / ~ / % 各有归属）',
     ['^', '~', '%'].every(function (c){
       return Object.keys(B).some(function (k){ return B[k].rows[0].chars[c] > 0; });
     }));
}

/* ---------------------------------------------------------------- ③ 形状 */
section('③ 群系决定形状：成团 / 长条 / 台地 / 残墙 分得开 ★');

if (!B.__err){
  var blobs = ['ridge', 'grove', 'cave', 'marsh'], cracks = ['lava', 'fissure'];
  var maxOf = function (list){
    return Math.min.apply(null, list.map(function (k){
      return Math.min.apply(null, B[k].rows.map(function (r){ return r.stat.max; }));
    }));
  };
  var countOf = function (list){
    return Math.min.apply(null, list.map(function (k){
      return Math.min.apply(null, B[k].rows.map(function (r){ return r.stat.count; }));
    }));
  };
  ok('「成团」图案的最大块比「长条」图案大（形状真的不同）★',
     maxOf(blobs) > maxOf(cracks), '成团 ' + maxOf(blobs) + ' vs 长条 ' + maxOf(cracks));
  ok('「长条」图案的块数比「成团」多（沟壑是碎的）★',
     countOf(cracks) > countOf(blobs), '长条 ' + countOf(cracks) + ' vs 成团 ' + countOf(blobs));
  var dunes = B['dunes'] && Math.min.apply(null, B['dunes'].rows.map(function (r){ return r.stat.max; }));
  ok('沙丘（台地）的最大块比岩脊大（量化成台地后更成整片）',
     dunes >= Math.min.apply(null, B['ridge'].rows.map(function (r){ return r.stat.max; })),
     'dunes ' + dunes);
}

/* ---------------------------------------------------------------- ④ 规则 */
section('④ 生成的图一条规则都不破（含 R6 连警告都没有）★');

if (!B.__err){
  var anyErr = [], anyWarn = [], openBad = [];
  Object.keys(B).forEach(function (k){
    B[k].rows.forEach(function (r){
      if (r.errs.length) anyErr.push(k + ': ' + r.errs[0]);
      if (r.warns.length) anyWarn.push(k + ': ' + r.warns[0]);
      if (r.open < 0.55) openBad.push(k + ' 开敞率 ' + Math.round(r.open * 100) + '%');
    });
  });
  ok('R1~R13 无错误（每种群系 6 个种子）★', anyErr.length === 0, anyErr.slice(0, 4).join(' | '));
  ok('连 R6 软规则都没有警告（生成器自己守规矩，不是规则让步）★',
     anyWarn.length === 0, anyWarn.slice(0, 4).join(' | '));
  ok('R7 开敞率都 >= 55% ★', openBad.length === 0, openBad.slice(0, 4).join(' | '));
}

/* ---------------------------------------------------------------- ⑤ 噪声 */
section('⑤ 噪声是确定性的，而且不是白噪声');

var N = probe('noise');
if (N.__err){ ok('跑得动噪声', false, N.__err); }
else {
  ok('同参数同结果（可复现）★', N.same === true);
  ok('换种子换结果（不会退化成常量场）★', N.diff === true);
  /* fbm 是多层叠加，取值天然往中间收（中心极限），不会像单层噪声那样铺满 [0,1) ——
     所以要求「够宽」而不是「顶到两头」：跨度 > 0.3 且均值在中间。 */
  ok('取值跨度够大（不会退化成接近常量场）',
     N.hi - N.lo > 0.3 && N.mean > 0.3 && N.mean < 0.7,
     'lo ' + N.lo.toFixed(3) + ' hi ' + N.hi.toFixed(3) + ' 跨度 ' + (N.hi - N.lo).toFixed(3) + ' mean ' + N.mean.toFixed(3));
  ok('相邻格差值的均值远小于白噪声（这就是「连贯」的定义）★',
     N.neigh < N.white_neigh / 3,
     '连贯场 ' + N.neigh.toFixed(4) + ' vs 白噪声 ' + N.white_neigh.toFixed(4));
}

/* ---------------------------------------------------------------- ⑥ 行星映射 */
section('⑥ 18 种行星类型全部映射到存在的群系');

var M = probe('maptypes');
if (M.__err){ ok('跑得动行星映射', false, M.__err); }
else {
  ok('planetTypes 有 18 种', M.planet_types.length === 18, M.planet_types.length);
  var unmapped = M.planet_types.filter(function (p){ return M.biomes.indexOf(M.map[p]) < 0; });
  ok('每一种都映射到存在的群系（没有落到未定义的兜底）★', unmapped.length === 0, unmapped.join(','));
  var badUnder = M.planet_types.filter(function (p){ return M.biomes.indexOf(M.under[p]) < 0; });
  ok('地下层的群系也都有效', badUnder.length === 0, badUnder.join(','));
  var used = {};
  M.planet_types.forEach(function (p){ used[M.map[p]] = (used[M.map[p]] || 0) + 1; });
  console.log('       映射：' + Object.keys(used).sort().map(function (b){ return b + '×' + used[b]; }).join('  '));
  var volcano = M.planet_types.filter(function (p){ return M.map[p] === 'lava'; });
  ok('火山 / 熔海走熔岩沟，别的是别的（没有一刀切）', volcano.length >= 2, volcano.join(','));
}

/* ---------------------------------------------------------------- ⑦ 世界层面 */
section('⑦ 生成的宇宙里出现多种地貌，走进去看得到');

var W = probe('world');
if (W.__err){ ok('跑得动世界生成', false, W.__err); }
else {
  var names = Object.keys(W.biomes);
  ok('一个世界里出现 >= 3 种地貌 ★', names.length >= 3, JSON.stringify(W.biomes));
  ok('地貌名写进了场景 ambient（走进去按 X 看得到）★',
     Object.keys(W.biomes).every(function (n){ return n && n.length >= 2; }), names.join(','));
  /* 第 1 期加了家具与容器（b 床 / t 桌 / m 机器 / v 盆栽 / c 柜 / r 货箱）——
     允许集合要跟着放开，但仍然要求**没有冒出没登记的字符**。 */
  ok('地图字符都在登记表里（墙/地板/门/地形/家具/容器）★',
     Object.keys(W.chars).every(function (c){ return '#.+^~%btmvcr'.indexOf(c) >= 0; }),
     Object.keys(W.chars).join(''));
  console.log('       地貌分布：' + Object.keys(W.biomes).map(function (k){ return k + '×' + W.biomes[k]; }).join('  '));
}

/* ---------------------------------------------------------------- ⑧ 自检 */
section('⑧ 生成器自检');

['gen_maps.py --selftest 10', 'gen_world.py --selftest'].forEach(function (cmd){
  var parts = cmd.split(' ');
  var r = cp.spawnSync(PY, [path.join(ROOT, 'tools', parts[0])].concat(parts.slice(1)), { encoding: 'utf8' });
  var o = ((r.stdout || '') + (r.stderr || '')).trim();
  ok(parts[0] + ' 通过', r.status === 0, o.slice(-200));
});

if (!process.env.SPACE_TERRAIN_PROBE){ try { fs.unlinkSync(probePath); } catch (e){} }

console.log('\n========================================');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
