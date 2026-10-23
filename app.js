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
      const r = document.createElement('b'); r.textContent = h.frac ? h.text + '  (' + h.frac + ')' : h.text;
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

  // 答え: 小数を大きく、分数にできる場合は下に小さく添える
  function setAnswer(r) {
    resultEl.className = '';
    resultEl.textContent = '';
    const main = document.createElement('div');
    main.textContent = r.text;
    resultEl.appendChild(main);
    if (r.frac) {
      const f = document.createElement('div');
      f.className = 'frac';
      f.textContent = '分数  ' + r.frac;
      resultEl.appendChild(f);
    }
  }

  function show(input, raw) {
    heardEl.textContent = raw ? '聞き取り: ' + raw : '';
    if (!input.trim()) { setResult('ここに結果が出ます', 'idle'); return; }
    try {
      const r = Calc.solve(input);
      exprEl.value = r.expr;
      setAnswer(r);
      history.unshift({ expr: r.expr, text: r.text, frac: r.frac || '' });
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

  // ---------- キーボードの音声入力(マイクキー)で話す ----------
  // iOS標準の音声入力は許可ポップもなく安定している。入力が止まったら自動で計算する。
  const TYPE_WAIT_MS = 1500;
  let typeTimer = null;
  function quietSolve(text) {
    if (!text.trim()) return;
    try { show(text); } catch (e) { /* ここには来ない */ }
  }
  exprEl.addEventListener('input', () => {
    clearTimeout(typeTimer);
    heardEl.textContent = '';
    typeTimer = setTimeout(() => {
      const t = exprEl.value;
      try { Calc.solve(t); } catch (e) { return; } // 入力の途中は、エラーを出さずに待つ
      show(t);
    }, TYPE_WAIT_MS);
  });
  $('kbd').addEventListener('click', () => {
    exprEl.value = '';
    setResult('キーボードのマイクを押して話してください', 'idle');
    exprEl.focus();
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

  const END_WAIT_MS = 2500;     // stop() 後に終了通知が来なければ、こちらで終わらせる
  const SILENCE_MS = 1800;      // 自動終了モード(許可ポップ後)で、話が止まってから計算するまでの間
  const SETTLE_MS = 1000;       // 指を離したあと、文字が出そろうのを待つ時間
  const FIRST_WAIT_MS = 3000;   // 指を離したのにまだ1文字も出ていないとき、待つ上限
  const NO_SPEECH_MS = 12000;   // 自動終了モードで、まったく話さなかったときの上限
  const START_WAIT_MS = 8000;   // 押してから録音が始まらないときの上限
  // audioOn: 実際に音を拾い始めた / autoFinish: 話し終えたら自動で計算するモード
  let audioOn = false, autoFinish = false, quietMs = SILENCE_MS;
  let silenceTimer = null, endTimer = null, startTimer = null;

  // 診断ログ(メニュー > 診断)。動かないときの原因調べ用
  const diagEl = $('diag');
  const logs = [];
  let t0 = Date.now();
  function dlog(msg) {
    logs.push(((Date.now() - t0) / 1000).toFixed(2) + 's ' + msg);
    if (logs.length > 80) logs.shift();
    if (diagEl) diagEl.textContent = logs.join('\n');
  }

  dlog('アプリ v7 を読み込みました');

  function resetUi() {
    running = false;
    audioOn = false;
    autoFinish = false;
    clearTimeout(watchdog);
    clearTimeout(silenceTimer);
    clearTimeout(startTimer);
    recBtn.classList.remove('on');
    hintEl.textContent = '押している間だけ聞き取ります';
  }

  // 認識を完全に捨てて、次の押下を受け付けられる状態に戻す
  function kill() {
    const r = rec;
    rec = null;
    pressed = false;
    clearTimeout(endTimer);
    resetUi();
    if (r) { dlog('kill'); try { r.abort(); } catch (e) { /* 既に停止 */ } }
  }

  // 認識が終わったときの後始末。onend が来なくても endTimer から呼ばれる。
  function finish(r) {
    if (rec !== r) return;
    rec = null;
    pressed = false;
    clearTimeout(endTimer);
    const heard = audioOn;
    resetUi();
    dlog('finish transcript=' + JSON.stringify(transcript) + ' discard=' + discard + ' audio=' + heard);
    if (discard) return;
    if (transcript) show(transcript, transcript);
    else setResult(heard ? '音は拾えましたが、文字になりませんでした。もう一度、少しゆっくり話してください' : '録音が始まる前に終わりました。ボタンが赤くなってから話してください', 'err');
  }

  // 録音を終えて結果を出す(音を拾い始めていれば stop、まだなら abort)
  function stopNow() {
    pressed = false;
    clearTimeout(watchdog);
    clearTimeout(silenceTimer);
    clearTimeout(startTimer);
    const r = rec;
    if (!r) { resetUi(); return; }
    dlog('stop audio=' + audioOn);
    if (audioOn) {
      try { r.stop(); } catch (e) { /* 既に停止 */ }
      endTimer = setTimeout(() => finish(r), END_WAIT_MS);
    } else {
      discard = true;
      try { r.abort(); } catch (e) { /* 開始前 */ }
      endTimer = setTimeout(() => finish(r), 300);
    }
  }

  // 文字が出そろうのを待ってから止める
  function armQuiet() {
    clearTimeout(watchdog);
    clearTimeout(silenceTimer);
    silenceTimer = setTimeout(stopNow, transcript ? quietMs : Math.max(quietMs, FIRST_WAIT_MS));
  }

  // 実際に音を拾い始めた。許可ポップを挟むとここが遅れ、その間に指が離れていることがある。
  function beginCapture() {
    if (audioOn) return;
    audioOn = true;
    clearTimeout(startTimer);
    const late = Date.now() - pressedAt > LATE_START_MS;
    autoFinish = !pressed || late; // 指が離れている or 離した通知が届いていない可能性がある
    quietMs = SILENCE_MS;
    dlog('audio start late=' + late + ' pressed=' + pressed);
    recBtn.classList.add('on');
    hintEl.textContent = autoFinish ? '話してください(話し終えると自動で計算します)' : '聞き取り中… 離すと計算します';
    clearTimeout(watchdog);
    watchdog = setTimeout(stopNow, autoFinish ? NO_SPEECH_MS : MAX_REC_MS);
  }

  function startRec() {
    if (!SR) return;
    transcript = '';
    discard = false;
    heardEl.textContent = '';
    pressedAt = Date.now();
    hintEl.textContent = '準備中… ボタンが赤くなってから話してください';
    const r = new SR();
    rec = r;
    r.lang = 'ja-JP';
    r.interimResults = true;
    r.continuous = true;
    r.maxAlternatives = 1;
    r.onstart = () => { if (rec === r) { running = true; dlog('onstart'); } };
    r.onaudiostart = () => { if (rec === r) beginCapture(); };
    r.onresult = (ev) => {
      if (rec !== r) return;
      beginCapture(); // audiostart が来ない環境のための保険
      let t = '';
      for (let i = 0; i < ev.results.length; i++) t += ev.results[i][0].transcript;
      transcript = t;
      dlog('result "' + t + '" final=' + ev.results[ev.results.length - 1].isFinal);
      heardEl.textContent = '聞き取り: ' + t;
      try { exprEl.value = Calc.normalize(t); } catch (e) { /* 途中経過なので無視 */ }
      if (autoFinish) armQuiet();
    };
    r.onerror = (ev) => {
      if (rec !== r) return;
      dlog('error ' + ev.error);
      discard = true;
      const msg = {
        'not-allowed': 'マイクまたは音声認識が許可されていません(設定で許可してください)',
        'service-not-allowed': '音声認識が許可されていません(設定 > Siriと検索 / キーボードの音声入力を確認)',
        'no-speech': '声が聞き取れませんでした',
        'audio-capture': 'マイクが使えません',
        'network': '音声認識の通信に失敗しました(Siriと音声入力がオンか確認)',
      }[ev.error];
      if (msg) setResult(msg, 'err');
      // エラー後に onend が来ないことがあるので、ここで確実に終わらせる
      endTimer = setTimeout(() => finish(r), 300);
    };
    r.onend = () => { dlog('onend'); finish(r); };
    clearTimeout(startTimer);
    startTimer = setTimeout(() => {
      if (rec === r && !audioOn) {
        kill();
        setResult('録音を始められませんでした。もう一度ボタンを押してください', 'err');
      }
    }, START_WAIT_MS);
    try {
      r.start();
    } catch (e) {
      kill();
      setResult('録音を開始できませんでした: ' + e.message, 'err');
    }
  }

  // 指を離した / 中断された
  function release() {
    if (!rec) { pressed = false; resetUi(); return; }
    if (!pressed && autoFinish) return;
    dlog('release audio=' + audioOn + ' autoFinish=' + autoFinish);
    if (!audioOn) {
      // まだ音を拾い始めていない(許可ポップの最中など)。止めずに待ち、許可後は自動終了モードにする。
      pressed = false;
      hintEl.textContent = '許可を押してから話してください';
      return;
    }
    pressed = false;
    if (autoFinish) return; // 話し終えたら自動で計算
    // 押している間だけモード: 離した直後に止めると文字が出る前に切れるので、出そろうのを待つ
    autoFinish = true;
    quietMs = SETTLE_MS;
    hintEl.textContent = '変換中…';
    armQuiet();
  }

  recBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    dlog('press');
    if (rec && audioOn && autoFinish) { stopNow(); return; } // 自動終了/変換待ちの最中にもう一度押すと、今すぐ計算
    kill(); // 前回の録音が残っていても、必ず新しく始める
    clearTimeout(typeTimer);
    exprEl.value = ''; // 前回の式・結果を消して、新しい入力だけを表示する
    heardEl.textContent = '';
    setResult('ここに結果が出ます', 'idle');
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
