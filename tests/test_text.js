/* 纯文本模式回归测试 */
var path=require('path'), fs=require('fs');
var Core=require(path.join(__dirname,'..','engine','space-core.js'));
var T=require(path.join(__dirname,'..','engine','space-textout.js'));
var pass=0,fail=0;
function ok(n,c,x){ if(c){pass++;console.log('  ok   '+n);} else {fail++;console.log('  FAIL '+n+(x!==undefined?'  -> '+x:''));} }
var spec=JSON.parse(fs.readFileSync(path.join(__dirname,'..','content','space.json'),'utf8'));
console.log('=== 纯文本输出器 ===');
ok('ASCII 映射：墙  -> #', T.toAscii('\u2588')==='#', T.toAscii('\u2588'));
ok('ASCII 映射：地板  -> .', T.toAscii('\u2591')==='.', T.toAscii('\u2591'));
ok('ASCII 映射：迷雾  -> 逗号', T.toAscii('\u00b7')===',', T.toAscii('\u00b7'));
ok('ASCII 映射：线框  -> -', T.toAscii('\u2500')==='-');
ok('ASCII 映射：角  -> +', T.toAscii('\u250c')==='+');
ok('ASCII 映射：光标  -> >', T.toAscii('\u25b6')==='>');
ok('ASCII 映射：宽字续格 -> 空', T.toAscii('\u0000')==='');
ok('普通字符原样保留', T.toAscii('A')==='A' && T.toAscii('\u6307')==='\u6307');
ok('全表没有非 ASCII 的地图符号', Object.keys(T.ASCII_MAP).every(function(k){
  return T.ASCII_MAP[k].split('').every(function(c){ return c.charCodeAt(0) < 128; }); }));

var built=Core.load({space:spec});
var g=Core.createGame(built,{});
g.resize(100,30);
g.render();
// 用一个假 <pre> 接住输出
var pre={textContent:'',innerHTML:'',style:{},appendChild:function(){}};
var out=new T.TextOut(pre,{fontSize:15,color:false});
out.paint(g.screen,true);
var txt=pre.textContent;
ok('产出非空文本', txt.length>500, txt.length);
var lines=txt.split('\n');
ok('行数 = 画面高度', lines.length===g.screenH, lines.length+' vs '+g.screenH);
/* 按【显示宽度】算（中文占两列），所有行必须等宽 */
function dispW(str){
  var total = 0;
  for (var i = 0; i < str.length; i++){
    var c = str.charCodeAt(i);
    var wide = c >= 0x1100 && ((c >= 0x1100 && c <= 0x115F) || (c >= 0x2E80 && c <= 0xA4CF) ||
      (c >= 0xAC00 && c <= 0xD7A3) || (c >= 0xF900 && c <= 0xFAFF) || (c >= 0xFE30 && c <= 0xFE6F) ||
      (c >= 0xFF00 && c <= 0xFF60) || (c >= 0xFFE0 && c <= 0xFFE6));
    total += wide ? 2 : 1;
  }
  return total;
}
var widths = lines.map(dispW);
var uniq = widths.filter(function(w,i){ return widths.indexOf(w) === i; });
ok('每一行的显示宽度完全一致（中文按两列算）', uniq.length === 1, '宽度集合 ' + JSON.stringify(uniq));
ok('每行显示宽度 = 画面列数', widths[0] === g.screenW, widths[0] + ' vs ' + g.screenW);
ok('没有残留的方块/线框字符', !/[\u2588\u2591\u2593\u2500\u2502\u250c\u25b6]/.test(txt));
/* 墙现在被轮廓化成 - | +（见 space-core 的 shapeWalls）：起点场景指挥中心是一整圈
   矩形墙，所以画面上一定有成排的 - 和 |；# 只留给端点与家具（货架）。 */
ok('地图里有墙（- | + 轮廓）', txt.indexOf('|')>=0 && txt.indexOf('-')>=0);
ok('地图里有 . 地板', txt.indexOf('.')>=0);
ok('画面上有玩家 @', txt.indexOf('@')>=0);
ok('标题栏中文显示正常', txt.indexOf('\u6307\u6325\u4e2d\u5fc3')>=0);
var blank=txt.split('\n').filter(function(l){return l.trim().length>0;}).length;
ok('不是一整片空白（有内容的行 > 5）', blank>5, blank);
/* ---- 自适应字号：字号必须真的写到 <pre> 上（用一个假 DOM 验） ---- */
/* 这个坑：只改 TextOut.fontSize 而不管 DOM，画面永远停在模板里写死的 15px，
   自适应算出来的列数/行数全白算。 */
function FakeEl(tag){
  this.tagName = tag; this.style = {}; this.textContent = ''; this.children = [];
}
FakeEl.prototype.appendChild = function(c){ this.children.push(c); return c; };
FakeEl.prototype.getBoundingClientRect = function(){
  var m = /(\d+(?:\.\d+)?)px/.exec(this.style.font || '');
  var size = m ? Number(m[1]) : 15;
  var lines = String(this.textContent).split('\n');
  var cols = 0;
  for (var i = 0; i < lines.length; i++) cols = Math.max(cols, lines[i].length);
  return { width: cols * size * 0.6, height: lines.length * size * 1.15, left: 0, top: 0 };
};
global.document = { createElement: function(t){ return new FakeEl(t); }, body: new FakeEl('body') };

var pre2 = new FakeEl('pre');
var out2 = new T.TextOut(pre2, { fontSize: 15, color: false });
ok('字号被写进 <pre>', /bold 15px/.test(pre2.style.font), pre2.style.font);
ok('量出的单格高度 = 字号 x 行高（行高 1.15）', Math.abs(out2.cellH - 15 * 1.15) < 0.01, out2.cellH);
ok('量出的单格宽度 = 等宽字宽', Math.abs(out2.cellW - 15 * 0.6) < 0.01, out2.cellW);
out2.setFont(24);
ok('setFont 换字号也换 DOM', /bold 24px/.test(pre2.style.font), pre2.style.font);
ok('单格高度跟着字号变', Math.abs(out2.cellH - 24 * 1.15) < 0.01, out2.cellH);
var fitA = out2.fit(1200, 800);
ok('fit 的列数 = 窗口宽 / 单格宽', fitA.cols === Math.floor(1200 / out2.cellW), fitA.cols + '/' + Math.floor(1200 / out2.cellW));
var big = out2.autoFit(1920, 1080, 40, 20, 3, 9, 30, 104, 28, 0);
ok('大窗口自动放大字号', big.fontSize >= 14, big.fontSize + 'px');
ok('放大后的字号确实落在 <pre> 上', new RegExp('bold ' + big.fontSize + 'px').test(pre2.style.font), pre2.style.font);
var small = out2.autoFit(700, 400, 72, 36, 6, 9, 30, 104, 28, 0);
ok('小窗口自动缩小字号', small.fontSize <= big.fontSize, small.fontSize + ' vs ' + big.fontSize);
ok('小窗口下场景仍然装得下（列数够）', small.cols >= 72, small.cols);
var zoom = out2.autoFit(1440, 860, 72, 24, 3, 9, 30, 104, 28, 3);
ok('手动缩放（zoomBias）会加在自动字号上', zoom.fontSize >= 9, zoom.fontSize);
delete global.document;

console.log('\n----------------------------------------');
console.log('通过 '+pass+' / 失败 '+fail);
process.exit(fail?1:0);