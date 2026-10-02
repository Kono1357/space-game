/* =============================================================================
 * space-core.js  「朔」场景层框架  纯逻辑内核（零 DOM 依赖）
 *   浏览器：window.SpaceCore      node：require('./space-core.js')
 *   设计铁律：内核不认内容，内容不写代码。所有玩法元素都从数据里长出来。
 * ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SpaceCore = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

var VERSION = '1.6.0-text';
var SAVE_VERSION = 2;   /* 存档格式版本：world 结构变了就 +1，并在 saveMigrations 里补一档 */
var HOUR = 60;          /* 1 游戏小时 = 60 tick = 60 分钟 */
var DAY  = 24 * HOUR;

/* ============================== 0  工具 ============================== */
function isObj(v){ return v !== null && typeof v === 'object' && !Array.isArray(v); }
function isArr(v){ return Array.isArray(v); }
function isFn(v){ return typeof v === 'function'; }
function clone(v){ return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }
function num(v, d){ v = Number(v); return isFinite(v) ? v : d; }
function str(v, d){ return v === undefined || v === null ? (d === undefined ? '' : d) : String(v); }
function clamp(v, a, b){ return v < a ? a : (v > b ? b : v); }
function has(o, k){ return o && Object.prototype.hasOwnProperty.call(o, k); }

function deepMerge(base, patch, opts){
  opts = opts || {};
  if (!isObj(base) || !isObj(patch)) return clone(patch === undefined ? base : patch);
  var out = clone(base);
  for (var k in patch){
    if (!has(patch, k)) continue;
    var pv = patch[k], bv = out[k];
    if (isObj(pv) && isObj(bv)) out[k] = deepMerge(bv, pv, opts);
    else if (isArr(pv) && isArr(bv) && opts.mergeArrays) out[k] = bv.concat(clone(pv));
    else out[k] = clone(pv);
  }
  return out;
}

