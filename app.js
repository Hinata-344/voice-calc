(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const recBtn = $('rec'), exprEl = $('expr'), heardEl = $('heard'), resultEl = $('result'), hintEl = $('hint');

  // ---------- 履歴 ----------
  const HKEY = 'voice-calc-history';
  const load = () => { try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch (e) { return []; } };
  const save = (h) => { try { localStorage.setItem(HKEY, JSON.stringify(h)); } catch (e) { /* 保存できなくても動作は続ける */ } };
  let history = load();

  function renderHistory() {
    const box = $('hist-list');
    box.textContent = '';
    if (!history.length) {
      const p = document.createElement('p');
      p.className = 'note';
      p.textContent = 'まだ履歴はありません。';
      box.appendChild(p);
      return;
    }
    history.forEach((h) => {
      const b = document.createElement('button');
      b.className = 'hist';
      const s = document.createElement('small'); s.textContent = h.expr;
      const r = document.createElement('b'); r.textContent = h.text;
      b.append(s, r);
      b.addEventListener('click', () => { exprEl.value = h.expr; show(h.expr); closeMenu(); });
      box.appendChild(b);
    });
  }

  // ---------- 計算と表示 ----------
  function setResult(text, cls) {
    resultEl.textContent = text;
    resultEl.className = cls || '';
  }

  function show(input, raw) {
    heardEl.textContent = raw ? '聞き取り: ' + raw : '';
    if (!input.trim()) { setResult('ここに結果が出ます', 'idle'); return; }
    try {
      const r = Calc.solve(input);
      exprEl.value = r.expr;
      setResult(r.text);
      history.unshift({ expr: r.expr, text: r.text });
      history = history.slice(0, 50);
      save(history);
      renderHistory();
    } catch (e) {
      exprEl.value = Calc.normalize(input);
      setResult(e.message, 'err');
    }
  }

  exprEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); exprEl.blur(); show(exprEl.value); }
  });

  // ---------- 音声認識(押している間だけ) ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, holding = false, transcript = '', running = false;

  if (!SR) {
    hintEl.textContent = 'このブラウザは音声認識に未対応です。式欄のキーボードのマイクを使ってください';
    recBtn.disabled = true;
    recBtn.style.opacity = .4;
  }

  function startRec() {
    if (!SR || running) return;
    holding = true;
    transcript = '';
    heardEl.textContent = '';
    rec = new SR();
    rec.lang = 'ja-JP';
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => { running = true; };
    rec.onresult = (ev) => {
      let t = '';
      for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      transcript = t;
      heardEl.textContent = '聞き取り: ' + t;
      try { exprEl.value = Calc.normalize(t); } catch (e) { /* 途中経過なので無視 */ }
    };
    rec.onerror = (ev) => {
      const msg = {
        'not-allowed': 'マイクまたは音声認識が許可されていません(設定で許可してください)',
        'service-not-allowed': '音声認識が許可されていません(設定 > Siriと検索 / キーボードの音声入力を確認)',
        'no-speech': '声が聞き取れませんでした',
        'audio-capture': 'マイクが使えません',
        'network': '音声認識の通信に失敗しました',
      }[ev.error];
      if (msg) setResult(msg, 'err');
    };
    rec.onend = () => {
      running = false;
      recBtn.classList.remove('on');
      hintEl.textContent = '押している間だけ聞き取ります';
      if (transcript) show(transcript, transcript);
      else if (!resultEl.classList.contains('err')) setResult('声が聞き取れませんでした', 'err');
    };
    try {
      rec.start();
      recBtn.classList.add('on');
      hintEl.textContent = '聞き取り中… 離すと計算します';
      if (navigator.vibrate) navigator.vibrate(10);
    } catch (e) {
      setResult('録音を開始できませんでした: ' + e.message, 'err');
    }
  }

  function stopRec() {
    if (!holding) return;
    holding = false;
    if (rec && running) { try { rec.stop(); } catch (e) { /* 既に停止 */ } }
    else recBtn.classList.remove('on');
  }

  recBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); try { recBtn.setPointerCapture(e.pointerId); } catch (_) { /* 非対応でも続行 */ } startRec(); });
  recBtn.addEventListener('pointerup', stopRec);
  recBtn.addEventListener('pointercancel', stopRec);
  recBtn.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- メニュー ----------
  function openMenu() { document.body.classList.add('menu'); $('sheet').setAttribute('aria-hidden', 'false'); }
  function closeMenu() { document.body.classList.remove('menu'); $('sheet').setAttribute('aria-hidden', 'true'); }
  $('menu-btn').addEventListener('click', openMenu);
  $('sheet-bg').addEventListener('click', closeMenu);
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
    if (t.dataset.pane === 'close') return closeMenu();
    document.querySelectorAll('.tab').forEach((x) => x.classList.toggle('on', x === t));
    document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('on', p.id === 'pane-' + t.dataset.pane));
  }));
  $('hist-clear').addEventListener('click', () => {
    if (!history.length || !confirm('履歴をすべて消しますか?')) return;
    history = []; save(history); renderHistory();
  });
  renderHistory();

  // ---------- オフライン対応 ----------
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { /* file:// などでは登録できない */ });
})();
