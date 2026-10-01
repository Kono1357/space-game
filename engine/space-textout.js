/* =============================================================================
 * space-textout.js  纯文本输出器（零 Canvas、零 Unicode 地图字符）
 *   把内核合成的 {ch,fg,bg} 字符网格，翻译成纯 ASCII，塞进一个 <pre> 里。
 *   DOM 能显示文字，就一定能看到画面。没有任何像素级操作。
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpaceTextOut = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* 地图/界面符号 -> 纯 ASCII。非 ASCII 的只剩中文文本（中文没问题） */
var ASCII_MAP = {
  '\u2588': '#', '\u2593': '%', '\u2592': '%', '\u2591': '.', '\u25a0': '#',
  '\u25c6': '*', '\u25b2': '^', '\u00b7': ',', '\u2500': '-', '\u2502': '|',
  '\u250c': '+', '\u2510': '+', '\u2514': '+', '\u2518': '+',
  '\u251c': '+', '\u2524': '+', '\u252c': '+', '\u2534': '+', '\u253c': '+',
  '\u25b6': '>', '\u2191': '^', '\u2193': 'v', '\u2190': '<', '\u2192': '>',
  '\u2016': '=', '\u2715': 'x', '\u2550': '=', '\u25cf': 'o', '\u25cb': 'o',
  '\u25c9': 'O', '\u25b3': '^', '\u2595': '|', '\u258f': '|',
  '\u0000': ''                      /* 宽字符续格：不占字符 */
};
var WIDE_MARK = '\u0000';