/* 路径取值：a.b[2].c ；找不到返回 fallback */
function getPath(obj, path, fallback){
  if (path === undefined || path === null || path === '') return obj === undefined ? fallback : obj;
  var cur = obj, parts = String(path).split('.');
  for (var i = 0; i < parts.length; i++){
    if (cur === undefined || cur === null) return fallback;
    var seg = parts[i], m = /^([^\[]*)(?:\[(\d+)\])?$/.exec(seg);
    if (!m) return fallback;
    if (m[1] !== '') cur = cur[m[1]];
    if (m[2] !== undefined){
      if (cur === undefined || cur === null) return fallback;
      cur = cur[Number(m[2])];
    }
  }
  return cur === undefined ? fallback : cur;
}

/* 模板：{a.b} 取值；找不到保留原样（永不崩） */
var TPL_RE = /\{([a-zA-Z_][a-zA-Z0-9_.\[\]]*)\}/g;
function tpl(text, ctx, opts){
  opts = opts || {};
  if (text === undefined || text === null) return '';
  if (typeof text !== 'string') return String(text);
  var out = text, depth = opts.depth === undefined ? 3 : opts.depth;
  for (var pass = 0; pass <= depth; pass++){
    if (out.indexOf('{') < 0) break;
    var before = out;
    out = out.replace(TPL_RE, function(all, key){
      var v = getPath(ctx, key, undefined);
      if (v === undefined || v === null) return opts.keepMissing ? all : str(opts.missing, '');
      if (typeof v === 'object'){ try { return JSON.stringify(v); } catch(e){ return '[obj]'; } }
      return String(v);
    });
    if (out === before) break;
  }
  return out;
}

/* 确定性随机（存档可复现）。
   注意：只带种子是不够的  读档必须把【当前状态】也接上，
   否则同一条时间线读档后会掷出不同的骰子，事件与随机遭遇全对不上。 */
function makeRng(seed){
  var s = (seed >>> 0) || 0x9E3779B9;
  function rnd(){
    s = (s + 0x6D2B79F5) | 0;
    var t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  rnd.state = function(){ return s | 0; };
  rnd.setState = function(v){ s = (Number(v) | 0) || 0x9E3779B9; return rnd; };
  return rnd;
}

/* 颜色：调色板名 / #hex / rgb() 统一成可绘制串；shade 只对 hex 生效 */
function resolveColor(c, palette, fallback){
  if (c === undefined || c === null || c === '') return fallback || '#000000';
  var s = String(c);
  if (s.charAt(0) === '#' ) return s;
  if (s.indexOf('rgb') === 0 || s.indexOf('hsl') === 0) return s;
  if (palette && has(palette, s)) return palette[s];
  return fallback || '#000000';
}
function shade(color, f){
  if (typeof color !== 'string' || color.charAt(0) !== '#') return color;
  var h = color.slice(1), r, g, b;
  if (h.length === 3){ r = parseInt(h[0]+h[0],16); g = parseInt(h[1]+h[1],16); b = parseInt(h[2]+h[2],16); }
  else if (h.length >= 6){ r = parseInt(h.slice(0,2),16); g = parseInt(h.slice(2,4),16); b = parseInt(h.slice(4,6),16); }
  else return color;
  r = clamp(Math.round(r*f),0,255); g = clamp(Math.round(g*f),0,255); b = clamp(Math.round(b*f),0,255);
  return '#' + ((1<<24) + (r<<16) + (g<<8) + b).toString(16).slice(1);
}
function pad(s, n){ s = String(s); while (s.length < n) s += ' '; return s; }
function padL(s, n){ s = String(s); while (s.length < n) s = ' ' + s; return s; }

/* ============================== 1  屏幕缓冲 ==============================
 * 内核把「整个世界 + UI」合成成一张字符网格，渲染器只负责把网格刷到 canvas。
 * 每个格子都带独立背景色  硬约束：零贴图 / 单字符 / 每格背景色块。
 * ====================================================================== */
function Screen(w, h, palette){
  this.w = w; this.h = h;
  this.n = w * h;
  this.palette = palette || null;
  this.ch = new Array(this.n);
  this.fg = new Array(this.n);
  this.bg = new Array(this.n);
  this.fill(0, 0, w, h, ' ', 'ui', 'bg');
}
Screen.prototype.inside = function(x, y){ return x >= 0 && y >= 0 && x < this.w && y < this.h; };
/* 关键：格子里存的必须是「真颜色」，不能是调色板名字。
   名字交给 canvas 会被静默忽略，整屏就花了。 */
Screen.prototype.set = function(x, y, ch, fg, bg){
  if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
  var i = y * this.w + x;
  this.ch[i] = ch;
  this.fg[i] = this.palette ? resolveColor(fg, this.palette, '#c9c9d8') : fg;
  if (bg !== undefined && bg !== null) this.bg[i] = this.palette ? resolveColor(bg, this.palette, '#000000') : bg;
};
Screen.prototype.get = function(x, y){
  if (!this.inside(x,y)) return null;
  var i = y * this.w + x;
  return { ch: this.ch[i], fg: this.fg[i], bg: this.bg[i] };
};
Screen.prototype.fill = function(x, y, w, h, ch, fg, bg){
  for (var j = 0; j < h; j++) for (var i = 0; i < w; i++) this.set(x+i, y+j, ch, fg, bg);
};
Screen.prototype.dimRect = function(x, y, w, h, f){
  f = f === undefined ? 0.45 : f;
  for (var j = 0; j < h; j++) for (var i = 0; i < w; i++){
    if (!this.inside(x+i, y+j)) continue;
    var k = (y+j) * this.w + (x+i);
    this.bg[k] = shade(this.bg[k], f);
    this.fg[k] = shade(this.fg[k], f);
  }
};
/* 写字：宽字符按 1 格算（中文宽度由渲染器缩放适配） */
Screen.prototype.text = function(x, y, text, fg, bg){
  text = str(text);
  for (var i = 0; i < text.length; i++) this.set(x + i, y, text.charAt(i), fg, bg);
  return x + text.length;
};
Screen.prototype.textRight = function(xRight, y, text, fg, bg){
  text = str(text);
  return this.text(xRight - text.length + 1, y, text, fg, bg);
};
Screen.prototype.center = function(x, y, w, text, fg, bg){
  text = str(text);
  return this.text(x + Math.max(0, Math.floor((w - text.length) / 2)), y, text, fg, bg);
};
Screen.prototype.hline = function(x, y, w, ch, fg, bg){
  for (var i = 0; i < w; i++) this.set(x+i, y, ch, fg, bg);
};
Screen.prototype.vline = function(x, y, h, ch, fg, bg){
  for (var j = 0; j < h; j++) this.set(x, y+j, ch, fg, bg);
};
/* 字符线框盒： */
Screen.prototype.box = function(x, y, w, h, fg, bg, title){
  if (w < 2 || h < 2) return;
  this.hline(x+1, y, w-2, '\u2500', fg, bg);
  this.hline(x+1, y+h-1, w-2, '\u2500', fg, bg);
  this.vline(x, y+1, h-2, '\u2502', fg, bg);
  this.vline(x+w-1, y+1, h-2, '\u2502', fg, bg);
  this.set(x, y, '\u250c', fg, bg);
  this.set(x+w-1, y, '\u2510', fg, bg);
  this.set(x, y+h-1, '\u2514', fg, bg);
  this.set(x+w-1, y+h-1, '\u2518', fg, bg);
  if (title){
    var t = ' ' + str(title) + ' ';
    this.text(x + 2, y, t, fg, bg);
  }
};
Screen.prototype.invert = function(x, y){
  if (!this.inside(x,y)) return;
  var i = y * this.w + x, f = this.fg[i];
  this.fg[i] = this.bg[i]; this.bg[i] = f;
};

/* ============================== 2  词表注册表 ==============================
 * 开放性的核心：行为词（effect）、判定词（condition）、视图提供者（view provider）
 * 全部可按名字注册。mod 用 JSON 写内容时直接引用这些词；有能力的人注册新词。
 * ====================================================================== */
var conditions = {};
var effects = {};
var viewProviders = {};
var viewMetas = {};

function registerCondition(name, fn){ conditions[name] = fn; return name; }
function registerEffect(name, fn){ effects[name] = fn; return name; }
function registerViewProvider(name, fn, meta){ viewProviders[name] = fn; if (meta) viewMetas[name] = meta; return name; }

var CMP = {
  '==': function(a,b){ return a === b; },
  '!=': function(a,b){ return a !== b; },
  '>':  function(a,b){ return a >  b; },
  '>=': function(a,b){ return a >= b; },
  '<':  function(a,b){ return a <  b; },
  '<=': function(a,b){ return a <= b; },
  'contains': function(a,b){ return String(a).indexOf(String(b)) >= 0; },
  'in': function(a,b){ return isArr(b) && b.indexOf(a) >= 0; },
  'truthy': function(a){ return !!a; }
};
function compare(a, op, b){ var f = CMP[op || '==']; return f ? !!f(a, b) : false; }

/* 判定：接受 布尔 / 字符串简写 / 对象 / 数组(全真) / null(真) */
function check(game, cond, ctx){
  if (cond === undefined || cond === null || cond === '') return true;
  if (typeof cond === 'boolean') return cond;
  if (typeof cond === 'function') return !!cond(game, ctx);
  if (isArr(cond)){
    for (var i = 0; i < cond.length; i++) if (!check(game, cond[i], ctx)) return false;
    return true;
  }
  if (typeof cond === 'string') return checkShorthand(game, cond, ctx);
  if (isObj(cond)){
    if (has(cond,'all') && !check(game, cond.all, ctx)) return false;
    if (has(cond,'any')){
      var any = cond.any, ok = false;
      for (var j = 0; j < (isArr(any)?any.length:1); j++){ if (check(game, isArr(any)?any[j]:any, ctx)){ ok = true; break; } }
      if (!ok) return false;
    }
    if (has(cond,'not') && check(game, cond.not, ctx)) return false;
    var t = cond.type;
    if (t){
      var f = conditions[t];
      if (!f) { game.warn('未知判定词 condition.type=' + t); return false; }
      return !!f(game, cond, ctx);
    }
    /* 无 type 的纯 {"all":..,"any":..} 视为已处理 */
    if (has(cond,'all') || has(cond,'any') || has(cond,'not')) return true;
  }
  return true;
}

/* 字符串简写： "flag:x"  "!flag:x"  "counter.gold>=10"  "scene:ruins"  "kernel:has_fleets" */
function checkShorthand(game, s, ctx){
  var neg = false, t = s.trim();
  if (t.charAt(0) === '!'){ neg = true; t = t.slice(1); }
  var res;
  var m = /^([a-z_]+):(.*)$/i.exec(t);
  if (m){
    var kind = m[1], rest = m[2];
    if (kind === 'flag') res = !!game.world.flags[rest];
    else if (kind === 'item') res = game.itemCount(rest) > 0;
    else if (kind === 'scene') res = game.world.player.scene === rest;
    else if (kind === 'visited') res = !!game.world.visited[rest];
    else if (kind === 'seen') res = !!game.world.seenDialogues[rest];
    else if (kind === 'pending') res = !!game.world.pending[rest];
    else if (kind === 'kernel') res = game.kernelQuery(rest);
    else if (kind === 'counter'){ var eq = /([a-z_]+)(>=|<=|==|!=|>|<)(-?\d+)/i.exec(rest); res = eq ? compare(num(game.world.counters[eq[1]],0), eq[2], num(eq[3],0)) : false; }
    else res = false;
  } else {
    var m2 = /^([a-z_]+)\.([a-zA-Z_]+)\s*(>=|<=|==|!=|>|<|contains|in)\s*(.+)$/i.exec(t);
    if (m2){
      var path = m2[1] + '.' + m2[2], val = game.readState(path);
      res = compare(val, m2[3], coerce(m2[4]));
    } else res = false;
  }
  return neg ? !res : res;
}
function coerce(s){
  s = String(s).trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if ((s.charAt(0) === '"' && s.charAt(s.length-1) === '"') || (s.charAt(0) === "'" && s.charAt(s.length-1) === "'")) return s.slice(1,-1);
  return s;
}

/* 执行效果链；ctx 里可以带 npc / node / cell / option */
function runEffects(game, list, ctx){
  if (!list) return;
  if (!isArr(list)) list = [list];
  for (var i = 0; i < list.length; i++){
    var e = list[i];
    if (!e) continue;
    if (typeof e === 'string') e = { type: e };
    if (typeof e === 'function'){ e(game, ctx); continue; }
    var f = effects[e.type];
    if (!f){ game.warn('未知效果词 effect.type=' + e.type); continue; }
    if (ctx && !e._raw){
      var bound = {};
      for (var kk in e) if (has(e, kk)) bound[kk] = (typeof e[kk] === 'string') ? tpl(e[kk], game.tplCtx(ctx)) : e[kk];
      e = bound;
    }
    var r = f(game, e, ctx || {});
    if (r && r.stop) return r;
  }
}
/* ============================== 3  内建判定词 ============================== */
registerCondition('flag', function(g, c){
  var v = has(c,'is') ? !!c.is : true;
  return !!g.world.flags[c.flag] === v;
});
registerCondition('counter', function(g, c){
  return compare(num(g.world.counters[c.counter], 0), c.op, num(c.value, 1));
});
/* 比较**两个计数器**（词表里原本只有「计数器 vs 常数」）。
   做「我方舰队 vs 敌方舰队」这类判定必须要有它 —— 否则内容层表达不了胜负条件。 */
registerCondition('counter_cmp', function(g, c){
  var a = num(g.world.counters[c.a], num(c.aDefault, 0)) + num(c.aOffset, 0);
  var b = num(g.world.counters[c.b], num(c.bDefault, 0)) + num(c.bOffset, 0);
  return compare(a, c.op || '>=', b);
});
registerCondition('stat', function(g, c){
  return compare(num(g.playerStat(c.stat), 0), c.op, num(c.value, 1));
});
registerCondition('item', function(g, c){
  return compare(g.itemCount(c.item), c.op || '>=', num(c.count, 1));
});
registerCondition('scene', function(g, c){
  if (c.sceneIn) return c.sceneIn.indexOf(g.world.player.scene) >= 0;
  return g.world.player.scene === (c.scene || c.id);
});
registerCondition('visited', function(g, c){ return !!g.world.visited[c.scene || c.id]; });
registerCondition('dialogue_seen', function(g, c){ return !!g.world.seenDialogues[c.dialogue || c.id]; });
registerCondition('near', function(g, c){
  var r = num(c.radius, 1), list;
  if (c.npc){ list = g.npcsNear(r); return list.some(function(a){ return a.npcId === c.npc; }); }
  if (c.interactable){ list = g.cellsNear(r); return list.some(function(a){ return a.def && a.def.id === c.interactable; }); }
  return false;
});
registerCondition('time', function(g, c){
  var m = g.minuteOfDay();
  var from = parseClock(c.from, 0), to = parseClock(c.to, 24*60);
  return from <= to ? (m >= from && m < to) : (m >= from || m < to);
});
registerCondition('tick', function(g, c){ return compare(g.world.tick, c.op || '>=', num(c.value, 0)); });
registerCondition('day', function(g, c){ return compare(Math.floor(g.world.tick / DAY) + 1, c.op || '>=', num(c.value, 1)); });
registerCondition('random', function(g, c){ return g.rng() < num(c.chance, 0.5); });
registerCondition('kernel', function(g, c){ return !!g.kernelQuery(c.query || c.id); });
registerCondition('build_done', function(g, c){
  var b = g.findBuild(c.build);
  return !!b && b.done === true;
});
registerCondition('tutorial', function(g, c){ return compare(g.world.tutStep, c.op || '>=', num(c.value, 0)); });
/* 组合判定也做成「词」，这样 {"type":"not", "not":X} 和 {"not":X} 两种写法都成立 */
registerCondition('not', function(g, c, ctx){ return !check(g, c.not !== undefined ? c.not : c.condition, ctx); });
registerCondition('all', function(g, c, ctx){ return check(g, c.all !== undefined ? c.all : c.condition, ctx); });
registerCondition('any', function(g, c, ctx){
  var any = c.any !== undefined ? c.any : c.condition;
  if (isArr(any)){ for (var i = 0; i < any.length; i++) if (check(g, any[i], ctx)) return true; return false; }
  return check(g, any, ctx);
});
/* 命名条件：macro 里写 condition，别处用 {"type":"macro_condition","id":"xxx"} 复用 */
registerCondition('macro_condition', function(g, c, ctx){
  var def = g.macro(c.id || c.macro);
  return !!(def && def.condition) && check(g, def.condition, ctx);
});
registerCondition('row', function(g, c, ctx){
  var v = getPath(ctx && ctx.row, c.path, undefined);
  if (has(c, 'is')) return v === c.is;
  if (has(c, 'op')) return compare(v, c.op, c.value);
  return !!v;
});
registerCondition('view_seen', function(g, c){ return !!(g.world.seenViews && g.world.seenViews[c.view || c.id]); });

function parseClock(v, d){
  if (v === undefined || v === null) return d;
  if (typeof v === 'number') return v * 60;
  var m = /^(\d{1,2}):(\d{2})$/.exec(String(v));
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  return d;
}

/* ============================== 4  内建效果词 ==============================
 * 全部是可组合的原语。mod 只写 JSON 就能拼出任意玩法，不必碰代码。
 * ====================================================================== */
function logEvent(g, text, level){
  g.world.log.push({ t: g.world.tick, text: str(text), level: level || 'info' });
  if (g.world.log.length > 400) g.world.log.splice(0, g.world.log.length - 400);
}
/* 内容也能「拦下默认行为」：效果链里任何一个词返回 {stop:true}，后面的效果与内建行为就不再执行 */
registerEffect('stop', function(){ return { stop: true }; });

/* 宏：内容里把一串效果打包起个名字，别处一句 {"type":"macro","id":"xxx"} 就能复用。
   params 里的值在宏内部用 {args.名字} 取；mod 可以加宏、也可以 patch 别人的宏。 */
registerEffect('macro', function(g, e, ctx){
  var id = e.id || e.macro || e.name;
  var def = g.macro(id);
  if (!def){ g.warn('未知宏：' + id); return; }
  var mctx = {};
  if (ctx) for (var k in ctx) if (has(ctx, k)) mctx[k] = ctx[k];
  mctx.args = isObj(e.params) ? e.params : (isObj(e.args) ? e.args : {});
  mctx.macro = id;
  return runEffects(g, def.effects || def.list, mctx);
});

registerEffect('log', function(g, e, ctx){ logEvent(g, tpl(e.text, g.tplCtx(ctx)), e.level); });
registerEffect('hint', function(g, e, ctx){ g.world.hint = tpl(e.text, g.tplCtx(ctx)); g.world.hintUntil = g.world.tick + num(e.ticks, 600); });
registerEffect('open_view', function(g, e){ g.openView(e.view); });
registerEffect('open_reader', function(g, e, ctx){ g.openReader(e, ctx); });
registerEffect('close_view', function(g){ g.ui.view = null; });
registerEffect('open_dialogue', function(g, e, ctx){ g.openDialogue(e.dialogue, e.npc || (ctx && ctx.npcId) || g.lastNpcId); });
registerEffect('close_dialogue', function(g){ g.closeDialogue('effect'); });
registerEffect('close_all', function(g){ g.ui.view = null; g.ui.reader = null; g.closeDialogue('close_all'); });

registerEffect('flag_set', function(g, e){ g.world.flags[e.flag] = has(e,'value') ? e.value : true; });
registerEffect('flag_clear', function(g, e){ delete g.world.flags[e.flag]; });
registerEffect('flag_toggle', function(g, e){ g.world.flags[e.flag] = !g.world.flags[e.flag]; });
registerEffect('counter_add', function(g, e){
  var k = e.counter, d = num(e.delta, 1);
  g.world.counters[k] = num(g.world.counters[k], 0) + d;
});
registerEffect('counter_set', function(g, e){ g.world.counters[e.counter] = num(e.value, 0); });
registerEffect('stat_add', function(g, e){
  var p = g.world.player, s = e.stat, d = num(e.delta, 0);
  if (s === 'fatigue'){ p.fatigue = clamp(num(p.fatigue,0) + d, 0, 100); }
  else {
    p.stats = p.stats || {};
    var cur = num(p.stats[s], 0);
    p.stats[s] = cur + d;
    if (s === 'hp'){ p.stats.hp = clamp(p.stats.hp, 0, num(p.stats.maxHp, 10)); if (p.stats.hp <= 0) g.onPlayerDeath(e.reason || '伤势过重'); }
    if (s === 'maxHp' && num(p.stats.hp,0) > p.stats.maxHp) p.stats.hp = p.stats.maxHp;
  }
});
registerEffect('stat_set', function(g, e){
  var p = g.world.player;
  if (e.stat === 'fatigue') p.fatigue = clamp(num(e.value, 0), 0, 100);
  else { p.stats = p.stats || {}; p.stats[e.stat] = num(e.value, 0); }
});
registerEffect('give_item', function(g, e){
  var n = num(e.count, 1), id = e.item;
  g.world.items[id] = num(g.world.items[id], 0) + n;
  logEvent(g, '获得 ' + g.itemName(id) + ' x' + n, 'good');
});
registerEffect('take_item', function(g, e){
  var n = num(e.count, 1), id = e.item;
  g.world.items[id] = Math.max(0, num(g.world.items[id], 0) - n);
});
registerEffect('teleport', function(g, e, ctx){
  g.teleport(e.scene || (ctx && ctx.scene), num(e.x, NaN), num(e.y, NaN));
});
registerEffect('travel', function(g, e){
  var cost = num(e.costTicks, 0);
  if (cost > 0){ g.world.tick += cost; g.onTick(cost); }
  g.teleport(e.to || e.scene, num(e.x, NaN), num(e.y, NaN));
});
registerEffect('advance_ticks', function(g, e){
  var n = clamp(num(e.ticks, 0), 0, 100000);
  g.world.tick += n; g.onTick(n);
});
registerEffect('spawn_npc', function(g, e){
  g.spawnNpc(e.npc, e.scene || g.world.player.scene, num(e.x, 1), num(e.y, 1));
});
registerEffect('despawn_npc', function(g, e){ g.despawnNpc(e.npc); });
registerEffect('npc_post', function(g, e){
  g.world.npcPosts[e.npc] = { scene: e.scene, x: num(e.x, 1), y: num(e.y, 1), until: num(e.until, g.world.tick + num(e.ticks, 0)) };
  g.placeNpc(e.npc, true);
});
registerEffect('set_tile', function(g, e){
  var s = e.scene || g.world.player.scene;
  g.setTile(s, num(e.x, 0), num(e.y, 0), { ch: e.ch, fg: e.fg, bg: e.bg, passable: e.passable, solid: e.solid });
});
registerEffect('start_build', function(g, e){
  g.startBuild(e);
});
registerEffect('kernel', function(g, e, ctx){
  var op = { op: e.op, params: clone(e.params || {}), tick: g.world.tick, ctx: ctx ? { npcId: ctx.npcId, scene: g.world.player.scene } : null };
  g.world.kernelOps.push(op);
  if (isFn(g.opts.onKernel)) { try { g.opts.onKernel(op, g); } catch(err){ g.warn('onKernel 回调异常：' + err.message); } }
});
registerEffect('end_game', function(g, e){
  g.world.gameOver = { result: e.result || 'defeat', reason: tpl(e.reason, g.tplCtx({})) || '' };
  logEvent(g, '【' + (e.result === 'victory' ? '胜利' : '失败') + '】' + (e.reason || ''), e.result === 'victory' ? 'good' : 'danger');
});
/* 改星图：把某个星系节点的归属 / 关系 / 舰队 / 污染写进 world.galaxy（存档里也带）。
   owner/relation/mark/fleets/pollution 是绝对值；*_add 是相对值（基于当前生效值）。 */
registerEffect('galaxy_get', function(g, e){
  var id = e.node || e.id, to = e.counter;
  if (!id || !to) return;
  var nodes = asList(g.space && g.space.galaxy && g.space.galaxy.nodes), base = null;
  for (var i = 0; i < nodes.length; i++) if (nodes[i] && nodes[i].id === id) base = nodes[i];
  var over = g.world.galaxy[id] || {};
  var f = str(e.field, 'fleets');
  var v = (over[f] !== undefined) ? over[f] : (base ? base[f] : undefined);
  g.world.counters[to] = num(v, num(e.default, 0));   /* galaxy_set 的读半边 */
});
registerEffect('galaxy_set', function(g, e){
  var id = e.node || e.id; if (!id) return;
  var nodes = asList(g.space && g.space.galaxy && g.space.galaxy.nodes), base = null;
  for (var i = 0; i < nodes.length; i++) if (nodes[i] && nodes[i].id === id) base = nodes[i];
  var over = g.world.galaxy[id] || (g.world.galaxy[id] = {});
  function cur(k, d){ return num(over[k] !== undefined ? over[k] : (base ? base[k] : undefined), d); }
  if (e.owner !== undefined) over.owner = e.owner;
  if (e.relation !== undefined) over.relation = e.relation;
  if (e.mark !== undefined) over.mark = e.mark;
  if (e.pollution !== undefined) over.pollution = num(e.pollution, 0);
  if (e.fleets !== undefined) over.fleets = num(e.fleets, 0);
  if (e.pollution_add !== undefined) over.pollution = cur('pollution', 0) + num(e.pollution_add, 0);
  if (e.fleets_add !== undefined) over.fleets = cur('fleets', 0) + num(e.fleets_add, 0);
});
registerEffect('if', function(g, e, ctx){
  runEffects(g, check(g, e.condition, ctx) ? e.then : e.else, ctx);
});
registerEffect('random', function(g, e, ctx){
  if (e.table){
    var total = 0, i;
    for (i = 0; i < e.table.length; i++) total += num(e.table[i].weight, 1);
    var r = g.rng() * total;
    for (i = 0; i < e.table.length; i++){
      r -= num(e.table[i].weight, 1);
      if (r <= 0){ runEffects(g, e.table[i].effects, ctx); return; }
    }
    return;
  }
  runEffects(g, g.rng() < num(e.chance, 0.5) ? e.then : e.else, ctx);
});
registerEffect('effects', function(g, e, ctx){ runEffects(g, e.list, ctx); });
registerEffect('gain_skill', function(g, e){
  g.world.player.skills = g.world.player.skills || {};
  var k = e.skill;
  g.world.player.skills[k] = num(g.world.player.skills[k], 0) + num(e.delta, 1);
});
registerEffect('tutorial_step', function(g, e){ g.world.tutStep = num(e.value, g.world.tutStep + 1); });
registerEffect('pending_set', function(g, e){ g.world.pending[e.event] = true; });
registerEffect('pending_clear', function(g, e){ delete g.world.pending[e.event]; });
registerEffect('discover', function(g, e){ g.world.known[e.scene] = true; logEvent(g, '记录到新地点：' + g.sceneName(e.scene), 'info'); });
registerEffect('rest', function(g, e){
  var t = num(e.ticks, 60);
  g.world.tick += t; g.onTick(t);
  var p = g.world.player; p.fatigue = clamp(num(p.fatigue,0) - num(e.recover, 20), 0, 100);
  logEvent(g, '你休息了 ' + Math.round(t / 60) + ' 小时。', 'info');
});

/* ============================== 5  载入 / 合并 / 编译 ==============================
 * 开放性三件套：
 *   1) 所有内容块都是「带 id 的列表」，按 id 合并；
 *   2) mod 可以用 append / patch / replace / remove 四种方式注入；
 *   3) 校验器只报警不崩溃，坏数据自动降级成能跑的东西。
 * ========================================================================== */
/* 所有「带 id 的列表块」。mod 按 id 合并的就是这张表  漏登记 = 一加东西就把整块内容冲掉，
   所以 test_arch.js 会拿内容里真实存在的块逐个校对。 */
var SPACE_BLOCKS = ['sceneTypes','scenes','rooms','interactables','npcs','schedules','dialogues',
                    'dialoguePools','shuttles','sceneTransitions','views','projections',
                    'events','eventChains','npcApproach','textPools','factions','nameCultures','internalPolitics',
                    'leaders','planetTypes','fleets','fleetModules','facilities','colonies','medical','armory','mine','farm','defense',
                    'resources','relics','missions','crisisStages','victoryConditions','defeatConditions',
                    'diplomacy','techTree','macros','hooks','saveMigrations'];
/* 嵌套在别的块里的 id 列表（diplomacy.actions 这种） */
var NESTED_BLOCKS = ['galaxy.nodes', 'techTree.list', 'techTree.branches', 'diplomacy.actions', 'tutorial.steps'];

function asList(block){
  if (block === undefined || block === null) return [];
  if (isArr(block)) return block;
  if (isObj(block)){
    if (isArr(block.list)) return block.list;
    if (isArr(block.options)) return block.options;
    if (isArr(block.items)) return block.items;
  }
  return [];
}
function byId(list){
  var m = {};
  for (var i = 0; i < list.length; i++){ var it = list[i]; if (it && it.id !== undefined) m[it.id] = it; }
  return m;
}
function rep(ch, n){ var s = ''; while (s.length < n) s += ch; return s; }

/* patch 一个条目。支持 _append：把数组追加进去而不是覆盖，这样 mod 不用重抄整张表。 */
function patchItem(base, patch){
  var p2 = clone(patch);
  var app = p2._append; delete p2._append;
  var out = deepMerge(base, p2);
  if (isObj(app)){
    for (var k in app){
      if (!has(app, k)) continue;
      if (isArr(app[k])) out[k] = (isArr(out[k]) ? out[k] : []).concat(clone(app[k]));
      else if (isObj(app[k])) out[k] = deepMerge(isObj(out[k]) ? out[k] : {}, app[k]);
    }
  }
  return out;
}

/* 按点路径合并嵌套 id 列表：mergeAtPath(space, 'diplomacy.actions', [...]) */
function mergeAtPath(space, path, incoming, modMeta, report){
  var parts = String(path).split('.'), cur = space;
  for (var i = 0; i < parts.length - 1; i++){
    if (!isObj(cur[parts[i]])) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  var last = parts[parts.length - 1];
  if (isArr(cur[last])) cur[last] = mergeBlock({ list: cur[last] }, incoming, modMeta, report);
  else {
    if (!isObj(cur[last])) cur[last] = { list: [] };
    if (!isArr(cur[last].list)) cur[last].list = asList(cur[last]);
    cur[last].list = mergeBlock(cur[last], incoming, modMeta, report);
  }
  return cur[last];
}

function mergeBlock(container, incoming, modMeta, report){
  var list = asList(container);
  var inc = asList(incoming);
  var index = byId(list);
  var defaultOp = str(modMeta && modMeta.defaultOp, 'append');
  var modId = str(modMeta && modMeta.id, '?');
  for (var i = 0; i < inc.length; i++){
    var item = clone(inc[i]);
    if (!isObj(item) || item.id === undefined){
      report.warnings.push('mod[' + modId + '] 条目缺少 id，已跳过');
      continue;
    }
    var op = str(item._op, defaultOp);
    delete item._op;
    var cur = index[item.id];
    if (!cur){
      if (op === 'remove'){
        report.warnings.push('mod[' + modId + '] 要删除的 ' + item.id + ' 不存在，已跳过');
        continue;
      }
      list.push(item); index[item.id] = item;
      continue;
    }
    var pos = list.indexOf(cur);
    if (op === 'replace'){ list[pos] = item; index[item.id] = item; }
    else if (op === 'patch'){ var merged = patchItem(cur, item); list[pos] = merged; index[item.id] = merged; }
    else if (op === 'remove'){
      if (modMeta && modMeta.allowRemove){ list.splice(pos, 1); delete index[item.id]; }
      else report.warnings.push('mod[' + modId + '] 试图删除 ' + item.id + '，但未声明 allowRemove，已忽略');
    } else {
      report.warnings.push('mod[' + modId + '] 条目 ' + item.id + ' 已存在，append 模式不覆盖（要用 _op:"patch"）');
    }
  }
  return list;
}

function normalizeSpace(raw){
  var space = isObj(raw) ? clone(raw) : {};
  for (var i = 0; i < SPACE_BLOCKS.length; i++){
    var k = SPACE_BLOCKS[i];
    if (space[k] === undefined) space[k] = { list: [] };   /* 必须是 {list:[]}：裸数组接不住 .list 赋值 */
    else if (!isObj(space[k])) space[k] = { list: asList(space[k]) };
    else if (space[k].list === undefined) space[k].list = asList(space[k]);
  }
  space.config = space.config || {};
  space.palette = space.palette || {};
  space.presets = space.presets || {};
  return space;
}

/* 合并一个 mod：data 里的每个 key 都可以是内容块，也可以是全新字段（开放） */
function applyMod(space, mod, report){
  var meta = mod.manifest || mod;
  var data = mod.data || mod.content || {};
  report.mods.push({ id: str(meta.id, 'unnamed'), name: str(meta.name, ''), version: str(meta.version, '1'), blocks: Object.keys(data) });
  if (isObj(meta.config)) space.config = deepMerge(space.config, meta.config);
  if (isObj(meta.palette)) space.palette = deepMerge(space.palette, meta.palette);
  if (isObj(meta.presets)) space.presets = deepMerge(space.presets, meta.presets);
  for (var key in data){
    if (!has(data, key)) continue;
    var val = data[key];
    if (SPACE_BLOCKS.indexOf(key) >= 0){
      space[key].list = mergeBlock(space[key], val, meta, report);
      /* 同一份 data 里可能还带着嵌套块或别的字段，别丢 */
      if (isObj(val)){
        for (var subKey in val){
          if (!has(val, subKey) || subKey === 'list') continue;
          var path = key + '.' + subKey;
          if (NESTED_BLOCKS.indexOf(path) >= 0) mergeAtPath(space, path, val[subKey], meta, report);
          else if (subKey.charAt(0) === '_'){ if (space[key][subKey] === undefined) space[key][subKey] = clone(val[subKey]); }
          else if (isObj(val[subKey]) && isObj(space[key][subKey])) space[key][subKey] = deepMerge(space[key][subKey], val[subKey]);
          else space[key][subKey] = clone(val[subKey]);
        }
        /* 顺带把 mod 的 _howToAdd / _example 也带过来，方便别人接着改 */
        if (val._howToAdd && !space[key]._howToAdd) space[key]._howToAdd = val._howToAdd;
        if (val._example && !space[key]._example) space[key]._example = val._example;
      }
      continue;
    }
    if (NESTED_BLOCKS.indexOf(key) >= 0){ mergeAtPath(space, key, val, meta, report); continue; }
    if (isObj(val)){
      /* 先把「嵌套 id 列表」挑出来单独合并，剩下的字段再 deepMerge（顺序不能反） */
      var rest = {}, nested = [];
      for (var sk2 in val){
        if (!has(val, sk2)) continue;
        if (NESTED_BLOCKS.indexOf(key + '.' + sk2) >= 0) nested.push(sk2);
        else rest[sk2] = val[sk2];
      }
      space[key] = isObj(space[key]) ? deepMerge(space[key], rest) : clone(rest);
      for (var ni = 0; ni < nested.length; ni++)
        mergeAtPath(space, key + '.' + nested[ni], val[nested[ni]], meta, report);
    } else {
      space[key] = clone(val);   /* 全新字段：原样保留 */
    }
  }
}

/* 载入：base space + 一串 mod  合并后的 space + 报告 */
function load(opts){
  opts = opts || {};
  var report = { warnings: [], errors: [], mods: [], stats: {} };
  var space = normalizeSpace(opts.space || {});
  var mods = (opts.mods || []).slice();
  mods.sort(function(a, b){
    var pa = num((a.manifest || a).priority, 0), pb = num((b.manifest || b).priority, 0);
    if (pa !== pb) return pa - pb;
    return num((a.manifest || a).order, 0) - num((b.manifest || b).order, 0);
  });
  for (var i = 0; i < mods.length; i++){
    try { applyMod(space, mods[i], report); }
    catch (e){ report.errors.push('mod[' + str((mods[i].manifest||mods[i]).id,'?') + '] 合并失败：' + e.message); }
  }
  var built = build(space, report, opts);
  built.report = report;
  return built;
}

/* ============================== 6  编译与索引 ============================== */
function build(space, report, opts){
  opts = opts || {};
  var idx = {
    sceneTypes: byId(asList(space.sceneTypes)), scenes: byId(asList(space.scenes)),
    rooms: byId(asList(space.rooms)), interactables: byId(asList(space.interactables)),
    npcs: byId(asList(space.npcs)), dialogues: byId(asList(space.dialogues)),
    techs: byId(asList(space.techTree)),
    pools: byId(asList(space.dialoguePools)), shuttles: byId(asList(space.shuttles)),
    views: byId(asList(space.views))
  };
  var dupCheck = {};
  for (var b = 0; b < SPACE_BLOCKS.length; b++){
    var key = SPACE_BLOCKS[b];
    var list = asList(space[key]);
    for (var i = 0; i < list.length; i++){
      var id = list[i] && list[i].id;
      if (id === undefined) continue;
      var tag = key + ':' + id;
      if (key === 'rooms') continue;   /* 房间本来就复用场景 id，不算冲突 */
      if (dupCheck[id] && dupCheck[id] !== key) report.warnings.push('ID 跨块重复：' + id + ' 同时出现在 ' + dupCheck[id] + ' 和 ' + key);
      dupCheck[id] = key;
    }
  }
  /* 日程归到 NPC 名下 */
  idx.schedules = {};
  var sch = asList(space.schedules);
  for (var s = 0; s < sch.length; s++){
    var item = sch[s];
    var who = item.npcId || item.id;
    if (who) idx.schedules[who] = item;
  }
  /* 宏与钩子：内容的「函数」和「插槽」 */
  idx.macros = byId(asList(space.macros));
  idx.hooksByOn = {};
  var hkList = asList(space.hooks);
  for (var hi = 0; hi < hkList.length; hi++){
    var hk = hkList[hi];
    if (!hk || !hk.on) continue;
    (idx.hooksByOn[hk.on] = idx.hooksByOn[hk.on] || []).push(hk);
  }
  for (var ho in idx.hooksByOn)
    idx.hooksByOn[ho].sort(function(a, b){ return num(b.priority, 0) - num(a.priority, 0); });
  /* 编译每个场景的网格 */
  idx.sceneGrids = {};
  var scenes = asList(space.scenes);
  for (var k = 0; k < scenes.length; k++){
    idx.sceneGrids[scenes[k].id] = compileScene(scenes[k], idx, space, report);
  }
  validate(space, idx, report);
  return { space: space, idx: idx, report: report };
}

function resolveLegendEntry(entry, ch, idx, presets, report, sceneId){
  var d = { ch: ch, fg: 'floor_fg', bg: 'floor_bg', passable: true, solid: false, kind: 'floor', ref: null, def: null, name: null };
  if (entry === undefined || entry === null){ d.bg = 'wall_bg'; d.fg = 'wall_fg'; d.passable = false; d.solid = true; d.kind = 'wall'; return d; }
  if (typeof entry === 'string') entry = { preset: entry };
  if (!isObj(entry)) return d;
  if (entry.preset){
    var p = presets[entry.preset];
    if (!p){ report.warnings.push('场景 ' + sceneId + ' 使用了未定义的 preset：「' + entry.preset + '」'); }
    else d = deepMerge(d, p);
    d.preset = entry.preset;   /* 记住「这一格是哪个预设」，compileScene 要按场景类型换地板 */
  }
  if (entry.interactable){
    var idef = idx.interactables[entry.interactable];
    if (!idef) report.warnings.push('场景 ' + sceneId + ' 引用了不存在的 interactable：「' + entry.interactable + '」');
    else {
      d.kind = 'interactable'; d.ref = entry.interactable; d.def = idef;
      d.ch = str(idef.symbol, ch); d.bg = str(idef.bg, d.bg); d.fg = str(idef.color, 'ui');
      d.passable = !!idef.passable; d.solid = !d.passable; d.name = idef.name;
    }
  }
  if (entry.npc){
    d.kind = 'npcspawn'; d.ref = entry.npc; d.passable = true; d.solid = false;
    d.bg = str(entry.bg, 'floor_bg'); d.fg = 'npc';
  }
  if (entry.playerSpawn){
    /* @ 只是编辑器记号：这一格要按地板显示，否则玩家走开后原地会残留一个 @ */
    d.playerSpawn = true; d.kind = 'floor';
    var fp = presets && presets.floor;
    if (fp){
      if (fp.ch) d.ch = fp.ch;
      if (fp.fg) d.fg = fp.fg;
      if (fp.bg) d.bg = fp.bg;
    }
    d.preset = 'floor';
  }
  if (entry.exit || entry.to){
    d.kind = 'exit'; d.exit = isObj(entry.exit) ? entry.exit : { to: entry.to, at: entry.at };
  }
  var fields = ['ch','fg','bg','passable','solid','kind','name','desc','auto','priority'];
  for (var i = 0; i < fields.length; i++){
    var f = fields[i];
    if (has(entry, f) && entry[f] !== undefined) d[f] = entry[f];   /* 显式 undefined 不覆盖已解析字段（tileEdits 只写 interactable 时保住 symbol） */
  }
  if (has(entry, 'ch') && entry.ch !== undefined) d.chLocked = true;   /* 显式写了 ch：别被「按场景类型换地板」再盖一次 */
  return d;
}

/* 有效图例 = config.defaultLegend（全局标准字符表）+ scene.legend（场景优先）。
   标准字符（# 墙 / . 地板 / + 门 / ^ 岩石 / 空格 虚空 / * 记录点 / h 座椅）
   即使某个场景忘了写，也不会把整张图变成实心墙。mod 可以在 manifest.config
   里补自己的 defaultLegend。 */
function effectiveLegend(space, scene){
  var base = getPath(space, 'config.defaultLegend', null);
  var own = isObj(scene && scene.legend) ? scene.legend : {};
  if (!isObj(base)) return clone(own);
  return deepMerge(base, own);
}

function compileScene(scene, idx, space, report){
  var presetTable = space.presets || {};
  /* 按场景类型换地板字符，做出区域感（舰内 : / 地表 , / 裂隙 ; / 殖民地 '）。
     映射全写在 config.floorByType 里（内容），内核不认识任何场景类型。
     只换「图例里用的就是 floor 预设」的格子，区域地板本身不参与。 */
  var floorByType = getPath(space, 'config.floorByType', null);
  var kindFloor = isObj(floorByType) ? presetTable[floorByType[scene.type]] : null;
  if (isObj(floorByType) && floorByType[scene.type] && !kindFloor){
    report.warnings.push('config.floorByType 里的「' + scene.type + '」指向不存在的 preset：「' +
                         floorByType[scene.type] + '」（已按默认地板 ' + str(getPath(space, 'config.defaultFloor'), '.') + ' 处理）');
  }
  function applyTypeFloor(d){
    if (!kindFloor || d.preset !== 'floor' || d.chLocked) return d;
    if (kindFloor.ch) d.ch = kindFloor.ch;
    if (kindFloor.fg) d.fg = kindFloor.fg;
    if (kindFloor.bg) d.bg = kindFloor.bg;
    if (kindFloor.name) d.name = kindFloor.name;   /* 图例里写「地表 / 舰内地板」，别一律叫地板 */
    return d;
  }
  var w = num(getPath(scene, 'size.w'), 0), h = num(getPath(scene, 'size.h'), 0);
  var tiles = isArr(scene.tiles) ? scene.tiles : [];
  if (!h) h = tiles.length;
  if (!w) w = tiles.length ? String(tiles[0]).length : 0;
  if (!w || !h){ report.warnings.push('场景 ' + scene.id + ' 尺寸为 0，已按 16x12 兜底'); w = w || 16; h = h || 12; }
  var fill = str(getPath(space, 'config.defaultFloor'), '.');
  var rows = [], y, row;
  for (y = 0; y < h; y++){
    row = tiles[y] === undefined ? '' : String(tiles[y]);
    if (row.length !== w){
      report.warnings.push('场景 ' + scene.id + ' 第 ' + y + ' 行宽度 ' + row.length + '，应为 ' + w + '（已自动修正）');
      row = row.length < w ? row + rep(fill, w - row.length) : row.slice(0, w);
    }
    rows.push(row);
  }
  var n = w * h;
  var g = { id: scene.id, w: w, h: h, ch: new Array(n), fg: new Array(n), bg: new Array(n),
            pass: new Uint8Array(n), kind: new Array(n), ref: new Array(n), name: new Array(n),
            def: new Array(n), exitMap: {}, spawn: null, props: [] };
  var legend = effectiveLegend(space, scene);
  for (y = 0; y < h; y++){
    for (var x = 0; x < w; x++){
      var ch = rows[y].charAt(x);
      var d = resolveLegendEntry(legend[ch], ch, idx, presetTable, report, scene.id);
      applyTypeFloor(d);
      var i = y * w + x;
      g.ch[i] = d.ch; g.fg[i] = d.fg; g.bg[i] = d.bg;
      g.pass[i] = (d.passable === false || d.solid) ? 0 : 1;
      g.kind[i] = d.kind; g.ref[i] = d.ref; g.name[i] = d.name; g.def[i] = d.def || null;
      if (d.playerSpawn){ g.spawn = { x: x, y: y }; }
      if (d.kind === 'exit'){
        var ex = d.exit || {};
        g.exitMap[x + ',' + y] = { x: x, y: y, to: ex.to || ex.scene, at: ex.at || null,
                                   costTicks: num(ex.costTicks, num(ex.cost, 0)), direction: ex.direction || null };
      }
    }
  }
  /* 场景 tileEdits：改单格地形（mod 加一扇门不用重抄整张地图） */
  var edits = isArr(scene.tileEdits) ? scene.tileEdits : [];
  for (var ed = 0; ed < edits.length; ed++){
    var eo = edits[ed]; if (!eo) continue;
    var ex3 = num(eo.x, -1), ey3 = num(eo.y, -1);
    if (ex3 < 0 || ey3 < 0 || ex3 >= w || ey3 >= h){
      report.warnings.push('场景 ' + scene.id + ' 的 tileEdit 越界：' + eo.x + ',' + eo.y); continue;
    }
    var ei = ey3 * w + ex3;
    var entry3 = (eo.legend !== undefined) ? eo.legend : { preset: eo.preset, ch: eo.ch, fg: eo.fg, bg: eo.bg,
      passable: eo.passable, solid: eo.solid, interactable: eo.interactable, name: eo.name };
    var d3 = resolveLegendEntry(entry3, g.ch[ei], idx, presetTable, report, scene.id);
    applyTypeFloor(d3);
    g.ch[ei] = d3.ch; g.fg[ei] = d3.fg; g.bg[ei] = d3.bg;
    g.pass[ei] = (d3.passable === false || d3.solid) ? 0 : 1;
    g.kind[ei] = d3.kind; g.ref[ei] = d3.ref; g.name[ei] = d3.name; g.def[ei] = d3.def || null;
    if (d3.playerSpawn) g.spawn = { x: ex3, y: ey3 };
    if (d3.kind === 'exit'){ var exd = d3.exit || {}; g.exitMap[ex3 + ',' + ey3] = { x: ex3, y: ey3, to: exd.to, at: exd.at || null, costTicks: num(exd.costTicks, 0) }; }
  }
  /* 场景自带的 exits 数组（与 legend 互补，两边都算） */
  var exits = isArr(scene.exits) ? scene.exits : [];
  for (var e = 0; e < exits.length; e++){
    var ex2 = exits[e];
    if (ex2 === undefined || ex2 === null) continue;
    var key = num(ex2.x,-1) + ',' + num(ex2.y,-1);
    if (ex2.x === undefined) continue;
    g.exitMap[key] = { x: num(ex2.x,0), y: num(ex2.y,0), to: ex2.to || ex2.scene, at: ex2.at || null,
                       costTicks: num(ex2.costTicks, num(ex2.cost, 0)), direction: ex2.direction || null };
    var ii = num(ex2.y,0) * w + num(ex2.x,0);
    if (ii >= 0 && ii < n && g.kind[ii] !== 'exit'){ g.kind[ii] = 'exit'; }
  }
  /* 门洞整段都能走：出口只登记中间格，但门口 3 格任何一格踩上去都算这扇门。
     两扇门挨在一起（比如医疗区西北角）时，出口自己那格永远优先，扩出来的格子不覆盖别人。 */
  g.doorMap = {};
  for (var dk0 in g.exitMap){ var de0 = g.exitMap[dk0]; if (de0 && de0.to) g.doorMap[dk0] = de0; }
  for (var dk in g.exitMap){
    var de = g.exitMap[dk]; if (!de || !de.to) continue;
    var ex2x = num(de.x, 0), ex2y = num(de.y, 0);
    function _claim(k){
      if (!g.doorMap[k]) g.doorMap[k] = de;
    }
    if (ex2y === 0 || ex2y === h - 1){
      for (var q1 = ex2x - 1; q1 >= 0 && g.pass[ex2y * w + q1]; q1--) _claim(q1 + ',' + ex2y);
      for (var q2 = ex2x + 1; q2 < w && g.pass[ex2y * w + q2]; q2++) _claim(q2 + ',' + ex2y);
    } else if (ex2x === 0 || ex2x === w - 1){
      for (var q3 = ex2y - 1; q3 >= 0 && g.pass[q3 * w + ex2x]; q3--) _claim(ex2x + ',' + q3);
      for (var q4 = ex2y + 1; q4 < h && g.pass[q4 * w + ex2x]; q4++) _claim(ex2x + ',' + q4);
    }
  }
  /* 场景 props：在坐标上额外摆物件 */
  var props = isArr(scene.props) ? scene.props : [];
  for (var p = 0; p < props.length; p++){
    var pr = props[p];
    if (!pr) continue;
    var pi = num(pr.y,0) * w + num(pr.x,0);
    if (pi < 0 || pi >= n) { report.warnings.push('场景 ' + scene.id + ' 的 prop 越界：' + pr.x + ',' + pr.y); continue; }
    var idef2 = pr.interactable ? idx.interactables[pr.interactable] : null;
    if (pr.interactable && !idef2) report.warnings.push('场景 ' + scene.id + ' 的 prop 引用了不存在的 interactable：' + pr.interactable);
    g.kind[pi] = 'interactable'; g.ref[pi] = pr.interactable || null; g.def[pi] = idef2 || null;
    if (idef2){
      g.ch[pi] = str(idef2.symbol, g.ch[pi]); g.bg[pi] = str(idef2.bg, g.bg[pi]); g.fg[pi] = str(idef2.color, 'ui');
      g.pass[pi] = idef2.passable ? 1 : 0; g.name[pi] = idef2.name;
    }
  }
  /* 墙体轮廓化：成线的实心结构画成 - | +，房间一眼是矩形；孤立的 # 是家具/货架。
     只改显示字符，不动 pass/kind（通行性与物件引用都不变）。 */
  shapeWalls(g, presetTable);
  /* 出生点兜底在 Game.newWorld 里做（玩家档案 position -> 场景 @ -> 第一个可走格） */
  return g;
}

/* 场景的四条边是不是都堵住了（门算堵住：门是出口，不是缺口）。 */
function ringClosed(g, presets){
  var doorCh = str(getPath(presets, 'door.ch'), '+');
  var x, y;
  function open(i){ return !!g.pass[i] && g.ch[i] !== doorCh; }
  for (x = 0; x < g.w; x++){
    if (open(x) || open((g.h - 1) * g.w + x)) return false;
  }
  for (y = 0; y < g.h; y++){
    if (open(y * g.w) || open(y * g.w + g.w - 1)) return false;
  }
  return true;
}

/* 把「墙」从一堆 # 变成有走向的形状。规则（内容驱动，字符全部来自 presets）：
     左右都有结构 -> -        上下都有结构 -> |
     拐角 / 丁字 / 十字 -> +   端点或孤立格 -> 保持 #
   门（presets.door）算结构邻格，所以门口两侧的墙不会被当成端点。 */
function shapeWalls(g, presets){
  var wallCh = str(getPath(presets, 'wall.ch'), '#');
  var doorCh = str(getPath(presets, 'door.ch'), '+');
  var n = g.w * g.h, i, x, y;
  var solid = new Uint8Array(n);
  for (i = 0; i < n; i++){
    var c = g.ch[i];
    solid[i] = (c === doorCh || (c === wallCh && !g.pass[i])) ? 1 : 0;
  }
  for (y = 0; y < g.h; y++){
    for (x = 0; x < g.w; x++){
      i = y * g.w + x;
      if (g.ch[i] !== wallCh || g.pass[i]) continue;
      var L = x > 0 ? solid[i - 1] : 0;
      var R = x < g.w - 1 ? solid[i + 1] : 0;
      var U = y > 0 ? solid[i - g.w] : 0;
      var D = y < g.h - 1 ? solid[i + g.w] : 0;
      if (L + R + U + D < 2) continue;             /* 端点 / 家具：留着 # */
      if (L && R && !U && !D) g.ch[i] = '-';
      else if (U && D && !L && !R) g.ch[i] = '|';
      else g.ch[i] = '+';
    }
  }
}

/* ============================== 7  校验 ============================== */
function validate(space, idx, report){
  var scenes = asList(space.scenes), npcs = asList(space.npcs);
  var regionOf = {};        /* 场景 -> {lab, main, sizes}：「这个格子走得到吗」 */
  if (!scenes.length) report.errors.push('没有定义任何场景  至少要有一个');
  for (var i = 0; i < scenes.length; i++){
    var sc = scenes[i], g = idx.sceneGrids[sc.id];
    if (!isArr(sc.tiles) || (!sc.tiles.length && !(sc.props && sc.props.length)))
      report.warnings.push('场景 ' + sc.id + ' 没有任何 tiles');
    /* 地图字符必须能在（有效）图例里查到  查不到就按墙编译，整张图会变成实心 */
    var legend2 = effectiveLegend(space, sc), unknown = {}, tiles2 = isArr(sc.tiles) ? sc.tiles : [];
    for (var ty = 0; ty < tiles2.length; ty++){
      var rowS = str(tiles2[ty]);
      for (var tx = 0; tx < rowS.length; tx++){
        var mc = rowS.charAt(tx);
        if (!has(legend2, mc)) unknown[mc] = (unknown[mc] || 0) + 1;
      }
    }
    var uk = Object.keys(unknown);
    if (uk.length) report.warnings.push('场景 ' + sc.id + ' 里的字符 ' +
      uk.map(function(c2){ return JSON.stringify(c2) + 'x' + unknown[c2]; }).join(' ') +
      ' 不在图例里（按墙处理；标准字符请写进 config.defaultLegend）');
    var walkCells = 0, firstWalk = 0;
    for (var wi = 0; wi < g.pass.length; wi++) if (g.pass[wi]){ if (!walkCells) firstWalk = wi; walkCells++; }
    if (!walkCells) report.errors.push('场景 ' + sc.id + ' 没有任何可走的格子（图例缺字符？）');
    else {
      var sp0 = g.spawn || { x: firstWalk % g.w, y: Math.floor(firstWalk / g.w) };
      var free = 0;
      for (var dd = 0; dd < 4; dd++){
        var ax = sp0.x + [0,0,-1,1][dd], ay = sp0.y + [-1,1,0,0][dd];
        if (ax >= 0 && ay >= 0 && ax < g.w && ay < g.h && g.pass[ay * g.w + ax]) free++;
      }
      if (!free) report.warnings.push('场景 ' + sc.id + ' 的出生点 ' + sp0.x + ',' + sp0.y + ' 四面都是墙，玩家会被卡死');
    }
    var exits = [];
    for (var k in g.exitMap) exits.push(g.exitMap[k]);
    if (!exits.length) report.warnings.push('场景 ' + sc.id + ' 没有出口（孤立场景）');
    for (var e = 0; e < exits.length; e++){
      if (!exits[e].to){ report.warnings.push('场景 ' + sc.id + ' 的出口 ' + exits[e].x + ',' + exits[e].y + ' 没有目标'); continue; }
      if (!idx.scenes[exits[e].to]) report.errors.push('场景 ' + sc.id + ' 的出口指向不存在的场景：' + exits[e].to);
    }
    /* 连通性：一个场景应该只有一个可走区域。
       多出来的区域就是「有房间但没有门」  里面的人、床、终端玩家永远够不着。
       小于 20 格又什么都没有的小石洞算装饰，不报。 */
    var lab = new Int32Array(g.w * g.h).fill(-1), sizes = [], stuff = [], firsts = [], nReg = 0;
    for (var ci = 0; ci < g.pass.length; ci++){
      if (!g.pass[ci] || lab[ci] >= 0) continue;
      var rid = nReg++, q2 = [ci], sz = 0, hasStuff = false, first = ci;
      lab[ci] = rid;
      while (q2.length){
        var c3 = q2.pop(); sz++;
        if (g.kind[c3] === 'interactable' || g.name[c3]) hasStuff = true;
        var cx3 = c3 % g.w, cy3 = Math.floor(c3 / g.w);
        for (var k3 = 0; k3 < 4; k3++){
          var nx3 = cx3 + [0,0,-1,1][k3], ny3 = cy3 + [-1,1,0,0][k3];
          if (nx3 < 0 || ny3 < 0 || nx3 >= g.w || ny3 >= g.h) continue;
          var j3 = ny3 * g.w + nx3;
          if (g.pass[j3] && lab[j3] < 0){ lab[j3] = rid; q2.push(j3); }
        }
      }
      sizes.push(sz); stuff.push(hasStuff); firsts.push(first);
    }
    var mainId = 0;
    for (var mi = 1; mi < sizes.length; mi++) if (sizes[mi] > sizes[mainId]) mainId = mi;
    regionOf[sc.id] = { lab: lab, main: mainId, sizes: sizes };
    for (var si = 0; si < sizes.length; si++){
      if (si === mainId) continue;
      if (sizes[si] < 20 && !stuff[si]) continue;
      report.warnings.push('场景 ' + sc.id + ' 有一块走不到的区域：' + sizes[si] + ' 格，起点 ' +
        (firsts[si] % g.w) + ',' + Math.floor(firsts[si] / g.w) + '（房间没有门？）');
    }
  }
  for (var n = 0; n < npcs.length; n++){
    var npc = npcs[n], id = npc.id;
    if (npc.homeScene && !idx.scenes[npc.homeScene]) report.warnings.push('NPC ' + id + ' 的 homeScene 不存在：' + npc.homeScene);
    if (npc.dialogue && !idx.dialogues[npc.dialogue]) report.warnings.push('NPC ' + id + ' 的 dialogue 不存在：' + npc.dialogue);
    var sched = idx.schedules[id];
    if (!sched){ report.warnings.push('NPC ' + id + ' 没有日程（已自动兜底为常驻 homeScene）'); }
    else {
      var slots = isArr(sched.slots) ? sched.slots : (isArr(sched.schedule) ? sched.schedule : []);
      for (var s2 = 0; s2 < slots.length; s2++){
        var slot = slots[s2];
        if (!slot) continue;
        if (slot.scene && !idx.scenes[slot.scene]){
          report.warnings.push('NPC ' + id + ' 的日程指向不存在的场景：' + slot.scene); continue;
        }
        var sSc = slot.scene || npc.homeScene;
        var sgs = idx.sceneGrids[sSc];
        if (sgs && (slot.x !== undefined || slot.y !== undefined)){
          var sIdx = num(slot.y, 0) * sgs.w + num(slot.x, 0);
          if (sIdx < 0 || sIdx >= sgs.w * sgs.h || !sgs.pass[sIdx])
            report.warnings.push('NPC ' + id + ' 的日程点 (' + slot.x + ',' + slot.y + ') 不是可走的格子');
          else if (regionOf[sSc] && regionOf[sSc].lab[sIdx] !== regionOf[sSc].main)
            report.warnings.push('NPC ' + id + ' 的日程点 (' + slot.x + ',' + slot.y + ') 在走不到的房间里（' + sSc + '）');
        }
      }
    }
  }
  for (var d in idx.dialogues){
    var dlg = idx.dialogues[d];
    var nodes = dlg.nodes || {};
    for (var dn in nodes){
      var dyn = (nodes[dn] || {}).dynamicOptions;
      if (typeof dyn === 'string' && !idx.pools[dyn] && !viewProviders[dyn])
        report.warnings.push('对话 ' + d + '.' + dn + ' 的动态选项池不存在：' + dyn);
    }
    if (dlg.entry && !nodes[dlg.entry]) report.errors.push('对话 ' + d + ' 的 entry 节点不存在：' + dlg.entry);
    for (var nid in nodes){
      var node = nodes[nid] || {};
      var opts2 = isArr(node.options) ? node.options : [];
      for (var o = 0; o < opts2.length; o++){
        var gt = opts2[o] && (opts2[o].goto || opts2[o].next);
        if (gt && gt !== 'end' && !nodes[gt]) report.errors.push('对话 ' + d + '.' + nid + ' 的选项跳转到不存在的节点：' + gt);
      }
      if (node.next && node.next !== 'end' && !nodes[node.next]) report.errors.push('对话 ' + d + '.' + nid + ' 的 next 不存在：' + node.next);
    }
  }
  /* 调色板校验：颜色名写错会静默变黑，这里点名 */
  var pal = space.palette || {};
  var used = {};
  function useColor(v, where){ if (typeof v === 'string' && v && v.charAt(0) !== '#' && v.indexOf('rgb') !== 0 && v.indexOf('hsl') !== 0) used[v] = used[v] || where; }
  var presets = space.presets || {};
  for (var pk in presets){ useColor(presets[pk].fg, 'presets.' + pk + '.fg'); useColor(presets[pk].bg, 'presets.' + pk + '.bg'); }
  var iL = asList(space.interactables);
  for (var ii = 0; ii < iL.length; ii++){ useColor(iL[ii].color, 'interactable ' + iL[ii].id + '.color'); useColor(iL[ii].bg, 'interactable ' + iL[ii].id + '.bg'); }
  var nL = asList(space.npcs);
  for (var ni = 0; ni < nL.length; ni++) useColor(nL[ni].color, 'npc ' + nL[ni].id + '.color');
  for (var uk in used) if (!has(pal, uk)) report.warnings.push('颜色名「' + uk + '」不在 palette 里（' + used[uk] + '），会退成黑色');

  var vL = asList(space.views);
  for (var vi = 0; vi < vL.length; vi++){
    var vv = vL[vi] || {};
    if (vv.provider && !viewProviders[vv.provider])
      report.warnings.push('视图 ' + vv.id + ' 的 provider 没注册：' + vv.provider);
  }
  var iL2 = asList(space.interactables);
  for (var ii2 = 0; ii2 < iL2.length; ii2++){
    var its = iL2[ii2] || {};
    var acts = isArr(its.onInteract) ? its.onInteract : (isArr(its.effects) ? its.effects : []);
    for (var ai = 0; ai < acts.length; ai++){
      var act = acts[ai] || {};
      if (act.type === 'open_view' && act.view && !idx.views[act.view] && !viewProviders[act.view])
        report.warnings.push('物件 ' + its.id + ' 打开不存在的视图：' + act.view);
    }
  }

  /* 每个块里的条目都必须有 id，否则 mod 没法按 id 追加/改写它 */
  var idless = [];
  SPACE_BLOCKS.concat(NESTED_BLOCKS).forEach(function(bk){
    var lst2 = asList(getPath(space, bk, []));
    var miss = 0;
    for (var li2 = 0; li2 < lst2.length; li2++) if (lst2[li2] && lst2[li2].id === undefined) miss++;
    if (miss) idless.push(bk + ' x' + miss);
  });
  if (idless.length) report.warnings.push('有块里的条目没有 id（mod 只能整块替换它）：' + idless.join('、'));

  var trs = asList(space.sceneTransitions);
  for (var t = 0; t < trs.length; t++){
    var tr = trs[t] || {};
    var from = getPath(tr, 'from.scene'), to = getPath(tr, 'to.scene');
    if (from && !idx.scenes[from]) report.warnings.push('过渡 ' + tr.id + ' 的 from 场景不存在：' + from);
    if (to && !idx.scenes[to]) report.warnings.push('过渡 ' + tr.id + ' 的 to 场景不存在：' + to);
  }
  /* 科技树：引擎真的会读它  研究流程按 requires 解锁，写错 id 直接点名 */
  var techs = asList(space.techTree);
  for (var ti = 0; ti < techs.length; ti++){
    var reqs = techs[ti] && techs[ti].requires;
    if (!isArr(reqs)) continue;
    for (var ri = 0; ri < reqs.length; ri++)
      if (!idx.techs[reqs[ri]]) report.warnings.push('科技 ' + techs[ti].id + ' 的 requires 指向不存在的科技：' + reqs[ri]);
  }
  report.stats = {
    events: asList(space.events).length, eventChains: asList(space.eventChains).length,
    npcApproach: asList(space.npcApproach).length, textPools: asList(space.textPools).length,
    factions: asList(space.factions).length, leaders: asList(space.leaders).length,
    fleets: asList(space.fleets).length, facilities: asList(space.facilities).length,
    relics: asList(space.relics).length, missions: asList(space.missions).length,
    sceneTypes: asList(space.sceneTypes).length, scenes: scenes.length, rooms: asList(space.rooms).length,
    interactables: asList(space.interactables).length, npcs: npcs.length, dialogues: asList(space.dialogues).length,
    dialoguePools: asList(space.dialoguePools).length, schedules: asList(space.schedules).length,
    shuttles: asList(space.shuttles).length, sceneTransitions: asList(space.sceneTransitions).length,
    views: asList(space.views).length, projections: asList(space.projections).length
  };
  return report;
}
/* ============================== 8  游戏运行时 ============================== */
var DIRS = { up: [0,-1], down: [0,1], left: [-1,0], right: [1,0],
             upleft:[-1,-1], upright:[1,-1], downleft:[-1,1], downright:[1,1] };

function createGame(input, opts){
  var built = (input && input.space && input.idx) ? input : load({ space: input, mods: (opts && opts.mods) || [] });
  return new Game(built, opts);
}

function Game(built, opts){
  this.opts = opts || {};
  this.space = built.space;
  this.idx = built.idx;
  this.report = built.report;
  this.cfg = this.space.config || {};
  this.palette = this.space.palette || {};
  this.presets = this.space.presets || {};
  this.rng = makeRng(num(this.opts.seed, num(this.cfg.seed, 20260930)));
  this.idx.events = byId(asList(this.space.events));
  this.idx.chains = byId(asList(this.space.eventChains));
  this.dynProviders = {};
  this.ui = { view: null, dialogue: null, cursor: 0, scroll: 0, follow: true, toast: null };
  this.perf = { tick: 0, render: 0, vision: 0, path: 0, frames: 0 };
  this.screen = null;
  this.world = this.newWorld();
  this.resize(num(this.cfg.screenW, 100), num(this.cfg.screenH, 40));
  this.log('你在' + this.sceneName(this.world.player.scene) + '醒来。', 'good');
  this.fireHooks('game_start', { scene: this.world.player.scene });
  this.stepTutorial();
  this.updateSchedules();
  this.applyProjections();
  this.updateVision();
}

Game.prototype.warn = function(msg){
  if (this.report && this.report.warnings) this.report.warnings.push(msg);
  if (typeof console !== 'undefined' && console.warn) console.warn('[space] ' + msg);
};
Game.prototype.log = function(text, level){ logEvent(this, text, level); };

Game.prototype.newWorld = function(){
  var pc = this.space.playerCharacter || {};
  var st = clone(pc.stats || {});
  st.hp = num(st.hp, num(st.maxHp, 10)); st.maxHp = num(st.maxHp, 10);
  st.visionRange = num(st.visionRange, num(this.cfg.visionRange, 8));
  var startScene = pc.currentScene || str(this.cfg.startScene, '') || (asList(this.space.scenes)[0] || {}).id;
  var g0 = this.idx.sceneGrids[startScene];
  var pos = pc.position || {};
  var sx = num(pos.x, NaN), sy = num(pos.y, NaN);
  if (isNaN(sx) && g0 && g0.spawn){ sx = g0.spawn.x; sy = g0.spawn.y; }
  if (isNaN(sx)){ var first = this.findFreeCell(startScene); sx = first.x; sy = first.y; }
  return {
    tick: num(this.cfg.startTick, 6 * HOUR),
    flags: clone(getPath(this.space, 'initialState.flags', {})) || {},
    counters: clone(getPath(this.space, 'initialState.counters', {})) || {},
    items: clone(getPath(this.space, 'initialState.items', {})) || {},
    known: {}, visited: {}, seenDialogues: {}, firedRules: {}, seenViews: {},
    npcPos: {}, npcPosts: {}, npcPaths: {}, pending: {}, builds: {}, tileOverrides: {}, chains: {}, crisis: { stage: -1 }, galaxy: {},
    fog: {}, vis: { scene: null, flags: null },
    player: {
      id: str(pc.id, 'player_character'), name: str(pc.name, '指挥官'), symbol: str(pc.symbol, '@'),
      title: str(pc.title, ''), faction: str(pc.faction, 'player_remnant'),
      scene: startScene, x: num(sx, 1), y: num(sy, 1), facing: 'down',
      stats: st, skills: clone(pc.skills || {}), equipment: clone(pc.equipment || []),
      fatigue: num(pc.fatigue, 0), dead: false
    },
    log: [], kernelOps: [], hint: '', hintUntil: 0, tutStep: 0, gameOver: null, path: null, lastAuto: ''
  };
};

Game.prototype.findFreeCell = function(sceneId){
  var g = this.idx.sceneGrids[sceneId];
  if (!g) return { x: 0, y: 0 };
  for (var y = 0; y < g.h; y++) for (var x = 0; x < g.w; x++) if (g.pass[y * g.w + x]) return { x: x, y: y };
  return { x: 0, y: 0 };
};

/* ---------- 读取世界 ---------- */
Game.prototype.grid = function(sceneId){ return this.idx.sceneGrids[sceneId]; };
Game.prototype.cellAt = function(sceneId, x, y){
  var g = this.idx.sceneGrids[sceneId];
  if (!g || x < 0 || y < 0 || x >= g.w || y >= g.h) return null;
  var i = y * g.w + x;
  var k = sceneId + ':' + x + ',' + y;
  var ovr = this.world.tileOverrides[k];
  if (ovr) return { ch: str(ovr.ch, g.ch[i]), fg: str(ovr.fg, g.fg[i]), bg: str(ovr.bg, g.bg[i]),
                    passable: has(ovr,'passable') ? !!ovr.passable : !!g.pass[i],
                    kind: str(ovr.kind, g.kind[i]), ref: ovr.ref !== undefined ? ovr.ref : g.ref[i],
                    def: g.def[i] || null, name: g.name[i], index: i, x: x, y: y, scene: sceneId };
  return { ch: g.ch[i], fg: g.fg[i], bg: g.bg[i], passable: !!g.pass[i], kind: g.kind[i],
           ref: g.ref[i], def: g.def[i] || null, name: g.name[i], index: i, x: x, y: y, scene: sceneId };
};
Game.prototype.isPassable = function(sceneId, x, y){
  var c = this.cellAt(sceneId, x, y);
  if (!c) return false;
  if (c.kind === 'interactable' && c.def && c.def.passable) return true;
  return !!c.passable;
};
Game.prototype.canStand = function(sceneId, x, y){
  if (!this.isPassable(sceneId, x, y)) return false;
  if (this.npcAt(sceneId, x, y)) return false;
  return true;
};
Game.prototype.setTile = function(sceneId, x, y, def){
  var c = this.cellAt(sceneId, x, y);
  if (!c) return;
  var key = sceneId + ':' + x + ',' + y;
  var cur = this.world.tileOverrides[key] || {};
  this.world.tileOverrides[key] = deepMerge(cur, def);
  return true;
};

/* ---------- 视野（迷雾） ---------- */
Game.prototype.computeVision = function(sceneId, ox, oy, r){
  var g = this.idx.sceneGrids[sceneId];
  if (!g) return null;
  var flags = new Uint8Array(g.w * g.h);
  r = Math.max(1, r | 0);
  var x0 = Math.max(0, ox - r), x1 = Math.min(g.w - 1, ox + r);
  var y0 = Math.max(0, oy - r), y1 = Math.min(g.h - 1, oy + r);
  for (var y = y0; y <= y1; y++){
    for (var x = x0; x <= x1; x++){
      var dx = x - ox, dy = y - oy;
      if (dx * dx + dy * dy > r * r + r) continue;
      if (this.lineOfSight(g, ox, oy, x, y)) flags[y * g.w + x] = 1;
    }
  }
  return flags;
};
Game.prototype.lineOfSight = function(g, x0, y0, x1, y1){
  var dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  var sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  var err = dx - dy, x = x0, y = y0, guard = 0;
  while (guard++ < 512){
    if (x === x1 && y === y1) return true;
    if (!(x === x0 && y === y0)){
      if (x < 0 || y < 0 || x >= g.w || y >= g.h) return false;
      if (!g.pass[y * g.w + x]) return false;
    }
    var e2 = 2 * err;
    if (e2 > -dy){ err -= dy; x += sx; }
    if (e2 < dx){ err += dx; y += sy; }
  }
  return true;
};
Game.prototype.fogOf = function(sceneId){
  var g = this.idx.sceneGrids[sceneId];
  if (!g) return null;
  if (!this.world.fog[sceneId]) this.world.fog[sceneId] = new Uint8Array(g.w * g.h);
  return this.world.fog[sceneId];
};
Game.prototype.updateVision = function(){
  var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  var p = this.world.player, g = this.grid(p.scene);
  if (!g) return;
  var sc = this.idx.scenes[p.scene] || {};
  var flags;
  if (sc.lit || num(sc.ambientLight, 0) >= 1){
    /* 室内照明：整间屋子都看得见，不再只照亮一小圈 */
    flags = new Uint8Array(g.w * g.h);
    flags.fill(1);
  } else {
    var r = num(sc.visionRange, num(getPath(p.stats, 'visionRange'), num(this.cfg.visionRange, 8)));
    flags = this.computeVision(p.scene, p.x, p.y, r);
  }
  var seen = this.fogOf(p.scene);
  for (var i = 0; i < flags.length; i++) if (flags[i]) seen[i] = 1;
  this.world.vis = { scene: p.scene, flags: flags };
  this.world.visited[p.scene] = true;
  this.world.known[p.scene] = true;
  this.perf.vision = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0;
};
Game.prototype.isVisible = function(x, y, index){
  var v = this.world.vis;
  if (!v || !v.flags) return true;
  return !!v.flags[index];
};

/* ---------- 时间 / 时钟 ---------- */
Game.prototype.minuteOfDay = function(){ return ((this.world.tick % DAY) + DAY) % DAY; };
Game.prototype.clockText = function(){
  var t = this.world.tick;
  var day = Math.floor(t / DAY), h = Math.floor((t % DAY) / HOUR), m = t % HOUR;
  var y = Math.floor(day / 360) + 1, mo = Math.floor((day % 360) / 30) + 1, d = (day % 30) + 1;
  return '年' + y + ' 月' + mo + ' 日' + d + ' ' + (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m;
};
Game.prototype.hourOfDay = function(){ return Math.floor(this.minuteOfDay() / HOUR); };

/* ---------- 场景 / 名字 ---------- */
Game.prototype.sceneName = function(id){ var s = this.idx.scenes[id]; return s ? str(s.name, id) : id; };
Game.prototype.npcName = function(id){ var n = this.idx.npcs[id]; return n ? str(n.name, id) : id; };
Game.prototype.itemName = function(id){
  var list = asList(this.space.items);
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return str(list[i].name, id);
  var k = this.space.itemNames || {};
  return str(k[id], id);
};
Game.prototype.viewName = function(id){ var v = this.idx.views[id]; return v ? str(v.title, id) : id; };

/* ---------- NPC 与日程 ---------- */
Game.prototype.npcAt = function(sceneId, x, y){
  var pos = this.world.npcPos;
  for (var id in pos){
    var p = pos[id];
    if (p && p.scene === sceneId && Math.round(p.x) === x && Math.round(p.y) === y) return id;
  }
  return null;
};
Game.prototype.npcsHere = function(sceneId){
  sceneId = sceneId || this.world.player.scene;
  var out = [], pos = this.world.npcPos;
  for (var id in pos) if (pos[id] && pos[id].scene === sceneId) out.push(id);
  return out;
};
Game.prototype.npcsNear = function(r, sceneId){
  sceneId = sceneId || this.world.player.scene;
  var p = this.world.player, out = [], pos = this.world.npcPos;
  r = num(r, 1);
  for (var id in pos){
    var a = pos[id];
    if (!a || a.scene !== sceneId) continue;
    var dx = Math.round(a.x) - p.x, dy = Math.round(a.y) - p.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) <= r) out.push({ npcId: id, x: Math.round(a.x), y: Math.round(a.y), dx: dx, dy: dy, dist: Math.abs(dx) + Math.abs(dy) });
  }
  out.sort(function(a, b){ return a.dist - b.dist; });
  return out;
};
Game.prototype.cellsNear = function(r, sceneId){
  sceneId = sceneId || this.world.player.scene;
  var p = this.world.player, out = [];
  r = num(r, 1);
  for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++){
    if (!dx && !dy) continue;
    var c = this.cellAt(sceneId, p.x + dx, p.y + dy);
    if (c && c.kind === 'interactable' && c.def) out.push({ x: c.x, y: c.y, def: c.def, dx: dx, dy: dy, dist: Math.abs(dx) + Math.abs(dy) });
  }
  out.sort(function(a, b){
    var pa = num(a.def.priority, 0), pb = num(b.def.priority, 0);
    if (pa !== pb) return pb - pa;
    return a.dist - b.dist;
  });
  return out;
};
Game.prototype.spawnNpc = function(npcId, sceneId, x, y){
  if (!this.idx.npcs[npcId]) { this.warn('spawnNpc：未知 NPC ' + npcId); return false; }
  this.world.npcPosts[npcId] = { scene: sceneId, x: x, y: y, until: 0, permanent: true };
  this.world.npcPos[npcId] = { scene: sceneId, x: x, y: y, px: x, py: y };
  return true;
};
Game.prototype.despawnNpc = function(npcId){ delete this.world.npcPos[npcId]; delete this.world.npcPosts[npcId]; };
Game.prototype.sampleSchedule = function(npcId){
  var npc = this.idx.npcs[npcId];
  if (!npc) return null;
  var post = this.world.npcPosts[npcId];
  if (post && (post.permanent || !post.until || this.world.tick < post.until)) return post;
  if (post && post.until && this.world.tick >= post.until) delete this.world.npcPosts[npcId];
  var sched = this.idx.schedules[npcId];
  var slots = sched ? (isArr(sched.slots) ? sched.slots : (isArr(sched.schedule) ? sched.schedule : [])) : [];
  var hour = this.minuteOfDay() / HOUR;
  for (var i = 0; i < slots.length; i++){
    var s = slots[i]; if (!s) continue;
    var hrs = isArr(s.hours) ? s.hours : null;
    if (hrs && hrs.length >= 2){
      var a = num(hrs[0], 0), b = num(hrs[1], 24);
      var ok = a <= b ? (hour >= a && hour < b) : (hour >= a || hour < b);
      if (!ok) continue;
    }
    return { scene: s.scene || npc.homeScene, x: num(s.x, 0), y: num(s.y, 0) };
  }
  /* 兜底：常驻 homeScene 的出生点 */
  var home = npc.homeScene || (asList(this.space.scenes)[0] || {}).id;
  var g = this.idx.sceneGrids[home];
  if (g && g.spawn) return { scene: home, x: g.spawn.x, y: g.spawn.y };
  var f = this.findFreeCell(home);
  return { scene: home, x: f.x, y: f.y };
};
Game.prototype.enterScene = function(npcId, sceneId){
  var g = this.idx.sceneGrids[sceneId];
  if (!g) return { x: 0, y: 0 };
  /* 从地图边缘找一个可站立的格子当作「入口」，让 NPC 走进来是看得见的 */
  var cands = [];
  for (var x = 0; x < g.w; x++){ cands.push({ x: x, y: 0 }); cands.push({ x: x, y: g.h - 1 }); }
  for (var y = 0; y < g.h; y++){ cands.push({ x: 0, y: y }); cands.push({ x: g.w - 1, y: y }); }
  for (var i = 0; i < cands.length; i++){
    var c = cands[i];
    if (this.canStand(sceneId, c.x, c.y)) return c;
  }
  return this.findFreeCell(sceneId);
};
Game.prototype.placeNpc = function(npcId, force){
  var target = this.sampleSchedule(npcId);
  if (!target) return;
  var cur = this.world.npcPos[npcId];
  if (!cur){
    this.world.npcPos[npcId] = { scene: target.scene, x: target.x, y: target.y, px: target.x, py: target.y, tx: target.x, ty: target.y };
    return;
  }
  if (cur.scene !== target.scene){
    var entry = this.enterScene(npcId, target.scene);
    this.world.npcPos[npcId] = { scene: target.scene, x: entry.x, y: entry.y, px: entry.x, py: entry.y, tx: target.x, ty: target.y };
    this.world.npcPaths[npcId] = null;
    if (force) { this.world.npcPos[npcId].x = target.x; this.world.npcPos[npcId].y = target.y; }
    return;
  }
  cur.tx = target.x; cur.ty = target.y;
  if (force){ cur.x = target.x; cur.y = target.y; this.world.npcPaths[npcId] = null; }
};
Game.prototype.updateSchedules = function(){
  var npcs = asList(this.space.npcs);
  for (var i = 0; i < npcs.length; i++){
    var id = npcs[i].id;
    if (!id) continue;
    try { this.placeNpc(id, false); } catch (e){ }
  }
};
Game.prototype.findPath = function(sceneId, sx, sy, tx, ty, limit){
  var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  var g = this.idx.sceneGrids[sceneId];
  if (!g) return null;
  /* 默认把整张地图放进来：BFS 是 O(可走格数)，一张 88x28 的图也就几十微秒。
     以前默认 900 会在 25 个场景里的 18 个直接放弃寻路，NPC 只能被瞬移到目标格。 */
  if (!(num(limit, 0) > 0)) limit = g.w * g.h + 1;
  if (sx === tx && sy === ty) return [];
  var n = g.w * g.h;
  /* 先把「能不能站」一次算成两个 TypedArray：编译好的可走位 + 运行时覆写 + 站着的人。
     BFS 内层绝不能再调 canStand  那会每格建一个对象、还把所有 NPC 扫一遍。 */
  var pass = new Uint8Array(g.pass);
  var ovr = this.world.tileOverrides;
  for (var okey in ovr){
    var om = /^(.+):(-?\d+),(-?\d+)$/.exec(okey);
    if (!om || om[1] !== sceneId) continue;
    var oi = Number(om[3]) * g.w + Number(om[2]);
    if (oi < 0 || oi >= n) continue;
    var opv = ovr[okey] ? ovr[okey].passable : undefined;
    if (opv !== undefined) pass[oi] = opv ? 1 : 0;
  }
  var occ = new Uint8Array(n), pos = this.world.npcPos;
  for (var nid in pos){
    var na = pos[nid];
    if (!na || na.scene !== sceneId) continue;
    var nax = Math.round(na.x), nay = Math.round(na.y);
    if (nax >= 0 && nay >= 0 && nax < g.w && nay < g.h) occ[nay * g.w + nax] = 1;
  }
  function standOK(px, py){
    if (px < 0 || py < 0 || px >= g.w || py >= g.h) return false;
    var pi = py * g.w + px;
    return !!pass[pi] && !occ[pi];
  }
  if (!standOK(tx, ty)){
    var best = null, bd = 1e9;
    for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++){
      var nx = tx + dx, ny = ty + dy;
      if (!standOK(nx, ny)) continue;
      var d = dx * dx + dy * dy;
      if (d < bd){ bd = d; best = { x: nx, y: ny }; }
    }
    if (!best) return null;
    tx = best.x; ty = best.y;
  }
  var prev = new Int32Array(n).fill(-1), seen = new Uint8Array(n);
  var qx = new Int32Array(n), qy = new Int32Array(n), head = 0, tail = 0;
  var start = sy * g.w + sx;
  qx[tail] = sx; qy[tail] = sy; tail++; seen[start] = 1;
  var goal = ty * g.w + tx, found = false, count = 0;
  var order = [[0,-1],[0,1],[-1,0],[1,0]];
  while (head < tail && count++ < limit){
    var cx = qx[head], cy = qy[head]; head++;
    if (cx === tx && cy === ty){ found = true; break; }
    for (var k = 0; k < 4; k++){
      var ax = cx + order[k][0], ay = cy + order[k][1];
      if (ax < 0 || ay < 0 || ax >= g.w || ay >= g.h) continue;
      var ai = ay * g.w + ax;
      if (seen[ai]) continue;
      if (!(pass[ai] && !occ[ai]) && !(ax === tx && ay === ty)) continue;
      seen[ai] = 1; prev[ai] = cy * g.w + cx;
      qx[tail] = ax; qy[tail] = ay; tail++;
    }
  }
  var path = null;
  if (found){
    path = []; var ci = goal, guard = 0;
    while (ci !== start && guard++ < n){ path.push({ x: ci % g.w, y: Math.floor(ci / g.w) }); ci = prev[ci]; if (ci < 0) { path = null; break; } }
    if (path) path.reverse();
  }
  this.perf.path = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0;
  return path;
};
Game.prototype.stepActors = function(){
  var pos = this.world.npcPos, paths = this.world.npcPaths;
  var cur = this.world.player.scene;
  /* 寻路分摊到多帧：一 tick 最多给 config.npcRepathPerTick 个人重新算路径（默认 2）。
     不然 30 个人同一 tick 一起 BFS，会顶出一个十几毫秒的最坏帧（test_arch 8b/8c）。
     已经有了缓存路径的人不受影响，照常往前走。 */
  var budget = Math.max(1, num(this.cfg.npcRepathPerTick, 2));
  for (var id in pos){
    var a = pos[id];
    if (!a) continue;
    a.px = a.x; a.py = a.y;
    if (a.x === a.tx && a.y === a.ty) continue;
    if (a.scene !== cur){ a.x = a.tx; a.y = a.ty; continue; }   /* 不在玩家场景：不跑路径，省 CPU */
    var path = paths[id];
    if (!path || !path.length){
      if (budget <= 0) continue;                               /* 这一 tick 预算用完，下几帧再算 */
      budget--;
      path = this.findPath(a.scene, a.x, a.y, a.tx, a.ty);
      paths[id] = path || [];
      if (!path || !path.length){ a.x = a.tx; a.y = a.ty; continue; }
    }
    var nxt = path.shift();
    if (this.canStand(a.scene, nxt.x, nxt.y)){ a.x = nxt.x; a.y = nxt.y; }
    else paths[id] = null;
  }
};

