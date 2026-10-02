/* 跑全部回归测试 */
var cp = require('child_process'), path = require('path');
var files = ['test_space.js', 'test_world.js', 'test_arch.js', 'test_text.js', 'test_shell.js', 'test_build.js',
             /* 这几条要 spawn Python：校验器与命名逻辑的可信度全靠它们 */
             'test_merge_parity.js', 'test_maprules_parity.js', 'test_validate.js', 'test_names.js', 'test_terrain.js', 'test_strategy.js', 'test_galaxy.js'];
var total = 0, bad = 0, scaled = 0;
files.forEach(function (f) {
  console.log('\n########## ' + f + ' ##########');
  var r = cp.spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  var out = (r.stdout || '') + (r.stderr || '');
  var lines = out.split('\n');
  var fail = lines.filter(function (l) { return l.indexOf('FAIL') >= 0; });
  /* 性能预算被环境系数缩放过的提示不能吞掉：
     缩放的绿灯必须一眼看得出来，否则「全绿」就会被误当成「代码没问题」。 */
  var warn = lines.filter(function (l) { return l.indexOf('\u26a0') >= 0; });
  var sum = lines.filter(function (l) { return l.indexOf('通过 ') === 0; })[0] || '';
  fail.forEach(function (l) { console.log(l); });
  warn.forEach(function (l) { console.log(l); scaled++; });
  console.log('  ' + sum.trim());
  var m = /通过 (\d+) \/ 失败 (\d+)/.exec(sum);
  if (m) { total += Number(m[1]); bad += Number(m[2]); }
  else { console.log(out.slice(0, 1500)); bad++; }
});
console.log('\n========================================');
console.log('合计：通过 ' + total + ' / 失败 ' + bad);
if (scaled) console.log('\u26a0 注意：本次运行有性能预算被 SPACE_PERF_SLACK 缩放，性能类断言不作数。');
process.exit(bad ? 1 : 0);