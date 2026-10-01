/* =============================================================================
 * perf_budget.js  性能预算的环境系数
 *
 * 有几条断言量的是「毫秒数」，而毫秒数取决于跑测试的机器，不取决于代码：
 * 同一份代码在手机上跑，单帧会比开发机慢 30%~80%，断言就红了 —— 但代码没回归。
 *
 * 为了让「测试红了 = 代码坏了」这条规则继续成立，这里给预算加一个乘子：
 *
 *   默认 1.0：快机器上逐字节和以前一样，一个字都没放宽。
 *   慢机器：SPACE_PERF_SLACK=1.5 node tests/run_all.js
 *           或在仓库根目录写一个 .perf_slack 文件（内容就是一个数字，已 gitignore），
 *           两者都设时环境变量优先。写文件是为了不用每次记着导出变量。
 *
 * 取值的依据：本机实测超标幅度是 1%~4%（单帧 6.23ms / 预算 6ms），
 * 1.5 留了足够余量，又不足以掩盖真实回归 —— 性能真的退化 50% 依然会红。
 *
 * 刻意不做的三件事：
 *   不改断言的判定写法（还是 dt < budget，只是 budget 会缩放）；
 *   不改被测代码去迁就测试；
 *   不跳过任何一条测试 —— 缩放的运行会在开头打印一条醒目提示，
 *   并且断言的标题上会带 [预算×1.5]，让「放松过的通过」永远不可冒充「全绿的通过」。
 * ========================================================================== */
var fs = require('fs'), path = require('path');

function resolveSlack(){
  var v = Number(process.env.SPACE_PERF_SLACK);
  if (v > 0) return { slack: v, from: 'SPACE_PERF_SLACK 环境变量' };
  try{
    var f = path.join(__dirname, '..', '.perf_slack');
    v = Number(String(fs.readFileSync(f, 'utf8')).trim());
    if (v > 0) return { slack: v, from: '.perf_slack 文件' };
  }catch (e){ /* 没有这个文件就走默认 */ }
  return { slack: 1, from: '' };
}

var r = resolveSlack();

module.exports = {
  slack: r.slack,
  source: r.from,
  /* 把原始预算按机器缩放 */
  budget: function (ms){ return ms * r.slack; },
  /* 挂在断言标题后面的说明；slack=1 时是空串，快机器上的输出一个字都不变 */
  note: r.slack === 1 ? '' : ' [预算×' + r.slack + ']',
  /* 开跑时打印一行，让「这次是缩放过的」不可能被忽略 */
  banner: function (){
    if (r.slack === 1) return '';
    return '⚠ 性能预算已按机器缩放 ×' + r.slack + '（来源：' + r.from + '）——'
         + '本机性能断言不反映真实回归，最终判定请在开发机上复跑。\n';
  }
};