/* ---------- tick ---------- */
Game.prototype.step = function(n){ n = Math.max(0, num(n, 1)); for (var i = 0; i < n; i++) this.tickOnce(); };
Game.prototype.tickOnce = function(){
  if (this.world.gameOver) return;
  var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  this.world.tick += 1;
  this.onTick(1);
  this.perf.tick = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0;
};
Game.prototype.onTick = function(dt){
  if (this.world.gameOver) return;
  this.fireHooks('tick', {});
  this.stepFleet();                                   /* 舰队在航道上推进（第 1 期）*/
  if (this.world.tick % DAY === 0) this.fireHooks('day', {});
  this.stepTutorial();
  this.updateSchedules();
  this.stepActors();
  this.stepBuilds(dt);
  this.stepChains();
  this.stepCrisis();
  this.checkEvents();
  this.world.player.fatigue = clamp(num(this.world.player.fatigue, 0) + dt * num(this.cfg.fatiguePerTick, 0.02), 0, 100);
  if (this.world.tick % 60 === 0) this.applyProjections();
};
Game.prototype.stepBuilds = function(dt){
  var builds = this.world.builds;
  for (var id in builds){
    var b = builds[id];
    if (!b || b.done) continue;
    b.progress += dt;
    var stage = Math.floor(b.progress / Math.max(1, b.ticksPerStage));
    if (stage > b.stage){
      b.stage = stage;
      var stages = b.stages || [];
      var sdef = stages[Math.min(stage, stages.length - 1)];
      if (sdef) this.setTile(b.scene, b.x, b.y, { ch: sdef.ch, fg: sdef.fg, bg: sdef.bg, passable: sdef.passable });
      if (stage >= stages.length){
        b.done = true;
        var done = b.doneDef || { ch: b.doneCh || '\u25a0', bg: b.doneBg || 'good' };
        this.setTile(b.scene, b.x, b.y, done);
        this.log(str(b.name, id) + ' 完工了。', 'good');
        runEffects(this, b.onDone, { buildId: id });
        this.fireHooks('build_done', { buildId: id, scene: b.scene, x: b.x, y: b.y });
      }
    }
  }
};
Game.prototype.startBuild = function(e){
  var id = str(e.id, 'build_' + Object.keys(this.world.builds).length);
  var b = {
    id: id, name: str(e.name, id), scene: e.scene || this.world.player.scene,
    x: num(e.x, 0), y: num(e.y, 0), stage: -1, progress: 0,
    ticksPerStage: Math.max(1, num(e.ticksPerStage, 120)),
    stages: isArr(e.stages) ? e.stages : [{ ch: '.', bg: 'wall_bg' }, { ch: ':', bg: 'wall_bg' }, { ch: '%', bg: 'wall_bg' }],
    doneDef: e.done || null, doneCh: e.doneCh, doneBg: e.doneBg, onDone: e.onDone || null, done: false
  };
  this.world.builds[id] = b;
  this.stepBuilds(0);
  this.setTile(b.scene, b.x, b.y, b.stages[0] || { ch: '.', bg: 'wall_bg' });
  this.log('开始建造：' + b.name, 'info');
  return b;
};
Game.prototype.findBuild = function(id){ return this.world.builds[id] || null; };
/* ============================== 9  玩家移动与交互 ============================== */
Game.prototype.tryMove = function(dx, dy){
  var p = this.world.player;
  if (this.world.gameOver) return false;
  if (this.ui.dialogue || this.ui.view) return false;
  if (dx < 0) p.facing = 'left'; else if (dx > 0) p.facing = 'right';
  else if (dy < 0) p.facing = 'up'; else if (dy > 0) p.facing = 'down';
  var nx = p.x + dx, ny = p.y + dy;
  var npc = this.npcAt(p.scene, nx, ny);
  if (npc){
    /* 撞到人就停下；想说话按 E（除非 config.autoNpcTalk 打开） */
    if (this.cfg.autoNpcTalk === true) this.approachNpc(npc);
    else this.log(str(this.npcName(npc)) + ' 挡在前面。（按 E 交谈）', 'dim');
    return false;
  }
  if (!this.isPassable(p.scene, nx, ny)){ this.log('那边过不去。', 'dim'); return false; }
  p.x = nx; p.y = ny;
  this.step(1);
  this.afterArrive();
  return true;
};
Game.prototype.wait = function(n){
  if (this.world.gameOver || this.ui.dialogue || this.ui.view) return false;
  this.step(num(n, 1));
  this.afterArrive();
  return true;
};
Game.prototype.afterArrive = function(){
  this.updateVision();
  if (this.takeExit()) return;
  this.autoInteract();
};
Game.prototype.takeExit = function(){
  var p = this.world.player, g = this.grid(p.scene);
  if (!g) return false;
  var ex = (g.doorMap && g.doorMap[p.x + ',' + p.y]) || g.exitMap[p.x + ',' + p.y];
  if (!ex || !ex.to) return false;
  var tr = this.findTransition(p.scene, ex.to);
  var cost = num(ex.costTicks, num(tr && tr.costTicks, 0));
  if (tr && tr.condition && !check(this, tr.condition, { exit: ex })) return false;
  if (cost > 0){ this.world.tick += cost; this.onTick(cost); this.log('赶路 ' + cost + ' 分钟。', 'dim'); }
  var at = ex.at || (tr && tr.at) || null;
  var ok = this.teleport(ex.to, at ? num(at.x, NaN) : NaN, at ? num(at.y, NaN) : NaN);
  if (ok){
    if (tr) runEffects(this, tr.onEnter && tr.onEnter.effects ? tr.onEnter.effects : tr.onEnter, { transition: tr.id });
    this.updateVision();
    this.world.path = null;
  }
  return ok;
};
Game.prototype.findTransition = function(from, to){
  var list = asList(this.space.sceneTransitions);
  for (var i = 0; i < list.length; i++){
    var t = list[i]; if (!t) continue;
    var f = getPath(t, 'from.scene', t.from), tt = getPath(t, 'to.scene', t.to);
    if (f === from && tt === to) return t;
  }
  return null;
};
Game.prototype.teleport = function(scene, x, y){
  if (!scene || !this.idx.scenes[scene]){ this.warn('teleport：场景不存在 ' + scene); return false; }
  var p = this.world.player, g = this.grid(scene);
  p.scene = scene;
  if (isNaN(x) || isNaN(y) || !this.isPassable(scene, x, y)){
    var cell = (g && g.spawn) ? g.spawn : this.findFreeCell(scene);
    x = cell.x; y = cell.y;
  }
  p.x = clamp(x, 0, g ? g.w - 1 : 0); p.y = clamp(y, 0, g ? g.h - 1 : 0);
  this.world.visited[scene] = true;
  this.world.known[scene] = true;
  this.updateVision();
  this.log('你走进了' + this.sceneName(scene) + '。', 'info');
  this.fireHooks('enter_scene', { scene: scene, x: p.x, y: p.y });
  return true;
};
Game.prototype.bestTarget = function(){
  var cells = this.cellsNear(1), npcs = this.npcsNear(1), out = [];
  for (var i = 0; i < cells.length; i++) out.push({ kind: 'interactable', dist: cells[i].dist, pri: num(cells[i].def.priority, 0), cell: cells[i] });
  for (var j = 0; j < npcs.length; j++) out.push({ kind: 'npc', dist: npcs[j].dist, pri: num(this.idx.npcs[npcs[j].npcId] && this.idx.npcs[npcs[j].npcId].priority, 0), npc: npcs[j] });
  out.sort(function(a, b){
    if (a.pri !== b.pri) return b.pri - a.pri;
    if (a.dist !== b.dist) return a.dist - b.dist;
    return a.kind === 'npc' ? -1 : 1;
  });
  return out[0] || null;
};
Game.prototype.autoInteract = function(){
  var p = this.world.player, t = this.bestTarget();
  if (!t) return false;
  var key = p.scene + ':' + p.x + ',' + p.y + ':' + (t.kind === 'npc' ? t.npc.npcId : t.cell.def.id);
  if (this.world.lastAuto === key) return false;
  /* 默认【什么都不自动弹】 想自动触发必须在 config 里显式打开开关 */
  if (t.kind === 'npc'){
    if (this.cfg.autoNpcTalk !== true) return false;
    this.world.lastAuto = key;
    this.approachNpc(t.npc.npcId);
    return true;
  }
  var d = t.cell.def;
  if (this.cfg.autoInteract !== true) return false;   /* 全局开关 */
  if (d.auto !== true) return false;                  /* 单物件开关 */
  this.world.lastAuto = key;
  runEffects(this, d.onInteract || d.effects, { cell: t.cell, interactable: d.id });
  return true;
};
Game.prototype.interact = function(){
  if (this.world.gameOver) return false;
  if (this.ui.dialogue){ this.dialogueAdvance(); return true; }
  if (this.ui.view) return false;
  var t = this.bestTarget();
  if (!t){ this.log('附近没有可以交互的东西。', 'dim'); return false; }
  if (t.kind === 'npc') return this.approachNpc(t.npc.npcId);
  var d = t.cell.def;
  this.world.lastAuto = this.world.player.scene + ':' + t.cell.x + ',' + t.cell.y + ':' + d.id;
  var hctx = { cell: t.cell, interactable: d.id, scene: this.world.player.scene, x: t.cell.x, y: t.cell.y };
  if (this.fireHooks('interact', hctx)) return true;      /* mod 用 {stop:true} 换掉默认行为 */
  runEffects(this, d.onInteract || d.effects, hctx);
  return true;
};
Game.prototype.pathTo = function(tx, ty){
  var p = this.world.player;
  var path = this.findPath(p.scene, p.x, p.y, tx, ty);
  this.world.path = (path && path.length) ? path : null;
  if (!this.world.path && !(p.x === tx && p.y === ty)) this.log('过不去。', 'dim');
  return this.world.path;
};
Game.prototype.advancePath = function(){
  var path = this.world.path;
  if (!path || !path.length){ this.world.path = null; return false; }
  var p = this.world.player, n = path[0];
  var dx = n.x - p.x, dy = n.y - p.y;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1){ this.world.path = null; return false; }
  if (this.tryMove(dx, dy)){ path.shift(); return true; }
  this.world.path = null; return false;
};

