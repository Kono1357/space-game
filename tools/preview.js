/* =============================================================================
 * tools/preview.js  把内核合成的屏幕按【纯文本模式的 ASCII 映射】打到终端
 *   用法： node tools/preview.js [列数] [行数]
 *   坐标全部现算（找场景里的终端/人），所以改地图也不会坏。
 * ========================================================================== */
var path = require('path'), fs = require('fs');
var Core = require(path.join(__dirname, '..', 'engine', 'space-core.js'));
var T    = require(path.join(__dirname, '..', 'engine', 'space-textout.js'));
var spec = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'content', 'space.json'), 'utf8'));
var built = Core.load({ space: spec });
var g = Core.createGame(built, {});

var cols = parseInt(process.argv[2] || '100', 10);
var rows = parseInt(process.argv[3] || '30', 10);
g.cfg.logRows = 5;
g.resize(cols, rows);

function show(title){
  var s = g.render(), out = [];
  for (var y = 0; y < s.h; y++){
    var line = '';
    for (var x = 0; x < s.w; x++){
      var ch = s.ch[y * s.w + x];
      if (ch === '\u0000') continue;
      line += T.toAscii(ch);
    }
    out.push(line);
  }
  console.log('\n########## ' + title + ' ##########');
  console.log(out.join('\n'));
}
/* 找东西：不写死坐标 */
function findCell(sceneId, pred){
  var gr = built.idx.sceneGrids[sceneId];
  for (var i = 0; i < gr.ch.length; i++){
    var p = { x: i % gr.w, y: Math.floor(i / gr.w) };
    if (pred(gr, i, p)) return p;
  }
  return null;
}
function findObject(sceneId, id){
  return findCell(sceneId, function(gr, i){ return gr.kind[i] === 'interactable' && gr.ref[i] === id; });
}
function floorNear(sceneId, x, y){
  var gr = built.idx.sceneGrids[sceneId];
  for (var r = 0; r < 10; r++){
    for (var dy = -r; dy <= r; dy++) for (var dx = -r; dx <= r; dx++){
      var nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= gr.w || ny >= gr.h) continue;
      var i = ny * gr.w + nx;
      if (gr.pass[i] && gr.kind[i] !== 'interactable' && gr.kind[i] !== 'exit') return { x: nx, y: ny };
    }
  }
  return null;
}

show('开局：' + g.sceneName(g.world.player.scene) + '（@ 是你）');

/* 环顾四周 = Tab */
g.openView('nearby');
show('环顾四周（Tab）');
g.closeView();

/* 星图终端：走过去按 E */
var t = findObject('station_command', 'star_map_terminal');
if (t){
  var st = floorNear('station_command', t.x, t.y);
  g.teleport('station_command', st.x, st.y);
  g.interact();
  show('终端：' + (g.ui.view && g.ui.view.title));
  g.closeView();
}

/* 对话：走到指挥官旁边按 E */
var sch = built.idx.schedules['npc_fleet_commander'].slots[0];
var s2 = floorNear(sch.scene, sch.x, sch.y);
g.teleport(sch.scene, s2.x, s2.y);
g.approachNpc('npc_fleet_commander');
show('对话：' + g.npcName('npc_fleet_commander'));
g.ui.dialogue = null;

/* 地表：迷雾 + 投影 */
var land = findCell('planet_landing', function(gr, i){ return gr.pass[i]; });
g.teleport('planet_landing', land.x, land.y);
show('室外：地表 + 迷雾');

/* 一个房间的内部：居住区（有床和门） */
var hab = findObject('station_habitat', 'bed');
if (hab){
  var st3 = floorNear('station_habitat', hab.x, hab.y);
  g.teleport('station_habitat', st3.x, st3.y);
  show('室内：居住区（每间宿舍都有门）');
}
