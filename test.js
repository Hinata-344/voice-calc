const assert = require('assert');
const { solve, normalize } = require('./calc.js');

const cases = [
  ['2+3', '5'],
  ['2たす3', '5'],
  ['二たす三かける四', '14'],
  ['かっこ二たす三かっことじかける四', '20'],
  ['括弧2+3閉じ括弧×4', '20'],
  ['10わる4', '2.5'],
  ['十わる三', '3.33333333333'],
  ['三百二十一ひく二十一', '300'],
  ['千二百三十四たす一', '1235'],
  ['一万二千たす一', '12001'],
  ['3点14かける2', '6.28'],
  ['2の3乗', '8'],
  ['三の二乗', '9'],
  ['ルート9', '3'],
  ['ルート16たす1', '5'],
  ['3分の2', '0.666666666667'],
  ['-2^2', '−4'],
  ['2(3+4)', '14'],
  ['(1+2)(3+4)', '21'],
  ['0.1+0.2', '0.3'],
  ['2+3イコール', '5'],
  ['2+3は', '5'],
];
for (const [i, o] of cases) assert.strictEqual(solve(i).text, o, `${i} → ${solve(i).text} (expected ${o})`);

const eq = [
  ['2x+3=11', 'x = 4'],
  ['2エックスたす3イコール11', 'x = 4'],
  ['3x=x+8', 'x = 4'],
  ['2(x+1)=10', 'x = 4'],
  ['x÷2=3', 'x = 6'],
  ['x分の6=3'.replace('x分の6', '6÷x'), null], // xで割る → エラー
  ['エックスひく5イコール−3', 'x = 2'],
  ['x+1=x+2', '解なし'],
  ['x+1=1+x', 'xはどんな値でも成り立つ'],
  ['1+1=2', '成り立つ(正しい)'],
  ['1+1=3', '成り立たない(誤り)'],
];
for (const [i, o] of eq) {
  if (o === null) assert.throws(() => solve(i), `${i} should throw`);
  else assert.strictEqual(solve(i).text, o, `${i} → ${solve(i).text} (expected ${o})`);
}

for (const bad of ['', '2+', '(2+3', '2+3)', '1÷0', 'x×x=4', 'ルートマイナス1', 'あいう', '1=2=3', 'x^2=4']) {
  assert.throws(() => solve(bad), `"${bad}" should throw`);
}
assert.throws(() => solve('2+3x'), /xが含まれて/);

const fr = [['10わる4', '5/2'], ['10わる3', '10/3'], ['1わる3', '1/3'], ['0ひく3わる4', '−3/4'], ['0.1たす0.2', '3/10'], ['6わる3', null], ['ルート2', null], ['3.14', '157/50']];
for (const [i, o] of fr) assert.strictEqual(solve(i).frac, o, `${i} frac → ${solve(i).frac} (expected ${o})`);
assert.strictEqual(solve('3x=1').frac, 'x = 1/3');
assert.strictEqual(solve('2x+3=11').frac, null);

console.log('all tests passed:', cases.length + eq.length + 11);