/* ============================== 10  对话运行时 ==============================
 * 对话是事件的唯一载体：NPC 走到你面前，把事说出来，你选。
 * ====================================================================== */
Game.prototype.registerDynamicOptions = function(name, fn){ this.dynProviders[name] = fn; return name; };

/* ---------------- 宏 ----------------
 * 内容里的「函数」：{"id":"give_ration","effects":[{"type":"give_item",...}]}
 * 调用 {"type":"macro","id":"give_ration","params":{"n":2}}，内部用 {args.n} 取值。
 * -------------------------------------------------- */
Game.prototype.macro = function(id){
  var m = this.idx.macros || {};
  return m[id] || null;
};

/* ---------------- 钩子（内容层的插槽） ----------------
 * hooks 块里每条：{ id, on, condition, once, priority, effects, 以及可选的过滤器 }
 * on 的可选值（都是引擎里已经存在的时刻，不是新机制）：
 *   game_start / tick / day / enter_scene / interact / npc_talk / dialogue_end / build_done
 * 过滤器：scene / interactable / npcId / dialogue / buildId / event（写哪个就只在那一种情况下触发）
 * 排序：priority 大者先跑；任一效果返回 {stop:true} 就掐掉这一轮（内建行为也会被掐掉）
 * -------------------------------------------------- */
var HOOK_FILTERS = ['scene', 'interactable', 'npcId', 'dialogue', 'buildId', 'event'];
Game.prototype.fireHooks = function(on, ctx){
  var list = (this.idx.hooksByOn && this.idx.hooksByOn[on]) || [];
  if (!list.length) return false;
  ctx = ctx || {};
  var stopped = false;
  for (var i = 0; i < list.length; i++){
    var h = list[i];
    if (!h) continue;
    if (h.once === true && this.world.firedRules['hook:' + h.id]) continue;
    if (h.every && on === 'tick' && (this.world.tick % Math.max(1, num(h.every, 1))) !== 0) continue;
    var match = true;
    for (var fi = 0; fi < HOOK_FILTERS.length; fi++){
      var fk = HOOK_FILTERS[fi];
      if (h[fk] !== undefined && String(h[fk]) !== String(ctx[fk])){ match = false; break; }
    }
    if (!match) continue;
    if (!check(this, h.condition, ctx)) continue;
    if (h.once === true) this.world.firedRules['hook:' + h.id] = true;
    if (runEffects(this, h.effects || h.list, ctx)) stopped = true;
  }
  return stopped;
};

Game.prototype.pickApproachDialogue = function(npcId){
  var rules = [];
  var npc = this.idx.npcs[npcId] || {};
  if (isArr(npc.onPlayerApproach)) rules = rules.concat(npc.onPlayerApproach);
  var global = asList(this.space.npcApproach);
  for (var i = 0; i < global.length; i++){
    var r = global[i]; if (!r) continue;
    if (r.npcId && r.npcId !== npcId) continue;
    rules.push(r);
  }
  var best = null;
  for (var j = 0; j < rules.length; j++){
    var rule = rules[j]; if (!rule || !rule.dialogue) continue;
    var once = rule.once !== false;
    if (once && this.world.firedRules['approach:' + npcId + ':' + rule.dialogue]) continue;
    if (!check(this, rule.condition, { npcId: npcId })) continue;
    var pri = num(rule.priority, 0);
    if (!best || pri > best.pri) best = { pri: pri, rule: rule };
  }
  if (!best) return null;
  if (best.rule.once !== false) this.world.firedRules['approach:' + npcId + ':' + best.rule.dialogue] = true;
  if (best.rule.effects) runEffects(this, best.rule.effects, { npcId: npcId });
  return best.rule.dialogue;
};
Game.prototype.approachNpc = function(npcId){
  var npc = this.idx.npcs[npcId];
  if (!npc){ this.warn('approachNpc：未知 NPC ' + npcId); return false; }
  var dlgId = this.pickApproachDialogue(npcId) || npc.dialogue;
  if (!dlgId){ this.log(str(npc.name, npcId) + ' 看了你一眼，没说话。', 'dim'); return false; }
  return this.openDialogue(dlgId, npcId);
};
Game.prototype.openDialogue = function(id, npcId){
  var d = this.idx.dialogues[id];
  if (!d){ this.warn('未知对话：' + id); return false; }
  this.lastNpcId = npcId || d.npcId;
  this.ui.dialogue = { id: id, npcId: this.lastNpcId, node: null, cursor: 0, pendingClose: false };
  this.enterNode(str(d.entry, 'root'));
  if (this.ui.dialogue) this.fireHooks('npc_talk', { npcId: this.lastNpcId, dialogue: id });
  return !!this.ui.dialogue;
};
/* 关对话只有这一条出口：这样内容才能挂「对话结束」的钩子 */
Game.prototype.closeDialogue = function(reason){
  var st = this.ui.dialogue;
  if (!st) return false;
  this.ui.dialogue = null;
  this.fireHooks('dialogue_end', { dialogue: st.id, npcId: st.npcId, node: st.node, reason: reason || '' });
  return true;
};
Game.prototype.enterNode = function(nodeId){
  var st = this.ui.dialogue; if (!st) return;
  var d = this.idx.dialogues[st.id] || {};
  var nodes = d.nodes || {};
  if (nodeId === undefined || nodeId === null || nodeId === '' || !nodes[nodeId]){
    this.closeDialogue('node_missing'); return;
  }
  st.node = nodeId; st.cursor = 0; st.pendingClose = false;
  var node = nodes[nodeId] || {};
  this.world.seenDialogues[st.id] = true;
  this.world.seenDialogues[st.id + '.' + nodeId] = true;
  runEffects(this, node.onEnter || node.effects, { npcId: st.npcId, node: nodeId });
  if (this.ui.dialogue !== st) return;
  var opts = this.dialogueOptions();
  if (!opts.length && (node.action === 'close_dialogue' || node.action === 'close' || node.autoClose)) st.pendingClose = true;
  if (!opts.length && node.next) this.enterNode(node.next);
};
Game.prototype.dialogueOptions = function(){
  var st = this.ui.dialogue; if (!st) return [];
  var d = this.idx.dialogues[st.id] || {};
  var node = (d.nodes || {})[st.node]; if (!node) return [];
  var src = [];
  if (isArr(node.options)) src = src.concat(node.options);
  if (node.dynamicOptions) src = src.concat(this.dynamicOptions(node.dynamicOptions, st));
  var out = [];
  for (var i = 0; i < src.length; i++){
    var o = src[i]; if (!o) continue;
    if (o.hidden) continue;
    if (!check(this, o.condition, { npcId: st.npcId, node: st.node })) continue;
    if (o.cost && !this.canPay(o.cost)) continue;
    out.push(o);
  }
  return out;
};
Game.prototype.dynamicOptions = function(spec, st){
  if (isArr(spec)) return spec;
  if (typeof spec === 'string'){
    if (this.dynProviders[spec]){
      try { return this.dynProviders[spec](this, st) || []; } catch (e){ this.warn('动态选项 provider ' + spec + ' 异常：' + e.message); return []; }
    }
    var pool = this.idx.pools[spec];
    if (pool) return asList(pool);
    this.warn('未知动态选项池：' + spec);
    return [];
  }
  if (isObj(spec)){
    if (isArr(spec.list)) return spec.list;
    if (spec.provider && this.dynProviders[spec.provider]) return this.dynProviders[spec.provider](this, st) || [];
    if (spec.from){
      var rows = getPath(this.scope(), spec.from, []);
      var out = [];
      if (isArr(rows)) for (var i = 0; i < rows.length; i++){
        var o = clone(spec.option || {});
        o.text = tpl(str(o.text, '{name}'), this.tplCtx({ row: rows[i], i: i, index: i }));
        o.effects = clone(spec.option && spec.option.effects) || clone(spec.effects) || [];
        o.effects = this.injectRow(o.effects, rows[i]);
        out.push(o);
      }
      return out;
    }
  }
  return [];
};
Game.prototype.injectRow = function(effects, row){
  if (!isArr(effects)) return effects;
  var out = clone(effects);
  for (var i = 0; i < out.length; i++) if (isObj(out[i]) && out[i]._row === true){ for (var k in row) out[i][k] = row[k]; }
  return out;
};
Game.prototype.canPay = function(cost){
  if (!cost) return true;
  if (cost.item) return this.itemCount(cost.item) >= num(cost.count, 1);
  if (cost.counter) return num(this.world.counters[cost.counter], 0) >= num(cost.amount, 1);
  return true;
};
Game.prototype.payCost = function(cost){
  if (!cost) return true;
  if (!this.canPay(cost)) return false;
  if (cost.item) this.world.items[cost.item] = Math.max(0, this.itemCount(cost.item) - num(cost.count, 1));
  if (cost.counter) this.world.counters[cost.counter] = num(this.world.counters[cost.counter], 0) - num(cost.amount, 1);
  return true;
};
Game.prototype.dialogueAdvance = function(){
  var st = this.ui.dialogue; if (!st) return false;
  if (st.pendingClose){ return this.closeDialogue('pending'); }
  var opts = this.dialogueOptions();
  if (opts.length){ return this.chooseOption(st.cursor); }
  return this.closeDialogue('end');
};
Game.prototype.chooseOption = function(i){
  var st = this.ui.dialogue; if (!st) return false;
  var opts = this.dialogueOptions();
  var o = opts[i]; if (!o) return false;
  if (o.cost && !this.payCost(o.cost)){ this.log('你不满足条件。', 'warn'); return false; }
  runEffects(this, o.effects, { npcId: st.npcId, node: st.node, option: i, choice: o });
  if (this.ui.dialogue !== st) return true;
  var go = o.goto || o.next;
  if (go) this.enterNode(go); else this.closeDialogue('option_end');
  return true;
};

/* ============================== 11  视图（终端叠加） ==============================
 * 星图 / 科技 / 资源 / 建造 / 外交 / 伤病 / 穿梭机 全是同一套「视图」，
 * 入口永远是场景里的一个具体字符，永远不会是菜单按钮。
 * ====================================================================== */
Game.prototype.kernelData = function(){ return this.opts.kernel || this.space.kernel || {}; };
Game.prototype.scope = function(extra){
  var p = this.world.player, s = {
    tick: this.world.tick, flags: this.world.flags, counters: this.world.counters, items: this.world.items,
    player: p, stats: p.stats, skills: p.skills, world: this.world, space: this.space, kernel: this.kernelData(),
    scene: p.scene, sceneName: this.sceneName(p.scene), minuteOfDay: this.minuteOfDay(),
    hour: this.hourOfDay(), clock: this.clockText(), visited: this.world.visited, known: this.world.known
  };
  if (extra) for (var k in extra) if (has(extra, k)) s[k] = extra[k];
  return s;
};
Game.prototype.tplCtx = function(extra){
  var p = this.world.player, s = this.scope(extra);
  s.hp = Math.round(num(getPath(p.stats, 'hp'), 0));
  s.maxHp = Math.round(num(getPath(p.stats, 'maxHp'), 10));
  s.fatigue = Math.round(num(p.fatigue, 0));
  s.name = p.name; s.title = p.title;
  if (!s.npc) s.npc = {};
  if (extra && extra.npcId && this.idx.npcs[extra.npcId]){
    var n = this.idx.npcs[extra.npcId];
    s.npc = n; s.npcName = str(n.name, extra.npcId); s.npcRole = str(n.role, '');
    s.npcSymbol = str(n.symbol, '?');
  }
  if (s.npcName === undefined) s.npcName = '';
  return s;
};
Game.prototype.playerStat = function(name){
  var p = this.world.player;
  var v = getPath(p.stats, name, undefined);
  if (v === undefined) v = getPath(p, name, 0);
  return v;
};
Game.prototype.itemCount = function(id){ return num(this.world.items[id], 0); };
Game.prototype.readState = function(path){ return getPath(this.scope(), path, 0); };

