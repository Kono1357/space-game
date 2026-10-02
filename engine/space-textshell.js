/* =============================================================================
 * space-textshell.js  纯文本外壳
 *   零 Canvas、零 rAF、零像素操作。游戏内核完全复用，只把输出接到 <pre>。
 *   键盘：WASD/方向键 走  E/回车 交互  空格 等  Tab 环顾  X 查看
 *         ? 帮助  F2 装 mod  F3 诊断  F4 信息  C 切彩色  1-5 速度  +/-/0 缩放
 *   鼠标：点地图上的格子就自己走过去（点不动的东西 = 查看它）
 *   存档：记录点终端里的 kernel op save/load/export 由外壳落到 localStorage
 * ========================================================================== */
(function (root) {
'use strict';
var Core = root.SpaceCore, T = root.SpaceTextOut;
if (!Core || !T) return;

var VERSION = '1.6.0-text';
var LS_ZOOM = 'space_zoom';
var LS_MODS = 'space_mods';

function boot(){
  var pre    = document.getElementById('screen');
  var infoEl = document.getElementById('info');
  var errEl  = document.getElementById('err');
  var modPanel = document.getElementById('modpanel');
  var modText  = document.getElementById('modtext');
  var modMsg   = document.getElementById('modmsg');
  var modList  = document.getElementById('modlist');
  var modFile  = document.getElementById('modfile');
  var mode  = 0;                       /* 0 暂停 1 1x 2 2x 3 4x 4 8x */
  var zoomBias = 0;
  try { zoomBias = Number(localStorage.getItem(LS_ZOOM)) || 0; } catch (e) {}
  var SPEEDS = [0, 1, 2, 4, 8];
  var acc = 0;

  var built, game, out, userMods = [];

  /* ---------------- 存档桥：记录点终端里的 kernel op ---------------- */
  function saveKey(slot){ return 'space_save_' + (slot || 1); }
  function onKernel(op, g){
    if (!op) return;
    try {
      if (op.op === 'save'){
        localStorage.setItem(saveKey(op.params && op.params.slot), JSON.stringify(g.serialize()));
        g.log('已存档到 ' + ((op.params && op.params.slot) || 1) + ' 号位。', 'good');
      } else if (op.op === 'load'){
        var raw = localStorage.getItem(saveKey(op.params && op.params.slot));
        if (!raw){ g.log('那个存档位是空的。', 'warn'); return; }
        g.deserialize(JSON.parse(raw));
        g.log('读档完成。', 'good');
      } else if (op.op === 'export'){
        var dump = JSON.stringify(g.serialize());
        try { localStorage.setItem('space_save_export', dump); } catch (e2) {}
        g.log('存档文本 ' + dump.length + ' 字节，已放到剪贴板下面那个存档位（space_save_export）。', 'info');
      }
    } catch (e){
      g.log('存档操作失败：' + (e && e.message ? e.message : e), 'danger');
    }
  }

  try {
    userMods = readStoredMods();
    buildGame(userMods);
    out = new T.TextOut(pre, { fontSize: 15, color: false });
    game.speed = SPEEDS[mode];       /* 内核自己不知道外壳的档位，这里告诉它 */
  } catch (e) {
    showErr('初始化失败：' + (e && e.message ? e.message : e));
    return;
  }

  function saveZoom(){ try { localStorage.setItem(LS_ZOOM, String(zoomBias)); } catch (e) {} }
  function showErr(msg){
    if (!errEl) return;
    errEl.classList.remove('hidden');
    errEl.textContent = '运行出错：' + msg;
  }
  root.addEventListener('error', function (ev) {
    showErr((ev.error && ev.error.message) || ev.message || '未知错误');
  });

  function viewport(){
    /* 直接用外层 flex 容器【实际拿到的高度】 它已经扣掉了信息栏和错误栏，
       比自己去猜"要减多少"准确得多。 */
    var st = document.getElementById('stage');
    var w = (st && st.clientWidth)  || window.innerWidth  || 1024;
    var h = (st && st.clientHeight) || window.innerHeight || 640;
    return { w: Math.max(320, w - 4), h: Math.max(200, h - 4) };
  }

  /* 宿主壳（手机 App 的外壳）可以用 URL 参数覆盖壳的默认布局，桌面浏览器不受影响：
       ?log=1..6   底部日志条固定几行。手机壳把日志画到了顶部浮层，就让这几行给地图。
     不认这个参数的老页面照旧（默认按窗口高度自适应）。 */
  function hostRows(name){
    /* 返回 -1 = 宿主没说；0 是**有效值**（= 别画，宿主自己画），不能和"没说"混为一谈。 */
    var m;
    try { m = new RegExp('[?&]' + name + '=(\\d+)').exec(root.location.search || ''); }
    catch (e) { return -1; }
    return m ? Math.max(0, Math.min(6, Number(m[1]))) : -1;
  }

  function resize(){
    var vp = viewport();
    var cfg = built.space.config || {};
    /* 固定取景框（config.mapDesignCols/Rows）：切场景时字号不跳，画面不割裂 */
    var need = game.designBox ? game.designBox() : { w: 24, h: 12 };
    var hostLog = hostRows('log');
    var logRows = hostLog >= 0 ? hostLog : Math.max(2, Math.min(6, Math.floor(vp.h / 170)));
    game.cfg.logRows = logRows;
    var fit;
    var lo = cfg.autoZoomMin || 10, hi = cfg.autoZoomMax || 32;
    if (cfg.autoZoom === false){
      out.setFont(cfg.fontSize || 15);
      fit = out.fit(vp.w, vp.h);
    } else {
      /* 两遍：先按"宽屏 + 右侧栏"（只占 2 行界面高度）算，
         再问内核实际给不给侧栏  不给就按"日志在下方"重算一次。 */
      var tc = cfg.mapTargetCols || 104, tr = cfg.mapTargetRows || 28;
      fit = out.autoFit(vp.w, vp.h, need.w, need.h, 2, lo, hi, tc, tr, zoomBias);
      game.resize(fit.cols, fit.rows);
      if (!game.layout().side){
        fit = out.autoFit(vp.w, vp.h, need.w, need.h, 3 + logRows, lo, hi, tc, tr, zoomBias);
      }
    }
    game.resize(fit.cols, fit.rows);
    render();
  }

  function render(){
    try { game.render(); out.paint(game.screen, false); }
    catch (e) { showErr('渲染：' + (e && e.message ? e.message : e)); }
  }

  function drawInfo(){
    var p = game.world.player, d = out.diag;
    var near = game.npcsNear(2);
    infoEl.textContent =
      (game.world.gameOver ? ('【' + (game.world.gameOver.result === 'victory' ? '胜利' : '失败') + '】' + String(game.world.gameOver.reason || '') + '   按 R 重新开始\n') : '') +
      '位置 ' + game.sceneName(p.scene) + ' (' + p.x + ',' + p.y + ')' +
      '    HP ' + Math.round(Core.getPath(p.stats, 'hp')) + '/' + Math.round(Core.getPath(p.stats, 'maxHp')) +
      '    速度 ' + (SPEEDS[mode] === 0 ? '暂停' : SPEEDS[mode] + 'x') +
      (near.length ? '    附近：' + game.npcName(near[0].npcId) : '') +
      (userMods.length ? '    mod ' + userMods.length + ' 个' : '') + '\n' +
      'WASD/方向键 走  E/回车 交互  鼠标点格子 走过去  X 查看  Tab 环顾  ? 帮助\n' +
      '1-5 速度(1 暂停 / 2-5 = 1x-8x)  +/- 缩放(0 复位)  C ' + (out.color ? '切黑白' : '切彩色') +
      '  F2 mod  F3 诊断  F4 信息  F2 里能选文件、填模板、导出\n' +
      '格 ' + d.cellW.toFixed(1) + 'x' + d.cellH.toFixed(1) + 'px  画面 ' + game.screenW + 'x' + game.screenH +
      '  可用 ' + Math.round(d.pxW) + 'x' + Math.round(d.pxH) +
      '  窗口 ' + window.innerWidth + 'x' + window.innerHeight + '  ' + VERSION;
  }

  /* ---------------- 装 mod：粘 JSON / 选文件 / 热加载（保留进度），存在浏览器里 ----------------
 * 门槛压到最低：
 *    框里粘 JSON 点一下就用；也可以直接选一个 mod.json 文件
 *    不知道自己该写什么？点「填入示例模板」那是 tools/starter_mod.json 那一份，能跑
 *    应用是【热加载】：世界状态、背包、进度都留着，新房间/新人/新对话立刻接上
 *    每个 mod 单独列出、单独移除；导出可以把装好的东西存成一个文件带走
 * ------------------------------------------------------------------------- */
function esc(str){
  return String(str === undefined || str === null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function readStoredMods(){
  try {
    var v = JSON.parse(localStorage.getItem(LS_MODS) || '[]');
    if (!Array.isArray(v)) v = [v];
    return v.filter(function(m){ return m && typeof m === 'object'; });
  } catch (e){ return []; }
}
function writeStoredMods(list){
  try { localStorage.setItem(LS_MODS, JSON.stringify(list)); } catch (e) {}
}
/* 允许三种写法：完整 manifest（带 data）/ 只有内容块 / 直接就是一个块 */
function parseModText(txt){
  var o = JSON.parse(txt);
  if (!o || typeof o !== 'object' || Array.isArray(o)) throw new Error('mod 必须是一个 JSON 对象');
  if (o.data || o.content) return { manifest: o, data: o.data || o.content };
  if (o.scenes || o.npcs || o.dialogues || o.views || o.interactables || o.schedules ||
      o.events || o.macros || o.hooks)
    return { manifest: { id: o.id || 'pasted_mod', name: o.name || '粘贴的 mod',
                         version: o.version || '1', priority: o.priority === undefined ? 100 : o.priority }, data: o };
  throw new Error('没找到内容块（scenes / npcs / dialogues / views / macros / hooks ...）');
}
function modName(m){
  var man = (m && (m.manifest || m)) || {};
  return { id: String(man.id || '?'), name: String(man.name || man.id || '未命名') };
}
function loadBuilt(mods){
  return Core.load({ space: root.SPACE_SPEC, mods: (mods || []).concat(root.SPACE_MODS || []) });
}
function buildGame(mods){
  built = loadBuilt(mods);
  /* opts.kernel = build_space.py --kernel 挂上来的兵棋内核（视图的 source、
     kernelQuery 判定词都读它）；effect "kernel" 的 op 走 onKernel。 */
  game  = Core.createGame(built, { kernel: root.ZHANYI_KERNEL || undefined, onKernel: onKernel });
  window.__game = game;
  return built.report;
}
/* 一局结束（或想重开）时用：同一份内容，世界状态全部重置 */
function newGame(){
  game = Core.createGame(built, { kernel: root.ZHANYI_KERNEL || undefined, onKernel: onKernel });
  window.__game = game;
  mode = 0; acc = 0;
  if (game) game.speed = SPEEDS[mode];     /* 内核自己不知道外壳的档位，这里告诉它 */
  out.lastText = null;
  lastScene = null; lastNeed = '';
  resize(); drawInfo();
  return game;
}
/* 应用（热加载）：先把新内容合出来，能合就 reloadContent 保留世界状态 */
function applyMods(){
  var built_new;
  try { built_new = loadBuilt(userMods); }
  catch (e){ setModMsg('内容合并不了：' + (e && e.message ? e.message : e), true); return; }
  var hotOK = false;
  try { hotOK = !!game && game.reloadContent(built_new) === true; } catch (e){ hotOK = false; }
  if (!hotOK){ buildGame(userMods); built_new = built; } else { built = built_new; window.__game = game; }
  out.lastText = null;
  resize(); drawInfo(); renderModList();
  var rep = built_new.report || { errors: [], warnings: [] };
  var extra = (rep.warnings && rep.warnings.length) ? ('；警告 ' + rep.warnings.length + '：' + rep.warnings.slice(0, 2).join('；')) : '';
  setModMsg((hotOK ? '已热加载（进度保留）：' : '已应用：') + '错误 ' + rep.errors.length + ' / 警告 ' + rep.warnings.length + extra,
            rep.errors.length > 0);
}
function modPanelOpen(){ return modPanel && !modPanel.classList.contains('hidden'); }
function setModMsg(txt, bad){
  if (!modMsg) return;
  modMsg.textContent = txt || '';
  modMsg.className = bad ? 'bad' : 'ok';
}
function renderModList(){
  if (!modList) return;
  var rows = [];
  (root.SPACE_MODS || []).forEach(function(m){
    var nm = modName(m);
    rows.push('<div class="modrow"><span>' + esc(nm.name) + '</span>' +
              '<span class="dim">' + esc(nm.id) + '  构建时就有的</span></div>');
  });
  userMods.forEach(function(m, i){
    var nm = modName(m);
    rows.push('<div class="modrow"><span>' + esc(nm.name) + '</span>' +
              '<span class="dim">' + esc(nm.id) + '</span>' +
              '<button data-rm="' + i + '">移除</button></div>');
  });
  modList.innerHTML = rows.length ? rows.join('') : '<div class="dim">还没有装过 mod。往上面粘一段 JSON，或点「填入示例模板」。</div>';
}
function openModPanel(){
  if (!modPanel) return;
  modPanel.classList.remove('hidden');
  renderModList();
  setModMsg(userMods.length ? ('已装 ' + userMods.length + ' 个：点「应用并重载」才会生效，改动会存在浏览器里。')
                            : '粘一段 JSON（或选一个 mod.json 文件），点「应用并重载」。');
  if (modText) modText.focus();
}
function closeModPanel(){ if (modPanel) modPanel.classList.add('hidden'); drawInfo(); }
function applyModPanel(){
  try {
    var mod = parseModText(modText.value);
    userMods = userMods.concat([mod]);
    writeStoredMods(userMods);
    applyMods();
  } catch (e){
    setModMsg('装不进去：' + (e && e.message ? e.message : e), true);
  }
}
function removeMod(i){
  if (!(i >= 0 && i < userMods.length)) return;
  userMods.splice(i, 1);
  writeStoredMods(userMods);
  applyMods();
}
function clearModPanel(){
  userMods = [];
  writeStoredMods(userMods);
  applyMods();
  setModMsg('已清空装过的 mod。');
}
function fillTemplate(){
  if (!modText) return;
  if (!root.SPACE_STARTER){ setModMsg('这份产物里没有编入示例模板。', true); return; }
  modText.value = JSON.stringify(root.SPACE_STARTER, null, 1);
  setModMsg('模板已填进框里（就是 tools/starter_mod.json）。直接点「应用并重载」就能看到自己的房间；改完再点一次就覆盖成你的。');
}
function exportMods(){
  var txt = JSON.stringify(userMods.length === 1 ? userMods[0] : userMods, null, 1);
  if (modText) modText.value = txt;
  try {
    var blob = new Blob([txt], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = 'space_mod.json';
    if (a.click) a.click();
    setTimeout(function(){ try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
    setModMsg('已导出（同时也放进上面的框里，可以直接复制给朋友）。');
  } catch (e){
    setModMsg('导出到文件没成功，但内容已经在上面框里了，可以手动复制。');
  }
}
/* 选一个 mod.json 文件 = 粘一段 JSON，少一次复制粘贴 */
function importFile(){
  var f = modFile && modFile.files && modFile.files[0];
  if (!f) return;
  try {
    if (typeof FileReader !== 'undefined'){
      var fr = new FileReader();
      fr.onload = function(){ if (modText) modText.value = String(fr.result); setModMsg('已读入 ' + f.name + '，点「应用并重载」就生效。'); };
      fr.onerror = function(){ setModMsg('读文件失败。', true); };
      fr.readAsText(f);
    } else if (f.text){
      f.text().then(function(t){ if (modText) modText.value = t; setModMsg('已读入 ' + f.name + '。'); });
    } else { setModMsg('这个浏览器读不了文件，直接把 JSON 粘进来吧。', true); }
  } catch (e){ setModMsg('读文件失败：' + e.message, true); }
}
if (modText){
  modText.placeholder =
    '{ "id": "my_mod", "name": "我的 mod", "data": {\n' +
    '  "scenes": { "list": [ { "id": "my_room", "name": "我的房间",\n' +
    '    "size": { "w": 10, "h": 6 },\n' +
    '    "tiles": ["##########", "#........#", "#...@....#",\n' +
    '              "#........#", "#........#", "##########"],\n' +
    '    "legend": {}, "exits": [] } ] } } }\n' +
    '（legend 空着也行  # 墙、. 地板、+ 门 这些标准字符走 config.defaultLegend）';
}
[['modapply', applyModPanel], ['modclear', clearModPanel], ['modclose', closeModPanel],
 ['modtemplate', fillTemplate], ['modexport', exportMods]].forEach(function(pair){
  var el2 = document.getElementById(pair[0]);
  if (el2 && el2.addEventListener) el2.addEventListener('click', pair[1]);
});
if (modFile && modFile.addEventListener) modFile.addEventListener('change', importFile);
if (modList && modList.addEventListener){
  modList.addEventListener('click', function(ev){
    var t = ev && ev.target, attr = t && t.getAttribute && t.getAttribute('data-rm');
    if (attr !== null && attr !== undefined) removeMod(Number(attr));
  });
}

/* ---------------- 鼠标：点格子走过去 ---------------- */
  if (pre && pre.addEventListener){
    pre.addEventListener('click', function(ev){
      if (modPanelOpen()) return;
      var lay = game.layout();
      var rect = pre.getBoundingClientRect ? pre.getBoundingClientRect() : { left: 0, top: 0 };
      var cx = Math.floor((ev.clientX - rect.left) / out.cellW);
      var cy = Math.floor((ev.clientY - rect.top) / out.cellH);
      var wX = (lay.winX === undefined) ? 0 : lay.winX, wY = (lay.winY === undefined) ? lay.mapTop : lay.winY;
      var wW = (lay.winW === undefined) ? lay.mapW : lay.winW, wH = (lay.winH === undefined) ? lay.mapH : lay.winH;
      if (cy < wY || cy >= wY + wH || cx < wX || cx >= wX + wW) return;
      var cell = game.screenToScene(cx, cy);
      if (!cell) return;
      if (game.ui.dialogue || game.ui.view) return;
      var c = game.cellAt(game.world.player.scene, cell.x, cell.y);
      if (!c || !c.passable){
        game.lookAt(cell.x, cell.y);                 /* 走不到的东西：看一眼它是什么 */
      } else if (cell.x === game.world.player.x && cell.y === game.world.player.y){
        /* 点自己：什么也不做 */
      } else {
        game.ui.look = null;
        game.world.path = null;
        game.pathTo(cell.x, cell.y);               /* 每帧走一格，路走完为止 */
      }
      render(); drawInfo();
    });
  }

  /* ---------------- 键盘 ---------------- */
  /* 速度档位只有一个来源：外壳的 mode。这里顺手同步给内核，
     标题栏和 speedLabel() 才和实际速度一致（宿主壳也靠它显示速度）。 */
  function setMode(m){
    mode = Math.max(0, Math.min(SPEEDS.length - 1, Number(m) || 0));
    acc = 0;
    if (game) game.speed = SPEEDS[mode];
    drawInfo();
  }

  function onKey(e){
    var k = e.key, g = game;
    if (k === 'F2'){ if (modPanelOpen()) closeModPanel(); else openModPanel(); e.preventDefault(); return; }
    if (modPanelOpen()){
      if (k === 'Escape'){ closeModPanel(); e.preventDefault(); }
      return;                                        /* 面板开着时键盘归输入框 */
    }
    if (g.ui.reader){                                /* 阅读弹层：长文本滚动 */
      if (k === 'ArrowUp' || k === 'w') g.readerMove(-1);
      else if (k === 'ArrowDown' || k === 's') g.readerMove(1);
      else if (k === 'PageUp') g.readerMove(-1, true);
      else if (k === 'PageDown' || k === ' ') g.readerMove(1, true);
      else if (k === 'Escape' || k === 'l' || k === 'L') g.closeReader();
      render(); drawInfo(); e.preventDefault(); return;
    }
    /* --- 星图模式（第 1 期）：方向键选星系、Enter 打开、G 切换 --- */
    if (g.screenMode === 'galaxy' && !g.ui.view && !g.ui.dialogue){
      var gd = { 'ArrowUp': [0, -1], 'w': [0, -1], 'ArrowDown': [0, 1], 's': [0, 1],
                 'ArrowLeft': [-1, 0], 'a': [-1, 0], 'ArrowRight': [1, 0], 'd': [1, 0] }[k];
      if (gd){ g.galaxyMove(gd[0], gd[1]); render(); drawInfo(); e.preventDefault(); return; }
      if (k === 'Enter' || k === 'e' || k === 'E'){ g.galaxyOpenNode(); render(); drawInfo(); e.preventDefault(); return; }
      if (k === 'g' || k === 'G'){ g.toggleGalaxy(false); resize(); render(); drawInfo(); e.preventDefault(); return; }
      if (k === 'Escape'){ g.toggleGalaxy(false); resize(); render(); drawInfo(); e.preventDefault(); return; }
    }
    if (k === 'F3'){ g.openView('debug'); resize(); drawInfo(); e.preventDefault(); return; }
    if (k === 'F4'){ infoEl.classList.toggle('hidden'); resize(); drawInfo(); e.preventDefault(); return; }
    if ((k === 'g' || k === 'G') && !g.ui.view && !g.ui.dialogue && g.screenMode !== 'galaxy'){
      g.toggleGalaxy(true); resize(); render(); drawInfo(); e.preventDefault(); return;
    }
    /* ? = 当前可用按键（第 1 期）。内容里没这个视图就退回老的静态帮助。 */
    if (k === '?' || k === '/'){ g.openView(g.idx.views['keys'] ? 'keys' : 'help'); render(); drawInfo(); e.preventDefault(); return; }
    if (k === 'l' || k === 'L'){ g.openReader({ title: '日志全文', lines: g.readerLog() }); render(); drawInfo(); e.preventDefault(); return; }
    if (k === 'm' || k === 'M'){ g.openReader({ title: '任务与指令', lines: g.readerOrders() }); render(); drawInfo(); e.preventDefault(); return; }
    if (g.world.gameOver){
      if (k === 'r' || k === 'R'){ newGame(); render(); drawInfo(); e.preventDefault(); return; }
      render(); drawInfo(); e.preventDefault(); return;
    }
    /* X 查看模式：光标移动，不移动玩家 */
    if (g.ui.look){
      if (k === 'ArrowUp' || k === 'w') g.lookMove(0, -1);
      else if (k === 'ArrowDown' || k === 's') g.lookMove(0, 1);
      else if (k === 'ArrowLeft' || k === 'a') g.lookMove(-1, 0);
      else if (k === 'ArrowRight' || k === 'd') g.lookMove(1, 0);
      else if (k === 'Escape' || k === 'x' || k === 'X' || k === 'Enter') g.ui.look = null;
      render(); drawInfo(); e.preventDefault(); return;
    }
    if (k === 'x' || k === 'X'){ g.lookAt(g.world.player.x, g.world.player.y); render(); drawInfo(); e.preventDefault(); return; }
    if (k === 'C' || k === 'c'){ out.color = !out.color; out.lastText = null; render(); drawInfo(); e.preventDefault(); return; }
    if (k === 'Escape'){
      if (g.ui.reader) g.closeReader();
      else if (g.ui.view) g.closeView();
      else if (g.ui.dialogue) g.ui.dialogue = null;
      render(); drawInfo(); e.preventDefault(); return;
    }
    if (g.ui.dialogue){
      if (k === 'ArrowUp' || k === 'w'){ g.ui.dialogue.cursor = Math.max(0, g.ui.dialogue.cursor - 1); }
      else if (k === 'ArrowDown' || k === 's'){ g.ui.dialogue.cursor = Math.min(g.dialogueOptions().length - 1, g.ui.dialogue.cursor + 1); }
      else if (k === 'Enter' || k === ' ' || k === 'e'){ g.dialogueAdvance(); }
      else if (k >= '1' && k <= '9'){ g.ui.dialogue.cursor = Number(k) - 1; g.dialogueAdvance(); }
      render(); drawInfo(); e.preventDefault(); return;
    }
    if (g.ui.view){
      if (k === 'ArrowUp' || k === 'w') g.viewMove(-1);
      else if (k === 'ArrowDown' || k === 's') g.viewMove(1);
      else if (k === 'Enter'){ if (g.ui.view.rows && g.ui.view.rows.length) g.viewSelect(); }
      else if (k >= '1' && k <= '9') g.viewChoose(Number(k) - 1);
      else if (k === 'Tab') g.closeView();
      render(); drawInfo(); e.preventDefault(); return;
    }
    if (k === 'Tab'){ g.openView('nearby'); render(); drawInfo(); e.preventDefault(); return; }
    if (k === ' ' || k === '.'){ g.wait(1); render(); drawInfo(); e.preventDefault(); return; }
    if (k === 'e' || k === 'E' || k === 'Enter'){ g.interact(); render(); drawInfo(); e.preventDefault(); return; }
    if (k >= '1' && k <= '5'){ setMode(Number(k) - 1); e.preventDefault(); return; }
    /* 缩放：+ 放大 / - 缩小 / 0 复位 */
    if (k === '+' || k === '='){ zoomBias++; saveZoom(); resize(); drawInfo(); e.preventDefault(); return; }
    if (k === '-' || k === '_'){ zoomBias--; saveZoom(); resize(); drawInfo(); e.preventDefault(); return; }
    if (k === '0'){ zoomBias = 0; saveZoom(); resize(); drawInfo(); e.preventDefault(); return; }
    var dirs = { ArrowUp:[0,-1], ArrowDown:[0,1], ArrowLeft:[-1,0], ArrowRight:[1,0],
                 w:[0,-1], s:[0,1], a:[-1,0], d:[1,0] };
    var d2 = dirs[k];
    if (d2){ g.world.path = null; g.tryMove(d2[0], d2[1]); render(); drawInfo(); e.preventDefault(); }
  }

  var lastScene = null, lastNeed = '';
  function resizeIfSceneChanged(){
    var sc = game.world.player.scene;
    var g = game.grid(sc);
    var sig = sc + ':' + (g ? g.w + 'x' + g.h : '-');
    if (sig !== lastNeed){ lastNeed = sig; lastScene = sc; resize(); }
  }

  /* ---------------- 主循环：setInterval，不用 requestAnimationFrame ---------------- */
  function step(){
    try {
      var overlay = !!(game.ui.dialogue || game.ui.view);
      if (!overlay && !game.world.gameOver && SPEEDS[mode] > 0){
        acc += 0.06 * SPEEDS[mode] * (Core.num(Core.getPath(built.space, 'config.ticksPerSecond'), 4));
        var n = Math.floor(acc);
        if (n > 0){ acc -= n; game.step(Math.min(n, 120)); }
      }
      /* 自动走路（鼠标点的目标）和速度无关：走一格就是一分钟 */
      if (!overlay && !game.world.gameOver && game.world.path) game.advancePath();
      resizeIfSceneChanged();
      render();
    } catch (e) { showErr('循环：' + (e && e.message ? e.message : e)); }
  }

  window.addEventListener('keydown', onKey);
  window.addEventListener('resize', function () { resize(); drawInfo(); });
  window.addEventListener('orientationchange', function () { setTimeout(function(){ resize(); drawInfo(); }, 150); });

  resize();
  drawInfo();
  setInterval(step, 60);
  setInterval(drawInfo, 250);
  window.__game = game;                     /* 方便在控制台查 */
  window.__space = { boot: boot, get game(){ return game; }, get built(){ return built; }, get out(){ return out; },
                     get mods(){ return userMods.slice(); }, applyMods: applyMods, parseModText: parseModText, resize: resize, newGame: newGame };
}

if (document.readyState === 'complete' || document.readyState === 'interactive') setTimeout(boot, 0);
else window.addEventListener('DOMContentLoaded', boot);
})(typeof self !== 'undefined' ? self : this);
