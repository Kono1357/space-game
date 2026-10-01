/* =============================================================================
 * test_names.js  命名与文化体系（第 2 期）
 *   node tests/test_names.js
 *
 * 守的是什么：
 *   改之前，名字来自**一个全局音节池**（SYL_A 28 字 + SYL_B 24 字 + 12 个类型词），
 *   unique_name(rnd, used) 的签名里根本没有「这是谁的站点」——
 *   于是深渊的矿站、铁合唱的前哨、残响议会的殖民地，起名的是一个脑子。
 *   而手写层是另一套（索尔 / 长夜锚地 / 铁砧 / 凯尔 / 石川），生成器读不到。
 *   两层名字互不相干，看起来不像同一个宇宙。
 *
 * 现在要有的性质（每一条都在下面有断言）：
 *   ① 每套文化有自己的词表，站点按**归属派系**选语言；
 *   ② 生成的名字只用该文化的词 —— 这是「数据驱动」而不是「换个写法硬编码」的证明；
 *   ③ 不同派系的站点听起来是三拨人起的名；
 *   ④ 类型词跟站点种类对得上（裂隙带不会被叫成中继站）；
 *   ⑤ 生成的地名不和手写层的地名重名（两层名字在同一张表上）；
 *   ⑥ 确定：同一个 seed 两次生成完全一样；站点名互不重复；
 *   ⑦ **mod 能加一套新语言并被用上**（不用改 gen_world.py）；
 *   ⑧ 坏掉的文化表只降级不崩（缺字段跳过 + 报问题，生成照常）。
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
  console.log('  ！找不到 Python 3（可用 SPACE_PYTHON=<路径> 指定）——命名逻辑在 Python 侧，没它就测不了');
  console.log('\n通过 0 / 失败 1');
  process.exit(1);
}

/* ---------------------------------------------------------------- 探针脚本 */
/* 把「跑生成器、读文化表」放在 Python 侧做，Node 这边只负责断言。
   探针是临时的，不落进仓库。 */
var probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'space-names-'));
var probePath = path.join(probeDir, 'probe.py');
fs.writeFileSync(probePath, [
"import sys, os, json, io, random, tempfile",
"ROOT = sys.argv[1]; MODE = sys.argv[2]",
"sys.path.insert(0, os.path.join(ROOT, 'tools'))",
"import gen_world as G, gen_maps as GM, space_merge",
"def out(o):",
"    sys.stdout.write(json.dumps(o, ensure_ascii=False, separators=(',', ':')))",
"def cults_json(cs):",
"    return [{'id': c['id'], 'name': c.get('name'), 'owners': c.get('owners') or [],",
"             'placeA': c['placeA'], 'placeB': c.get('placeB') or [],",
"             'personA': c['personA'], 'personB': c.get('personB') or []} for c in cs]",
"if MODE == 'cultures':",
"    by_owner, cults, fb, probs = G.load_cultures()",
"    out({'cults': cults_json(cults), 'by_owner': {k: v['id'] for k, v in by_owner.items()},",
"         'fallback': fb['id'], 'problems': probs,",
"         'factions': [f['id'] for f in GM.SPACE['factions']['list']],",
"         'hand_written_nodes': [n.get('name') for n in (GM.SPACE.get('galaxy') or {}).get('nodes', [])],",
"         'kind_suf': G.KIND_SUF, 'suf_all': G.SUF_ALL})",
"elif MODE == 'world':",
"    seed, sites = sys.argv[3], int(sys.argv[4])",
"    by_owner, cults, fb, probs = G.load_cultures()",
"    w = G.make_world(seed, sites)",
"    d = w['data']",
"    nodes = [{'name': n['name'], 'owner': n.get('owner')} for n in d['galaxy']['nodes']]",
"    for n in nodes:",
"        c = G.culture_for(by_owner, fb, n['owner'])",
"        n['culture'] = c['id']; n['stem'] = n['name'].split(G.SEP)[0]; n['suffix'] = n['name'].split(G.SEP)[-1]",
"    npcs = [{'name': x['name'], 'faction': x.get('faction'), 'id': x.get('id')} for x in d['npcs']['list']]",
"    for x in npcs:",
"        c = G.culture_for(by_owner, fb, x['faction'])",
"        x['culture'] = c['id']; x['given'] = x['name'].split(' ')[-1]",
"    out({'nodes': nodes, 'npcs': npcs, 'problems': probs})",
"elif MODE == 'suffix':",
"    rnd = random.Random(20261002); bad = []",
"    for kind in sorted(G.KIND_SUF):",
"        for _ in range(300):",
"            n = G.place_name(rnd, set(), G.FALLBACK_CULTURE, kind)",
"            suf = n.split(G.SEP)[-1]",
"            if suf not in G.KIND_SUF[kind]: bad.append({'kind': kind, 'suffix': suf})",
"    rnd2 = random.Random(11)",
"    for c in G.load_cultures()[1]:",
"        for _ in range(200):",
"            n = G.place_name(rnd2, set(), c, 'station')",
"            if n.split(G.SEP)[-1] not in G.KIND_SUF['station']:",
"                bad.append({'kind': 'station', 'culture': c['id'], 'suffix': n.split(G.SEP)[-1]})",
"    out({'bad': bad})",
"elif MODE == 'person':",
"    rnd = random.Random(5); res = {}",
"    for c in G.load_cultures()[1]:",
"        res[c['id']] = [G.person_name(rnd, c) for _ in range(60)]",
"    out(res)",
"elif MODE == 'mod_culture':",
"    base = json.load(io.open(os.path.join(ROOT, 'content', 'space.json'), encoding='utf-8-sig'))",
"    mod = json.load(io.open(os.path.join(ROOT, 'tests', 'fixtures', 'mod_new_culture.json'), encoding='utf-8'))",
"    merged, rep = space_merge.merge_all(base, [mod])",
"    by_owner, cults, fb, probs = G.load_cultures(merged)",
"    c = G.culture_for(by_owner, fb, 'free_miners')",
"    rnd = random.Random(3)",
"    out({'culture_ids': [x['id'] for x in cults], 'problems': probs,",
"         'picked_for_free_miners': c['id'],",
"         'places': [G.place_name(rnd, set(), c, 'station') for _ in range(40)],",
"         'people': [G.person_name(rnd, c) for _ in range(40)],",
"         'mod_culture_placeA': list(c['placeA']), 'mod_culture_personA': list(c['personA'])})",
"elif MODE == 'bad_culture':",
"    base = json.load(io.open(os.path.join(ROOT, 'content', 'space.json'), encoding='utf-8-sig'))",
"    mod = json.load(io.open(os.path.join(ROOT, 'tests', 'fixtures', 'mod_bad_culture.json'), encoding='utf-8'))",
"    merged, rep = space_merge.merge_all(base, [mod])",
"    by_owner, cults, fb, probs = G.load_cultures(merged)",
"    w = G.make_world('badc', 4)",
"    out({'problems': probs, 'fallback': fb['id'], 'culture_ids': [c['id'] for c in cults],",
"         'nodes': [n['name'] for n in w['data']['galaxy']['nodes']]})",
"else:",
"    out({'error': 'unknown mode ' + MODE})",
].join('\n'), 'utf8');