/* 这一格到底是什么？地形 / 物件 / 门 / 人 */
Game.prototype.describeAt = function(sceneId, x, y){
  var c = this.cellAt(sceneId, x, y);
  if (!c) return { name: '虚空', kind: 'void', desc: '地图之外。', ch: ' ' };
  var npcId = this.npcAt(sceneId, x, y);
  if (npcId){
    var n = this.idx.npcs[npcId] || {};
    return { name: str(n.name, npcId), kind: 'npc', ch: str(n.symbol, '?'),
             desc: str(n.title, '') || str(n.role, '') || '这里的人', npcId: npcId };
  }
  if (c.kind === 'interactable' && c.def){
    return { name: str(c.def.name, c.def.id), kind: 'object', ch: c.ch,
             desc: str(c.def.desc, ''), def: c.def };
  }
  if (c.kind === 'exit'){
    var _gg = this.grid(sceneId);
    var ex = (_gg.doorMap && _gg.doorMap[x + ',' + y]) || (_gg.exitMap || {})[x + ',' + y];
    return { name: '门', kind: 'exit', ch: c.ch,
             desc: ex && ex.to ? ('通向 ' + this.sceneName(ex.to)) : '出口' };
  }
  return { name: str(c.name, '') || (c.passable ? '地板' : '墙'), kind: c.passable ? 'floor' : 'wall',
           ch: c.ch, desc: c.passable ? '可以走过去。' : '过不去。' };
};

/* 当前场景里出现过的字符 -> 含义，用来给玩家一张随时可看的图例 */
Game.prototype.sceneLegend = function(sceneId){
  var g = this.grid(sceneId); if (!g) return [];
  var wallCh = str(getPath(this.presets, 'wall.ch'), '#');
  var seen = {}, out = [], i;
  for (i = 0; i < g.ch.length; i++){
    var ch = g.ch[i];
    if (!ch || ch === ' ' || ch === WIDE_MARK) continue;
    /* 墙被轮廓化成了 - | +：图例里按「类别字符」列一次就够，
       否则侧栏会同时出现「+ 墙」和「+ 门」两条一样的符号。 */
    if (g.kind[i] === 'wall') ch = wallCh;
    var def = g.def[i];
    var name = def ? str(def.name, '') : str(g.name[i], '');
    if (!name) continue;
    var key = ch + '|' + name;
    if (seen[key]) continue;
    seen[key] = 1;
    out.push({ ch: ch, name: name, kind: g.kind[i], color: def ? def.color : g.fg[i] });
  }
  var here = this.npcsHere(sceneId);
  for (i = 0; i < here.length; i++){
    var nd = this.idx.npcs[here[i]] || {};
    var key2 = str(nd.symbol, '?') + '|' + str(nd.name, here[i]);
    if (seen[key2]) continue;
    seen[key2] = 1;
    out.push({ ch: str(nd.symbol, '?'), name: str(nd.name, here[i]), kind: 'npc', color: str(nd.color, 'npc') });
  }
  out.sort(function(a, b){ return a.kind === b.kind ? 0 : (a.kind === 'npc' ? -1 : 1); });
  return out;
};

/* 查看模式：把光标挪到某格 */
Game.prototype.lookAt = function(x, y){
  var p = this.world.player, g = this.grid(p.scene);
  if (!g) return false;
  this.ui.look = { x: clamp(x, 0, g.w - 1), y: clamp(y, 0, g.h - 1) };
  return true;
};
Game.prototype.lookMove = function(dx, dy){
  var lk = this.ui.look; if (!lk) return false;
  return this.lookAt(lk.x + dx, lk.y + dy);
};
Game.prototype.lookInfo = function(){
  var lk = this.ui.look; if (!lk) return null;
  return this.describeAt(this.world.player.scene, lk.x, lk.y);
};
Game.prototype.kernelQuery = function(q){
  if (typeof q === 'boolean') return q;
  var k = this.kernelData();
  var v = getPath(k, q, undefined);
  if (v !== undefined) return !!v;
  var rule = getPath(this.space, 'kernelQueries.' + q, undefined);
  if (isArr(rule)) return check(this, rule, {});
  if (rule !== undefined) return !!rule;
  return false;
};
Game.prototype.resolveView = function(id){
  var v = this.idx.views[id];
  if (v) return v;
  /* 任何注册过的视图提供者，都可以直接用名字打开  加终端不用先登记 */
  if (viewProviders[id]){
    var m = viewMetas[id] || {};
    return { id: id, title: str(m.title, id), width: num(m.width, 74), provider: id,
             actions: m.actions || [{ text: '关闭', effects: [{ type: 'close_view' }] }] };
  }
  return null;
};
Game.prototype.openView = function(id){
  /* 记下打开之前是哪个面板：? 键位表自己也是一个面板，不记住的话它永远只会报
     「面板打开中」，因为按 ? 的那一刻新面板已经开了。 */
  var _prev = this.ui.view ? this.ui.view.id : null;
  this.ui.viewFrom = (id === 'keys') ? _prev : null;
  var v = this.resolveView(id);
  if (!v){ this.warn('未知视图：' + id); return false; }
  this.ui.view = { id: id, cursor: 0, scroll: 0, def: v };
  this.ui.flash = null;
  this.world.seenViews[id] = true;
  this.refreshView();
  logEvent(this, '打开终端：' + str(v.title, id) + '（Esc 关闭）', 'dim');
  return true;
};
Game.prototype.closeView = function(){ this.ui.view = null; this.ui.flash = null; };
Game.prototype.setFlash = function(logN){
  var L = this.world.log || [];
  if (logN === undefined || L.length > logN){
    var e = L[L.length - 1];
    if (e && e.text) this.ui.flash = { text: str(e.text, ''), level: str(e.level, 'info') };
  }
};
/* 阅读弹层：长剧情 / 日志全文 / 任务进度都用它，滚轮不会把长文本挤进侧栏 */
Game.prototype.openReader = function(spec, ctx){
  spec = spec || {};
  var self = this, raw = [];
  function add(x){
    if (x === undefined || x === null) return;
    if (isArr(x)){ for (var i = 0; i < x.length; i++) add(x[i]); return; }
    if (isObj(x)){ raw.push({ text: tpl(str(x.text, x.name !== undefined ? String(x.name) : ''), self.tplCtx(ctx || {})), fg: str(x.fg, 'ui') }); return; }
    raw.push({ text: tpl(String(x), self.tplCtx(ctx || {})), fg: 'ui' });
  }
  add(spec.lines);
  add(spec.text);
  if (spec.source){
    var rows = getPath(this.scope(), spec.source, []);
    if (!isArr(rows)) rows = rows ? [rows] : [];
    for (var r = 0; r < rows.length; r++) add(rows[r]);
  }
  var W = 76, out = [];
  for (var j = 0; j < raw.length; j++){
    var parts = wrapText(raw[j].text || '', W);
    if (!parts.length) parts = [''];
    for (var k = 0; k < parts.length; k++) out.push({ text: parts[k], fg: raw[j].fg });
  }
  this.ui.reader = { title: str(spec.title, '阅读'), rows: out, scroll: 0 };
  this.ui.flash = null;
  return true;
};
Game.prototype.closeReader = function(){ this.ui.reader = null; };
Game.prototype.readerMove = function(d, page){
  var st = this.ui.reader; if (!st) return false;
  var step = page ? Math.max(1, num(this.lastReaderBodyH, 12)) : 1;
  st.scroll = clamp(num(st.scroll, 0) + d * step, 0, Math.max(0, st.rows.length - 1));
  return true;
};
Game.prototype.readerLog = function(){
  var out = [{ text: '【日志全文】', fg: 'accent' }];
  var L = this.world.log || [];
  for (var i = 0; i < L.length; i++){ var e = L[i] || {}; out.push({ text: str(e.text, ''), fg: str(e.level, 'ui') }); }
  if (!L.length) out.push({ text: '（还没有日志。）', fg: 'ui_dim' });
  return out;
};
Game.prototype.readerOrders = function(){
  var out = [{ text: '【任务与指令进度】', fg: 'accent' }];
  var ms = asList(this.space.missions), any = false;
  for (var i = 0; i < ms.length; i++){
    var m = ms[i] || {}, pr = m.progress;
    if (!pr || !pr.counter) continue;
    any = true;
    var cur = num(this.world.counters[pr.counter], 0), tgt = num(pr.target, 1);
    var pct = Math.max(0, Math.min(100, Math.round(cur / Math.max(1, tgt) * 100)));
    var bars = Math.round(pct / 5), bar = '';
    for (var b = 0; b < 20; b++) bar += (b < bars ? '#' : '.');
    out.push({ text: ' ' + str(m.name, m.id) + '  ' + cur + '/' + tgt + '  [' + bar + '] ' + pct + '%', fg: pct >= 100 ? 'good' : 'ui' });
    if (m.objective) out.push({ text: '   目标：' + str(m.objective), fg: 'ui_dim' });
  }
  if (!any) out.push({ text: '（还没有带进度的任务；给 missions 加 progress:{counter,target} 即可。）', fg: 'ui_dim' });
  return out;
};
Game.prototype.refreshView = function(){
  var st = this.ui.view; if (!st) return;
  var def = st.def || this.idx.views[st.id] || {};
  st.def = def;
  st.title = str(def.title, st.id);
  st.lines = this.buildViewLines(def);
  st.actions = this.buildViewActions(def);
  st.rows = [];
  for (var i = 0; i < st.lines.length; i++) if (st.lines[i] && st.lines[i].selectable) st.rows.push(i);
  st.cursor = clamp(num(st.cursor, 0), 0, Math.max(0, st.rows.length - 1));
  st.scroll = clamp(num(st.scroll, 0), 0, Math.max(0, st.lines.length - 1));
};
Game.prototype.buildViewLines = function(def){
  var out = [], self = this;
  function push(x){
    if (x === undefined || x === null) return;
    if (Array.isArray(x)){ for (var i = 0; i < x.length; i++) push(x[i]); return; }
    out.push(isObj(x) ? x : { text: str(x) });
  }
  /* 静态 lines 也要过模板：否则 "裂隙接触者观察：{counters.rift_touched} 人"
     会把花括号原样画给玩家（P0 真机验证发现）。 */
  function pushLine(x){
    if (x === undefined || x === null) return;
    if (Array.isArray(x)){ for (var i = 0; i < x.length; i++) pushLine(x[i]); return; }
    if (isObj(x)){
      var o = {}; for (var k in x) if (has(x, k)) o[k] = x[k];
      o.text = tpl(str(x.text, ''), self.tplCtx({}));
      out.push(o); return;
    }
    out.push({ text: tpl(str(x), self.tplCtx({})) });
  }
  if (def.provider && viewProviders[def.provider]){
    try { push(viewProviders[def.provider](this, def) || []); }
    catch (e){ push({ text: '视图提供者出错：' + e.message, fg: 'danger' }); }
    return out;
  }
  if (Array.isArray(def.lines)) pushLine(def.lines);
  if (def.list) this.buildViewList(def.list, out);
  var secs = Array.isArray(def.sections) ? def.sections : [];
  for (var i = 0; i < secs.length; i++){
/* 段落级 provider：一个终端可以把「活数据」和静态文案混着排 */
    var sec = secs[i] || {};
    if (sec.title) out.push({ text: sec.title, fg: str(sec.titleFg, 'accent') });
    if (sec.provider && viewProviders[sec.provider]){
      try { push(viewProviders[sec.provider](this, sec) || []); }
      catch (e){ push({ text: '视图提供者出错：' + e.message, fg: 'danger' }); }
    }
    if (Array.isArray(sec.lines)) pushLine(sec.lines);
    if (sec.source){
      var rows = getPath(this.scope(), sec.source, []);
      if (!Array.isArray(rows)) rows = rows ? [rows] : [];
      var shown = 0;
      for (var r = 0; r < rows.length; r++){
        var ctx = this.tplCtx({ row: rows[r], i: r, index: r, n: r + 1 });
        if (sec.rowCondition && !check(this, sec.rowCondition, ctx)) continue;
        out.push({ text: tpl(str(sec.rowTemplate, '{row}'), ctx), fg: str(sec.rowFg, 'ui') });
        shown++;
        if (sec.maxRows && shown >= num(sec.maxRows, 999)) break;
      }
      if (!shown && sec.empty) out.push({ text: str(sec.empty), fg: 'ui_dim' });
    }
  }
  if (def.source){
    var rows2 = getPath(this.scope(), def.source, []);
    if (!Array.isArray(rows2)) rows2 = rows2 ? [rows2] : [];
    for (var r2 = 0; r2 < rows2.length; r2++){
      var ctx2 = this.tplCtx({ row: rows2[r2], i: r2, index: r2 });
      out.push({ text: tpl(str(def.rowTemplate, '{row}'), ctx2), fg: str(def.rowFg, 'ui') });
    }
  }
  if (def.empty && !out.length) out.push({ text: str(def.empty), fg: 'ui_dim' });
  return out;
};
Game.prototype.buildViewList = function(spec, out){
  var rows = getPath(this.scope(), spec.source, []);
  if (!Array.isArray(rows)) rows = rows ? [rows] : [];
  var shown = 0;
  for (var i = 0; i < rows.length; i++){
    var ctx = this.tplCtx({ row: rows[i], i: i, index: i, n: i + 1 });
    if (spec.rowCondition && !check(this, spec.rowCondition, ctx)) continue;
    out.push({ text: tpl(str(spec.rowTemplate, '{row}'), ctx), fg: str(spec.rowFg, 'ui'),
               row: rows[i], rowIndex: i, selectable: spec.selectable !== false });
    shown++;
    if (spec.maxRows && shown >= num(spec.maxRows, 999)) break;
  }
  if (!shown && spec.empty) out.push({ text: str(spec.empty), fg: 'ui_dim' });
  return shown;
};
Game.prototype.buildViewActions = function(def){
  var out = [], acts = isArr(def.actions) ? def.actions : [];
  for (var i = 0; i < acts.length; i++){
    var a = acts[i]; if (!a) continue;
    if (!check(this, a.condition, {})) continue;
    if (a.cost && !this.canPay(a.cost)) continue;
    out.push(a);
  }
  return out;
};
Game.prototype.viewChoose = function(i){
  var st = this.ui.view; if (!st) return false;
  var a = st.actions[i]; if (!a) return false;
  this.ui.flash = null;
  if (a.cost && !this.payCost(a.cost)){ this.log('条件不足。', 'warn'); this.setFlash(); return false; }
  var logN = (this.world.log || []).length;
  runEffects(this, a.effects, { view: st.id, action: i });
  this.setFlash(logN);
  if (this.ui.view === st) this.refreshView();
  return true;
};
Game.prototype.viewSelect = function(){
  var st = this.ui.view; if (!st || !st.rows || !st.rows.length) return false;
  var def = st.def || this.idx.views[st.id] || {};
  var line = st.lines[st.rows[st.cursor]];
  if (!line) return false;
  var ctx = this.tplCtx({ row: line.row, index: line.rowIndex });
  var acts = (def.list && def.list.onSelect) || def.onSelect;
  if (!acts) return false;
  this.ui.flash = null;
  var logN = (this.world.log || []).length;
  runEffects(this, acts, ctx);
  this.setFlash(logN);
  if (this.ui.view === st) this.refreshView();
  return true;
};
Game.prototype.viewMove = function(d){
  var st = this.ui.view; if (!st || !st.rows || !st.rows.length) return false;
  st.cursor = clamp(num(st.cursor, 0) + d, 0, st.rows.length - 1);
  var def = this.idx.views[st.id] || {};
  var bodyH = Math.max(3, num(this.lastViewBodyH, 12));
  var at = st.rows[st.cursor];
  if (at < st.scroll) st.scroll = at;
  if (at >= st.scroll + bodyH) st.scroll = at - bodyH + 1;
  return true;
};

/* ============================== 12  事件与投影 ============================== */
/* 事件链推进：eventChains[].steps 是有顺序的事件 id。
   world.chains[链id] = { step, done }；一条链同一时刻只放行「当前这一步」的事件。
   一步算走完 = 这一步的事件对话玩家已经打开过（world.seenDialogues）。
   每 tick 每条链最多推进一步，不会一 tick 把整条链抖出来。 */
Game.prototype.chainIndex = function(){
  var idx = this.idx;
  if (idx._chainStep) return idx._chainStep;
  var m = idx._chainStep = {}, ch = idx.chains || {};
  for (var cid in ch){
    var c = ch[cid], steps = (c && c.steps) || [];
    for (var i = 0; i < steps.length; i++) if (m[steps[i]] === undefined) m[steps[i]] = { chain: cid, index: i };
  }
  return m;
};
Game.prototype.stepChains = function(){
  var ch = this.idx.chains || {}, w = this.world;
  if (!w.chains) w.chains = {};
  for (var cid in ch){
    var c = ch[cid];
    if (!c || !isArr(c.steps) || !c.steps.length) continue;
    var st = w.chains[cid] || (w.chains[cid] = { step: 0 });
    var step = clamp(num(st.step, 0), 0, c.steps.length);
    if (step >= c.steps.length){ st.done = true; continue; }
    var ev = this.idx.events[c.steps[step]];
    var seen = ev && ev.dialogue ? !!w.seenDialogues[ev.dialogue] : !!w.firedRules['ev:' + c.steps[step]];
    if (seen){
      st.step = step + 1; st.done = st.step >= c.steps.length;
      if (st.done) logEvent(this, '事件链「' + str(c.name, cid).trim() + '」走到头了。', 'good');
    }
  }
};
/* 危机阶段：crisisStages 块上写 counter（驱动计数器，比如 pollution），
   列表里每个阶段写 threshold；引擎按「counter 从低到高」依次触发还没触发的阶段。
   阶段里的 events = 要触发的（events 块里的）事件 id；onEnter = 进入这一阶段时跑的效果。
   引擎不知道危机是什么内容  计数器名和阶段内容都在数据里。 */
Game.prototype.triggerEvent = function(id){
  var ev = this.idx.events[id];
  if (!ev) return false;
  if (this.world.pending[id]) return false;
  this.world.pending[id] = true;
  if (ev.once !== false) this.world.firedRules['ev:' + id] = true;
  if (ev.effects) runEffects(this, ev.effects, { eventId: id });
  return true;
};
Game.prototype.stepCrisis = function(){
  var block = this.space.crisisStages, stages = asList(block);
  if (!stages.length) return;
  var driver = str(block && block.counter, '');
  if (!driver) return;                       /* 没写驱动计数器就不跑，别猜 */
  var val = num(this.world.counters[driver], 0), cur = -1;
  for (var i = 0; i < stages.length; i++) if (val >= num(stages[i].threshold, 0)) cur = i;
  if (cur < 0) return;
  var w = this.world;
  if (!w.crisis) w.crisis = { stage: -1 };
  var at = num(w.crisis.stage, -1);
  if (cur <= at) return;                     /* 危机只进不退 */
  for (var k = at + 1; k <= cur; k++){
    var st = stages[k] || {};
    w.crisis.stage = k;
    w.flags.crisis_stage = str(st.id, 'crisis_' + (k + 1));
    w.flags.crisis_level = k + 1;
    logEvent(this, '危机进入「' + str(st.name, st.id) + '」。', 'warn');
    var ids = isArr(st.events) ? st.events : [];
    for (var e = 0; e < ids.length; e++) this.triggerEvent(ids[e]);
    runEffects(this, st.onEnter, { crisis: st.id, stage: k });
  }
};
Game.prototype.checkEvents = function(){
  var list = asList(this.space.events);
  for (var i = 0; i < list.length; i++){
    var ev = list[i]; if (!ev || !ev.id) continue;
    /* 事件链 gating：不在当前这一步的事件先不放行 */
    var cLoc = this.chainIndex()[ev.id];
    if (cLoc){
      var cSt = this.world.chains && this.world.chains[cLoc.chain];
      if ((cSt ? num(cSt.step, 0) : 0) !== cLoc.index) continue;
    }
    if (this.world.pending[ev.id]) continue;
    if (ev.once !== false && this.world.firedRules['ev:' + ev.id]) continue;
    if (ev.minTick && this.world.tick < num(ev.minTick, 0)) continue;
    if (ev.every && (this.world.tick % num(ev.every, 1)) !== 0) continue;
    if (!check(this, ev.condition, { eventId: ev.id })) continue;
    this.world.pending[ev.id] = true;
    if (ev.once !== false) this.world.firedRules['ev:' + ev.id] = true;
    if (ev.effects) runEffects(this, ev.effects, { eventId: ev.id });
  }
};
Game.prototype.projectValue = function(pj){
  var val = getPath(this.scope(), pj.from, pj.default);
  var out = { value: val, ch: str(pj.ch, ''), fg: str(pj.fg, 'ui'), bg: str(pj.bg, ''), text: '' };
  if (isObj(pj.map)){
    var m = pj.map[String(val)] || pj.map['*'];
    if (m){
      if (typeof m === 'string') out.ch = m;
      else { if (m.ch !== undefined) out.ch = m.ch; if (m.fg !== undefined) out.fg = m.fg; if (m.bg !== undefined) out.bg = m.bg; if (m.text !== undefined) out.text = m.text; }
    }
  }
  if (pj.scale && isArr(pj.scale)){
    var idx = clamp(Math.floor(num(val, 0)), 0, pj.scale.length - 1);
    out.ch = str(pj.scale[idx], out.ch);
  }
  if (pj.text) out.text = tpl(str(pj.text), this.tplCtx({ value: val }));
  return out;
};
Game.prototype.applyProjections = function(){
  var list = asList(this.space.projections);
  this.world.proj = this.world.proj || {};
  for (var i = 0; i < list.length; i++){
    var pj = list[i]; if (!pj) continue;
    var v = this.projectValue(pj);
    if (pj.id) this.world.proj[pj.id] = v;
    var tg = pj.target;
    if (tg && tg.scene && tg.x !== undefined && tg.y !== undefined){
      var tdef = { ch: v.ch };
      if (v.fg) tdef.fg = v.fg;
      if (v.bg) tdef.bg = v.bg;                    /* 没写就保留原来那格的颜色，别刷黑 */
      this.setTile(tg.scene, num(tg.x, 0), num(tg.y, 0), tdef);
    }
  }
};
Game.prototype.setFlag = function(k, v){ this.world.flags[k] = v === undefined ? true : v; };
Game.prototype.getFlag = function(k){ return !!this.world.flags[k]; };
Game.prototype.onPlayerDeath = function(reason){
  var p = this.world.player;
  p.dead = true; p.stats.hp = 0;
  this.world.gameOver = { result: 'defeat', reason: str(reason, '你倒下了。') };
  this.log('你倒下了。', 'danger');
};

/* ============================== 13  存档 ============================== */
Game.prototype.serialize = function(){
  var w = this.world, fog = {};
  for (var k in w.fog){
    var arr = w.fog[k], s = '';
    for (var i = 0; i < arr.length; i++) s += String.fromCharCode(48 + (arr[i] | 0));
    fog[k] = s;
  }
  return {
    v: SAVE_VERSION, spec: str(this.space._version, this.space.version || '1'), savedAt: w.tick,
    tick: w.tick, flags: clone(w.flags), counters: clone(w.counters), items: clone(w.items),
    known: clone(w.known), visited: clone(w.visited), seenDialogues: clone(w.seenDialogues), seenViews: clone(w.seenViews),
    firedRules: clone(w.firedRules), pending: clone(w.pending), builds: clone(w.builds), chains: clone(w.chains), crisis: clone(w.crisis), galaxy: clone(w.galaxy),
    tileOverrides: clone(w.tileOverrides), npcPos: clone(w.npcPos), npcPosts: clone(w.npcPosts),
    fleetMv: clone(w.fleetMv || null),      /* 主力舰队在星图上的位置（第 1 期）*/
    rng: (isFn(this.rng.state) ? this.rng.state() : 0),
    fog: fog, player: clone(w.player), log: w.log.slice(-80), hint: w.hint, hintUntil: w.hintUntil,
    tutStep: w.tutStep, gameOver: w.gameOver, lastAuto: w.lastAuto,
    mods: (this.report.mods || []).map(function(m){ return m.id; })
  };
};
Game.prototype.deserialize = function(o){
  if (!o || !isObj(o)) return false;
  var w = this.world;
  if (num(o.v, 1) > SAVE_VERSION) this.warn('存档版本 v' + o.v + ' 比内核（v' + SAVE_VERSION + '）新，只能读认出认识的部分');
  w.tick = num(o.tick, w.tick);
  var keys = ['flags','counters','items','known','visited','seenDialogues','firedRules','seenViews','pending','builds','tileOverrides','npcPos','npcPosts','chains','crisis','galaxy','fleetMv'];
  for (var i = 0; i < keys.length; i++) w[keys[i]] = clone(o[keys[i]] || {});
  /* 老存档缺了新加的计数器：用 initialState 兜底，别让新规则把 undefined 当成 0（会误判败北）*/
  var initC = getPath(this.space, 'initialState.counters', {}) || {};
  for (var ic in initC) if (has(initC, ic) && w.counters[ic] === undefined) w.counters[ic] = num(initC[ic], 0);
  w.fog = {};
  var src = o.fog || {};
  for (var k in src){
    var s = String(src[k]), arr = new Uint8Array(s.length);
    for (var j = 0; j < s.length; j++) arr[j] = Math.max(0, s.charCodeAt(j) - 48);
    w.fog[k] = arr;
  }
  if (o.player) w.player = deepMerge(w.player, o.player);
  if (isArr(o.log)) w.log = o.log;
  w.hint = str(o.hint, ''); w.hintUntil = num(o.hintUntil, 0);
  w.tutStep = num(o.tutStep, 0); w.gameOver = o.gameOver || null; w.lastAuto = str(o.lastAuto, '');
  if (o.rng !== undefined && isFn(this.rng.setState)) this.rng.setState(o.rng);
  /* 存档迁移：space.saveMigrations = [{from, to, effects}]，按版本号一档一档往上跑 */
  var fromV = num(o.v, 1);
  if (fromV < SAVE_VERSION){
    var migs = asList(this.space.saveMigrations), guard = 0;
    while (fromV < SAVE_VERSION && guard++ < 50){
      var mig = null;
      for (var mi = 0; mi < migs.length; mi++) if (num(migs[mi].from, -1) === fromV){ mig = migs[mi]; break; }
      if (!mig) break;
      runEffects(this, mig.effects, { migration: str(mig.id, fromV + '>' + mig.to), from: fromV, to: num(mig.to, fromV + 1) });
      logEvent(this, '存档已迁到 v' + num(mig.to, fromV + 1) + '。', 'dim');
      fromV = num(mig.to, fromV + 1);
    }
    if (fromV < SAVE_VERSION) this.warn('找不到 v' + fromV + ' 的存档迁移规则（space.saveMigrations），按现状读。');
  }
  this.ui.dialogue = null; this.ui.view = null; w.path = null;
  /* 内容改过之后老存档可能指向已经不存在的场景（比如卸了那个 mod）  别把玩家扔在地图外 */
  if (!this.idx.scenes[w.player.scene]){
    var fallback = str(this.cfg.startScene, '') || (asList(this.space.scenes)[0] || {}).id;
    var fg2 = this.grid(fallback);
    var fpos = (fg2 && fg2.spawn) || this.findFreeCell(fallback);
    this.warn('存档里的场景 ' + w.player.scene + ' 不存在了，已回到 ' + fallback);
    w.player.scene = fallback; w.player.x = fpos.x; w.player.y = fpos.y;
    logEvent(this, '这个存档来自另一份内容：找不到原来的场景，你回到了' + this.sceneName(fallback) + '。', 'warn');
  }
  /* 存档记的 mod 列表和当前不一样：说一声，别让人对着「怎么变样了」发呆 */
  if (isArr(o.mods) && this.report && isArr(this.report.mods)){
    var was = o.mods.slice().sort().join(','), now = this.report.mods.map(function(m){ return m.id; }).sort().join(',');
    if (was !== now) logEvent(this, '注意：存档当时的 mod 是 [' + was + ']，现在是 [' + now + ']。', 'warn');
  }
  this.updateVision();
  this.applyProjections();        /* 投影是派生量：读档后立刻按新 counters 重算 */
  return true;
};
/* ============================== 13b  换内容接着玩 ==============================
 * 装 mod / 改内容之后不必重开：把新的 built 装进正在跑的 Game，世界状态留着。
 *   场景没了 -> 回到起始场景；人没了 -> 摘掉；位置不在可走格上 -> 挪到出生点/空位。
 *   待上报事件/建造/地块覆写指向不存在的东西 -> 清掉。
 * ========================================================================== */
