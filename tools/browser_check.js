/* =============================================================================
 * tools/browser_check.js  真浏览器自检（可选：需要本机有 Edge / Chrome）
 *
 * 为什么有它：DEVLOG 第 6 节「没有在真浏览器里跑过」是历史遗留。
 * 这里用 Edge/Chrome 的 headless + --dump-dom 打开 space-text.html，
 * 在页面里跑一组断言（boot / 校验报告 / 字号写回 DOM / 运行期无报错 /
 * 布局尺寸 / 15 个终端视图是否都渲染出内容），把结果 base64 JSON 打回 stdout。
 *
 * 用法：
 *   node tools/browser_check.js               # 默认窗口 1600x900
 *   node tools/browser_check.js 1920x1080     # 指定窗口尺寸
 *   SPACE_BROWSER=<exe 路径> node tools/browser_check.js
 * 找不到浏览器 -> 打印「跳过」并 exit 0（机器上没装浏览器不算失败）。
 * ========================================================================== */
'use strict';
var cp = require('child_process'), fs = require('fs'), path = require('path'), os = require('os');

var ROOT = path.join(__dirname, '..');
var GAME = path.join(ROOT, 'space-text.html');

function findBrowser(){
  var picks = [];
  if (process.env.SPACE_BROWSER) picks.push(process.env.SPACE_BROWSER);
  var pf   = process.env['ProgramFiles'] || 'C:\\Program Files';
  var pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  var lad  = process.env['LOCALAPPDATA'] || '';
  picks.push(path.join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe'));
  picks.push(path.join(pf,   'Microsoft\\Edge\\Application\\msedge.exe'));
  picks.push(path.join(pf,   'Google\\Chrome\\Application\\chrome.exe'));
  picks.push(path.join(pf86, 'Google\\Chrome\\Application\\chrome.exe'));
  if (lad) picks.push(path.join(lad, 'Google\\Chrome\\Application\\chrome.exe'));
  for (var i = 0; i < picks.length; i++){
    try { if (picks[i] && fs.existsSync(picks[i])) return picks[i]; } catch (e) {}
  }
  return null;
}

/* 下面这个函数会被 toString() 后原样注入页面执行；只能引用页面里存在的东西。 */
function PAGE_TEST(){
  function ascii(s){ return String(s === null || s === undefined ? '' : s).replace(/[^\x20-\x7e]/g, '?'); }
  function finish(obj){
    var b64 = btoa(JSON.stringify(obj));
    try { document.body.innerHTML = ''; } catch (e) {}
    var pre = document.createElement('pre');
    pre.id = 'atr';
    pre.textContent = b64;
    (document.body || document.documentElement).appendChild(pre);
    document.title = 'AUTOTEST_DONE';
  }
  var out = { ok: true, checks: [], views: [], msgs: [], info: {} };
  function check(name, ok, detail){
    out.checks.push({ name: name, ok: !!ok, detail: ascii(detail) });
    if (!ok) out.ok = false;
  }
  setTimeout(function(){
    try {
      var sp = window.__space, g = sp && sp.game, T = sp && sp.out;
      if (!sp || !g || !T){ finish({ ok:false, fatal:'no window.__space / __game / out', checks:[], views:[] }); return; }
      var pre = document.getElementById('screen');
      var stage = document.getElementById('stage');
      function renderText(){ g.render(); try { T.paint(g.screen, true); } catch (e) {} return (pre && pre.textContent) || ''; }
      function nsLen(s){ return (s.match(/[^\s]/g) || []).length; }

      var built = sp.built, rep = built.report || { errors: [], warnings: [] };
      out.info = {
        win: window.innerWidth + 'x' + window.innerHeight,
        stage: (stage ? stage.clientWidth + 'x' + stage.clientHeight : 'n/a'),
        screen: g.screenW + 'x' + g.screenH,
        fontSize: T.fontSize,
        cell: T.diag ? (T.diag.cellW.toFixed(2) + 'x' + T.diag.cellH.toFixed(2)) : 'n/a',
        layoutSide: !!(g.layout && g.layout().side)
      };
      check('report_errors_0',   (rep.errors   || []).length === 0, (rep.errors   || []).length);
      check('report_warnings_0', (rep.warnings || []).length === 0, (rep.warnings || []).length);
      check('screen_element', !!pre, pre ? 'pre#screen' : 'missing');
      check('font_applied', !!(pre && pre.style && (pre.style.font || '').indexOf('px') >= 0),
            pre && pre.style ? pre.style.font : '');
      check('cell_metrics', !!(T.diag && T.diag.cellW > 2 && T.diag.cellH > 6),
            T.diag ? (T.diag.cellW.toFixed(2) + 'x' + T.diag.cellH.toFixed(2)) : 'no diag');
      check('layout_side', out.info.layoutSide, 'side=' + out.info.layoutSide);
      var base = renderText();
      check('screen_nonempty', nsLen(base) > 200, 'nonspace=' + nsLen(base) + ' total=' + base.length);
      check('screen_has_map',  base.indexOf('#') >= 0, 'has #=' + (base.indexOf('#') >= 0));
      var errEl = document.getElementById('err');
      check('no_runtime_err', !errEl || (' ' + errEl.className + ' ').indexOf(' hidden ') >= 0,
            errEl ? errEl.textContent : '');
      var views = (built.space.views && built.space.views.list) || [];
      check('views_count', views.length >= 15, views.length);
      for (var i = 0; i < views.length; i++){
        var v = views[i];
        var empties = (v.sections || []).map(function(s){ return s.empty; }).filter(Boolean);
        var hits = [], titleHit = false, ns = 0, err = '';
        try {
          g.openView(v.id);
          var vt = renderText();
          ns = nsLen(vt);
          for (var j = 0; j < empties.length; j++){ if (vt.indexOf(empties[j]) >= 0) hits.push(j); }
          titleHit = vt.indexOf(v.title || '') >= 0;
          try { g.closeView(); } catch (e2) {}
        } catch (e){ err = ascii(e && e.message); }
        out.views.push({ id: v.id, ns: ns, emptyHits: hits, title: titleHit, err: err });
      }
      /* 相机稳定性：把所有场景走一遍，字号 / 画面尺寸 / 分栏都不能变（换图不割裂） */
      var cam = [], sceneList = (built.space.scenes && built.space.scenes.list) || [];
      for (var si = 0; si < sceneList.length; si++){
        var sid = sceneList[si].id, sgr = g.grid(sid);
        if (!sgr) continue;
        var cell = null;
        for (var ci = 0; ci < sgr.pass.length; ci++) if (sgr.pass[ci]){ cell = { x: ci % sgr.w, y: Math.floor(ci / sgr.w) }; break; }
        if (!cell) continue;
        try {
          g.teleport(sid, cell.x, cell.y);
          if (sp.resize) sp.resize();
          cam.push({ id: sid, font: T.fontSize, w: g.screenW, h: g.screenH, side: !!(g.layout && g.layout().side) });
        } catch (e){ cam.push({ id: sid, font: 'ERR', err: ascii(e && e.message) }); }
      }
      var uFont = {}, uScreen = {}, uSide = {};
      cam.forEach(function(c){ uFont[c.font] = 1; uScreen[c.w + 'x' + c.h] = 1; uSide[String(c.side)] = 1; });
      check('camera_scenes', cam.length >= 25, cam.length + ' 个场景');
      check('camera_font_stable', Object.keys(uFont).length === 1, Object.keys(uFont).join(','));
      check('camera_screen_stable', Object.keys(uScreen).length === 1, Object.keys(uScreen).join(','));
      check('camera_layout_stable', Object.keys(uSide).length === 1, Object.keys(uSide).join(','));
      out.cam = cam.map(function(c){ return c.id + ':' + c.font + '/' + c.w + 'x' + c.h; });

      /* ---- 真机验收：固定视口 / 门判定 / 点击反算 ---- */
      var view = g.getViewSize();
      var byId = {}, ids4 = [];
      for (var si1 = 0; si1 < sceneList.length; si1++){ byId[sceneList[si1].id] = sceneList[si1]; ids4.push(sceneList[si1].id); }
      function firstCell(id){
        var gr = g.grid(id); if (!gr) return null;
        for (var ci2 = 0; ci2 < gr.pass.length; ci2++) if (gr.pass[ci2]) return { x: ci2 % gr.w, y: Math.floor(ci2 / gr.w) };
        return null;
      }
      function goScene(id, x, y){ g.teleport(id, x, y); if (sp.resize) sp.resize(); g.render(); }
      function middleCell(id){
        var gr = g.grid(id); if (!gr) return null;
        var cx = Math.floor(gr.w / 2), cy = Math.floor(gr.h / 2), best = null, bd = 1e9;
        for (var ci3 = 0; ci3 < gr.pass.length; ci3++){
          if (!gr.pass[ci3]) continue;
          var x3 = ci3 % gr.w, y3 = Math.floor(ci3 / gr.w);
          var d3 = Math.abs(x3 - cx) + Math.abs(y3 - cy);
          if (d3 < bd){ bd = d3; best = { x: x3, y: y3 }; }
        }
        return best;
      }
      /* 1+2) 相机稳定（上面的 camera_* 已经验过）：这里再确认两个具体跳转点 */
      goScene('station_command', 1, 1);
      var f1 = T.fontSize, s1 = !!(g.layout && g.layout().side);
      goScene('station_corridor', 32, 10);
      var f2 = T.fontSize, s2 = !!(g.layout && g.layout().side);
      goScene('colony_command', 1, 1);
      var f3 = T.fontSize, s3 = !!(g.layout && g.layout().side);
      check('acc_font_stable', f1 === f2 && f2 === f3, f1 + '/' + f2 + '/' + f3);
      check('acc_side_stable', s1 === s2 && s2 === s3, String(s1) + '/' + String(s2) + '/' + String(s3));
      /* 3) 小图居中 + 四周留空 */
      var small = null;
      for (var si6 = 0; si6 < ids4.length && !small; si6++){
        var gr6 = g.grid(ids4[si6]); if (!gr6) continue;
        if (gr6.w < view.w && gr6.h < view.h){
          var c6 = firstCell(ids4[si6]); if (!c6) continue;
          goScene(ids4[si6], c6.x, c6.y);
          small = { id: ids4[si6], ox: g._cam.originX, oy: g._cam.originY, camX: g._cam.x, camY: g._cam.y, w: gr6.w, h: gr6.h };
        }
      }
      check('acc_small_centered', !!small && small.ox > 0 && small.oy > 0 && small.camX === 0 && small.camY === 0,
            small ? (small.id + ' origin=' + small.ox + ',' + small.oy + ' cam=' + small.camX + ',' + small.camY) : 'no small scene');
      /* 4) 大图滚动 + 边缘 clamp */
      var big = null;
      for (var si7 = 0; si7 < ids4.length && !big; si7++){
        var gr7 = g.grid(ids4[si7]); if (!gr7) continue;
        if (gr7.h > view.h || gr7.w > view.w){
          var midc = middleCell(ids4[si7]) || { x: Math.floor(gr7.w / 2), y: Math.floor(gr7.h / 2) };
          goScene(ids4[si7], midc.x, midc.y);
          var midOx = g._cam.originX, midOy = g._cam.originY, midCamY = g._cam.y;
          goScene(ids4[si7], 0, 0);
          big = { id: ids4[si7], midOx: midOx, midOy: midOy, midCamY: midCamY,
                  edgeCamX: g._cam.x, edgeCamY: g._cam.y, w: gr7.w, h: gr7.h };
        }
      }
      check('acc_big_scrolls', !!big && (big.midOy < 0 || big.midOx < 0),
            big ? (big.id + ' ' + big.w + 'x' + big.h + ' midOrigin=' + big.midOx + ',' + big.midOy + ' view=' + view.w + 'x' + view.h) : 'no big scene');
      check('acc_camera_clamped', !!big && big.edgeCamX === 0 && big.edgeCamY === 0,
            big ? ('edgeCam=' + big.edgeCamX + ',' + big.edgeCamY) : '');
      /* 5) 场景格 -> 屏幕格 -> 场景格 往返一致（含大图滚动） */
      var rtBad = [];
      for (var si8 = 0; si8 < ids4.length; si8++){
        var gr8 = g.grid(ids4[si8]); if (!gr8) continue;
        var c8 = firstCell(ids4[si8]); if (!c8) continue;
        goScene(ids4[si8], c8.x, c8.y);
        var cam8 = g._cam;
        var tx8 = Math.floor(gr8.w / 2), ty8 = Math.floor(gr8.h / 2);
        var sx8 = (cam8.winX || 0) + tx8 + cam8.originX;
        var sy8 = (cam8.winY === undefined ? cam8.top : cam8.winY) + ty8 + cam8.originY;
        var back8 = g.screenToScene(sx8, sy8);
        if (!back8 || back8.x !== tx8 || back8.y !== ty8) rtBad.push(ids4[si8]);
      }
      check('acc_click_roundtrip', rtBad.length === 0, rtBad.slice(0, 4).join(','));
      /* 6) 门判定：3 格门洞的「边上那一格」也要能走出去 */
      var doorBad = [], doorTested = 0;
      for (var si9 = 0; si9 < ids4.length && doorTested < 4; si9++){
        var sid9 = ids4[si9], gr9 = g.grid(sid9); if (!gr9 || !gr9.exitMap) continue;
        var keys9 = Object.keys(gr9.exitMap);
        for (var ki9 = 0; ki9 < keys9.length && doorTested < 4; ki9++){
          var e9 = gr9.exitMap[keys9[ki9]]; if (!e9 || !e9.to) continue;
          var sideKey = null;
          if (e9.y === 0 || e9.y === gr9.h - 1){
            if (gr9.doorMap[(e9.x - 1) + ',' + e9.y] && (e9.x - 1) !== e9.x) sideKey = { x: e9.x - 1, y: e9.y };
            else if (gr9.doorMap[(e9.x + 1) + ',' + e9.y]) sideKey = { x: e9.x + 1, y: e9.y };
          } else if (e9.x === 0 || e9.x === gr9.w - 1){
            if (gr9.doorMap[e9.x + ',' + (e9.y - 1)]) sideKey = { x: e9.x, y: e9.y - 1 };
            else if (gr9.doorMap[e9.x + ',' + (e9.y + 1)]) sideKey = { x: e9.x, y: e9.y + 1 };
          }
          if (!sideKey) continue;
          doorTested++;
          g.teleport(sid9, sideKey.x, sideKey.y);
          var okDoor = g.takeExit();
          if (!okDoor || g.world.player.scene !== e9.to) doorBad.push(sid9 + ' 边上格 (' + sideKey.x + ',' + sideKey.y + ') -> ' + g.world.player.scene + ' 期望 ' + e9.to);
        }
      }
      check('acc_door_wide_hit', doorBad.length === 0 && doorTested > 0,
            doorTested + ' 扇试过' + (doorBad.length ? (' / ' + doorBad.slice(0, 3).join(' | ')) : ''));

      /* ---- 事件 <-> 功能文本：情报板真机交互 ---- */
      try {
        g.teleport('station_command', 36, 12); if (sp.resize) sp.resize(); g.render();
        g.openView('intel_board');
        function vt2(){ return ((g.ui.view && g.ui.view.lines) || []).map(function(l){ return l.text; }).join('\n'); }
        var v0 = vt2();
        check('acc_intel_sections', v0.indexOf('待处理情报') >= 0 && v0.indexOf('事件链') >= 0 && v0.indexOf('态势') >= 0,
              '待处理/链路/态势');
        var actsI = (g.ui.view && g.ui.view.actions) || [], ai = -1;
        for (var qi = 0; qi < actsI.length; qi++) if (String(actsI[qi].text).indexOf('调阅最新情报  一') >= 0) ai = qi;
        check('acc_intel_action', ai >= 0, JSON.stringify(actsI.map(function(a){ return a.text; })));
        if (ai >= 0){
          g.viewChoose(ai);
          check('acc_intel_triggers_event', g.world.pending.ev_intel_01 === true,
                Object.keys(g.world.pending).length + ' 条待处理');
          check('acc_intel_hot_refresh', vt2().indexOf('没有待处理的情报') < 0, '面板当场刷新');
        }
        g.closeView();
      } catch (e){ check('acc_intel_sections', false, ascii(e && e.message)); }

      /* ---- 真机：交互面板点了要真管用 ---- */
      try {
        g.teleport('station_warehouse', 10, 10); if (sp.resize) sp.resize(); g.render();
        g.openView('warehouse_stock');
        var actsP = (g.ui.view && g.ui.view.actions) || [], pi = -1;
        for (var pj = 0; pj < actsP.length; pj++) if (String(actsP[pj].text).indexOf('合金换口粮') >= 0) pi = pj;
        check('acc_panel_action_exists', pi >= 0, JSON.stringify(actsP.map(function(a){ return a.text; })));
        if (pi >= 0){
          var al0 = g.world.counters.alloy || 0, fd0 = g.world.counters.food || 0;
          g.viewChoose(pi);
          check('acc_panel_action_applies', (g.world.counters.alloy || 0) === al0 - 20 && (g.world.counters.food || 0) === fd0 + 5,
                'alloy ' + al0 + '->' + g.world.counters.alloy + ', food ' + fd0 + '->' + g.world.counters.food);
          check('acc_panel_still_alive', !!g.ui.view, 'view=' + (g.ui.view && g.ui.view.id));
        }
        g.closeView();
        g.openView('fleet_status');
        var actsF = (g.ui.view && g.ui.view.actions) || [], fi = -1;
        for (var fj = 0; fj < actsF.length; fj++) if (String(actsF[fj].text).indexOf('回防') >= 0) fi = fj;
        check('acc_fleet_panel_action', fi >= 0, JSON.stringify(actsF.map(function(a){ return a.text; })));
        if (fi >= 0){
          var fl0 = g.world.counters.fleets || 0;
          g.viewChoose(fi);
          check('acc_fleet_action_applies', (g.world.counters.fleets || 0) === fl0 - 1 && g.world.flags.home_guard === true,
                'fleets ' + fl0 + '->' + g.world.counters.fleets);
        }
        g.closeView();
      } catch (e){ check('acc_panel_action_exists', false, ascii(e && e.message)); }

      /* ---- 真机：终局判定 + 「污染的出口」 ---- */
      try {
        g.world.counters.pollution = 2; g.world.counters.alloy = 200;
        /* R8：净化作业现在要 tech_purge1；先断言没有科技时是锁着的，再点开科技 */
        g.openView('galaxy_map');
        var actsLocked = (g.ui.view && g.ui.view.actions) || [];
        check('acc_purify_gated', !actsLocked.some(function(a){ return String(a.text).indexOf('组织净化作业') >= 0; }),
              JSON.stringify(actsLocked.map(function(a){ return a.text; })));
        g.closeView();
        g.world.flags.tech_purge1 = true;
        g.openView('galaxy_map');
        var actsE = (g.ui.view && g.ui.view.actions) || [], ei = -1;
        for (var ei2 = 0; ei2 < actsE.length; ei2++) if (String(actsE[ei2].text).indexOf('净化') >= 0) ei = ei2;
        check('acc_purify_action', ei >= 0, JSON.stringify(actsE.map(function(a){ return a.text; })));
        if (ei >= 0){
          var pol0 = g.world.counters.pollution, al2 = g.world.counters.alloy;
          g.viewChoose(ei);
          check('acc_purify_applies', g.world.counters.pollution === pol0 - 1 && g.world.counters.alloy === al2 - 25,
                'pollution ' + pol0 + '->' + g.world.counters.pollution + ', alloy ' + al2 + '->' + g.world.counters.alloy);
        }
        g.closeView();
        /* 判负：污染 15，走到下一个 tick%60==0 的点让钩子判定 */
        g.world.counters.pollution = 15;
        var need2 = 60 - (g.world.tick % 60); g.step(need2);
        check('acc_defeat_pollution', !!g.world.gameOver && g.world.gameOver.result === 'defeat', JSON.stringify(g.world.gameOver));
        g.render();
        var overText = renderText();
        check('acc_gameover_screen', overText.indexOf('重新开始') >= 0, overText.length);
        var tOver = g.world.tick; g.step(30);
        check('acc_gameover_frozen', g.world.tick === tOver, g.world.tick - tOver);
        var fresh = (window.__space && window.__space.newGame) ? window.__space.newGame() : null;
        check('acc_restart', !!fresh && !fresh.world.gameOver &&
              fresh.world.player.scene === ((built.space.config && built.space.config.startScene) || 'station_command'),
              fresh ? fresh.world.player.scene : 'newGame 不存在');
      } catch (e){ check('acc_purify_action', false, ascii(e && e.message)); }

      renderText();
      finish(out);
    } catch (e){
      finish({ ok: false, fatal: ascii(e && e.message || e), checks: out.checks, views: out.views, info: out.info });
    }
  }, 300);
}

function main(){
  var size = (process.argv[2] || '1600,900').replace(/[xX]/, ',');
  if (!fs.existsSync(GAME)){ console.error('找不到 ' + GAME + '，先跑 python build_space.py'); process.exit(2); }
  var browser = findBrowser();
  if (!browser){ console.log('跳过：本机没有 Edge/Chrome（可设 SPACE_BROWSER=<exe> 指定）。'); process.exit(0); }
  var html = fs.readFileSync(GAME, 'utf8');
  var inject = '<script>(' + PAGE_TEST.toString() + ')();</script>';
  var idx = html.lastIndexOf('</body>');
  var page_html = idx >= 0 ? (html.slice(0, idx) + inject + html.slice(idx)) : (html + inject);
  var tmp = path.join(os.tmpdir(), 'shuo_browsercheck');
  try { fs.mkdirSync(tmp, { recursive: true }); } catch (e) {}
  var page = path.join(tmp, 'game_autotest.html');
  fs.writeFileSync(page, page_html, 'utf8');
  var url = 'file:///' + page.replace(/\\/g, '/');
  var args = ['--headless', '--disable-gpu', '--no-sandbox',
              '--user-data-dir=' + path.join(tmp, 'edgedata_' + Date.now()),
              '--window-size=' + size, '--virtual-time-budget=6000', '--dump-dom', url];
  var r = cp.spawnSync(browser, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  var dom = r.stdout || '';
  var m = /id="atr"[^>]*>([A-Za-z0-9+/=]+)</.exec(dom);
  if (!m){
    console.error('没拿到自检结果（浏览器退出码 ' + r.status + '）。DOM 头部：');
    console.error(dom.slice(0, 600));
    console.error((r.stderr || '').split('\n').slice(-4).join('\n'));
    process.exit(1);
  }
  var res = JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
  var fail = 0;
  console.log('真浏览器自检  ' + browser.replace(/^.*[\\/]/, '') + '  窗口 ' + size);
  if (res.info) console.log('  布局：' + JSON.stringify(res.info));
  console.log('--------------------------------------------------');
  (res.checks || []).forEach(function(c){
    if (!c.ok) fail++;
    console.log((c.ok ? '  [OK]  ' : '  [!!]  ') + c.name + (c.detail ? '   (' + c.detail + ')' : ''));
  });
  console.log('--------------------------------------------------');
  console.log('终端视图（ns=非空白字符数 / empty=命中了 empty 文案的下标 / title=标题是否出现）');
  (res.views || []).forEach(function(v){
    var bad = v.emptyHits.length > 0 || !v.title || v.ns < 120 || v.err;
    if (bad) fail++;
    console.log((bad ? '  [!!]  ' : '  [OK]  ') + v.id + '   ns=' + v.ns +
                '   empty=' + JSON.stringify(v.emptyHits) + '   title=' + v.title + (v.err ? '   ERR=' + v.err : ''));
  });
  if (res.cam) console.log('  切场景相机：' + res.cam.join('  '));
  if (res.fatal) console.log('  FATAL: ' + res.fatal);
  if (res.msgs && res.msgs.length) console.log('  msgs: ' + res.msgs.join(' ; '));
  console.log('==================================================');
  console.log(fail ? ('失败 ' + fail + ' 项') : '全部通过');
  process.exit(fail ? 1 : 0);
}
main();