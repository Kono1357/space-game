/* 跑全部回归测试 */
var cp = require('child_process'), path = require('path');
var files = ['test_space.js', 'test_world.js', 'test_arch.js', 'test_text.js', 'test_shell.js', 'test_build.js'];
var total = 0, bad = 0;
files.forEach(function (f) {
  console.log('\n########## ' + f + ' ##########');
  var r = cp.spawnSync(process.execPath, [path.join(__dirname, f)], { encoding: 'utf8' });
  var out = (r.stdout || '') + (r.stderr || '');
  var lines = out.split('\n');
  var fail = lines.filter(function (l) { return l.indexOf('FAIL') >= 0; });
  var sum = lines.filter(function (l) { return l.indexOf('通过 ') === 0; })[0] || '';
  fail.forEach(function (l) { console.log(l); });
  console.log('  ' + sum.trim());
  var m = /通过 (\d+) \/ 失败 (\d+)/.exec(sum);
  if (m) { total += Number(m[1]); bad += Number(m[2]); }
  else { console.log(out.slice(0, 1500)); bad++; }
});
console.log('\n========================================');
console.log('合计：通过 ' + total + ' / 失败 ' + bad);
process.exit(bad ? 1 : 0);