Game.prototype.reloadContent = function(built){
  if (!built || !built.space || !built.idx) return false;
  this.space = built.space; this.idx = built.idx;
  if (built.report) this.report = built.report;
  this.cfg = this.space.config || {};
  this.palette = this.space.palette || {};
  this.presets = this.space.presets || {};
  this.idx.events = byId(asList(this.space.events));
  this.idx.chains = byId(asList(this.space.eventChains));
  var w = this.world;
  if (!this.idx.scenes[w.player.scene]){
    var fb = str(this.cfg.startScene, '') || (asList(this.space.scenes)[0] || {}).id;
    var fg2 = this.grid(fb), fp2 = (fg2 && fg2.spawn) || this.findFreeCell(fb);
    this.warn('内容换了：原来的场景 ' + w.player.scene + ' 不在了，你回到了 ' + fb);
    w.player.scene = fb; w.player.x = fp2.x; w.player.y = fp2.y;
    logEvent(this, '内容变了：原来的地方找不到了，你回到了' + this.sceneName(fb) + '。', 'warn');
  } else if (!this.isPassable(w.player.scene, w.player.x, w.player.y)){
    var pg2 = this.grid(w.player.scene), pp2 = (pg2 && pg2.spawn) || this.findFreeCell(w.player.scene);
    w.player.x = pp2.x; w.player.y = pp2.y;
    logEvent(this, '内容变了：你原来站的格子现在过不去，换到了旁边。', 'dim');
  }
  var pos = w.npcPos, nids = Object.keys(pos);
  for (var ni = 0; ni < nids.length; ni++)
    if (!this.idx.npcs[nids[ni]]){ delete pos[nids[ni]]; delete w.npcPosts[nids[ni]]; delete w.npcPaths[nids[ni]]; }
  this.updateSchedules();
  var pend = Object.keys(w.pending);
  for (var pi = 0; pi < pend.length; pi++) if (!this.idx.events[pend[pi]]) delete w.pending[pend[pi]];
  for (var ck in w.chains) if (!this.idx.chains[ck]) delete w.chains[ck];
  var bl = Object.keys(w.builds);
  for (var bi = 0; bi < bl.length; bi++) if (w.builds[bi] && !this.idx.scenes[w.builds[bi].scene]) delete w.builds[bi];
  var ov = Object.keys(w.tileOverrides);
  for (var oi = 0; oi < ov.length; oi++) if (!this.idx.scenes[String(ov[oi]).split(':')[0]]) delete w.tileOverrides[ov[oi]];
  w.npcPaths = {};
  w.path = null;
  this.updateVision();
  this.applyProjections();
  logEvent(this, '内容已热加载（世界状态保留）。', 'good');
  return true;
};

/* ============================== 14  屏幕合成（CDDA 式字符网格） ==============================
 * 内核把世界 + UI 全部合成成一张字符网格；渲染器只负责刷格子。
 * 每个格子都是【单字符 + 前景色 + 独立背景色块】，零贴图、零 emoji。
 * ====================================================================== */
var WIDE_MARK = '\u0000';
var _shadeCache = {};
function charW(ch){
  var c = ch.charCodeAt(0);
  if (c < 0x1100) return 1;
  return ((c >= 0x1100 && c <= 0x115F) || (c >= 0x2E80 && c <= 0xA4CF) || (c >= 0xAC00 && c <= 0xD7A3) ||
          (c >= 0xF900 && c <= 0xFAFF) || (c >= 0xFE30 && c <= 0xFE6F) || (c >= 0xFF00 && c <= 0xFF60) ||
          (c >= 0xFFE0 && c <= 0xFFE6) || (c >= 0x20000 && c <= 0x3FFFD)) ? 2 : 1;
}
function strW(s){ s = str(s); var w = 0; for (var i = 0; i < s.length; i++) w += charW(s.charAt(i)); return w; }
function cutW(s, width){
  s = str(s); var w = 0, out = '';
  for (var i = 0; i < s.length; i++){
    var cw = charW(s.charAt(i));
    if (w + cw > width) break;
    out += s.charAt(i); w += cw;
  }
  return out;
}
function wrapText(text, width){
  var out = [], paras = str(text).split('\n');
  for (var p = 0; p < paras.length; p++){
    var para = paras[p], cur = '', w = 0;
    for (var i = 0; i < para.length; i++){
      var ch = para.charAt(i), cw = charW(ch);
      if (w + cw > width && cur.length){ out.push(cur); cur = ''; w = 0; }
      cur += ch; w += cw;
    }
    out.push(cur);
  }
  return out;
}
/* 覆盖 Screen 的写字方法：中文按 2 格宽推进，多余半格留空标记 */
Screen.prototype.text = function(x, y, text, fg, bg){
  text = str(text); var cx = x;
  for (var i = 0; i < text.length; i++){
    var ch = text.charAt(i);
    if (ch === '\n') break;
    var w = charW(ch);
    this.set(cx, y, ch, fg, bg);
    if (w === 2) this.set(cx + 1, y, WIDE_MARK, fg, bg);
    cx += w;
  }
  return cx;
};
Screen.prototype.textRight = function(xRight, y, text, fg, bg){
  text = str(text);
  return this.text(xRight - strW(text) + 1, y, text, fg, bg);
};
Screen.prototype.center = function(x, y, w, text, fg, bg){
  text = str(text);
  return this.text(x + Math.max(0, Math.floor((w - strW(text)) / 2)), y, text, fg, bg);
};
Screen.prototype.boxTitle = function(x, y, title, fg, bg){
  if (!title) return;
  this.text(x + 2, y, ' ' + str(title) + ' ', fg, bg);
};

Game.prototype.screenToScene = function(sx, sy){
  var cam = this._cam; if (!cam) return null;
  var wx = (cam.winX === undefined) ? 0 : cam.winX, wy = (cam.winY === undefined) ? cam.top : cam.winY;
  var ww = (cam.winW === undefined) ? cam.w : cam.winW, wh = (cam.winH === undefined) ? cam.h : cam.winH;
  var ox = num(cam.originX, 0), oy = num(cam.originY, 0);
  if (sx < wx || sx >= wx + ww || sy < wy || sy >= wy + wh) return null;
  var mx = (sx - wx) - ox, my = (sy - wy) - oy;
  var g = this.grid(this.world.player.scene);
  if (!g || mx < 0 || my < 0 || mx >= g.w || my >= g.h) return null;
  return { x: mx, y: my };
};
Game.prototype.resize = function(w, h){
  this.screenW = Math.max(40, w | 0); this.screenH = Math.max(18, h | 0);
  this.screen = new Screen(this.screenW, this.screenH, this.palette);
  /* 屏幕模式：'scene' = 可走的房间；'galaxy' = 星图（战略层）。见 renderGalaxy。 */
  this.screenMode = 'scene';
  this.galaxyCur = null;        // 星图光标（吸附到星系 id）
};
Game.prototype.col = function(name, fallback){
  return resolveColor(name, this.palette, fallback);
};
Game.prototype.dim = function(name, f){
  var key = str(name) + '@' + f;
  if (_shadeCache[key] === undefined) _shadeCache[key] = shade(this.col(name, '#000000'), f);
  return _shadeCache[key];
};
Game.prototype.speedLabel = function(){
  var sp = num(this.speed, 1);
  return sp === 0 ? '\u2016 暂停' : ('\u25b6 ' + sp + 'x');
};
Game.prototype.logLine = function(e){
  var t = num(e.t, 0), h = Math.floor((t % DAY) / HOUR), m = t % HOUR;
  return '[' + (h < 10 ? '0' : '') + h + ':' + (m < 10 ? '0' : '') + m + '] ' + str(e.text);
};

/* ---------------- 布局 ----------------
 * 宽屏：标题 / 状态 / 地图 + 右侧栏(日志)
 * 窄屏：标题 / 状态 / 地图 / 日志（日志在下方）
 * 侧栏模式把纵向空间全留给地图，地图能大 30% 以上。
 * ------------------------------------------------------------------ */
/* 固定视口（viewW x viewH）：字号、分栏、相机都以它为准，跟当前场景多大无关。
   来源：config.viewW / config.viewH -> config.mapDesignCols/Rows（旧名）-> 全部场景的最大宽高。
   旧存档没有这个字段时按这条链推导，不会炸。 */
Game.prototype.getViewSize = function(){
  var cfg = this.cfg || {};
  var w = num(cfg.viewW, 0) || num(cfg.mapDesignCols, 0);
  var h = num(cfg.viewH, 0) || num(cfg.mapDesignRows, 0);
  if (!w || !h){
    var list = asList(this.space.scenes), mw = 0, mh = 0;
    for (var i = 0; i < list.length; i++){
      var sz = (list[i] || {}).size || {};
      mw = Math.max(mw, num(sz.w, 0)); mh = Math.max(mh, num(sz.h, 0));
    }
    w = w || mw; h = h || mh;
  }
  this.viewW = Math.max(24, w | 0); this.viewH = Math.max(12, h | 0);
  return { w: this.viewW, h: this.viewH };
};
/* 固定取景框：字号按这个框算，而不是按当前场景算。
   否则一换场景（房间 60x22 -> 大厅 64x36 -> 地表 88x28）字号就跳，画面会「割裂」。
   框的大小来自 config.mapDesignCols/Rows；没写就取全部场景的最大宽高。 */
Game.prototype.designBox = function(){ return this.getViewSize(); };   /* 旧名，保留兼容 */
Game.prototype.layout = function(){
  var W = this.screenW, H = this.screenH;
  var logRows = clamp(num(this.cfg.logRows, 3), 1, 6);
  var view = this.getViewSize();           /* 固定视口：分栏与否不随场景变 */
  var side = (view.w >= 70 && view.h >= 18) ? clamp(Math.round(W * 0.26), 24, 42) : 0;
  /* 开了侧栏就得保证地图区放得下整个视口，否则宁可不分栏 */
  if (side && (W - side - 1) < view.w) side = 0;
  var mapTop = 2;                                  /* 0 标题  1 状态 */
  var mapW = side ? (W - side - 1) : W;
  var mapH = side ? Math.max(4, H - mapTop) : Math.max(4, H - mapTop - 1 - logRows);
  /* 视口窗口：在地图区里居中；比地图区还大就取地图区 */
  var winW = Math.min(view.w, mapW), winH = Math.min(view.h, mapH);
  var winX = Math.floor((mapW - winW) / 2), winY = mapTop + Math.floor((mapH - winH) / 2);
  return { W: W, H: H, side: side, sideX: side ? mapW : -1, mapW: mapW,
           mapTop: mapTop, mapH: mapH, logRows: logRows,
           viewW: view.w, viewH: view.h, winX: winX, winY: winY, winW: winW, winH: winH,
           chromeRows: side ? mapTop : (mapTop + 1 + logRows) };
};

/* ---------------- 教学 ----------------
 * 内容里只写「这一步什么时候算完成」和「这一步要说什么」，
 * 内核负责：完成了就推进，推进了就把 hint 顶到状态行。没有任何弹窗。
 * ------------------------------------------------------------------ */
Game.prototype.tutorialSteps = function(){
  var steps = getPath(this.space, 'tutorial.steps', []);
  return isArr(steps) ? steps : [];
};
Game.prototype.stepTutorial = function(){
  var steps = this.tutorialSteps();
  if (!steps.length) return;
  var i = clamp(num(this.world.tutStep, 0), 0, steps.length);
  if (i >= steps.length) return;
  var cur = steps[i];
  if (!cur) return;
  var key = 'tut:' + i;
  if (cur.hint && !this.world.firedRules[key]){
    this.world.firedRules[key] = true;
    this.world.hint = str(cur.hint);
    this.world.hintUntil = this.world.tick + num(this.cfg.tutorialHintTicks, 1200);
  }
  if (cur.done && check(this, cur.done, {})) this.world.tutStep = i + 1;
};

/* ---------------- 主渲染 ---------------- */
/* ============================== 星图模式（第 1 期）==============================
 * 场景层是**可走的房间**；星图层不是 —— 它是战略层。所以这里不复用场景网格，
 * 而是复用**同一块 Screen 和同一套 layout()**，只换"画什么"：
 *     render() 入口分流 -> renderGalaxy() -> 还是 out.paint(screen)
 * 好处：信息栏、日志栏、字号自适应、手机视口、视野计算全都不用改一行。
 *
 * 光标**吸附到星系上**（不是自由二维光标）：方向键做"朝那个方向的最近星系"选择。
 * 手机上只有十字键，吸附比自由光标好用得多，而且永远有一个合法的选中项。
 */
Game.prototype.galaxyNodes = function(){
  var out = [], list = asList(this.space && this.space.galaxy && this.space.galaxy.nodes);
  var over = this.world.galaxy || {};
  for (var i = 0; i < list.length; i++){
    var n = list[i] || {}; if (!n.id) continue;
    var o = over[n.id] || {};
    out.push({
      id: n.id, name: str(n.name, n.id),
      x: num(n.x, 0), y: num(n.y, 0),
      owner: (o.owner !== undefined) ? o.owner : str(n.owner, '?'),
      fleets: num((o.fleets !== undefined) ? o.fleets : n.fleets, 0),
      pollution: num((o.pollution !== undefined) ? o.pollution : n.pollution, 0),
      links: isArr(n.links) ? n.links.slice() : [],   /* 复制：下面要补对称，不能改到内容 */
      mark: str(n.mark, '*'), desc: str(n.desc, '')
    });
  }
  /* 航道是**无向**的，但 mod 只会写自己那半边（新星系连到老星系，老星系那边不知道）。
     这里补齐对称 —— 否则舰队从 A 看得到 B、从 B 看不到 A，寻路会单向。 */
  var by = {};
  for (i = 0; i < out.length; i++) by[out[i].id] = out[i];
  for (i = 0; i < out.length; i++){
    for (var j = 0; j < out[i].links.length; j++){
      var other = by[out[i].links[j]];
      if (other && other.links.indexOf(out[i].id) < 0) other.links.push(out[i].id);
    }
  }
  for (i = 0; i < out.length; i++) out[i].links.sort();
  return out;
};
Game.prototype.galaxyOwnerColor = function(owner){
  if (owner === 'player_remnant') return 'good';
  if (owner === 'abyss' || owner === 'iron_chorus' || owner === 'silent_order') return 'danger';
  if (owner === 'veil_pact' || owner === 'alpha_traders') return 'accent';
  if (owner === 'free_miners' || owner === 'scavenger_league') return 'npc2';
  return 'ui_dim';
};
/* 星系坐标 -> 屏幕格子。等比缩放 + 撞位顺推，保证任何窗口尺寸下都不重叠。 */
Game.prototype.galaxyProject = function(lay){
  var ns = this.galaxyNodes();
  var out = {}, i;
  if (!ns.length) return out;
  var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (i = 0; i < ns.length; i++){
    if (ns[i].x < x0) x0 = ns[i].x; if (ns[i].x > x1) x1 = ns[i].x;
    if (ns[i].y < y0) y0 = ns[i].y; if (ns[i].y > y1) y1 = ns[i].y;
  }
  var padX = 3, padY = 2;
  var wx = lay.winX + padX, wy = lay.winY + padY;
  var ww = Math.max(8, lay.winW - padX * 2), wh = Math.max(6, lay.winH - padY - 1);
  var spanX = Math.max(1, x1 - x0), spanY = Math.max(1, y1 - y0);
  /* **等比缩放**：把 x 和 y 按同一个比例放，坐标系才不变形。
     一开始图省事把 x 铺满、y 也铺满 —— 纵向被压扁 40%，星系挤到同一行，
     长航道斜着穿过整张图，糊成一团。等比之后地图是居中的一块，
     手机视口是竖的（40x44），等比刚好占满，比拉伸好看也好读。 */
  var sc = Math.min((ww - 1) / spanX, (wh - 1) / spanY);
  /* 等比之后如果还是宽的窗口，允许横向拉伸最多 2.2 倍 —— 宽屏上等比会只占两成宽度（浪费），
     但拉过头坐标系就变形、长航道又开始穿越。2.2 是试出来的折中：手机竖屏用不到（本来就等比），
     桌面宽屏能把地图铺开七成。 */
  var sx = sc * Math.min(2.2, Math.max(1, (ww - 1) / Math.max(1, spanX * sc)));
  var sy = sc;
  var usedW = Math.round(spanX * sx), usedH = Math.round(spanY * sy);
  wx += Math.max(0, Math.floor((ww - usedW) / 2));
  wy += Math.max(0, Math.floor((wh - usedH) / 2));
  var occ = {};
  var sorted = ns.slice().sort(function(a, b){ return (a.y - b.y) || (a.x - b.x); });
  for (i = 0; i < sorted.length; i++){
    var n = sorted[i];
    var px = wx + Math.round((n.x - x0) * sx);
    var py = wy + Math.round((n.y - y0) * sy);
    var guard = 0;
    while (occ[px + ',' + py] && guard < wh){    // 撞位就往下顺推，推不动往上找
      py += 1; guard++;
      if (py > wy + wh - 1) py = wy + Math.round((n.y - y0) * sy) - guard;
    }
    if (py < wy) py = wy;
    if (py > wy + wh - 1) py = wy + wh - 1;
    if (px < wx) px = wx;
    if (px > wx + ww - 1) px = wx + ww - 1;
    occ[px + ',' + py] = n.id;
    out[n.id] = { x: px, y: py };
  }
  return out;
};
Game.prototype.galaxyNode = function(id){
  var ns = this.galaxyNodes();
  for (var i = 0; i < ns.length; i++) if (ns[i].id === id) return ns[i];
  return null;
};
/* 朝 (dx,dy) 方向选下一个星系：投影越正、偏得越少，越优先 */
Game.prototype.galaxyMove = function(dx, dy){
  var proj = this.galaxyProject(this.layout());
  var cur = proj[this.galaxyCur];
  if (!cur){
    var ks = Object.keys(proj);
    if (!ks.length) return false;
    this.galaxyCur = ks[0]; return true;
  }
  var best = null;
  for (var id in proj){
    if (!has(proj, id) || id === this.galaxyCur) continue;
    var vx = proj[id].x - cur.x, vy = proj[id].y - cur.y;
    var along = vx * dx + vy * dy;
    if (along <= 0) continue;
    var across = Math.abs(vx * dy - vy * dx);
    var score = along + across * 2.5;
    if (best === null || score < best.s) best = { id: id, s: score };
  }
  if (!best) return false;
  this.galaxyCur = best.id;
  return true;
};
Game.prototype.galaxyLaneChar = function(dx, dy){
  if (dy === 0) return '-';
  if (dx === 0) return '|';
  return (dx * dy > 0) ? '\\' : '/';
};
Game.prototype.renderGalaxy = function(lay){
  var s = this.screen, ns = this.galaxyNodes(), proj = this.galaxyProject(lay), i, j;
  var wx = lay.winX, wy = lay.winY, ww = lay.winW, wh = lay.winH;
  s.fill(wx, wy, ww, wh, ' ', 'ui_dim', 'bg');
  var byId = {};
  for (i = 0; i < ns.length; i++) byId[ns[i].id] = ns[i];
  /* --- 航道：先画线，星系会盖在上面 --- */
  for (i = 0; i < ns.length; i++){
    var a = ns[i], pa = proj[a.id]; if (!pa) continue;
    for (j = 0; j < a.links.length; j++){
      var b = byId[a.links[j]]; if (!b || a.id > b.id) continue;
      var pb = proj[b.id]; if (!pb) continue;
      var steps = Math.max(Math.abs(pb.x - pa.x), Math.abs(pb.y - pa.y));
      if (steps <= 0) continue;
      var dxs = Math.sign(pb.x - pa.x), dys = Math.sign(pb.y - pa.y);
      var ch = this.galaxyLaneChar(dxs, dys);
      /* 光标所在星系的航道点亮，其余压暗 —— 一张 60 多个星系、90 条航道的图，
         全亮会糊成一团。玩家真正要看的是「我从这儿能去哪」。 */
      var hot = (a.id === this.galaxyCur || b.id === this.galaxyCur);
      var lfg = hot ? 'accent' : 'ui_dim';   /* palette 里没有 'lane' 键，写它会回退成亮灰 */
      for (var k = 1; k < steps; k++){
        var lx = pa.x + Math.round((pb.x - pa.x) * k / steps);
        var ly = pa.y + Math.round((pb.y - pa.y) * k / steps);
        if (lx === pa.x && ly === pa.y) continue;
        if (lx === pb.x && ly === pb.y) continue;
        s.set(lx, ly, ch, lfg, 'bg');
      }
    }
  }
  /* --- 星系 --- */
  for (i = 0; i < ns.length; i++){
    var n = ns[i], p = proj[n.id]; if (!p) continue;
    var fg = this.galaxyOwnerColor(n.owner);
    var cur = (n.id === this.galaxyCur);
    s.set(p.x, p.y, cur ? '+' : (n.id === 'sol' ? '@' : '*'), cur ? 'sel_fg' : fg, cur ? 'sel_bg' : 'bg');
    if (n.fleets > 0 && p.y + 1 < wy + wh) s.set(p.x, p.y + 1, '^', 'accent', 'bg');
  }
  /* 光标框**最后画**：按顺序画点的话，后画的相邻星系会把先画的 [ 或 ] 盖掉
     （撞位顺推允许两个星系贴在相邻列，实测真的盖掉过一个）。 */
  var cp = proj[this.galaxyCur];
  if (cp){
    if (cp.x - 1 >= wx) s.set(cp.x - 1, cp.y, '[', 'sel_fg', 'sel_bg');
    if (cp.x + 1 < wx + ww) s.set(cp.x + 1, cp.y, ']', 'sel_fg', 'sel_bg');
  }
  /* 主力舰队：移动中画在航道上（按 tick 插值），停下时画在所在星系 */
  var fp = this.fleetScreenPos(proj);
  if (fp && fp.x >= wx && fp.x < wx + ww && fp.y >= wy && fp.y < wy + wh){
    s.set(fp.x, fp.y, '\u25b2', 'accent_fg', this.fleetMoving() ? 'accent_bg' : 'bg');
  }
  /* --- 底部：选中星系的一句话 + 图例（记不住的东西就写在屏幕上）--- */
  var line = wy + wh - 1;
  var sel = this.galaxyNode(this.galaxyCur);
  s.hline(wx, line - 1, ww, '-', 'ui_dim', 'bg');
  if (sel){
    var txt = ' ' + sel.name + '　' + this.galaxyOwnerName(sel.owner) +
              '　航道 ' + sel.links.length + ' 条';
    if (sel.fleets) txt += '　舰队 ' + sel.fleets;
    if (sel.pollution) txt += '　污染 ' + sel.pollution;
    s.text(wx, line, cutW(txt, ww - 24), 'ui_bright', 'bg');
    /* 主力在哪 / 还有多久到 —— 常驻右下角，不用去翻面板 */
    var ftxt;
    if (this.fleetMoving()){
      var fm = Math.max(0, Math.ceil((this.world.fleetMv.t1 - this.world.tick) / 60));
      ftxt = '▲ ' + this.galaxyName(this.world.fleetMv.from) + '->' + this.galaxyName(this.world.fleetMv.to) + ' ' + fm + 'h ';
    } else {
      ftxt = '▲ 主力在 ' + this.galaxyName(this.fleetAt()) + ' ';
    }
    s.textRight(wx + ww - 1, line, ftxt, this.fleetMoving() ? 'accent' : 'ui_dim', 'bg');
  } else {
    s.text(wx, line, ' 银河里还没有已知的星系。', 'ui_dim', 'bg');
  }
  return true;
};
Game.prototype.galaxyName = function(id){
  var n = this.galaxyNode(id);
  return n ? n.name : str(id, '?');
};
/* 星图上按 Enter：打开光标所在星系的视图（视图由内容层定义，引擎只管开门） */
Game.prototype.galaxyOpenNode = function(){
  if (!this.galaxyCur) this.galaxyCur = 'sol';
  if (!this.idx.views['galaxy_node']){
    this.log('（内容里没有 galaxy_node 视图）', 'dim');
    return false;
  }
  return this.openView('galaxy_node');
};
Game.prototype.galaxyOwnerName = function(oid){
  var fs = asList(this.space && this.space.factions), i;
  for (i = 0; i < fs.length; i++) if (fs[i] && fs[i].id === oid) return str(fs[i].name, oid);
  return oid === '?' ? '未知' : oid;
};
Game.prototype.toggleGalaxy = function(on){
  var want = (on === undefined) ? (this.screenMode !== 'galaxy') : !!on;
  if (want && !this.galaxyCur){
    var ns = this.galaxyNodes();
    for (var i = 0; i < ns.length; i++) if (ns[i].id === 'sol') { this.galaxyCur = 'sol'; break; }
    if (!this.galaxyCur && ns.length) this.galaxyCur = ns[0].id;
  }
  this.screenMode = want ? 'galaxy' : 'scene';
  return this.screenMode;
};

/* ============================== 舰队在星图上移动（第 1 期）==============================
 * 群星最核心的手感之一：**舰队沿航道走，要花时间**。你把一支舰队派出去，
 * 看着它一格一格挪过去，这几分钟里你得想别的事 —— 没有这个，星图只是一张静态关系图。
 *
 * 移动的是「你的主力舰队」（一支 token），存在 world.fleetMv：
 *   { at: 现在在哪个星系, from/to: 移动中, t0/t1: 出发/到达 tick }
 * `fleets` 计数器仍然是总量（造舰、打仗扣的还是它）。两者不冲突：
 *   token 表示"主力在哪"，计数器表示"你有几支"。
 */