function probe(mode, extra){
  var args = [probePath, ROOT, mode].concat(extra || []);
  var r = cp.spawnSync(PY, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  var txt = (r.stdout || '').trim();
  if (r.status !== 0 || !txt){
    return { __err: 'python 退出码 ' + r.status + '：' + ((r.stderr || '') + txt).slice(0, 400) };
  }
  try { return JSON.parse(txt); }
  catch (e){ return { __err: '输出不是 JSON：' + txt.slice(0, 200) }; }
}

/* ================================================================ 开跑 */
console.log('test_names.js  —— 命名与文化体系');
console.log('  用 ' + PY);

/* ---------------------------------------------------------------- ① 文化表 */
section('① 文化表：每套语言有自己的词表，每个派系都说得上话');

var C = probe('cultures');
if (C.__err){ ok('读得到文化表', false, C.__err); }
else {
  ok('内容里有 nameCultures 且解析出多套文化', C.cults.length >= 5, C.cults.length + ' 套');
  ok('解析没有报问题', C.problems.length === 0, C.problems.join(' | '));
  ok('每套文化都有名字和非空的 placeA / personA',
     C.cults.every(function (c){ return c.name && c.placeA.length && c.personA.length; }));
  var noOwner = C.factions.filter(function (f){ return !C.by_owner[f]; });
  ok('每个派系都被某套文化认领（不是靠兜底）★', noOwner.length === 0, '没认领的：' + noOwner.join(','));
  ok('兜底文化指向的 id 真实存在', C.cults.some(function (c){ return c.id === C.fallback; }), C.fallback);
  var owners = [];
  C.cults.forEach(function (c){ owners = owners.concat(c.owners); });
  var dupOwner = owners.filter(function (o, i){ return owners.indexOf(o) !== i; });
  ok('一个派系不会被两套文化同时认领', dupOwner.length === 0, dupOwner.join(','));
  /* 文化之间应该真的不一样，否则「不同语言」是假的 */
  var uniqA = {};
  C.cults.forEach(function (c){ c.placeA.forEach(function (w){ uniqA[w] = 1; }); });
  ok('词表不是同一份复制多遍（placeA 去重后数量合理）', Object.keys(uniqA).length >= 40,
     Object.keys(uniqA).length + ' 个不同词');
}

/* ---------------------------------------------------------------- ② 只用本文化的词 */
section('② 生成的名字只用「该站点归属方那套文化」的词 ★');

var W1 = probe('world', ['t1', '14']);
if (W1.__err){ ok('跑得动生成器', false, W1.__err); }
else {
  var badStem = [], badSuffix = [], badGiven = [];
  W1.nodes.forEach(function (n){
    var c = (C.cults || []).filter(function (x){ return x.id === n.culture; })[0];
    if (!c){ badStem.push(n.name + ' 的文化 ' + n.culture + ' 不存在'); return; }
    var hit = c.placeA.filter(function (w){ return n.stem.indexOf(w) === 0; });
    if (!hit.length){ badStem.push(n.name + '（' + n.culture + '）词干不在词表里'); return; }
    var rest = n.stem.slice(hit.sort(function (a, b){ return b.length - a.length; })[0].length);
    if (rest && c.placeB.indexOf(rest) < 0){ badSuffix.push(n.name + ' 的后缀字 ' + rest + ' 不在 placeB'); }
    if ((C.suf_all || []).indexOf(n.suffix) < 0){ badSuffix.push(n.name + ' 的类型词 ' + n.suffix + ' 不认识'); }
  });
  W1.npcs.forEach(function (x){
    var c = (C.cults || []).filter(function (y){ return y.id === x.culture; })[0];
    if (!c){ badGiven.push(x.name); return; }
    var a = c.personA.filter(function (w){ return x.given.indexOf(w) === 0; });
    if (!a.length){ badGiven.push(x.name + '（' + x.culture + '）人名不在词表里'); return; }
    var rest = x.given.slice(a.sort(function (p, q){ return q.length - p.length; })[0].length);
    if (rest && c.personB.indexOf(rest) < 0) badGiven.push(x.name + ' 的尾字 ' + rest + ' 不在 personB');
  });
  ok('所有站点名的词干都来自本文化的 placeA/placeB ★', badStem.length === 0, badStem.slice(0, 4).join(' | '));
  ok('所有站点名的类型词都认识 ★', badSuffix.length === 0, badSuffix.slice(0, 4).join(' | '));
  ok('所有 NPC 人名的字都来自本文化的 personA/personB ★', badGiven.length === 0, badGiven.slice(0, 4).join(' | '));
  ok('生成过程没有文化表问题', W1.problems.length === 0, W1.problems.join(' | '));
}

/* ---------------------------------------------------------------- ③ 风格差异 */
section('③ 不同派系的站点听起来是三拨人起的名 ★');

if (!W1.__err && C.cults){
  var byCulture = {};
  W1.nodes.forEach(function (n){
    (byCulture[n.culture] = byCulture[n.culture] || []).push(n.name);
  });
  var ids = Object.keys(byCulture);
  ok('一次生成里出现了多种语言（' + ids.length + ' 种）', ids.length >= 3, ids.join(','));
  /* 「不串味」怎么测才不会误报：
     原先写的是「别种语言独有的词不能出现在本地名的开头」——用前缀判断，
     而 '空壳'（边地语）以 '空'（帷幕语独有）开头，直接误报。前缀判断在这里是错的。
     真正的性质是：**区别性词干（placeA）绝大多数只属于一种语言**。
     不要求"零共用"：专名本来就会被借用 —— 长夜 / 铁砧 / 织女 是手写层就有的地名，
     tongue_sol 和别的语言都收了，这是有意的（不然两层名字对不上）。
     通用尾字（placeB：港 / 台 / 门 / 环）共用更是正常，那本来就是"类型词"性质的。 */
  var wordOwners = {};
  C.cults.forEach(function (c){
    c.placeA.forEach(function (w){ (wordOwners[w] = wordOwners[w] || []).push(c.id); });
  });
  var lowExcl = C.cults.filter(function (c){
    var ex = c.placeA.filter(function (w){ return wordOwners[w].length === 1; }).length;
    return ex < c.placeA.length * 0.6;
  }).map(function (c){
    return c.id + '（' + c.placeA.filter(function (w){ return wordOwners[w].length === 1; }).length
         + '/' + c.placeA.length + '）';
  });
  ok('每套语言的区别性词干至少 60% 是它独有的 ★', lowExcl.length === 0, lowExcl.join(' '));
  var sharedA = Object.keys(wordOwners).filter(function (w){ return wordOwners[w].length > 1; });
  console.log('       共用的词干（专名借用，允许）：' + (sharedA.join(' ') || '无'));
  /* 反过来：每个站点用的词干**必须**来自它自己那套语言（这一条是硬的，见 ②） */
  var foreign = [];
  W1.nodes.forEach(function (n){
    var c = C.cults.filter(function (x){ return x.id === n.culture; })[0];
    var hit = c.placeA.filter(function (w){ return n.stem.indexOf(w) === 0; })
                      .sort(function (a, b){ return b.length - a.length; })[0];
    if (hit && wordOwners[hit].indexOf(n.culture) < 0) foreign.push(n.name + ' 的 ' + hit);
  });
  ok('没有哪个站点用了它那套语言词表之外的词干 ★', foreign.length === 0, foreign.slice(0, 3).join(' | '));
  /* 打印几个例子，出问题时一眼看得出风格对不对 */
  ids.slice(0, 6).forEach(function (id){
    console.log('       ' + id.padEnd(12) + ' ' + byCulture[id].slice(0, 5).join('  '));
  });
}

/* ---------------------------------------------------------------- ④ 类型词 */
section('④ 类型词跟站点种类对得上（裂隙带不会被叫成中继站）★');

var S = probe('suffix');
if (S.__err){ ok('跑得动类型词检查', false, S.__err); }
else {
  ok('每种种类生成的类型词都在它的表里 ★', S.bad.length === 0,
     JSON.stringify(S.bad.slice(0, 4)));
}

/* ---------------------------------------------------------------- ⑤ 确定 + 不重名 */
section('⑤ 确定、不重名、不和手写层撞车');

var WA = probe('world', ['same', '16']);
var WB = probe('world', ['same', '16']);
if (WA.__err || WB.__err){ ok('跑得动两次生成', false, (WA.__err || WB.__err)); }
else {
  ok('同一个 seed 两次生成的名字完全一样 ★',
     JSON.stringify(WA.nodes) === JSON.stringify(WB.nodes));
  var names = WA.nodes.map(function (n){ return n.name; });
  ok('站点名互不重复 ★', names.length === new Set(names).size,
     names.filter(function (x, i){ return names.indexOf(x) !== i; }).join(','));
  var hand = C.hand_written_nodes || [];
  var clash = names.filter(function (n){ return hand.indexOf(n) >= 0; });
  ok('生成的地名不和手写层的地名重名 ★（手写 ' + hand.length + ' 个）', clash.length === 0, clash.join(','));
  var nset = WA.npcs.map(function (x){ return x.given; });
  ok('NPC 人名有重复但数量合理（同文化重名是正常的）',
     new Set(nset).size >= Math.ceil(nset.length * 0.4), new Set(nset).size + '/' + nset.length);
}

/* ---------------------------------------------------------------- ⑥ 人名 */
section('⑥ 人名：每种语言都能造出名字，且只用本语言的词');

var P = probe('person');
if (P.__err){ ok('跑得动人名', false, P.__err); }
else {
  var badP = [];
  Object.keys(P).forEach(function (cid){
    var c = (C.cults || []).filter(function (x){ return x.id === cid; })[0];
    if (!c){ badP.push(cid + ' 不在文化表里'); return; }
    P[cid].forEach(function (nm){
      var a = c.personA.filter(function (w){ return nm.indexOf(w) === 0; });
      if (!a.length){ badP.push(cid + ':' + nm); return; }
      var rest = nm.slice(a.sort(function (p, q){ return q.length - p.length; })[0].length);
      if (rest && c.personB.indexOf(rest) < 0) badP.push(cid + ':' + nm);
    });
  });
  ok('每种语言的人名都只用本语言的词 ★', badP.length === 0, badP.slice(0, 5).join(' | '));
  Object.keys(P).slice(0, 7).forEach(function (cid){
    console.log('       ' + cid.padEnd(12) + ' ' + P[cid].slice(0, 10).join(' '));
  });
  /* 至少有一种语言能造出单字名（深渊那种「多念一个字要多付代价」的味道） */
  var single = Object.keys(P).filter(function (cid){
    return P[cid].some(function (nm){ return nm.length === 1; });
  });
  ok('有语言会造出单字名（personB 里的空串起作用了）', single.length >= 1, single.join(','));
}

/* ---------------------------------------------------------------- ⑦ mod 加语言 */
section('⑦ mod 能加一套新语言并被生成器用上（不用改 gen_world.py）★');

var MC = probe('mod_culture');
if (MC.__err){ ok('跑得动 mod 加语言', false, MC.__err); }
else {
  ok('合并后多出了 mod 的文化 ★', MC.culture_ids.indexOf('my_tongue') >= 0, MC.culture_ids.join(','));
  ok('mod 认领的派系改用 mod 的语言 ★', MC.picked_for_free_miners === 'my_tongue',
     MC.picked_for_free_miners);
  var A = MC.mod_culture_placeA, PA = MC.mod_culture_personA;
  var startsWithAny = function (s, list){
    return list.some(function (w){ return s.indexOf(w) === 0; });
  };
  ok('生成的地名用的是 mod 的词 ★',
     MC.places.every(function (n){ return startsWithAny(n, A); }), MC.places.slice(0, 3).join(' '));
  ok('生成的人名用的是 mod 的词 ★',
     MC.people.every(function (n){ return startsWithAny(n, PA); }), MC.people.slice(0, 5).join(' '));
  ok('mod 的词表确实被当成了整个词池（不是只用第一个词）',
     new Set(MC.places.map(function (n){ return A.filter(function (w){ return n.indexOf(w) === 0; })[0]; })).size >= 2,
     MC.places.slice(0, 6).join(' '));
  /* 这条 mod 抢了基础内容里 frontier 认领的派系 —— 顶掉是允许的，但**必须说出来**，不能静默 */
  ok('抢别人的派系会报出来（不是静默顶掉）★',
     MC.problems.some(function (p){ return /free_miners/.test(p) && /同时被文化/.test(p); }),
     MC.problems.join(' | ') || '(没报)');
}

/* ---------------------------------------------------------------- ⑧ 坏数据降级 */
section('⑧ 坏掉的文化表只降级不崩（VISION 第 4 条不变量）★');

var BC = probe('bad_culture');
if (BC.__err){ ok('跑得动坏数据检查', false, BC.__err); }
else {
  ok('坏条目被跳过并报出问题 ★', BC.problems.some(function (p){ return /缺 placeA/.test(p); }),
     BC.problems.join(' | '));
  ok('坏条目没有进文化表 ★', BC.culture_ids.indexOf('broken_tongue') < 0, BC.culture_ids.join(','));
  ok('生成照常完成（有名字产出）★', BC.nodes.length === 4 && BC.nodes.every(Boolean), BC.nodes.join(','));
}

/* ---------------------------------------------------------------- ⑨ 自检 */
section('⑨ 生成器自检（含新加的命名断言）');

var st = cp.spawnSync(PY, [path.join(ROOT, 'tools', 'gen_world.py'), '--selftest'], { encoding: 'utf8' });
var stOut = ((st.stdout || '') + (st.stderr || '')).trim();
ok('gen_world --selftest 通过', st.status === 0 && /自检：OK/.test(stOut), stOut.slice(-300));

try { fs.rmSync(probeDir, { recursive: true, force: true }); } catch (e){}

console.log('\n========================================');
console.log('通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);
