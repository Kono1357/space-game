/* =============================================================================
 * tools/shot.js  用真浏览器（Edge/Chrome headless）给产物截一张彩色 PNG
 *   用法： node tools/shot.js [场景ID] [宽,高] [输出PNG]
 *   例：   node tools/shot.js station_command 1440,810 preview_text.png
 *
 *   为什么需要它：默认是纯文本（黑白）模式，视觉设计（调色板 / 轮廓 / 区域地板）
 *   只有按 C 切到彩色才看得到；而纯文本模式下 toAscii 会把块字符全映射掉。
 *   截图走的就是真机的渲染路径，所以它是「人工看一眼」的唯一可靠办法。
 * ========================================================================== */
var path = require('path'), fs = require('fs'), os = require('os'), cp = require('child_process');

var GAME = path.join(__dirname, '..', 'space-text.html');
var sceneId = process.argv[2] || 'station_command';
var size = (process.argv[3] || '1440,810').replace(/[xX]/, ',');
var outPng = process.argv[4] || path.join(__dirname, '..', 'preview_text.png');

function findBrowser(){
  if (process.env.SPACE_BROWSER && fs.existsSync(process.env.SPACE_BROWSER)) return process.env.SPACE_BROWSER;
  var cands = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
  ];
  for (var i = 0; i < cands.length; i++) if (fs.existsSync(cands[i])) return cands[i];
  var names = ['msedge.exe', 'chrome.exe'];
  var roots = [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA];
  for (var r = 0; r < roots.length; r++){
    for (var n = 0; n < names.length; n++){
      if (!roots[r]) continue;
      var p = path.join(roots[r], n === 0 ? 'Microsoft\\Edge\\Application' : 'Google\\Chrome\\Application', names[n]);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function main(){
  if (!fs.existsSync(GAME)){ console.error('找不到 ' + GAME + '，先跑 python build_space.py'); process.exit(2); }
  var browser = findBrowser();
  if (!browser){ console.log('跳过：本机没有 Edge/Chrome（可设 SPACE_BROWSER=<exe> 指定）。'); process.exit(0); }
  var html = fs.readFileSync(GAME, 'utf8');
  var inject = '<script>(' + PAGE_SHOT.toString() + ')(' + JSON.stringify(sceneId) + ');</script>';
  var idx = html.lastIndexOf('</body>');
  var pageHtml = idx >= 0 ? (html.slice(0, idx) + inject + html.slice(idx)) : (html + inject);
  var tmp = path.join(os.tmpdir(), 'shuo_shot');
  try { fs.mkdirSync(tmp, { recursive: true }); } catch (e) {}
  var page = path.join(tmp, 'shot.html');
  fs.writeFileSync(page, pageHtml, 'utf8');
  var url = 'file:///' + page.replace(/\\/g, '/');
  var args = ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars',
              '--user-data-dir=' + path.join(tmp, 'edgedata_' + Date.now()),
              '--window-size=' + size, '--virtual-time-budget=8000',
              '--screenshot=' + path.resolve(outPng), url];
  var r = cp.spawnSync(browser, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!fs.existsSync(outPng)){
    console.error('没截到图（浏览器退出码 ' + r.status + '）');
    console.error((r.stderr || '').split('\n').slice(-5).join('\n'));
    process.exit(1);
  }
  console.log('截图 ' + path.basename(outPng) + '  场景 ' + sceneId + '  窗口 ' + size +
              '  ' + (fs.statSync(outPng).size / 1024).toFixed(1) + ' KB');
}

/* 注入到页面里：等引擎起来 -> 切彩色 -> 走到指定场景 -> 打一帧 */
function PAGE_SHOT(sceneId){
  var t0 = Date.now();
  var iv = setInterval(function(){
    var sp = window.__space;
    if (!sp || !sp.game){ if (Date.now() - t0 > 6000) clearInterval(iv); return; }
    clearInterval(iv);
    var g = sp.game;
    sp.out.color = true;                       /* C：彩色模式，调色板才看得到 */
    var grid = g.grid(sceneId);
    if (grid){
      var doorCh = (g.presets && g.presets.door && g.presets.door.ch) || '+';
      var cell = null, fallback = null;
      for (var i = 0; i < grid.pass.length; i++){
        if (!grid.pass[i] || grid.kind[i] === 'interactable') continue;
        if (grid.ch[i] === doorCh) continue;                      /* 别站在门上 */
        var key = (i % grid.w) + ',' + Math.floor(i / grid.w);
        if (grid.exitMap && grid.exitMap[key]) continue;
        if (fallback === null) fallback = i;
        if (grid.kind[i] === 'floor' && !grid.def[i]){ cell = i; break; }
      }
      if (cell === null) cell = fallback;
      if (cell !== null) g.teleport(sceneId, cell % grid.w, Math.floor(cell / grid.w));
      if (g.world && g.world.log) g.world.log.length = 0;
    }
    sp.resize();                                /* 重算字号，把 <pre> 铺满 */
  }, 50);
}

main();