Game.prototype.fleetHopsBetween = function(a, b){
  var ns = this.galaxyNodes(), by = {}, i;
  for (i = 0; i < ns.length; i++) by[ns[i].id] = ns[i];
  if (!by[a] || !by[b]) return -1;
  if (a === b) return 0;
  var seen = {}, q = [[a, 0]];
  seen[a] = 1;
  while (q.length){
    var cur = q.shift(), nb = by[cur[0]] ? by[cur[0]].links : [];
    for (i = 0; i < nb.length; i++){
      if (nb[i] === b) return cur[1] + 1;
      if (by[nb[i]] && !seen[nb[i]]){ seen[nb[i]] = 1; q.push([nb[i], cur[1] + 1]); }
    }
  }
  return -1;                                   /* 走不到：没有航道 */
};
Game.prototype.fleetAt = function(){
  var f = this.world.fleetMv;
  return (f && f.at) ? f.at : (this.world.fleetMv = { at: 'sol', from: null, to: null, t0: 0, t1: 0 }).at;
};
Game.prototype.fleetMoving = function(){
  var f = this.world.fleetMv;
  return !!(f && f.to && this.world.tick < f.t1);
};
Game.prototype.fleetSend = function(target){
  var ns = this.galaxyNodes(), by = {}, i;
  for (i = 0; i < ns.length; i++) by[ns[i].id] = ns[i];
  if (!by[target]){ this.log('没有这个星系：' + target, 'warn'); return false; }
  var f = this.world.fleetMv || (this.world.fleetMv = { at: 'sol', from: null, to: null, t0: 0, t1: 0 });
  if (this.fleetMoving()){ this.log('主力舰队还在路上。', 'warn'); return false; }
  var cur = this.fleetAt();
  if (cur === target){ this.log('主力舰队已经在 ' + by[target].name + ' 了。', 'info'); return false; }
  var hops = this.fleetHopsBetween(cur, target);
  if (hops < 0){ this.log(by[target].name + ' 和这里之间没有航道，去不了。', 'warn'); return false; }
  var per = Math.max(1, num(this.cfg.fleetTicksPerHop, 120));    /* 每跳 2 小时 */
  f.at = cur; f.from = cur; f.to = target; f.t0 = this.world.tick; f.t1 = this.world.tick + hops * per;
  this.log('【舰队】主力离开 ' + by[cur].name + '，前往 ' + by[target].name +
           '（' + hops + ' 跳，约 ' + Math.round(hops * per / 60) + ' 小时）。', 'info');
  this.world.hint = '舰队在航道上。到了会有动静。';
  this.world.hintUntil = this.world.tick + 900;
  return true;
};
Game.prototype.stepFleet = function(){
  var f = this.world.fleetMv;
  if (!f || !f.to || this.world.tick < f.t1) return;
  var to = f.to;
  f.at = to; f.from = null; f.to = null; f.t0 = f.t1 = 0;
  var ns = this.galaxyNodes(), i, nm = to, owner = '?';
  for (i = 0; i < ns.length; i++) if (ns[i].id === to){ nm = ns[i].name; owner = ns[i].owner; }
  this.log('【舰队】主力抵达 ' + nm + '。', 'good');
  this.world.hint = '主力到了 ' + nm + '。按 Enter 看这里有什么。';
  this.world.hintUntil = this.world.tick + 1200;
  /* 把船开到敌对星系门口，对方不会没反应 */
  if (owner && owner !== 'player_remnant'){
    var rel = num(this.world.counters['rel_' + owner], 0);
    if (rel <= -3){
      this.world.counters['rel_' + owner] = rel - 1;
      this.log('【外交】' + this.factionName(owner) + '对你的态度又差了一点（' +
               rel + ' -> ' + (rel - 1) + '）。', 'warn');
    }
  }
};
Game.prototype.factionName = function(fid){
  var fs = asList(this.space && this.space.factions), i;
  for (i = 0; i < fs.length; i++) if (fs[i] && fs[i].id === fid) return str(fs[i].name, fid);
  return fid;
};
Game.prototype.fleetScreenPos = function(proj){
  var f = this.world.fleetMv, at = this.fleetAt();
  if (!this.fleetMoving() || !f || !proj[f.from] || !proj[f.to]) return proj[at] || null;
  var k = clamp((this.world.tick - f.t0) / Math.max(1, f.t1 - f.t0), 0, 1);
  var a = proj[f.from], b = proj[f.to];
  return { x: Math.round(a.x + (b.x - a.x) * k), y: Math.round(a.y + (b.y - a.y) * k) };
};
Game.prototype.galaxyLand = function(nodeId){
  var ns = this.galaxyNodes(), n = null, i;
  for (i = 0; i < ns.length; i++) if (ns[i].id === nodeId) n = ns[i];
  if (!n){ this.log('没有这个星系：' + nodeId, 'warn'); return false; }
  var list = asList(this.space && this.space.galaxy && this.space.galaxy.nodes), by = {};
  for (i = 0; i < list.length; i++) if (list[i]) by[list[i].id] = list[i];
  var scene = by[n.id] ? str(by[n.id].scene, '') : '';
  if (!scene || !this.idx.scenes[scene]){
    this.log('【降落】' + n.name + ' 没有可降落的地表 —— 这里只有航道和一个坐标。', 'dim');
    this.world.hint = n.name + ' 还没铺地表。';
    this.world.hintUntil = this.world.tick + 900;
    return false;
  }
  this.toggleGalaxy(false);
  this.teleport(scene);
  this.log('【降落】' + n.name + '：你踏上了它的地表。', 'good');
  return true;
};
registerEffect('galaxy_toggle', function(g, e){ g.toggleGalaxy(e.on === undefined ? undefined : !!e.on); });
registerEffect('fleet_send', function(g, e){ g.fleetSend(e.node || g.galaxyCur); });
registerEffect('galaxy_land', function(g, e){ g.galaxyLand(e.node || g.galaxyCur); });

Game.prototype.render = function(){
  var t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  var lay = this.layout();
  var s = this.screen, W = lay.W, H = lay.H, p = this.world.player;
  if (s.palette !== this.palette) s.palette = this.palette;
  s.fill(0, 0, W, H, ' ', 'ui', 'bg');

  /* --- 固定视口 + 场景偏移：先算好，状态行和地图都用它 ---
     小图（场景 <= 视口）：原点为正，场景居中、四周留空、不滚动
     大图：原点为负（= -相机），相机跟着玩家、clamp 在边界内 */
  var view = this.getViewSize();
  var winX = lay.winX, winY = lay.winY, winW = lay.winW, winH = lay.winH;
  var g = this.grid(p.scene);
  var camX = 0, camY = 0, originX = 0, originY = 0;
  if (g){
    if (g.w <= view.w){ originX = Math.floor((winW - g.w) / 2); camX = 0; }
    else { camX = clamp(p.x - Math.floor(view.w / 2), 0, g.w - view.w); originX = -camX; }
    if (g.h <= view.h){ originY = Math.floor((winH - g.h) / 2); camY = 0; }
    else { camY = clamp(p.y - Math.floor(view.h / 2), 0, g.h - view.h); originY = -camY; }
  }
  this._cam = { x: camX, y: camY, originX: originX, originY: originY,
                winX: winX, winY: winY, winW: winW, winH: winH,
                top: winY, h: winH, w: winW,
                mapTop: lay.mapTop, mapW: lay.mapW, mapH: lay.mapH,
                viewW: view.w, viewH: view.h, sceneW: g ? g.w : 0, sceneH: g ? g.h : 0 };

  /* --- 标题栏 --- */
  s.fill(0, 0, W, 1, ' ', 'ui', 'panel');
  var x = 1;
  x = s.text(x, 0, this.clockText(), 'ui_bright', 'panel');
  var tabs = '[地图] [终端] [日志]';
  var reserved = W >= 78 ? strW(tabs) + 3 : 0;
  if (W - reserved - x > 12) x = s.text(x + 2, 0, this.speedLabel(), num(this.speed, 1) === 0 ? 'warn' : 'good', 'panel');
  var tag = '[' + this.sceneName(p.scene) + ']';
  if (W - reserved - x - 2 >= strW(tag)) s.text(x + 2, 0, tag, 'accent', 'panel');
  if (reserved) s.textRight(W - 2, 0, tabs, 'ui_dim', 'panel');

  /* --- 状态行（提示条有内容时借用这一行） --- */
  var hintOn = !!(this.world.hint && this.world.tick < num(this.world.hintUntil, 0));
  var row1 = lay.mapTop - 1;
  if (hintOn){
    s.fill(0, row1, W, 1, ' ', 'accent_fg', 'accent_bg');
    s.text(1, row1, cutW(this.world.hint, W - 2), 'accent_fg', 'accent_bg');
  } else {
    if (this.screenMode === 'galaxy'){
      var gsel = this.galaxyNode(this.galaxyCur);
      s.fill(0, row1, W, 1, ' ', 'ui', 'panel');
      s.text(1, row1, ' 银河 ', 'accent', 'panel');
      var gtxt = ' 方向键选星系　Enter 打开　G 回到场景';
      if (gsel) gtxt = ' ' + gsel.name + '（' + this.galaxyOwnerName(gsel.owner) + '）' +
                       '　航道 ' + gsel.links.length + ' 条' + gtxt;
      s.text(9, row1, cutW(gtxt, W - 11), 'ui', 'panel');
      var nmap = this.galaxyNodes().length;
      s.textRight(W - 2, row1, nmap + ' 个星系 ', 'ui_dim', 'panel');
    } else {
    s.fill(0, row1, W, 1, ' ', 'ui', 'panel');
    var leftTag = ' ' + this.sceneName(p.scene) + ' ';
    var lx = 1, lw = strW(leftTag);
    s.text(lx, row1, leftTag, 'accent', 'panel');
    var info = '(' + p.x + ',' + p.y + ')  HP ' + Math.round(num(getPath(p.stats, 'hp'), 0)) + '/' +
               Math.round(num(getPath(p.stats, 'maxHp'), 10)) + '  疲劳 ' + Math.round(num(p.fatigue, 0));
    var near = this.npcsNear(2);
    if (near.length) info += '  |  ' + this.npcName(near[0].npcId) + ' 在 (' + near[0].x + ',' + near[0].y + ')';
    if (g && (g.w > view.w || g.h > view.h)){
      var edges = '';
      if (camX > 0) edges += '<';
      if (camX + view.w < g.w) edges += '>';
      if (camY > 0) edges += '^';
      if (camY + view.h < g.h) edges += 'v';
      if (edges) info += '  |  视野 ' + edges;
    }
    var avail = W - 3 - (lx + lw);
    if (avail > 4) s.text(lx + lw, row1, cutW(info, avail), 'ui', 'panel');
    }
  }

  /* --- 地图：往固定视口窗口里画；场景按 origin 偏移（小图居中 / 大图滚动） --- */
  var mapW = lay.mapW, mapH = lay.mapH, mapTop = lay.mapTop;   /* 侧栏 / 下方日志 / 叠加层还要用 */
  var seenArr = this.world.fog[p.scene];
  if (this.screenMode === 'galaxy'){
    this.renderGalaxy(lay);
  } else {
  for (var row = 0; row < winH; row++){
    var sy = winY + row;
    for (var col = 0; col < winW; col++){
      var mx = col - originX, my = row - originY;      /* 窗口格 -> 场景格 */
      var ch = ' ', fg = 'ui_dim', bg = 'bg';
      if (g && mx >= 0 && my >= 0 && mx < g.w && my < g.h){
        var i = my * g.w + mx;
        var vis = this.isVisible(mx, my, i);
        var seen = seenArr && seenArr[i];
        var c = this.cellAt(p.scene, mx, my);
        if (vis){ ch = c.ch; fg = c.fg; bg = c.bg; }
        else if (seen){ ch = c.ch; fg = this.dim(c.fg, 0.5); bg = this.dim(c.bg, 0.45); }
        else { ch = str(this.cfg.fogChar, '\u00b7'); fg = 'fog_fg'; bg = 'fog_bg'; }
      }
      s.set(winX + col, sy, ch, fg, bg);
    }
    /* 侧栏竖线 */
    if (lay.side) s.set(lay.sideX, sy, '\u2502', 'ui_dim', 'panel');
  }
  }
  /* 小图：给场景描个边，免得边缘字符和内容混在一起看不清。
     但场景自己就有一圈实心外框（门不算漏）时不再描 —— 轮廓化之后墙本身就是 - | +，
     再套一圈同样的线会叠成两层，反而更乱。 */
  if (this.screenMode !== 'galaxy' && g && !ringClosed(g, this.presets) && (g.w < winW || g.h < winH)){
    var fx = winX + originX - 1, fy = winY + originY - 1;
    var fw = g.w + 2, fh = g.h + 2;
    for (var fi = 0; fi < fw; fi++){
      var fxx = fx + fi;
      if (fxx < winX || fxx >= winX + winW) continue;
      var fch = (fi === 0 || fi === fw - 1) ? '+' : '-';
      if (fy >= winY && fy < winY + winH) s.set(fxx, fy, fch, 'ui_dim', 'bg');
      if (fy + fh - 1 >= winY && fy + fh - 1 < winY + winH) s.set(fxx, fy + fh - 1, fch, 'ui_dim', 'bg');
    }
    for (var fj = 1; fj < fh - 1; fj++){
      var fyy = fy + fj;
      if (fyy < winY || fyy >= winY + winH) continue;
      if (fx >= winX && fx < winX + winW) s.set(fx, fyy, '|', 'ui_dim', 'bg');
      if (fx + fw - 1 >= winX && fx + fw - 1 < winX + winW) s.set(fx + fw - 1, fyy, '|', 'ui_dim', 'bg');
    }
  }
  /* NPC */
  if (g && this.screenMode !== 'galaxy'){
    var here = this.npcsHere(p.scene);
    for (var n = 0; n < here.length; n++){
      var a2 = this.world.npcPos[here[n]]; if (!a2) continue;
      var nx = winX + Math.round(a2.x) + originX, ny = winY + Math.round(a2.y) + originY;
      if (nx < winX || ny < winY || nx >= winX + winW || ny >= winY + winH) continue;
      var nc = this.cellAt(p.scene, Math.round(a2.x), Math.round(a2.y));
      var nd = this.idx.npcs[here[n]] || {};
      var i2 = Math.round(a2.y) * g.w + Math.round(a2.x);
      var visN = this.isVisible(Math.round(a2.x), Math.round(a2.y), i2);
      s.set(nx, ny, str(nd.symbol, '?'), visN ? str(nd.color, 'npc') : this.dim(str(nd.color, 'npc'), 0.5), nc ? nc.bg : 'floor_bg');
    }
  }
  /* 玩家 @ */
  if (g && this.screenMode !== 'galaxy'){
    var px = winX + p.x + originX, py = winY + p.y + originY;
    var pc = this.cellAt(p.scene, p.x, p.y);
    s.set(px, py, str(p.symbol, '@'), 'player', pc ? pc.bg : 'floor_bg');
  }

  /* --- 侧栏：日志 + 附近 --- */
  if (lay.side){
    var sx0 = lay.sideX + 1, sw = W - sx0;
    s.fill(sx0, mapTop, sw, H - mapTop, ' ', 'ui', 'panel');
    var sy2 = mapTop;
    s.text(sx0 + 1, sy2, ' 日志 ', 'accent', 'panel'); sy2++;
    var log2 = this.world.log, lr = clamp(lay.logRows + 2, 3, 12);
    for (var li = 0; li < lr && sy2 < H - 6; li++){
      var idx = log2.length - lr + li;
      if (idx < 0) { sy2++; continue; }
      s.text(sx0 + 1, sy2, cutW(this.logLine(log2[idx]), sw - 2), str(log2[idx].level, 'ui'), 'panel');
      sy2++;
    }
    sy2++;
    if (sy2 < H - 2) s.text(sx0 + 1, sy2++, ' 附近 ', 'accent', 'panel');
    var near2 = this.npcsNear(6);
    for (var ni = 0; ni < near2.length && sy2 < H - 1; ni++){
      var nn = this.idx.npcs[near2[ni].npcId] || {};
      s.text(sx0 + 1, sy2++, cutW(' ' + str(nn.symbol, '?') + ' ' + str(nn.name, near2[ni].npcId) +
             ' (' + near2[ni].x + ',' + near2[ni].y + ')', sw - 2), 'npc', 'panel');
    }
    /* 附近的东西按「种类」合并：货架那种一屋子几十个的，只报最近的一个 + 数量 */
    var cl = this.cellsNear(6), byType = {}, order = [];
    for (var ci = 0; ci < cl.length; ci++){
      var cid = cl[ci].def.id;
      if (!byType[cid]){ byType[cid] = { def: cl[ci].def, n: 0, first: cl[ci] }; order.push(cid); }
      byType[cid].n++;
    }
    for (var oi = 0; oi < order.length && sy2 < H - 1; oi++){
      var ent = byType[order[oi]];
      var lbl = ' ' + str(ent.def.symbol, '?') + ' ' + str(ent.def.name, ent.def.id) +
                ' (' + ent.first.x + ',' + ent.first.y + ')' + (ent.n > 1 ? ' x' + ent.n : '');
      s.text(sx0 + 1, sy2++, cutW(lbl, sw - 2), 'ui', 'panel');
    }
    /* 图例：这个场景里每个字符是什么  玩家不用靠近就能认字 */
    if (sy2 < H - 2) sy2++;
    if (sy2 < H - 2) s.text(sx0 + 1, sy2++, ' 图例 ', 'accent', 'panel');
    var lg = this.sceneLegend(this.world.player.scene);
    for (var gi = 0; gi < lg.length && sy2 < H - 1; gi++){
      s.text(sx0 + 1, sy2++, cutW(' ' + lg[gi].ch + ' ' + lg[gi].name, sw - 2),
             lg[gi].kind === 'npc' ? 'npc' : 'ui', 'panel');
    }
  } else {
    /* --- 窄屏：日志在下面 --- */
    var lineB = mapTop + mapH;
    s.hline(0, lineB, W, '\u2500', 'ui_dim', 'panel');
    s.text(2, lineB, ' 日志 ', 'accent', 'panel');
    var log = this.world.log;
    for (var lj = 0; lj < lay.logRows; lj++){
      var idx2 = log.length - lay.logRows + lj;
      var row2 = lineB + 1 + lj;
      if (idx2 < 0 || idx2 >= log.length || row2 >= H) continue;
      s.text(1, row2, cutW(this.logLine(log[idx2]), W - 2), str(log[idx2].level, 'ui'), 'bg');
    }
  }

  /* --- 查看光标 --- */
  if (this.ui.look && g){
    var lx = winX + this.ui.look.x + originX, ly = winY + this.ui.look.y + originY;
    if (lx >= winX && lx < winX + winW && ly >= winY && ly < winY + winH){
      s.invert(lx, ly);
      /* 四角标记，一眼看到光标在哪 */
      s.set(lx - 1, ly, '[', 'look', s.bg[ly * W + lx]);
      s.set(lx + 1, ly, ']', 'look', s.bg[ly * W + lx]);
    }
    var li = this.lookInfo();
    if (li){
      s.fill(0, row1, W, 1, ' ', 'ui', 'panel');
      var txt = '【' + li.ch + '】 ' + li.name + '   (' + this.ui.look.x + ',' + this.ui.look.y + ')   ' + str(li.desc, '');
      s.text(1, row1, cutW(txt, W - 2), 'look', 'panel');
    }
  }

  /* --- 叠加层（只盖地图区） --- */
  if (this.ui.reader) this.drawReader(s, mapTop, mapH);
  else if (this.ui.dialogue) this.drawDialogue(s, mapTop, mapH);
  else if (this.ui.view) this.drawView(s, mapTop, mapH);
  if (this.world.gameOver && !this.ui.reader) this.drawGameOver(s, mapTop, mapH);
  this.perf.render = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : 0) - t0;
  return s;
};

/* ---------------- 对话叠加 ---------------- */
Game.prototype.drawDialogue = function(s, top, height){
  var st = this.ui.dialogue; if (!st) return;
  var d = this.idx.dialogues[st.id] || {};
  var node = (d.nodes || {})[st.node] || {};
  var npc = this.idx.npcs[st.npcId] || {};
  var camW = (this._cam && this._cam.w) || s.w;
  var boxW = Math.min(camW - 2, Math.max(30, num(this.cfg.dialogueWidth, 66)));
  var innerW = boxW - 4;
  var ctx = this.tplCtx({ npcId: st.npcId });
  var textLines = wrapText(tpl(str(node.text, '...'), ctx), innerW);
  var opts = this.dialogueOptions();
  var optText = [];
  for (var i = 0; i < opts.length; i++){
    var t = tpl(str(opts[i].text, ''), this.tplCtx({ npcId: st.npcId, i: i, index: i }));
    optText.push(wrapText(t, innerW - 4));
  }
  var rows = 2 + textLines.length + (opts.length ? 1 : 0);
  for (var k = 0; k < optText.length; k++) rows += optText[k].length;
  var boxH = rows + 3;
  var maxBoxH = Math.max(6, height - 1);
  if (boxH > maxBoxH) boxH = maxBoxH;                /* 框绝不越出地图区 */
  boxW = Math.max(12, Math.min(boxW, s.w - 2));
  var bx = Math.max(0, Math.floor((s.w - boxW) / 2));
  var by = top + Math.max(0, Math.floor((height - boxH) / 2));
  s.dimRect(0, top, s.w, height, 0.35);
  s.fill(bx, by, boxW, boxH, ' ', 'ui', 'panel');
  s.box(bx, by, boxW, boxH, 'accent', 'panel');
  s.text(bx + 2, by, ' ' + str(npc.symbol, '?') + ' ' + str(npc.name, st.npcId) + ' ', 'accent', 'panel');
  var y = by + 2;
  for (var j = 0; j < textLines.length; j++){ s.text(bx + 2, y, textLines[j], 'ui', 'panel'); y++; }
  if (opts.length) y++;
  for (var o = 0; o < optText.length; o++){
    if (y >= by + boxH - 1) break;                   /* 装不下就不再往下画 */
    var sel = (o === st.cursor);
    var pre = (sel ? '\u25b6 ' : '  ') + (o + 1) + '. ';
    var bg = sel ? 'sel_bg' : 'panel';
    var fg = sel ? 'sel_fg' : 'ui';
    var yy = y++;
    s.fill(bx + 1, yy, boxW - 2, 1, ' ', fg, bg);
    s.text(bx + 2, yy, pre, sel ? 'sel_fg' : 'ui_dim', bg);
    s.text(bx + 2 + strW(pre), yy, cutW(optText[o][0] || '', innerW - strW(pre)), fg, bg);
    for (var w2 = 1; w2 < optText[o].length; w2++){ s.text(bx + 2 + strW(pre), yy + w2, cutW(optText[o][w2], innerW - strW(pre)), fg, bg); }
    y += optText[o].length - 1;
  }
  if (st.pendingClose || !opts.length){
    s.text(bx + 2, by + boxH - 1, ' [任意键继续] ', 'ui_dim', 'panel');
  }
};

/* ---------------- 视图叠加（终端） ---------------- */
Game.prototype.drawView = function(s, top, height){
  var st = this.ui.view; if (!st) return;
  var def = st.def || this.idx.views[st.id] || {};
  var camW = (this._cam && this._cam.w) || s.w;
  var boxW = Math.min(camW - 2, Math.max(30, num(def.width, 74)));
  var boxH = Math.max(8, height - 2);
  var bx = Math.floor((s.w - boxW) / 2), by = top + Math.floor((height - boxH) / 2);
  s.dimRect(0, top, s.w, height, 0.4);
  s.fill(bx, by, boxW, boxH, ' ', 'ui', 'panel');
  s.box(bx, by, boxW, boxH, 'accent', 'panel');
  s.text(bx + 2, by, ' ' + str(st.title, st.id) + ' ', 'accent', 'panel');
  if (this.ui.flash && this.ui.flash.text){
    var fl = this.ui.flash, flFg = ({ good: 'good', warn: 'warn', danger: 'danger', info: 'ui', dim: 'ui_dim' })[fl.level] || 'ui';
    s.textRight(bx + boxW - 3, by, ' \u00bb ' + cutW(str(fl.text), Math.max(12, boxW - 26)) + ' ', flFg, 'panel');
  } else {
    s.textRight(bx + boxW - 3, by, ' [Esc 关闭] ', 'ui_dim', 'panel');
  }
  var footer = (st.actions.length ? 2 : 0);
  var bodyH = Math.max(3, boxH - 3 - footer);
  this.lastViewBodyH = bodyH;
  var lines = st.lines || [];
  if (!lines.length) lines = [{ text: '（这台终端暂时没有内容）', fg: 'ui_dim' }];
  var selLine = (st.rows && st.rows.length) ? st.rows[clamp(num(st.cursor, 0), 0, st.rows.length - 1)] : -1;
  if (selLine >= 0){
    if (selLine < st.scroll) st.scroll = selLine;
    if (selLine >= st.scroll + bodyH) st.scroll = selLine - bodyH + 1;
  }
  st.scroll = clamp(num(st.scroll, 0), 0, Math.max(0, lines.length - bodyH));
  for (var i = 0; i < bodyH; i++){
    var li = i + st.scroll;
    var ln = lines[li];
    if (ln === undefined) break;
    var yy = by + 1 + i;
    var isSel = (li === selLine);
    var fg = isSel ? str(def.selectFg, 'sel_fg') : str(ln.fg, 'ui');
    var bg = isSel ? str(def.selectBg, 'sel_bg') : 'panel';
    s.fill(bx + 1, yy, boxW - 2, 1, ' ', fg, bg);
    s.text(bx + 2, yy, (isSel ? '\u25b6 ' : '  ') + cutW(str(ln.text), boxW - 6), fg, bg);
  }
  if (lines.length > bodyH) s.textRight(bx + boxW - 3, by + boxH - 2 - footer, ' ' + (st.scroll + 1) + '-' + Math.min(lines.length, st.scroll + bodyH) + '/' + lines.length + ' ', 'ui_dim', 'panel');
  if (st.actions.length){
    var ay = by + boxH - 2;
    s.hline(bx + 1, ay, boxW - 2, '\u2500', 'ui_dim', 'panel');
    var ax = bx + 2;
    for (var a = 0; a < st.actions.length; a++){
      var label = '[' + (a + 1) + '] ' + tpl(str(st.actions[a].text, ''), this.tplCtx({}));
      var sel2 = a === st.cursor && !(st.rows && st.rows.length);
      ax = s.text(ax, ay + 1, label + '  ', sel2 ? 'sel_fg' : 'ui', sel2 ? 'sel_bg' : 'panel');
    }
  }
  /* 统一操作行（第 1 期「统一交互骨架」的可见部分）：
     以前每个面板各画各的，玩家得靠记；现在每个面板底部都是同一句话，按 ? 还能展开看全部。 */
  if (footer){
    s.fill(bx + 1, by + boxH - 1, boxW - 2, 1, ' ', 'ui_dim', 'panel');
    s.text(bx + 2, by + boxH - 1, cutW(' ↑↓ 选择　回车 确定　数字 1-9 快选　Esc 返回　? 当前可用按键', boxW - 4), 'ui_dim', 'panel');
  }
  if (st.rows && st.rows.length) s.textRight(bx + boxW - 3, by + boxH - 2, ' [\u2191\u2193 选择] [回车 确定] ', 'ui_dim', 'panel');
};

