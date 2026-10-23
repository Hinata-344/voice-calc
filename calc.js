// 音声計算機のエンジン: 日本語の話し言葉 → 式 → 計算(1次方程式まで)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Calc = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- 漢数字 → 算用数字 ----------
  const DIGIT = { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const SMALL = { 十: 10, 百: 100, 千: 1000 };
  const BIG = { 万: 1e4, 億: 1e8, 兆: 1e12 };

  function kanjiToNum(s) {
    if (!/[十百千万億兆]/.test(s)) return s.split('').map((c) => DIGIT[c]).join('');
    let total = 0, section = 0, cur = null;
    for (const c of s) {
      if (c in DIGIT) cur = DIGIT[c];
      else if (c in SMALL) { section += (cur == null ? 1 : cur) * SMALL[c]; cur = null; }
      else if (c in BIG) { total += ((section + (cur || 0)) || 1) * BIG[c]; section = 0; cur = null; }
    }
    return String(total + section + (cur || 0));
  }

  // ---------- 話し言葉の正規化 ----------
  // 長い表現を先に置く(括弧閉じ → 括弧 の順など)
  const WORDS = [
    [/閉じ?括弧|括弧閉じ|閉じ?かっこ|かっこ閉じ|かっことじ|カッコ閉じ|カッコとじ|閉じ?カッコ|とじかっこ|括弧とじ/g, ')'],
    [/開き?括弧|開き?かっこ|開き?カッコ|括弧|かっこ|カッコ/g, '('],
    [/プラス|足す|たす|タス|加える/g, '+'],
    [/マイナス|引く|ひく|ヒク/g, '-'],
    [/掛ける|かける|カケル|掛け/g, '*'],
    [/割る|わる|ワル|割り/g, '/'],
    [/イコール|いこーる|等しい|＝/g, '='],
    [/エックス|えっくす|イクス|未知数/g, 'x'],
    [/円周率|パイ|ぱい/g, 'pi'],
    [/平方根|ルート|るーと|√/g, 'sqrt'],
  ];

  function normalize(input) {
    let s = String(input).normalize('NFKC');
    s = s.replace(/[\s　]+/g, '');
    s = s.replace(/(\d)[,、](?=\d{3}(\D|$))/g, '$1'); // 1,000 → 1000
    s = s.replace(/[〇零一二三四五六七八九十百千万億兆]+/g, kanjiToNum);
    // 「3分の2」→ (2/3)
    const operand = '(\\d+(?:\\.\\d+)?|x|\\([^()]*\\))';
    s = s.replace(new RegExp(operand + '分の' + operand, 'g'), '(($2)/($1))');
    s = s.replace(/(\d)点(\d)/g, '$1.$2');
    for (const [re, rep] of WORDS) s = s.replace(re, rep);
    s = s.replace(/の?(\d+)乗/g, '^$1'); // 2の3乗 / 二乗
    s = s.replace(/答え|こたえ|計算|です|ですか|[はをがのでね？?。、,]/g, '');
    s = s.toLowerCase();
    return s.replace(/\*/g, '×').replace(/\//g, '÷').replace(/-/g, '−');
  }

  // ---------- トークナイザ ----------
  function tokenize(src) {
    const t = [];
    let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/[0-9.]/.test(c)) {
        let j = i;
        while (j < src.length && /[0-9.]/.test(src[j])) j++;
        const txt = src.slice(i, j);
        if (!/^\d*\.?\d+$|^\d+\.$/.test(txt)) throw new Error('数字の形が不正です: ' + txt);
        t.push({ k: 'num', v: parseFloat(txt) });
        i = j;
      } else if (src.startsWith('sqrt', i)) { t.push({ k: 'fn', v: 'sqrt' }); i += 4; }
      else if (src.startsWith('pi', i)) { t.push({ k: 'num', v: Math.PI }); i += 2; }
      else if (c === 'π') { t.push({ k: 'num', v: Math.PI }); i++; }
      else if (c === 'x') { t.push({ k: 'x' }); i++; }
      else if ('+−-×*÷/^()='.includes(c)) { t.push({ k: 'op', v: c }); i++; }
      else throw new Error('解釈できない文字があります: 「' + c + '」');
    }
    return t;
  }

  // ---------- 1次式 {a*x + b} の評価器 ----------
  const K = (b) => ({ a: 0, b });
  const EPS = 1e-12;

  function evalLinear(src) {
    const toks = tokenize(src);
    let p = 0;
    const peek = () => toks[p];
    const isOp = (v) => peek() && peek().k === 'op' && (Array.isArray(v) ? v.includes(peek().v) : peek().v === v);

    function expr() {
      let l = term();
      while (isOp(['+', '−', '-'])) {
        const o = toks[p++].v;
        const r = term();
        l = o === '+' ? { a: l.a + r.a, b: l.b + r.b } : { a: l.a - r.a, b: l.b - r.b };
      }
      return l;
    }
    const startsOperand = () => {
      const t = peek();
      return t && (t.k === 'num' || t.k === 'x' || t.k === 'fn' || (t.k === 'op' && t.v === '('));
    };
    function mul(l, r) {
      if (Math.abs(l.a) > EPS && Math.abs(r.a) > EPS) throw new Error('1次方程式までです(xのかけ算は計算できません)');
      return { a: l.a * r.b + r.a * l.b, b: l.b * r.b };
    }
    function term() {
      let l = unary();
      for (;;) {
        if (isOp(['×', '*'])) { p++; l = mul(l, unary()); }
        else if (isOp(['÷', '/'])) {
          p++;
          const r = unary();
          if (Math.abs(r.a) > EPS) throw new Error('xで割ることはできません');
          if (r.b === 0) throw new Error('0で割れません');
          l = { a: l.a / r.b, b: l.b / r.b };
        } else if (startsOperand()) l = mul(l, unary()); // 暗黙の掛け算 2x, 2(3+1)
        else return l;
      }
    }
    function unary() {
      if (isOp(['−', '-'])) { p++; const v = unary(); return { a: -v.a, b: -v.b }; }
      if (isOp('+')) { p++; return unary(); }
      return power();
    }
    function power() {
      const base = primary();
      if (isOp('^')) {
        p++;
        const e = unary();
        if (Math.abs(e.a) > EPS) throw new Error('指数にxは使えません');
        if (Math.abs(base.a) < EPS) return K(Math.pow(base.b, e.b));
        if (e.b === 1) return base;
        if (e.b === 0) return K(1);
        throw new Error('1次方程式までです(xのべき乗は計算できません)');
      }
      return base;
    }
    function primary() {
      const t = toks[p];
      if (!t) throw new Error('式が途中で終わっています');
      if (t.k === 'num') { p++; return K(t.v); }
      if (t.k === 'x') { p++; return { a: 1, b: 0 }; }
      if (t.k === 'fn') {
        p++;
        const arg = power();
        if (Math.abs(arg.a) > EPS) throw new Error('ルートの中にxは使えません');
        if (arg.b < 0) throw new Error('負の数のルートは計算できません');
        return K(Math.sqrt(arg.b));
      }
      if (t.k === 'op' && t.v === '(') {
        p++;
        const v = expr();
        if (!isOp(')')) throw new Error('かっこが閉じていません');
        p++;
        return v;
      }
      throw new Error('式の形が正しくありません: 「' + (t.v || 'x') + '」');
    }

    const v = expr();
    if (p < toks.length) {
      if (isOp(')')) throw new Error('閉じかっこが多すぎます');
      throw new Error('式の形が正しくありません');
    }
    return v;
  }

  // ---------- 表示用 ----------
  function fmt(n) {
    if (!isFinite(n)) throw new Error('計算できません(結果が大きすぎるか不正です)');
    if (Math.abs(n) < EPS) return '0';
    const s = parseFloat(n.toPrecision(12));
    return String(s).replace('-', '−');
  }

  // 式(または1次方程式)を解く。expr は正規化済みでも生の話し言葉でもよい。
  function solve(input) {
    const expr = normalize(input);
    if (!expr) throw new Error('式が空です');
    const parts = expr.split('=');
    if (parts.length > 2) throw new Error('「=」は1つだけにしてください');
    if (parts.length === 1 || parts[1] === '') {
      // 式の評価
      const v = evalLinear(parts[0]);
      if (Math.abs(v.a) > EPS) throw new Error('xが含まれています。「=」を付けて方程式にしてください');
      return { expr, kind: 'value', text: fmt(v.b) };
    }
    const l = evalLinear(parts[0]);
    const r = evalLinear(parts[1]);
    const a = l.a - r.a;
    const b = r.b - l.b;
    if (Math.abs(a) < EPS) {
      if (Math.abs(b) < 1e-9) {
        return { expr, kind: l.a === 0 && r.a === 0 ? 'bool' : 'all', text: l.a === 0 && r.a === 0 ? '成り立つ(正しい)' : 'xはどんな値でも成り立つ' };
      }
      return { expr, kind: l.a === 0 && r.a === 0 ? 'bool' : 'none', text: l.a === 0 && r.a === 0 ? '成り立たない(誤り)' : '解なし' };
    }
    return { expr, kind: 'solution', text: 'x = ' + fmt(b / a) };
  }

  return { normalize, solve, kanjiToNum };
});
