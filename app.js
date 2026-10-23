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
  // iOSは許可ポップアップが出ると「指を離した」通知がページに届かない。
  // そのため pressed を複数のイベントで落とし、開始が遅れた場合は自動で止める。
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  const LATE_START_MS = 1200;   // 押してから録音開始までこれ以上かかったら、許可ポップが出たとみなす
  const MAX_REC_MS = 30000;     // 押しっぱなしの上限
  let rec = null, pressed = false, running = false, discard = false;
  let transcript = '', pressedAt = 0, watchdog = null;

  if (!SR) {
    hintEl.textContent = 'このブラウザは音声認識に未対応です。式欄のキーボードのマイクを使ってください';
    recBtn.disabled = true;
    recBtn.style.opacity = .4;
  }

  function resetUi() {
    running = false;
    clearTimeout(watchdog);
    recBtn.classList.remove('on');
    hintEl.textContent = '押している間だけ聞き取ります';
  }

  function startRec() {
    if (!SR || rec) return;
    transcript = '';
    discard = false;
    heardEl.textContent = '';
    pressedAt = Date.now();
    const r = new SR();
    rec = r;
    r.lang = 'ja-JP';
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 1;
    r.onstart = () => {
      running = true;
      const late = Date.now() - pressedAt > LATE_START_MS;
      if (!pressed || late) {
        // 許可ポップを挟んだ場合など。離した通知が来ていないので、ここで止めて押し直してもらう
        discard = true;
        pressed = false;
        try { r.abort(); } catch (e) { /* 既に停止 */ }
        if (late) setResult('許可されました。もう一度ボタンを押して話してください', 'idle');
        return;
      }
      recBtn.classList.add('on');
      hintEl.textContent = '聞き取り中… 離すと計算します';
      watchdog = setTimeout(release, MAX_REC_MS);
    };
    r.onresult = (ev) => {
      let t = '';
      for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      transcript = t;
      heardEl.textContent = '聞き取り: ' + t;
      try { exprEl.value = Calc.normalize(t); } catch (e) { /* 途中経過なので無視 */ }
    };
    r.onerror = (ev) => {
      discard = true;
      const msg = {
        'not-allowed': 'マイクまたは音声認識が許可されていません(設定で許可してください)',
        'service-not-allowed': '音声認識が許可されていません(設定 > Siriと検索 / キーボードの音声入力を確認)',
        'no-speech': '声が聞き取れませんでした',
        'audio-capture': 'マイクが使えません',
        'network': '音声認識の通信に失敗しました(Siriと音声入力がオンか確認)',
      }[ev.error];
      if (msg) setResult(msg, 'err');
    };
    r.onend = () => {
      rec = null;
      pressed = false;
      resetUi();
      if (discard) return;
      if (transcript) show(transcript, transcript);
      else setResult('声が聞き取れませんでした', 'err');
    };
    try {
      r.start();
    } catch (e) {
      rec = null;
      setResult('録音を開始できませんでした: ' + e.message, 'err');
    }
  }

  // 指を離した / 中断された。開始前でも開始後でも安全に呼べる。
  function release() {
    pressed = false;
    if (!rec) { resetUi(); return; }
    if (running) { try { rec.stop(); } catch (e) { /* 既に停止 */ } }
    else { discard = true; try { rec.abort(); } catch (e) { /* 開始前 */ } }
  }

  recBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (rec) { discard = true; try { rec.abort(); } catch (_) { /* */ } return; } // 固まったときは、もう一度押せば止まる
    pressed = true;
    startRec();
  });
  ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => recBtn.addEventListener(t, release));
  ['pointerup', 'pointercancel', 'touchend', 'touchcancel'].forEach((t) => window.addEventListener(t, release));
  document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
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