function num(v, d){ v = Number(v); return isFinite(v) ? v : d; }
function esc(s){
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function toAscii(ch){
  if (ch === undefined || ch === null) return ' ';
  if (Object.prototype.hasOwnProperty.call(ASCII_MAP, ch)) return ASCII_MAP[ch];
  return ch;
}

function TextOut(pre, opts){
  opts = opts || {};
  this.pre = pre;
  this.fontSize = num(opts.fontSize, 15);
  this.color = !!opts.color;              /* 默认黑白，按 C 切彩色 */
  this.cellW = 9; this.cellH = 17.25;
  this.cellCssW = 9; this.cellCssH = 18;
  this.advance = 9;
  this.dpr = 1;
  this.prev = null;
  this.lastText = '';
  this.stats = { painted: 0, cells: 0, frames: 0 };
  this.diag = {};
  this._measure();
}

TextOut.prototype.fontCss = function(){
  return 'bold ' + this.fontSize + 'px "Consolas", "Courier New", monospace';
};

/* 关键：字号必须真的写到 <pre> 上。
   只改 this.fontSize 而不管 DOM，画面就永远停在模板里写死的 15px，
   自适应算出来的列数/行数全白算  这是纯文本版最容易踩的坑。 */
TextOut.prototype.applyFont = function(){
  var pre = this.pre;
  if (!pre || !pre.style) return;
  pre.style.font = this.fontCss();
  pre.style.lineHeight = '1.15';
};

/* 量出这个字号下单格的宽高：用一个隐藏的 <pre>（同样的 font / line-height /
   margin / padding）量「100 列 x 2 行」，而不是量一个 span  因为 inline 元素的
   rect 高度是字体内容高，不等于行高，会和 <pre> 的实际行距对不上。 */
TextOut.prototype._measure = function(){
  this.applyFont();
  if (typeof document === 'undefined'){
    this.cellW = Math.round(this.fontSize * 0.6); this.cellH = Math.round(this.fontSize * 1.15);
    this.cellCssW = this.cellW; this.cellCssH = this.cellH; return;
  }
  var el = this._mEl;
  if (!el){
    el = document.createElement('pre');
    if (el.style && el.style.cssText !== undefined)
      el.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;white-space:pre;margin:0;padding:0';
    if (document.body && document.body.appendChild) document.body.appendChild(el);
    this._mEl = el;
  }
  el.style.font = this.fontCss();
  el.style.lineHeight = '1.15';
  var sample = '';
  for (var i = 0; i < 100; i++) sample += 'M';
  el.textContent = sample + '\n' + sample;
  var r = el.getBoundingClientRect();
  this.cellW = (r.width > 0 ? r.width / 100 : this.fontSize * 0.6);
  this.cellH = (r.height > 0 ? r.height / 2 : this.fontSize * 1.15);
  this.advance = this.cellW;
  this.cellCssW = this.cellW; this.cellCssH = this.cellH;
};

TextOut.prototype.setFont = function(size){
  if (size) this.fontSize = num(size, this.fontSize);
  this._measure();
  this.applyFont();
  return this.fontSize;
};

TextOut.prototype.fit = function(pxW, pxH){
  this._measure();
  var cols = Math.max(20, Math.floor(num(pxW, 900) / this.cellW));
  var rows = Math.max(8,  Math.floor(num(pxH, 600) / this.cellH));
  this.prev = null;
  this.diag = { advance: this.advance, cellW: this.cellW, cellH: this.cellH, cols: cols, rows: rows,
                dpr: 1, cellCssW: this.cellW, cellCssH: this.cellH,
                pxW: Math.round(num(pxW, 0)), pxH: Math.round(num(pxH, 0)),
                canvasW: Math.round(cols * this.cellW), canvasH: Math.round(rows * this.cellH),
                font: 'bold ' + this.fontSize + 'px Consolas' };
  return { cols: cols, rows: rows };
};

/* 自适应字号：两种目标
 *    保底：整个场景必须装得下（rows-chrome >= needRows 且 cols >= needCols）
 *    目标：屏幕尽量显示到 targetCols x targetRows 这么多格  这样地图才"看得开"
 * 优先同时满足 ；满足不了就退而求其次，选最大的能装下场景的字号。
 * 另外叠加一个手动缩放偏移 zoomBias（+ 放大 / - 缩小）。 */
TextOut.prototype.autoFit = function(pxW, pxH, needCols, needRows, chromeRows, minF, maxF, targetCols, targetRows, zoomBias){
  minF = num(minF, 10); maxF = num(maxF, 40);
  zoomBias = num(zoomBias, 0);
  var tCols = num(targetCols, 0), tRows = num(targetRows, 0);
  var fitOK = minF, targetOK = 0;
  for (var f = minF; f <= maxF; f++){
    this.fontSize = f; this._measure();
    var cols = Math.floor(num(pxW, 900) / this.cellW);
    var rows = Math.floor(num(pxH, 600) / this.cellH);
    var ok = (rows - num(chromeRows, 8) >= num(needRows, 12)) && (cols >= num(needCols, 24));
    if (ok){
      fitOK = f;
      /* 循环是字号从小到大，最后留下的就是「还看得见目标格数」的最大字号 */
      if (cols >= tCols && rows >= tRows) targetOK = f;
    }
  }
  var best = targetOK || fitOK;
  best = Math.max(minF, Math.min(maxF, best + zoomBias));
  this.fontSize = best; this._measure();
  var fit = this.fit(pxW, pxH);
  fit.fontSize = best;
  return fit;
};

TextOut.prototype.charW = function(ch){ return this.cellW * (toAscii(ch).length || 0); };
TextOut.prototype.contentLost = function(){ return false; };   /* DOM 不会丢内容 */

/* 把网格拼成一段文本（可选彩色 span），整体塞进 <pre> */
TextOut.prototype.paint = function(scr, force){
  var i, W = scr.w, H = scr.h, lines = [], painted = 0;
  var color = this.color;
  if (color){
    for (var y = 0; y < H; y++){
      var buf = '', curF = null, curB = null, html = '';
      for (var x = 0; x < W; x++){
        i = y * W + x;
        var ch = scr.ch[i];
        if (ch === WIDE_MARK) continue;                    /* 宽字续格不占字符位 */
        var s = toAscii(ch);
        if (!s) continue;
        var f = String(scr.fg[i] || '#c9c9d8'), b = String(scr.bg[i] || '#000000');
        if (f !== curF || b !== curB){
          if (buf) html += '<span style="color:' + curF + ';background:' + curB + '">' + esc(buf) + '</span>';
          buf = ''; curF = f; curB = b;
        }
        buf += s;
      }
      if (buf) html += '<span style="color:' + curF + ';background:' + curB + '">' + esc(buf) + '</span>';
      lines.push(html);
    }
    var outHtml = lines.join('\n');
    if (outHtml !== this.lastText){ this.pre.innerHTML = outHtml; this.lastText = outHtml; }
    painted = W * H;
  } else {
    for (var y2 = 0; y2 < H; y2++){
      var line = '';
      for (var x2 = 0; x2 < W; x2++){
        i = y2 * W + x2;
        var c2 = scr.ch[i];
        if (c2 === WIDE_MARK) continue;
        line += toAscii(c2);
      }
      lines.push(line);
    }
    var outText = lines.join('\n');
    if (outText !== this.lastText){ this.pre.textContent = outText; this.lastText = outText; painted = W * H; }
  }
  this.prev = { w: W, h: H };
  this.stats.painted = painted;
  this.stats.cells = W * H;
  this.stats.frames++;
  return painted;
};

return { TextOut: TextOut, toAscii: toAscii, ASCII_MAP: ASCII_MAP, WIDE_MARK: WIDE_MARK };
});