// Emoji Movie Showdown — game logic
(function () {
  'use strict';

  // ============================================================
  // Helpers
  // ============================================================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = s => String(s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const pick = arr => arr[Math.floor(Math.random() * arr.length)];
  const shuffle = arr => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const slug = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // localStorage that never crashes (private windows, blocked storage, etc.)
  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* ignore */ }
    }
  };
  const KEYS = { players: 'ems_players', settings: 'ems_settings', used: 'ems_used', custom: 'ems_custom' };

  const MIN_PLAYERS = 2;
  const MAX_PLAYERS = 15;
  const COLORS = ['#ff2e93', '#ffc300', '#00e0c6', '#b388ff', '#ff7b39', '#4cc9f0', '#ff6fb5', '#a3e635',
    '#ffd60a', '#06d6a0', '#ff5d73', '#c77dff', '#f9a03f', '#7ee8fa', '#e9c46a'];

  // Words on screen for each edition
  const TEXT = {
    bollywood: {
      tagline: 'Bollywood ka sabse filmy emoji game!',
      headings: ['Guess the movie!', 'Kaunsi picture hai?', 'Name this film!'],
      reveal: ['Kya baat hai!', 'Ekdum jhakaas!', 'Bilkul sahi!', 'Superhit!', 'Blockbuster!'],
      win: ['ne maara chhakka!', 'is the hero of the day!', 'ke liye taaliyan!', 'ne dil jeet liya!'],
      timeUp: '⏰ Time khatam!',
      sadHeading: 'Picture abhi baaki hai…',
      noHints: 'No more hints — ab sirf dua kaam aayegi! 🙏',
      finalTitle: 'And the Filmfare goes to…',
      finalWin: name => `Mogambo khush hua! ${name} wins!`,
      playAgain: '(picture abhi baaki hai!)'
    },
    hollywood: {
      tagline: 'Lights, camera, emoji! Hollywood Classics edition',
      headings: ['Guess the movie!', 'Name this film!', 'Which classic is this?'],
      reveal: ['Bravo!', "That's a wrap!", 'Oscar-worthy!', 'Box-office smash!', "Here's looking at you, kid!"],
      win: ['steals the show!', 'takes a bow!', 'is the leading star!', 'gets a standing ovation!'],
      timeUp: "⏰ That's a wrap!",
      sadHeading: 'Cut! Nobody got it…',
      noHints: "No more hints — you're on your own, kid! 🎬",
      finalTitle: 'And the Oscar goes to…',
      finalWin: name => `And the Oscar goes to… ${name}!`,
      playAgain: "(I'll be back!)"
    }
  };
  const txt = () => TEXT[settings.mode] || TEXT.bollywood;

  // Give every built-in puzzle a stable id based on its title
  PUZZLES.forEach(p => { p.id = 'p_' + slug(p.t); });
  HOLLYWOOD_PUZZLES.forEach(p => { p.id = 'h_' + slug(p.t); });

  // ============================================================
  // Persistent state
  // ============================================================
  let players = store.get(KEYS.players, []).filter(n => typeof n === 'string').slice(0, MAX_PLAYERS);
  const settings = Object.assign({ mode: 'bollywood', rounds: 20, timer: 30, difficulty: 'mixed', sound: true }, store.get(KEYS.settings, {}));
  if (!['bollywood', 'hollywood'].includes(settings.mode)) settings.mode = 'bollywood';
  if (![10, 20, 30].includes(settings.rounds)) settings.rounds = 20;
  if (![20, 30, 45].includes(settings.timer)) settings.timer = 30;
  if (!['easy', 'mixed', 'hard'].includes(settings.difficulty)) settings.difficulty = 'mixed';
  let customPuzzles = store.get(KEYS.custom, []).filter(c => c && c.e && c.t);

  let game = null;

  // ============================================================
  // Sound (Web Audio API — all synthesized, no files)
  // ============================================================
  const Sound = {
    ctx: null,
    init() {
      try {
        if (!this.ctx) {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (!AC) return;
          this.ctx = new AC();
        }
        if (this.ctx.state === 'suspended') this.ctx.resume();
      } catch (e) { /* audio unavailable */ }
    },
    note(freq, at, dur, opts = {}) {
      if (!settings.sound || !this.ctx) return;
      const { type = 'sine', vol = 0.2, to = null } = opts;
      const c = this.ctx;
      const t = c.currentTime + at;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (to) osc.frequency.exponentialRampToValueAtTime(to, t + dur);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(c.destination);
      osc.start(t);
      osc.stop(t + dur + 0.05);
    },
    tick() {
      this.note(1600, 0, 0.05, { type: 'square', vol: 0.07 });
      this.note(800, 0, 0.09, { type: 'triangle', vol: 0.12 });
    },
    ding() {
      [1046.5, 1318.5, 1568, 2093].forEach((f, i) => this.note(f, i * 0.08, 0.55, { type: 'triangle', vol: 0.17 }));
      this.note(2637, 0.32, 1.0, { type: 'sine', vol: 0.12 });
    },
    buzzer() {
      this.note(160, 0, 0.8, { type: 'sawtooth', vol: 0.2, to: 105 });
      this.note(166, 0, 0.8, { type: 'square', vol: 0.08, to: 108 });
    },
    award() {
      this.note(988, 0, 0.1, { type: 'square', vol: 0.09 });
      this.note(1319, 0.08, 0.4, { type: 'square', vol: 0.09 });
    },
    hint() { this.note(500, 0, 0.3, { type: 'sine', vol: 0.15, to: 1400 }); },
    undo() { this.note(800, 0, 0.25, { type: 'triangle', vol: 0.15, to: 260 }); },
    sad() { [392, 370, 349, 311].forEach((f, i) => this.note(f, i * 0.2, i === 3 ? 0.6 : 0.25, { type: 'triangle', vol: 0.15 })); },
    fanfare() {
      [[523, 0], [659, 0.12], [784, 0.24], [1047, 0.36]].forEach(([f, t]) => this.note(f, t, 0.28, { type: 'sawtooth', vol: 0.07 }));
      this.note(1047, 0.5, 0.9, { type: 'triangle', vol: 0.16 });
      this.note(1319, 0.5, 0.9, { type: 'triangle', vol: 0.1 });
    },
    click() { this.note(1200, 0, 0.04, { type: 'triangle', vol: 0.08 }); }
  };

  // ============================================================
  // Confetti (canvas)
  // ============================================================
  const Confetti = (() => {
    const canvas = $('#confetti');
    const ctx = canvas.getContext('2d');
    const colors = ['#ffd23f', '#ff2e93', '#00e0c6', '#ff8a00', '#ffffff', '#b388ff'];
    let parts = [];
    let raf = null;

    function resize() {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = innerWidth * dpr;
      canvas.height = innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    window.addEventListener('resize', resize);
    resize();

    function add(p) {
      parts.push(Object.assign({
        w: 7 + Math.random() * 8, h: 9 + Math.random() * 10,
        r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.35,
        c: pick(colors), shape: Math.random() < 0.3 ? 'circle' : 'rect', g: 0.32, drag: 0.985
      }, p));
    }
    function burst(n = 140, x = innerWidth / 2, y = innerHeight * 0.45) {
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const spd = 5 + Math.random() * 13;
        add({ x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd - 6 });
      }
      run();
    }
    function rain(n = 220) {
      for (let i = 0; i < n; i++) {
        add({ x: Math.random() * innerWidth, y: -20 - Math.random() * innerHeight, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3, g: 0.03, drag: 0.995 });
      }
      run();
    }
    function run() { if (!raf) raf = requestAnimationFrame(loop); }
    function loop() {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      for (const p of parts) {
        p.vy += p.g; p.vx *= p.drag; p.vy *= p.drag;
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.r);
        ctx.fillStyle = p.c;
        if (p.shape === 'circle') {
          ctx.beginPath(); ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2); ctx.fill();
        } else {
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.r * 1.5)) + 2);
        }
        ctx.restore();
      }
      parts = parts.filter(p => p.y < innerHeight + 40);
      if (parts.length) raf = requestAnimationFrame(loop);
      else { raf = null; ctx.clearRect(0, 0, innerWidth, innerHeight); }
    }
    return { burst, rain, clear() { parts = []; } };
  })();

  // ============================================================
  // Small UI helpers
  // ============================================================
  let toastTimer = null;
  function toast(msg, ms = 2600) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms);
  }

  function showScreen(name) {
    $$('.screen').forEach(s => s.classList.toggle('active', s.id === 'screen-' + name));
  }
  const currentScreen = () => ($('.screen.active') || {}).id;

  function makeSparkles() {
    const box = $('#sparkles');
    for (let i = 0; i < 26; i++) {
      const s = document.createElement('span');
      s.className = 'sparkle';
      s.style.left = Math.random() * 100 + '%';
      s.style.top = Math.random() * 100 + '%';
      s.style.animationDelay = (Math.random() * 3).toFixed(2) + 's';
      s.style.animationDuration = (2 + Math.random() * 2.5).toFixed(2) + 's';
      box.appendChild(s);
    }
  }

  // ============================================================
  // Setup screen
  // ============================================================
  function renderPlayers() {
    const list = $('#player-list');
    if (!players.length) {
      list.innerHTML = '<li class="empty">No stars yet — add your friends!</li>';
    } else {
      list.innerHTML = players.map((name, i) =>
        `<li class="chip" style="--c:${COLORS[i % COLORS.length]}"><span>${esc(name)}</span>` +
        `<button type="button" class="chip-x" data-i="${i}" aria-label="Remove ${esc(name)}">×</button></li>`
      ).join('');
    }
    $('#player-count').textContent = `${players.length}/${MAX_PLAYERS}`;
    const enough = players.length >= MIN_PLAYERS;
    $('#start-btn').disabled = !enough;
    $('#start-hint').textContent = enough ? 'Screen-share this window, then hit start!' : `Add at least ${MIN_PLAYERS} players to begin`;
    $('#add-player-btn').disabled = players.length >= MAX_PLAYERS;
    $('#player-input').disabled = players.length >= MAX_PLAYERS;
    $('#player-input').placeholder = players.length >= MAX_PLAYERS ? 'Full house! (15 max)' : 'Type a player name…';
    store.set(KEYS.players, players);
  }

  function addPlayer() {
    const input = $('#player-input');
    const name = input.value.trim().replace(/\s+/g, ' ').slice(0, 18);
    if (!name) return;
    if (players.length >= MAX_PLAYERS) { toast('Housefull! Maximum 15 players.'); return; }
    if (players.some(p => p.toLowerCase() === name.toLowerCase())) { toast(`${name} is already in the cast!`); return; }
    players.push(name);
    input.value = '';
    renderPlayers();
    input.focus();
  }

  function renderSettings() {
    $$('.seg').forEach(seg => {
      const key = seg.dataset.setting;
      $$('button', seg).forEach(b => b.classList.toggle('on', String(settings[key]) === b.dataset.value));
    });
    const tg = $('#sound-toggle');
    tg.setAttribute('aria-pressed', String(settings.sound));
    $('.toggle-text', tg).textContent = settings.sound ? 'ON' : 'OFF';
    $('#tagline').textContent = txt().tagline;
    $('#final-title').textContent = txt().finalTitle;
    $('#play-again-sub').textContent = txt().playAgain;
    document.body.dataset.mode = settings.mode;
    store.set(KEYS.settings, settings);
    renderFreshCount();
  }

  function allPuzzles() {
    const base = settings.mode === 'hollywood' ? HOLLYWOOD_PUZZLES : PUZZLES;
    return base.concat(customPuzzles.map(c => Object.assign({ custom: true }, c)));
  }

  function renderFreshCount() {
    const used = new Set(store.get(KEYS.used, []));
    const all = allPuzzles();
    const fresh = all.filter(p => !used.has(p.id)).length;
    $('#fresh-count').textContent = `(${fresh}/${all.length} fresh)`;
    $('#custom-count').textContent = customPuzzles.length ? `(${customPuzzles.length})` : '';
  }

  // ---------- Custom puzzles ----------
  function renderCustomList() {
    const list = $('#custom-list');
    if (!customPuzzles.length) {
      list.innerHTML = '<li class="empty">No custom puzzles yet. Make one about your gang!</li>';
    } else {
      list.innerHTML = customPuzzles.map((c, i) =>
        `<li><span class="ce">${esc(c.e)}</span><span class="ct"><b>${esc(c.t)}</b>` +
        `<span>${c.h ? 'Hint: ' + esc(c.h) : 'No hint'}</span></span>` +
        `<button type="button" class="btn btn-ghost btn-sm" data-del="${i}">🗑️ Delete</button></li>`
      ).join('');
    }
    renderFreshCount();
  }

  function saveCustom(e) {
    e.preventDefault();
    const em = $('#c-emoji').value.trim();
    const ans = $('#c-answer').value.trim();
    const hint = $('#c-hint').value.trim();
    if (!em || !ans) { toast('Emojis and answer are both needed!'); return; }
    customPuzzles.push({ id: 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), e: em, t: ans, h: hint });
    store.set(KEYS.custom, customPuzzles);
    $('#custom-form').reset();
    $('#c-emoji').focus();
    renderCustomList();
    toast('Puzzle saved! 🎬');
  }

  // ============================================================
  // Puzzle selection (no repeats in a game, avoid repeats across games)
  // ============================================================
  function buildQueue(count) {
    const diff = settings.difficulty;
    const pool = allPuzzles().filter(p => p.custom || diff === 'mixed' || p.d === diff);
    let used = new Set(store.get(KEYS.used, []));
    let picked = shuffle(pool.filter(p => !used.has(p.id))).slice(0, count);

    if (picked.length < count) {
      // This deck is used up — reshuffle it (only forget the ones in this pool)
      const poolIds = new Set(pool.map(p => p.id));
      used = new Set([...used].filter(id => !poolIds.has(id)));
      store.set(KEYS.used, [...used]);
      const have = new Set(picked.map(p => p.id));
      picked = picked.concat(shuffle(pool.filter(p => !have.has(p.id))).slice(0, count - picked.length));
      toast('You\'ve seen every puzzle — reshuffling the deck! 🔀', 3200);
    }
    // Gentle ramp in Mixed: easier ones tend to come first
    if (diff === 'mixed') {
      const rank = { easy: 0, medium: 1, hard: 2 };
      picked = picked
        .map((p, i) => ({ p, k: (rank[p.d] ?? 1) + Math.random() * 1.6 + i * 0.0001 }))
        .sort((a, b) => a.k - b.k)
        .map(x => x.p);
    }
    return picked;
  }

  function markUsed(id) {
    const used = new Set(store.get(KEYS.used, []));
    used.add(id);
    store.set(KEYS.used, [...used]);
  }

  // ============================================================
  // Game flow
  // ============================================================
  function startGame(names) {
    Sound.init();
    const queue = buildQueue(settings.rounds);
    if (!queue.length) { toast('No puzzles available for this difficulty!'); return; }
    game = {
      players: names.map((n, i) => ({ name: n, score: 0, color: COLORS[i % COLORS.length] })),
      queue,
      total: queue.length,
      idx: -1,
      timer: settings.timer,
      history: [],
      interval: null
    };
    Confetti.clear();
    showScreen('game');
    renderScoreboard();
    Sound.fanfare();
    nextRound();
  }

  function nextRound() {
    stopTimer();
    if (game.idx + 1 >= game.total) { endGame(); return; }
    game.idx++;
    const p = game.queue[game.idx];
    markUsed(p.id);
    Object.assign(game, {
      puzzle: p, elapsed: 0, hintLevel: 0, state: 'playing',
      awarded: null, revealPoints: null, paused: false, lastTick: null
    });

    $('#round-label').textContent = `Round ${game.idx + 1} of ${game.total}`;
    $('#stage').classList.remove('revealed');
    $('#answer').hidden = true;
    $('#answer').classList.remove('sad');
    $('#stage-heading').textContent = p.custom ? '🤫 Inside joke alert!' : pick(txt().headings);
    const third = Math.round(game.timer / 3);
    setHintCard(1, false, `🔒 Unlocks at ${third}s gone · ${p.custom ? 'secret clue' : 'year, star & clue'}`);
    setHintCard(2, false, `🔒 Unlocks at ${third * 2}s gone · the title in blanks`);
    renderEmoji();
    updateWorth(false);
    renderScoreboard();
    updateButtons();
    updateTimerUI();
    startTimer();
  }

  // ---------- Emoji display that always fits ----------
  function graphemes(str) {
    if (window.Intl && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str), s => s.segment).filter(s => s.trim());
    }
    return Array.from(str).filter(s => s.trim());
  }

  function renderEmoji() {
    const row = $('#emoji');
    const segs = graphemes(game.puzzle.e);
    row.innerHTML = segs.map((s, i) => `<span class="em" style="animation-delay:${i * 80}ms">${esc(s)}</span>`).join('');
    row.style.fontSize = '';
    row.style.maxWidth = '';
    fitEmoji();
  }

  function fitEmoji() {
    if (!game || !game.puzzle || $('#stage').classList.contains('revealed')) return;
    const wrap = $('#emoji-wrap');
    const row = $('#emoji');
    const n = Math.max(1, row.children.length);
    const W = wrap.clientWidth - 20;
    const H = wrap.clientHeight - 10;
    if (W < 60 || H < 60) { requestAnimationFrame(fitEmoji); return; } // layout not settled yet
    let best = { size: 0, lines: 1, perLine: n };
    for (let lines = 1; lines <= 3; lines++) {
      const perLine = Math.ceil(n / lines);
      const size = Math.min(W / (perLine * 1.16), H / (lines * 1.16));
      if (size > best.size * 1.08) best = { size, lines, perLine };
    }
    const size = Math.max(36, Math.min(best.size, 180));
    row.style.fontSize = size + 'px';
    row.style.maxWidth = (best.perLine * size * 1.16 + 4) + 'px';
  }

  // ---------- Hints ----------
  function setHintCard(n, unlocked, html) {
    const card = $('#hint' + n);
    card.classList.toggle('locked', !unlocked);
    card.classList.toggle('unlocked', unlocked);
    $('#hint' + n + '-body').innerHTML = html;
  }

  function hint1HTML(p) {
    if (p.custom) {
      return `<div class="hint-line hint-clue">🤫 ${p.h ? esc(p.h) : 'Inside joke! Think about your gang…'}</div>`;
    }
    return `<div class="hint-line">📅 <b>${p.y}</b> &nbsp;·&nbsp; 🎭 ${esc(p.a)}</div>` +
           `<div class="hint-line hint-clue">💬 ${esc(p.c)}</div>`;
  }

  function blanksHTML(title) {
    const words = title.split(/\s+/).filter(Boolean).map(word => {
      let first = true;
      const chars = Array.from(word).map(ch => {
        if (/\p{N}/u.test(ch)) return `<b>${esc(ch)}</b>`; // numbers stay visible
        if (/\p{L}/u.test(ch)) {
          if (first) { first = false; return `<b>${esc(ch.toUpperCase())}</b>`; }
          return '<i>_</i>';
        }
        return `<em>${esc(ch)}</em>`;
      }).join('');
      return `<span class="bw">${chars}</span>`;
    });
    return `<div class="blanks">${words.join('')}</div>`;
  }

  function unlockHint(level, manual) {
    if (level <= game.hintLevel || level > 2) return;
    for (let l = game.hintLevel + 1; l <= level; l++) {
      setHintCard(l, true, l === 1 ? hint1HTML(game.puzzle) : blanksHTML(game.puzzle.t));
    }
    game.hintLevel = level;
    Sound.hint();
    updateWorth(true);
    updateButtons();
    if (manual) toast(`Hint ${level} unlocked — now worth ${currentPoints()} ${currentPoints() === 1 ? 'point' : 'points'}`, 1800);
  }

  function currentPoints() { return Math.max(1, 3 - game.hintLevel); }

  function updateWorth(animate) {
    const pts = game.state === 'revealed' && game.revealPoints != null ? game.revealPoints : currentPoints();
    $('#worth-stars').textContent = '⭐'.repeat(pts);
    $('#worth-text').textContent = `${pts} ${pts === 1 ? 'pt' : 'pts'}`;
    const w = $('#worth');
    if (animate) { w.classList.remove('drop'); void w.offsetWidth; w.classList.add('drop'); }
  }

  // ---------- Timer ----------
  function startTimer() {
    stopTimer();
    let last = performance.now();
    game.interval = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      if (game.paused || game.state !== 'playing') return;
      game.elapsed = Math.min(game.timer, game.elapsed + dt);
      onTimerProgress();
    }, 100);
  }
  function stopTimer() {
    if (game && game.interval) { clearInterval(game.interval); game.interval = null; }
  }

  function onTimerProgress() {
    const T = game.timer;
    const e = game.elapsed;
    const autoLevel = e >= (2 * T) / 3 ? 2 : e >= T / 3 ? 1 : 0;
    if (autoLevel > game.hintLevel) unlockHint(autoLevel, false);
    const secLeft = Math.ceil(T - e);
    if (secLeft <= 5 && secLeft > 0 && secLeft !== game.lastTick) {
      game.lastTick = secLeft;
      Sound.tick();
    }
    updateTimerUI();
    if (e >= T) timeUp();
  }

  function updateTimerUI() {
    const T = game.timer;
    const left = Math.max(0, T - game.elapsed);
    const frac = left / T;
    const C = 2 * Math.PI * 52;
    $('#timer-ring').style.strokeDashoffset = String(C * (1 - frac));
    const timer = $('#timer');
    timer.classList.toggle('warn', frac <= 0.5 && frac > 0.2);
    timer.classList.toggle('danger', frac <= 0.2 && game.state === 'playing' && !game.paused);
    timer.classList.toggle('paused', game.paused);
    timer.classList.toggle('done', game.state !== 'playing');
    $('#timer-num').textContent = game.paused ? '⏸' : String(Math.ceil(left));
  }

  function togglePause() {
    if (!game || game.state !== 'playing') return;
    game.paused = !game.paused;
    updateTimerUI();
    toast(game.paused ? '⏸ Paused — interval! Press P to resume' : '▶️ Picture shuru!', 1600);
  }

  function timeUp() {
    game.elapsed = game.timer;
    Sound.buzzer();
    showAnswer({ kicker: txt().timeUp, sad: true });
  }

  // ---------- Reveal / award / skip / undo ----------
  function showAnswer({ kicker, sad = false, celebrate = false }) {
    if (game.state !== 'playing') return;
    game.revealPoints = currentPoints();
    game.state = 'revealed';
    game.paused = false;
    stopTimer();
    const p = game.puzzle;
    $('#answer-kicker').textContent = kicker;
    $('#answer-title').textContent = p.t;
    $('#answer-meta').innerHTML = p.custom ? '🤫 Custom puzzle' : `📅 ${p.y} &nbsp;·&nbsp; 🎭 ${esc(p.a)}`;
    $('#answer').classList.toggle('sad', sad);
    $('#answer').hidden = false;
    $('#stage').classList.add('revealed');
    $('#stage-heading').textContent = sad ? txt().sadHeading : '🎬 The answer is…';
    updateTimerUI();
    updateWorth(false);
    updateButtons();
    if (celebrate) {
      Sound.ding();
      const r = $('#answer-title').getBoundingClientRect();
      Confetti.burst(160, r.left + r.width / 2, r.top + r.height / 2);
    }
  }

  function reveal() {
    if (!game || game.state !== 'playing') return;
    showAnswer({ kicker: pick(txt().reveal), celebrate: true });
  }

  function award(i) {
    if (!game) return;
    const pl = game.players[i];
    if (game.awarded !== null) {
      toast(`Already awarded to ${game.players[game.awarded].name} — use Undo to change it`);
      const btn = $(`.pl[data-i="${i}"]`);
      if (btn) { btn.classList.remove('minus'); void btn.offsetWidth; btn.classList.add('minus'); }
      return;
    }
    const wasPlaying = game.state === 'playing';
    const pts = wasPlaying ? currentPoints() : game.revealPoints;
    pl.score += pts;
    game.history.push({ round: game.idx, player: i, pts });
    game.awarded = i;
    Sound.award();
    if (wasPlaying) {
      showAnswer({ kicker: `${pl.name} ${pick(txt().win)}`, celebrate: true });
    } else {
      $('#answer-kicker').textContent = `${pl.name} ${pick(txt().win)}`;
      $('#answer').classList.remove('sad');
      Sound.ding();
    }
    renderScoreboard(i);
    const btn = $(`.pl[data-i="${i}"]`);
    if (btn) {
      const r = btn.getBoundingClientRect();
      floatPoints(`+${pts}`, r.left + r.width / 2 - 30, r.top - 10);
      if (!wasPlaying) Confetti.burst(70, r.left + r.width / 2, r.top + r.height / 2);
    }
    updateButtons();
  }

  function floatPoints(text, x, y) {
    const el = document.createElement('div');
    el.className = 'float-points';
    el.textContent = text;
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 1200);
  }

  function undo() {
    if (!game) return;
    const last = game.history.pop();
    if (!last) { toast('Nothing to undo yet'); return; }
    const pl = game.players[last.player];
    pl.score -= last.pts;
    if (last.round === game.idx) game.awarded = null;
    Sound.undo();
    toast(`↩️ Took back ${last.pts} ${last.pts === 1 ? 'point' : 'points'} from ${pl.name}`);
    renderScoreboard();
    const btn = $(`.pl[data-i="${last.player}"]`);
    if (btn) { btn.classList.add('minus'); }
    updateButtons();
  }

  function skip() {
    if (!game) return;
    if (game.state === 'playing') {
      Sound.sad();
      toast(`⏭️ Skipped! It was “${game.puzzle.t}”`, 3000);
    }
    nextRound();
  }

  function next() {
    if (!game) return;
    if (game.state === 'playing') {
      toast('Reveal the answer first (Space) — or Skip (S)');
      return;
    }
    nextRound();
  }

  function manualHint() {
    if (!game || game.state !== 'playing') return;
    if (game.hintLevel >= 2) { toast(txt().noHints); return; }
    unlockHint(game.hintLevel + 1, true);
  }

  function updateButtons() {
    const playing = game.state === 'playing';
    $('#reveal-btn').disabled = !playing;
    $('#skip-btn').disabled = !playing;
    $('#next-btn').disabled = playing;
    $('#hint-btn').disabled = !playing || game.hintLevel >= 2;
    $('#hint-btn').innerHTML = game.hintLevel >= 2 ? '💡 No more hints' : `💡 Hint ${game.hintLevel + 1} <small>(−1 ⭐)</small>`;
    $('#undo-btn').disabled = game.history.length === 0;
    $('#next-btn').innerHTML = game.idx + 1 >= game.total ? '🏆 Final Results' : 'Next ➡️';
    $('#scoreboard').classList.toggle('board-locked', game.awarded !== null);
  }

  // ---------- Scoreboard ----------
  function renderScoreboard(bumpIdx) {
    const board = $('#scoreboard');
    const top = Math.max(...game.players.map(p => p.score));
    const many = game.players.length > 8;
    board.style.setProperty('--n', game.players.length);
    board.style.setProperty('--rows', Math.ceil(game.players.length / 2));
    $('.game-grid').classList.toggle('many', many);
    board.innerHTML = game.players.map((p, i) => {
      const crown = top > 0 && p.score === top ? '👑 ' : '';
      const cls = ['pl', i === bumpIdx ? 'bump' : '', i === game.awarded ? 'winner' : ''].join(' ');
      return `<button type="button" class="${cls}" data-i="${i}" style="--c:${p.color}">` +
             `<span class="pl-name">${crown}${esc(p.name)}</span><span class="pl-score">${p.score}</span></button>`;
    }).join('');
  }

  // ============================================================
  // Final screen
  // ============================================================
  function ranked() {
    const sorted = game.players.slice().sort((a, b) => b.score - a.score);
    let rank = 0;
    return sorted.map((p, i) => {
      if (i === 0 || p.score !== sorted[i - 1].score) rank = i + 1;
      return Object.assign({ rank }, p);
    });
  }

  function endGame() {
    stopTimer();
    const list = ranked();
    const top3 = list.slice(0, 3);
    const order = [top3[1], top3[0], top3[2]]; // 2nd, 1st, 3rd
    const medals = { 1: '🥇', 2: '🥈', 3: '🥉' };
    $('#podium').innerHTML = order.map((p, slot) => {
      if (!p) return '';
      const place = slot === 1 ? 1 : slot === 0 ? 2 : 3;
      return `<div class="pod p${place}">` +
             `<div class="pod-medal">${medals[p.rank] || '🎖️'}</div>` +
             `<div class="pod-name">${esc(p.name)}</div>` +
             `<div class="pod-score">${p.score} ${p.score === 1 ? 'point' : 'points'}</div>` +
             `<div class="pod-block">${p.rank}</div></div>`;
    }).join('');
    $('#ranks').innerHTML = list.map(p =>
      `<li><span class="rk">${p.rank}</span>${esc(p.name)} <span class="rs">${p.score}</span></li>`
    ).join('');

    const winners = list.filter(p => p.rank === 1);
    $('#final-title').textContent = list[0].score === 0
      ? 'Koi baat nahi… everybody tied at zero!'
      : winners.length > 1
        ? `It's a tie! ${winners.map(w => w.name).join(' & ')} 🤝`
        : txt().finalWin(winners[0].name);

    showScreen('final');
    Sound.fanfare();
    setTimeout(() => Sound.ding(), 900);
    Confetti.rain(260);
    setTimeout(() => Confetti.burst(180, innerWidth / 2, innerHeight * 0.4), 1000);
  }

  // ============================================================
  // Wiring
  // ============================================================
  function bind() {
    // Players
    $('#add-player-form').addEventListener('submit', e => { e.preventDefault(); addPlayer(); });
    $('#player-list').addEventListener('click', e => {
      const x = e.target.closest('.chip-x');
      if (!x) return;
      players.splice(Number(x.dataset.i), 1);
      renderPlayers();
    });

    // Settings
    $$('.seg').forEach(seg => seg.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      const key = seg.dataset.setting;
      settings[key] = key === 'difficulty' || key === 'mode' ? b.dataset.value : Number(b.dataset.value);
      Sound.init(); Sound.click();
      renderSettings();
    }));
    $('#sound-toggle').addEventListener('click', () => {
      settings.sound = !settings.sound;
      Sound.init(); Sound.click();
      renderSettings();
    });
    $('#reset-used').addEventListener('click', () => {
      if (!confirm('Reset the used-puzzle memory? Every puzzle becomes fresh again.')) return;
      store.set(KEYS.used, []);
      renderFreshCount();
      toast('♻️ All puzzles are fresh again!');
    });

    // Custom puzzles dialog
    const dlg = $('#custom-dialog');
    $('#open-custom').addEventListener('click', () => { renderCustomList(); dlg.showModal(); $('#c-emoji').focus(); });
    $('#close-custom').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    $('#custom-form').addEventListener('submit', saveCustom);
    $('#custom-list').addEventListener('click', e => {
      const b = e.target.closest('[data-del]');
      if (!b) return;
      const c = customPuzzles[Number(b.dataset.del)];
      if (!c || !confirm(`Delete the puzzle “${c.t}”?`)) return;
      customPuzzles.splice(Number(b.dataset.del), 1);
      store.set(KEYS.custom, customPuzzles);
      renderCustomList();
    });

    // Start
    $('#start-btn').addEventListener('click', () => {
      if (players.length < MIN_PLAYERS) return;
      startGame(players.slice());
    });

    // Game controls
    $('#reveal-btn').addEventListener('click', reveal);
    $('#next-btn').addEventListener('click', next);
    $('#skip-btn').addEventListener('click', skip);
    $('#undo-btn').addEventListener('click', undo);
    $('#hint-btn').addEventListener('click', manualHint);
    $('#timer').addEventListener('click', togglePause);
    $('#scoreboard').addEventListener('click', e => {
      const b = e.target.closest('.pl');
      if (b) award(Number(b.dataset.i));
    });
    $('#end-game-btn').addEventListener('click', () => {
      if (confirm('End the game now and show the final results?')) endGame();
    });

    // Final screen
    $('#play-again-btn').addEventListener('click', () => startGame(game.players.map(p => p.name)));
    $('#new-game-btn').addEventListener('click', () => {
      Confetti.clear();
      game = null;
      renderPlayers();
      renderFreshCount();
      showScreen('setup');
    });

    // Never leave focus on a game button (so Space doesn't double-click it)
    document.addEventListener('click', e => {
      const b = e.target.closest('#screen-game button, #screen-final button');
      if (b) b.blur();
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', e => {
      if ((e.target.closest && e.target.closest('input, textarea, dialog')) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (currentScreen() !== 'screen-game' || !game) return;
      const k = e.key.toLowerCase();
      if (e.code === 'Space') { e.preventDefault(); reveal(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (k === 'h') manualHint();
      else if (k === 's') skip();
      else if (k === 'u') undo();
      else if (k === 'p') togglePause();
    });

    window.addEventListener('resize', fitEmoji);
    // Unlock audio on the very first interaction anywhere
    document.addEventListener('pointerdown', () => Sound.init(), { once: true });
  }

  // ============================================================
  // Boot
  // ============================================================
  makeSparkles();
  bind();
  renderPlayers();
  renderSettings();
  renderFreshCount();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitEmoji);
})();