/* ---------------- 阅读弹层（长文本） ---------------- */
Game.prototype.drawReader = function(s, top, height){
  var st = this.ui.reader; if (!st) return;
  var camW = (this._cam && this._cam.w) || s.w;
  var boxW = Math.min(camW - 2, 80);
  var boxH = Math.max(8, height - 2);
  var bx = Math.floor((s.w - boxW) / 2), by = top + Math.floor((height - boxH) / 2);
  s.dimRect(0, top, s.w, height, 0.45);
  s.fill(bx, by, boxW, boxH, ' ', 'ui', 'panel');
  s.box(bx, by, boxW, boxH, 'accent', 'panel');
  s.text(bx + 2, by, ' ' + str(st.title, '阅读') + ' ', 'accent', 'panel');
  s.textRight(bx + boxW - 3, by, ' [Esc 关闭] ', 'ui_dim', 'panel');
  var bodyH = Math.max(3, boxH - 3);
  this.lastReaderBodyH = bodyH;
  st.scroll = clamp(num(st.scroll, 0), 0, Math.max(0, st.rows.length - bodyH));
  for (var i = 0; i < bodyH; i++){
    var r = st.rows[i + st.scroll];
    if (r === undefined) break;
    s.text(bx + 2, by + 1 + i, cutW(str(r.text), boxW - 4), str(r.fg, 'ui'), 'panel');
  }
  if (st.rows.length > bodyH) s.textRight(bx + boxW - 3, by + boxH - 2, ' ' + (st.scroll + 1) + '-' + Math.min(st.rows.length, st.scroll + bodyH) + '/' + st.rows.length + ' ', 'ui_dim', 'panel');
  s.textRight(bx + boxW - 3, by + boxH - 1, ' [\u2191\u2193 滚动] [PgUp/PgDn 翻页] ', 'ui_dim', 'panel');
};

/* ---------------- 结束叠加（胜负 + [R] 重开） ---------------- */
Game.prototype.drawGameOver = function(s, top, height){
  var over = this.world.gameOver; if (!over) return;
  var win = over.result === 'victory';
  var camW = (this._cam && this._cam.w) || s.w;
  var boxW = Math.min(camW - 2, 70);
  var boxH = Math.max(8, Math.min(height - 2, 13));
  var bx = Math.floor((s.w - boxW) / 2), by = top + Math.floor((height - boxH) / 2);
  s.dimRect(0, top, s.w, height, 0.7);
  s.fill(bx, by, boxW, boxH, ' ', 'ui', 'panel');
  s.box(bx, by, boxW, boxH, win ? 'good' : 'danger', 'panel');
  s.text(bx + 2, by, win ? ' 胜 利 ' : ' 失 败 ', win ? 'good' : 'danger', 'panel');
  s.textRight(bx + boxW - 3, by, ' [R] 重新开始 ', 'accent', 'panel');
  var y = by + 2;
  var msg = wrapText(str(over.reason, ''), boxW - 6);
  for (var i = 0; i < msg.length && y < by + boxH - 4; i++){ s.text(bx + 3, y, msg[i], 'ui', 'panel'); y++; }
  y++;
  var day = Math.max(1, Math.floor((this.world.tick - num(this.cfg.startTick, 0)) / DAY) + 1);
  s.text(bx + 3, y, '第 ' + day + ' 天   舰队 ' + num(this.world.counters.fleets, 0) +
                     '   污染 ' + num(this.world.counters.pollution, 0) +
                     '   民情 ' + num(this.world.counters.morale, 0), 'ui_dim', 'panel');
  s.text(bx + 3, by + boxH - 2, '按 R 重新开始；按 L 看日志；按 F2 装 mod。', 'accent', 'panel');
};
/* ============================== 15  扩展面（框架的公开接口） ==============================
 * 这里是对外暴露的一切。写 mod 只需要 JSON；要加新「词」，就注册到这里。
 * ====================================================================================== */
/* 星图（活数据）：把内容里的 galaxy.nodes 和 world.galaxy 的归属覆盖合并起来，
   这样「宣示 / 殖民 / 交涉 / 开战」真的会改星图，而且能存进档。 */
registerViewProvider('galaxy_live', function(g){
  var out = [], nodes = asList(g.space && g.space.galaxy && g.space.galaxy.nodes);
  var over = g.world.galaxy || {};
  for (var i = 0; i < nodes.length; i++){
    var n = nodes[i] || {}, o = over[n.id] || {};
    var owner = (o.owner !== undefined) ? o.owner : str(n.owner, '?');
    var rel = (o.relation !== undefined) ? o.relation : str(n.relation, '-');
    var poll = num((o.pollution !== undefined) ? o.pollution : n.pollution, 0);
    var fl = num((o.fleets !== undefined) ? o.fleets : n.fleets, 0);
    out.push({ text: ' ' + str(n.mark, '?') + ' ' + str(n.name, n.id) + '    归属 ' + owner +
                     '    关系 ' + rel + '    污染 ' + poll + '%    舰队 ' + fl, fg: 'ui' });
  }
  if (!out.length) out.push({ text: '星图上什么都没有。', fg: 'ui_dim' });
  return out;
});
/* ============================== 战略层活数据（第 4 期）==============================
 * 这几块内容在第 4 期之前**只登记在 SPACE_BLOCKS 里，内核一次都没读过**：
 *   colonies（10 个殖民地）· fleetModules（34 个模块）· internalPolitics（12 个派别）
 *   planetTypes（18 种行星）· diplomacy.actions（30 条外交动作）
 * 也就是说：内容写了，游戏里一个字都看不到。这一节把它们显示出来。
 *
 * 殖民地的数值优先读 col_<id>_<字段> 计数器（内容用 game_start 钩子播种、按天推进），
 * 没有计数器就退回内容里的静态值 —— 所以「殖民地每天在变」是内容驱动出来的，内核只管显示。
 */
function colVal(g, c, field){
  var k = 'col_' + str(c.id, '?') + '_' + field;
  if (g.world.counters[k] !== undefined) return num(g.world.counters[k], 0);
  return num(c[field], 0);
}
/* 当前可用的按键（第 1 期「? 键位表」）。
   问题 3 说「内容太多记不住」—— 那就别让你记：任何时候按 ? 都告诉你现在能按什么。
   状态不同键不同：星图上 / 场景里 / 视图开着 / 对话里 / 阅读弹层里。 */
registerViewProvider('keymap_now', function(g){
  var out = [], ui = g.ui || {};
  function add(k, t){ out.push({ text: ' ' + pad(k, 16) + t, fg: 'ui' }); }
  function head(t){ out.push({ text: ' ' + t, fg: 'accent' }); }
  if (ui.reader){
    head('阅读弹层');
    add('↑ ↓ / W S', '滚动一行');
    add('PgUp / PgDn', '翻一页');
    add('空格', '下一页');
    add('Esc / L', '关闭');
  } else if (ui.dialogue){
    head('对话中');
    add('↑ ↓', '选选项');
    add('回车 / E', '确定这一项');
    add('Esc', '结束对话');
  } else if (ui.view && ui.view.id === 'keys'){
    /* 键位表自己开着：报「打开它之前」的状态 */
    var from = ui.viewFrom;
    if (from){ head('面板：' + g.viewName(from)); add('↑ ↓', '选择'); add('回车 / E', '执行选中的动作'); add('数字 1-9', '直接执行第 N 个动作'); add('Esc', '关闭面板'); add('?', '就是这里'); }
    else if (g.screenMode === 'galaxy'){ head('星图（你在银河上）'); add('方向键 / WASD', '选星系'); add('回车 / E', '打开这个星系'); add('G / Esc', '回到地表'); add('?', '就是这里'); }
    else { head('地表（你在' + g.sceneName(g.world.player.scene) + '）'); add('方向键 / WASD', '走路'); add('E / 回车', '和面前的东西交互'); add('X', '查看脚下／周围一眼'); add('Tab', '环顾：这场景里有什么、门通向哪'); add('L', '日志全文'); add('M', '任务与进度'); add('G', '上星图'); add('1 - 5', '速度（5 = 暂停）'); add('F2', 'mod 面板'); add('F3', '诊断'); add('F4', '收起底下那行状态'); }
  } else if (ui.view){
    head('面板：' + g.viewName(ui.view.id));
    add('↑ ↓', '选择');
    add('回车 / E', '执行选中的动作');
    add('数字 1-9', '直接执行第 N 个动作');
    add('Esc', '关闭面板');
    add('?', '就是这里');
  } else if (g.screenMode === 'galaxy'){
    head('星图（你在银河上）');
    add('方向键 / WASD', '选星系');
    add('回车 / E', '打开这个星系');
    add('G / Esc', '回到地表');
    add('?', '就是这里');
  } else {
    head('地表（你在' + g.sceneName(g.world.player.scene) + '）');
    add('方向键 / WASD', '走路');
    add('E / 回车', '和面前的东西交互');
    add('X', '查看脚下／周围一眼');
    add('Tab', '环顾：这场景里有什么、门通向哪');
    add('L', '日志全文');
    add('M', '任务与进度');
    add('G', '上星图');
    add('1 - 5', '速度（5 = 暂停）');
    add('F2', 'mod 面板');
    add('F3', '诊断（校验报告）');
    add('F4', '收起／展开底下那行状态');
  }
  out.push({ text: '', fg: 'ui_dim' });
  out.push({ text: ' 记不住没关系：任何时候按 ? 都会重新列一遍。', fg: 'ui_dim' });
  return out;
});
registerViewProvider('galaxy_sel', function(g){
  var n = g.galaxyNode(g.galaxyCur), out = [];
  if (!n){ out.push({ text: '星图上没有选中的星系。', fg: 'ui_dim' }); return out; }
  out.push({ text: ' ' + n.name + '　' + g.galaxyOwnerName(n.owner), fg: 'ui_bright' });
  out.push({ text: ' 坐标 (' + n.x + ',' + n.y + ')　航道 ' + n.links.length + ' 条', fg: 'ui' });
  if (n.fleets) out.push({ text: ' 驻留舰队 ' + n.fleets, fg: 'accent' });
  if (n.pollution) out.push({ text: ' 污染 ' + n.pollution, fg: 'danger' });
  var cur = g.fleetAt(), hops = g.fleetHopsBetween(cur, n.id);
  out.push({ text: ' 主力在 ' + g.galaxyName(cur) +
                   (hops > 0 ? '，到这儿 ' + hops + ' 跳（约 ' + Math.round(hops * 120 / 60) + ' 小时）'
                             : (hops === 0 ? '（就在这儿）' : '，没有航道能过来')), fg: 'ui_dim' });
  if (n.desc) out.push({ text: ' ' + n.desc, fg: 'ui_dim' });
  return out;
});
registerViewProvider('colonies_live', function(g){
  var out = [], cols = asList(g.space && g.space.colonies);
  var pop = 0, mor = 0;
  for (var i = 0; i < cols.length; i++){ pop += colVal(g, cols[i] || {}, 'pop'); mor += colVal(g, cols[i] || {}, 'morale'); }
  out.push({ text: '在册 ' + cols.length + ' 处　总人口 ' + pop + '　平均士气 ' + (cols.length ? Math.round(mor / cols.length) : 0),
             fg: 'ui_bright' });
  for (var j = 0; j < cols.length; j++){
    var c = cols[j] || {};
    var m = colVal(g, c, 'morale');
    out.push({ text: ' ' + str(c.name, c.id)
                     + '　人口 ' + colVal(g, c, 'pop')
                     + '　士气 ' + m
                     + '　口粮 ' + colVal(g, c, 'food')
                     + '　矿石 ' + colVal(g, c, 'ore')
                     + '　防御 ' + colVal(g, c, 'defense'),
               fg: m >= 60 ? 'good' : (m >= 35 ? 'ui' : 'warn') });
  }
  if (!cols.length) out.push({ text: '没有登记任何殖民地。', fg: 'ui_dim' });
  return out;
});
registerViewProvider('fleets_live', function(g){
  var out = [], fl = asList(g.space && g.space.fleets), mods = asList(g.space && g.space.fleetModules);
  out.push({ text: '在编 ' + num(g.world.counters.fleets, 0) + ' 支　（登记了 ' + fl.length + ' 支有名字的，可装 ' + mods.length + ' 种模块）',
             fg: 'ui_bright' });
  for (var i = 0; i < fl.length; i++){
    var f = fl[i] || {};
    out.push({ text: ' ' + (f.flag ? '★' : ' ') + str(f.name, f.id)
                     + '　' + str(f.class, '-') + '　' + str(f.status, '-')
                     + '　在 ' + str(f.at, '-')
                     + '　舰体 ' + num(f.hp, 0) + '%　舰员 ' + num(f.crew, 0),
               fg: f.flag ? 'accent' : 'ui' });
  }
  if (mods.length){
    out.push({ text: '', fg: 'ui_dim' });
    out.push({ text: '可用模块（' + mods.length + ' 种，取样）：', fg: 'ui_dim' });
    for (var k = 0; k < mods.length && k < 6; k++){
      var mo = mods[k] || {};
      out.push({ text: ' ' + str(mo.name, mo.id) + '　' + str(mo.type, '-') + '　' + str(mo.effect, ''), fg: 'ui_dim' });
    }
  }
  return out;
});
registerViewProvider('politics_live', function(g){
  var out = [], pols = asList(g.space && g.space.internalPolitics);
  out.push({ text: '内部派别（支持度是活的：殖民地与污染会推着它走）', fg: 'ui_bright' });
  var list = [];
  for (var i = 0; i < pols.length; i++){
    var p = pols[i] || {};
    var k = 'support_' + str(p.id, '').replace(/^pol_/, '');
    var s = (g.world.counters[k] !== undefined) ? num(g.world.counters[k], 0) : num(p.support, 0);
    list.push({ p: p, s: s });
  }
  list.sort(function(a, b){ return b.s - a.s; });
  for (var j = 0; j < list.length; j++){
    var it = list[j], pp = it.p;
    out.push({ text: ' ' + str(pp.name, pp.id) + '　支持 ' + it.s
                     + '　诉求：' + str(pp.demand, '—'),
               fg: it.s >= 40 ? 'accent' : (it.s >= 20 ? 'ui' : 'ui_dim') });
  }
  if (!pols.length) out.push({ text: '没有登记内部派别。', fg: 'ui_dim' });
  return out;
});
registerViewProvider('planets_live', function(g){
  var out = [], pts = asList(g.space && g.space.planetTypes);
  out.push({ text: '行星志（' + pts.length + ' 种；生成世界的站点会按它的地貌生长）', fg: 'ui_bright' });
  for (var i = 0; i < pts.length; i++){
    var p = pts[i] || {};
    out.push({ text: ' ' + str(p.name, p.id) + '　危害 ' + str(p.hazard, '无') + '　产出 ' + str(p.resource, '无'), fg: 'ui' });
  }
  return out;
});
registerViewProvider('diplomacy_live', function(g){
  var out = [], fs = asList(g.space && g.space.factions);
  var acts = asList(g.space && g.space.diplomacy && g.space.diplomacy.actions);
  var nodes = asList(g.space && g.space.galaxy && g.space.galaxy.nodes), over = g.world.galaxy || {};
  out.push({ text: '各派系对你的态度（rel_<派系> 是活计数器，会随你的行为变）', fg: 'ui_bright' });
  for (var i = 0; i < fs.length; i++){
    var f = fs[i] || {}, fid = str(f.id, '?');
    if (fid === 'player_remnant') continue;
    var k = 'rel_' + fid;
    var v = (g.world.counters[k] !== undefined) ? num(g.world.counters[k], 0) : num(f.relation, 0);
    var hold = 0;
    for (var j = 0; j < nodes.length; j++){
      var n = nodes[j] || {}, o = over[n.id] || {};
      var own = (o.owner !== undefined) ? o.owner : n.owner;
      if (own === fid) hold++;
    }
    var word = v >= 3 ? '亲近' : (v >= 1 ? '友善' : (v === 0 ? '冷淡' : (v >= -2 ? '戒备' : '敌对')));
    out.push({ text: ' ' + str(f.mark, '·') + ' ' + str(f.name, fid) + '　态度 ' + v + '（' + word + '）'
                     + '　占据 ' + hold + ' 处，' + str(f.stance, '') ,
               fg: v >= 1 ? 'good' : (v === 0 ? 'ui' : (v >= -2 ? 'warn' : 'danger')) });
  }
  if (acts.length) out.push({ text: '可用外交动作 ' + acts.length + ' 条（在通讯终端里执行）', fg: 'ui_dim' });
  return out;
});
registerViewProvider('diplomacy_actions', function(g){
  var out = [], acts = asList(g.space && g.space.diplomacy && g.space.diplomacy.actions);
  out.push({ text: '外交动作 ' + acts.length + ' 条（内容里写好了，以前一条都看不到）', fg: 'ui_bright' });
  for (var i = 0; i < acts.length; i++){
    var a = acts[i] || {};
    var cost = str(a.cost, '');
    out.push({ text: ' ' + str(a.name, a.id) + (cost ? '　耗 ' + cost : '') +
                     (a.costType ? '（' + str(a.costType) + '）' : ''), fg: 'ui' });
    if (a.effect) out.push({ text: '     ' + str(a.effect), fg: 'ui_dim' });
  }
  return out;
});
registerViewProvider('validation', function(g){
  var r = g.report || { warnings: [], errors: [] };
  var out = [{ text: '错误 ' + r.errors.length + ' 条 / 警告 ' + r.warnings.length + ' 条', fg: r.errors.length ? 'danger' : 'good' }];
  var i;
  for (i = 0; i < r.errors.length && i < 40; i++) out.push({ text: 'E  ' + r.errors[i], fg: 'danger' });
  for (i = 0; i < r.warnings.length && i < 60; i++) out.push({ text: 'W  ' + r.warnings[i], fg: 'warn' });
  if (!r.errors.length && !r.warnings.length) out.push({ text: '一切正常。', fg: 'good' });
  return out;
});
registerViewProvider('projections', function(g){
  var out = [], pj = g.world.proj || {};
  for (var k in pj) out.push({ text: pad(k, 20) + '  ' + (pj[k].text || pj[k].ch || '') + '  (' + pj[k].value + ')', fg: 'ui' });
  if (!out.length) out.push({ text: '没有投影数据。', fg: 'ui_dim' });
  return out;
});
/* 环顾四周（Tab）：当前场景里有什么、在哪、门通向哪  不用走过去就能看 */
registerViewProvider('nearby', function(g){
  var out = [], p = g.world.player, sid = p.scene;
  var sc = g.idx.scenes[sid] || {}, gr = g.grid(sid) || {};
  var DIRCN = { north: '北', south: '南', east: '东', west: '西', up: '北', down: '南', left: '西', right: '东' };
  function dir(c, ox, oy){
    var dx = c.x - ox, dy = c.y - oy, s2 = '';
    if (dx) s2 += (dx < 0 ? '西' : '东');        /* 中文方位是「东北」不是「北东」 */
    if (dy) s2 += (dy < 0 ? '北' : '南');
    return s2 + ' ' + Math.max(Math.abs(dx), Math.abs(dy)) + '格';
  }
  out.push({ text: ' ' + g.sceneName(sid) + '  (' + p.x + ',' + p.y + ')  ' + g.clockText(), fg: 'accent' });
  if (sc.ambient) out.push({ text: ' ' + str(sc.ambient), fg: 'ui_dim' });

  var near = g.cellsNear(1);
  out.push({ text: ' 身边 ', fg: 'accent' });
  if (near.length) for (var i = 0; i < near.length; i++)
    out.push({ text: '   ' + str(near[i].def.symbol, '?') + ' ' + str(near[i].def.name, near[i].def.id) +
                     '（' + dir(near[i], p.x, p.y) + '，按 E 交互）', fg: 'ui' });
  else out.push({ text: '   没有够得着的东西。', fg: 'ui_dim' });

  var here = g.npcsHere(sid);
  out.push({ text: ' 这个场景里的人 ', fg: 'accent' });
  if (here.length) for (var n = 0; n < here.length; n++){
    var a = g.world.npcPos[here[n]] || {}, nd = g.idx.npcs[here[n]] || {};
    out.push({ text: '   ' + str(nd.symbol, '?') + ' ' + str(nd.name, here[n]) +
                     '（' + str(nd.role, str(nd.title, '')) + '） 在 ' +
                     Math.round(num(a.x, 0)) + ',' + Math.round(num(a.y, 0)) + ' ' + dir(a, p.x, p.y), fg: 'npc' });
  } else out.push({ text: '   这里只有你。', fg: 'ui_dim' });

  var exs = [];
  for (var k in gr.exitMap) if (has(gr.exitMap, k)) exs.push(gr.exitMap[k]);
  out.push({ text: ' 门 ', fg: 'accent' });
  if (exs.length) for (var e = 0; e < exs.length; e++)
    out.push({ text: '   ' + (exs[e].direction ? (DIRCN[str(exs[e].direction)] || str(exs[e].direction)) + ' ' : '') + dir(exs[e], p.x, p.y) +
                     '  通向 ' + g.sceneName(exs[e].to), fg: 'ui' });
  else out.push({ text: '   这个场景没有门。', fg: 'ui_dim' });

  var objs = g.cellsNear(999, sid), kinds = [], byKind = {};
  for (var o = 0; o < objs.length; o++){
    var kid = objs[o].def.id;
    if (!byKind[kid]){ byKind[kid] = { def: objs[o].def, n: 0, first: objs[o] }; kinds.push(kid); }
    byKind[kid].n++;
  }
  out.push({ text: ' 这个场景里的东西（' + objs.length + ' 件 / ' + kinds.length + ' 种）', fg: 'accent' });
  for (var o2 = 0; o2 < kinds.length; o2++){
    var kk = byKind[kinds[o2]];
    out.push({ text: '   ' + str(kk.def.symbol, '?') + ' ' + str(kk.def.name, kk.def.id) + (kk.n > 1 ? ' x' + kk.n : '') +
                     '  最近在 (' + kk.first.x + ',' + kk.first.y + ') ' + dir(kk.first, p.x, p.y), fg: 'ui' });
  }

  var lg = g.sceneLegend(sid);
  out.push({ text: ' 图例 ', fg: 'accent' });
  for (var q = 0; q < lg.length; q++)
    out.push({ text: '   ' + lg[q].ch + ' = ' + lg[q].name + (lg[q].kind === 'npc' ? '（人）' : ''), fg: lg[q].kind === 'npc' ? 'npc' : 'ui_dim' });
  return out;
}, { title: '环顾四周（Tab）', width: 66,
     actions: [{ text: '关闭', effects: [{ type: 'close_view' }] }] });

registerViewProvider('recent_log', function(g){
  var out = [], log = g.world.log;
  for (var i = Math.max(0, log.length - 40); i < log.length; i++) out.push({ text: g.logLine(log[i]), fg: str(log[i].level, 'ui') });
  return out;
});

/* 事件 <-> 功能文本：把「待上报事件 / 事件链进度 / 活计数器」画成终端能读的文本。
   事件改的是 world.pending / world.chains / world.counters，这几个面板立刻跟着变。 */
registerViewProvider('pending_events', function(g){
  var out = [], pend = g.world.pending || {}, evs = asList(g.space.events), rows = [];
  for (var i = 0; i < evs.length; i++) if (evs[i] && pend[evs[i].id]) rows.push(evs[i]);
  rows.sort(function(a, b){ return num(b.priority, 0) - num(a.priority, 0); });
  if (!rows.length){ out.push({ text: ' 没有待处理的情报。走到上报人面前按 E 就行。', fg: 'ui_dim' }); return out; }
  out.push({ text: ' 待处理 ' + rows.length + ' 条（优先级高的排前面）', fg: 'accent' });
  for (var r = 0; r < rows.length && r < 20; r++){
    var ev = rows[r], who = (ev.presentedBy || [])[0];
    out.push({ text: ' [' + str(ev.category, '?') + '] ' + str(ev.name, ev.id) +
                     (who ? ('    ' + g.npcName(who)) : ''),
               fg: num(ev.priority, 0) >= 100 ? 'warn' : 'ui' });
  }
  return out;
});
registerViewProvider('chain_progress', function(g){
  var out = [], ch = g.idx.chains || {}, prog = g.world.chains || {};
  var ids = Object.keys(ch);
  if (!ids.length){ out.push({ text: ' 没有登记事件链。', fg: 'ui_dim' }); return out; }
  var doneN = 0;
  for (var i = 0; i < ids.length; i++){
    var c = ch[ids[i]], n = ((c && c.steps) || []).length;
    var st = prog[ids[i]] || { step: 0 };
    var k = clamp(num(st.step, 0), 0, n);
    if (k >= n) doneN++;
    var next = (c && c.steps && c.steps[k]) ? ('  下一步 ' + str(c.steps[k], '')) : '';
    out.push({ text: ' ' + (k >= n ? '[完]  ' : ('[' + k + '/' + n + '] ')) + str(c.name, ids[i]).trim() + next,
               fg: k >= n ? 'good' : 'ui' });
  }
  out.push({ text: ' 已走完 ' + doneN + ' / ' + ids.length + ' 条', fg: 'accent' });
  return out;
});
registerViewProvider('situation', function(g){
  var out = [], cs = g.world.counters || {}, res = asList(g.space.resources), named = {};
  for (var i = 0; i < res.length; i++) named[res[i].id] = res[i];
  var keys = Object.keys(cs); keys.sort();
  if (!keys.length){ out.push({ text: ' 还没有任何数值。', fg: 'ui_dim' }); return out; }
  out.push({ text: ' 名称            当前    开局   变化', fg: 'accent' });
  for (var k = 0; k < keys.length; k++){
    var id = keys[k], r = named[id] || {}, base = num(r.amount, 0), now = num(cs[id], 0), diff = now - base;
    /* resources 里标了 hidden 的是**内部账本**（每个殖民地的人口/士气、每个派系的态度、
       作战状态…）：它们有专门的面板（殖民地看板 / 外交态势 / 作战室）好好显示，
       不该在这一屏里以 "col_col_sol3_morale" 这种原始 id 倒出来。
       （第 4 期踩过：播种 62 个内部计数器之后，情报板的「态势」和资源终端的「现场盘点」
        各多出五六十行原始 id，玩家第一眼看到的就是这个。） */
    if (r.hidden === true) continue;
    out.push({ text: ' ' + str(r.name, id) + '    ' + now + str(r.unit, '') +
                     (diff ? ('   ' + base + '   ' + (diff > 0 ? '+' : '') + diff) : ('   ' + base + '   0')),
               fg: diff ? (diff > 0 ? 'good' : 'warn') : 'ui' });
  }
  return out;
});

return {
  version: VERSION, SAVE_VERSION: SAVE_VERSION, HOUR: HOUR, DAY: DAY,
  conditions: conditions, effects: effects, viewProviders: viewProviders,
  registerCondition: registerCondition, registerEffect: registerEffect, registerViewProvider: registerViewProvider, viewMetas: viewMetas,
  check: check, runEffects: runEffects, compare: compare,
  load: load, createGame: createGame, byId: byId, asList: asList,
  SPACE_BLOCKS: SPACE_BLOCKS, NESTED_BLOCKS: NESTED_BLOCKS, mergeBlock: mergeBlock, mergeAtPath: mergeAtPath,
  compileScene: compileScene, validate: validate, shapeWalls: shapeWalls, ringClosed: ringClosed,
  tpl: tpl, getPath: getPath, deepMerge: deepMerge, clone: clone, effectiveLegend: effectiveLegend,
  resolveColor: resolveColor, shade: shade, makeRng: makeRng,
  Screen: Screen, Game: Game,
  isObj: isObj, isArr: isArr, isFn: isFn, num: num, str: str, clamp: clamp, has: has,
  pad: pad, padL: padL, charW: charW, strW: strW, wrapText: wrapText, cutW: cutW
};
});