/* =========================================================================
   CHESS WEBSITE — script.js
   Uses chess.js (CDN) for rules. Custom minimax AI (no Stockfish).
   Firebase Realtime Database for online multiplayer.
   ========================================================================= */

/* -------------------------------------------------------------------------
   0. FIREBASE CONFIGURATION (Optional: Needed only for Online Multiplayer)
------------------------------------------------------------------------- */
const firebaseConfig = {
  apiKey: "PASTE_YOUR_API_KEY_HERE",
  authDomain: "PASTE_YOUR_PROJECT.firebaseapp.com",
  databaseURL: "https://PASTE_YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId: "PASTE_YOUR_PROJECT",
  storageBucket: "PASTE_YOUR_PROJECT.appspot.com",
  messagingSenderId: "PASTE_YOUR_SENDER_ID",
  appId: "PASTE_YOUR_APP_ID"
};

const FIREBASE_CONFIGURED = !firebaseConfig.apiKey.includes("PASTE_YOUR");
let fbApp = null;
let fbDb = null;

function initFirebase() {
  if (!FIREBASE_CONFIGURED) return false;
  if (fbApp) return true;
  try {
    fbApp = firebase.initializeApp(firebaseConfig);
    fbDb = firebase.database();
    return true;
  } catch (e) {
    console.error("Firebase init failed:", e);
    return false;
  }
}

/* -------------------------------------------------------------------------
   1. GLOBAL STATE
------------------------------------------------------------------------- */
let game = null;

try {
  game = new Chess();
} catch (e) {
  console.error("chess.js failed to load. Check your internet connection.", e);
}

let mode = null;              // 'pvc' | 'pvp' | 'online'
let aiDifficulty = 'medium';  // 'easy' | 'medium' | 'hard'
let humanColor = 'w';         // color the human plays in PvC
let boardFlipped = false;
let selectedSquare = null;
let legalTargets = [];        // verbose move objects for the selected square
let lastMove = null;          // {from,to}
let gameOver = false;

let soundOn = localStorage.getItem('chess_sound_pref') !== 'off';

// Clock state
let clock = {
  enabled: false,
  whiteMs: 0,
  blackMs: 0,
  incrementMs: 0,
  activeColor: null,
  timerId: null,
  lastTick: null
};

// Online state
let online = {
  roomCode: null,
  playerId: null,
  color: null,        // 'w' or 'b' assigned to this browser
  roomRef: null,
  listener: null,
  applyingRemote: false
};

/* -------------------------------------------------------------------------
   2. DOM HELPERS
------------------------------------------------------------------------- */
const $ = (id) => document.getElementById(id);

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = $(id);
  if (el) el.classList.add('active');
}

function toast(msg, ms = 2600) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => t.classList.add('hidden'), ms);
}

function showModal(id) { $(id).classList.remove('hidden'); }
function hideModal(id) { $(id).classList.add('hidden'); }

/* -------------------------------------------------------------------------
   3. SOUND (Web Audio — self-contained)
------------------------------------------------------------------------- */
let audioCtx = null;
function beep(freq, dur, type = 'sine', vol = 0.15) {
  if (!soundOn) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    osc.stop(audioCtx.currentTime + dur);
  } catch (e) { /* audio not available */ }
}

function playSound(kind) {
  if (kind === 'move') beep(440, 0.08);
  else if (kind === 'capture') beep(300, 0.1, 'square');
  else if (kind === 'check') beep(600, 0.15, 'sawtooth');
  else if (kind === 'end') beep(220, 0.4, 'triangle', 0.2);
}

/* -------------------------------------------------------------------------
   4. PIECE RENDERING
------------------------------------------------------------------------- */
const PIECE_UNICODE = {
  w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
  b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' }
};
const FILES = ['a','b','c','d','e','f','g','h'];

function renderBoard() {
  const boardEl = $('board');
  if (!boardEl || !game) return;
  boardEl.innerHTML = '';

  const board = game.board();
  let ranks = [0,1,2,3,4,5,6,7];
  let files = [0,1,2,3,4,5,6,7];
  if (boardFlipped) { ranks = ranks.slice().reverse(); files = files.slice().reverse(); }

  for (const r of ranks) {
    for (const f of files) {
      const square = FILES[f] + (8 - r);
      const isLight = (r + f) % 2 === 0;
      const sqEl = document.createElement('div');
      sqEl.className = 'square ' + (isLight ? 'light' : 'dark');
      sqEl.dataset.square = square;

      const piece = board[r][f];
      if (piece) {
        const span = document.createElement('span');
        span.className = 'piece ' + (piece.color === 'w' ? 'white' : 'black');
        span.textContent = PIECE_UNICODE[piece.color][piece.type];
        sqEl.appendChild(span);
      }

      if (selectedSquare === square) sqEl.classList.add('selected');
      if (lastMove && (lastMove.from === square || lastMove.to === square)) sqEl.classList.add('last-move');

      if (game.in_check()) {
        const turnColor = game.turn();
        if (piece && piece.type === 'k' && piece.color === turnColor) {
          sqEl.classList.add('in-check');
        }
      }

      const targetMove = legalTargets.find(m => m.to === square);
      if (targetMove) {
        const marker = document.createElement('div');
        marker.className = targetMove.flags.includes('c') || targetMove.flags.includes('e') ? 'capture-ring' : 'move-dot';
        sqEl.appendChild(marker);
      }

      if (f === (boardFlipped ? 7 : 0)) {
        const rankLabel = document.createElement('span');
        rankLabel.className = 'coord rank';
        rankLabel.textContent = 8 - r;
        sqEl.appendChild(rankLabel);
      }
      if (r === (boardFlipped ? 0 : 7)) {
        const fileLabel = document.createElement('span');
        fileLabel.className = 'coord file';
        fileLabel.textContent = FILES[f];
        sqEl.appendChild(fileLabel);
      }

      sqEl.addEventListener('click', () => onSquareClick(square));
      boardEl.appendChild(sqEl);
    }
  }
}

/* -------------------------------------------------------------------------
   5. MOVE INTERACTION
------------------------------------------------------------------------- */
function onSquareClick(square) {
  if (gameOver || !game) return;
  if (!isMyTurnToInteract()) return;

  if (selectedSquare) {
    const move = legalTargets.find(m => m.to === square);
    if (move) {
      if (move.flags.includes('p')) {
        askPromotion((piece) => executeMove(selectedSquare, square, piece));
      } else {
        executeMove(selectedSquare, square);
      }
      selectedSquare = null;
      legalTargets = [];
      renderBoard();
      return;
    }
  }

  const piece = game.get(square);
  if (piece && piece.color === game.turn()) {
    selectedSquare = square;
    legalTargets = game.moves({ square, verbose: true });
  } else {
    selectedSquare = null;
    legalTargets = [];
  }
  renderBoard();
}

function isMyTurnToInteract() {
  if (mode === 'pvc') return game.turn() === humanColor;
  if (mode === 'online') return game.turn() === online.color;
  return true;
}

function askPromotion(callback) {
  const box = $('promo-choices');
  box.innerHTML = '';
  const color = game.turn();
  ['q','r','b','n'].forEach(p => {
    const btn = document.createElement('button');
    btn.textContent = PIECE_UNICODE[color][p];
    btn.addEventListener('click', () => {
      hideModal('promotion-modal');
      callback(p);
    });
    box.appendChild(btn);
  });
  showModal('promotion-modal');
}

function executeMove(from, to, promotion) {
  if (mode === 'online' && game.turn() !== online.color) {
    toast("It's not your turn.");
    return null;
  }

  const moveObj = { from, to };
  if (promotion) moveObj.promotion = promotion;
  const result = game.move(moveObj);
  if (!result) return null;

  lastMove = { from, to };
  playSound(result.captured ? 'capture' : 'move');

  if (clock.enabled) {
    applyIncrement(result.color);
    clock.activeColor = game.turn();
  }

  afterMove(result);
  return result;
}

function applyIncrement(colorThatMoved) {
  if (!clock.enabled || clock.incrementMs <= 0) return;
  if (colorThatMoved === 'w') clock.whiteMs += clock.incrementMs;
  else clock.blackMs += clock.incrementMs;
}

function afterMove(result) {
  updateStatus();
  updateMoveHistory();
  renderBoard();
  updateClockDisplay();

  if (game.in_check() && !game.game_over()) playSound('check');

  checkGameOver();

  if (mode === 'online') {
    pushOnlineState();
  }

  if (clock.enabled && !gameOver) startClock();

  if (!gameOver && mode === 'pvc' && game.turn() !== humanColor) {
    clearTimeout(aiMoveTimer);
    aiMoveTimer = setTimeout(makeAIMove, 350);
  }

  saveOfflineGameIfNeeded();
}
let aiMoveTimer = null;

/* -------------------------------------------------------------------------
   6. STATUS / GAME OVER
------------------------------------------------------------------------- */
function updateStatus() {
  const bar = $('status-bar');
  bar.classList.remove('check', 'over');

  if (game.in_checkmate()) {
    const winner = game.turn() === 'w' ? 'Black' : 'White';
    bar.textContent = `Checkmate — ${winner} wins`;
    bar.classList.add('over');
  } else if (game.in_stalemate()) {
    bar.textContent = 'Stalemate — Draw';
    bar.classList.add('over');
  } else if (game.insufficient_material()) {
    bar.textContent = 'Draw — Insufficient material';
    bar.classList.add('over');
  } else if (game.in_threefold_repetition()) {
    bar.textContent = 'Draw — Threefold repetition';
    bar.classList.add('over');
  } else if (game.in_draw()) {
    bar.textContent = 'Draw — Fifty-move rule';
    bar.classList.add('over');
  } else if (game.in_check()) {
    const side = game.turn() === 'w' ? 'White' : 'Black';
    bar.textContent = `${side} is in check`;
    bar.classList.add('check');
  } else {
    const side = game.turn() === 'w' ? 'White' : 'Black';
    bar.textContent = `${side} to move`;
  }
}

function checkGameOver() {
  if (game.game_over()) {
    endGame(null, true);
  }
}

function endGame(message, fromRules) {
  if (gameOver) return;
  gameOver = true;
  stopClock();
  playSound('end');
  if (message) {
    const bar = $('status-bar');
    bar.textContent = message;
    bar.classList.add('over');
  }
  if (mode === 'online') pushOnlineState(true);
}

function updateMoveHistory() {
  const hist = game.history();
  const el = $('move-history');
  el.innerHTML = '';
  for (let i = 0; i < hist.length; i += 2) {
    const num = document.createElement('div');
    num.className = 'mv-num';
    num.textContent = (i / 2 + 1) + '.';
    const white = document.createElement('div');
    white.textContent = hist[i] || '';
    const black = document.createElement('div');
    black.textContent = hist[i + 1] || '';
    el.appendChild(num);
    el.appendChild(white);
    el.appendChild(black);
  }
  el.scrollTop = el.scrollHeight;
}

/* -------------------------------------------------------------------------
   7. CLOCK
------------------------------------------------------------------------- */
function setupClock(totalSeconds, incrementSeconds) {
  if (totalSeconds == null) {
    clock.enabled = false;
    $('clocks-row').classList.add('hidden');
    return;
  }
  clock.enabled = true;
  clock.whiteMs = totalSeconds * 1000;
  clock.blackMs = totalSeconds * 1000;
  clock.incrementMs = (incrementSeconds || 0) * 1000;
  clock.activeColor = 'w';
  $('clocks-row').classList.remove('hidden');
  updateClockDisplay();
}

function startClock() {
  if (!clock.enabled || gameOver) return;
  stopClockTimer();
  clock.lastTick = Date.now();
  clock.timerId = setInterval(tickClock, 200);
}

function tickClock() {
  if (!clock.enabled || gameOver) return;
  const now = Date.now();
  const delta = now - clock.lastTick;
  clock.lastTick = now;

  if (clock.activeColor === 'w') clock.whiteMs -= delta;
  else clock.blackMs -= delta;

  if (clock.whiteMs <= 0) { clock.whiteMs = 0; onTimeout('w'); }
  if (clock.blackMs <= 0) { clock.blackMs = 0; onTimeout('b'); }

  updateClockDisplay();
}

function onTimeout(color) {
  const winner = color === 'w' ? 'Black' : 'White';
  endGame(`Time out — ${winner} wins`);
}

function stopClockTimer() {
  if (clock.timerId) { clearInterval(clock.timerId); clock.timerId = null; }
}
function stopClock() { stopClockTimer(); }

function formatMs(ms) {
  ms = Math.max(0, ms);
  const totalSec = Math.ceil(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}

function updateClockDisplay() {
  if (!clock.enabled) return;
  $('clock-white-time').textContent = formatMs(clock.whiteMs);$('clock-black-time').textContent = formatMs(clock.blackMs);
  $('clock-white').classList.toggle('active', clock.activeColor === 'w' && !gameOver);$('clock-black').classList.toggle('active', clock.activeColor === 'b' && !gameOver);
  $('clock-white-time').classList.toggle('low', clock.whiteMs < 20000);$('clock-black-time').classList.toggle('low', clock.blackMs < 20000);
}

/* -------------------------------------------------------------------------
   8. CHESS AI (Minimax with Alpha-Beta Pruning)
------------------------------------------------------------------------- */
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

const PAWN_TABLE = [
  0,0,0,0,0,0,0,0,
  50,50,50,50,50,50,50,50,
  10,10,20,30,30,20,10,10,
  5,5,10,25,25,10,5,5,
  0,0,0,20,20,0,0,0,
  5,-5,-10,0,0,-10,-5,5,
  5,10,10,-20,-20,10,10,5,
  0,0,0,0,0,0,0,0
];
const KNIGHT_TABLE = [
  -50,-40,-30,-30,-30,-30,-40,-50,
  -40,-20,0,0,0,0,-20,-40,
  -30,0,10,15,15,10,0,-30,
  -30,5,15,20,20,15,5,-30,
  -30,0,15,20,20,15,0,-30,
  -30,5,10,15,15,10,5,-30,
  -40,-20,0,5,5,0,-20,-40,
  -50,-40,-30,-30,-30,-30,-40,-50
];
const CENTER_TABLE = [
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,0,0,0,0,0,0,-10,
  -10,0,5,5,5,5,0,-10,
  -10,0,5,10,10,5,0,-10,
  -10,0,5,10,10,5,0,-10,
  -10,0,5,5,5,5,0,-10,
  -10,0,0,0,0,0,0,-10,
  -20,-10,-10,-10,-10,-10,-10,-20
];

function squareIndex(file, rank) { return rank * 8 + file; }

function evaluateBoard(g) {
  const board = g.board();
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p) continue;
      let val = PIECE_VALUES[p.type];
      let table = p.type === 'p' ? PAWN_TABLE : (p.type === 'n' ? KNIGHT_TABLE : CENTER_TABLE);
      const idx = p.color === 'w' ? squareIndex(f, r) : squareIndex(f, 7 - r);
      val += table[idx] || 0;
      score += (p.color === 'w') ? val : -val;
    }
  }
  return score;
}

function minimax(g, depth, alpha, beta, maximizing) {
  if (g.in_checkmate()) {
    return g.turn() === 'w' ? -100000 - depth : 100000 + depth;
  }
  if (g.in_draw() || g.in_stalemate() || g.in_threefold_repetition()) {
    return 0;
  }
  if (depth === 0) {
    return evaluateBoard(g);
  }
  const moves = g.moves({ verbose: true });

  if (maximizing) {
    let best = -Infinity;
    for (const m of moves) {
      g.move(m);
      const val = minimax(g, depth - 1, alpha, beta, false);
      g.undo();
      best = Math.max(best, val);
      alpha = Math.max(alpha, val);
      if (beta <= alpha) break;
    }
    return best;
  } else {
    let best = Infinity;
    for (const m of moves) {
      g.move(m);
      const val = minimax(g, depth - 1, alpha, beta, true);
      g.undo();
      best = Math.min(best, val);
      beta = Math.min(beta, val);
      if (beta <= alpha) break;
    }
    return best;
  }
}

function pickBestMove(g, depth) {
  const moves = g.moves({ verbose: true });
  if (moves.length === 0) return null;
  const maximizing = g.turn() === 'w';
  let best = null;
  let bestVal = maximizing ? -Infinity : Infinity;

  for (let i = moves.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [moves[i], moves[j]] = [moves[j], moves[i]];
  }

  for (const m of moves) {
    g.move(m);
    const val = minimax(g, depth - 1, -Infinity, Infinity, !maximizing);
    g.undo();
    if (maximizing ? val > bestVal : val < bestVal) {
      bestVal = val;
      best = m;
    }
  }
  return best;
}

function getAIMove() {
  if (aiDifficulty === 'easy') {
    const moves = game.moves({ verbose: true });
    if (Math.random() < 0.65) {
      return moves[Math.floor(Math.random() * moves.length)];
    }
    return pickBestMove(game, 1);
  }
  if (aiDifficulty === 'medium') return pickBestMove(game, 2);
  return pickBestMove(game, 3);
}

function makeAIMove() {
  if (gameOver) return;
  const move = getAIMove();
  if (!move) return;
  lastMove = { from: move.from, to: move.to };
  const result = game.move(move);
  playSound(result.captured ? 'capture' : 'move');
  applyIncrement(result.color);
  clock.activeColor = game.turn();
  updateStatus();
  updateMoveHistory();
  renderBoard();
  updateClockDisplay();
  if (game.in_check() && !game.game_over()) playSound('check');
  checkGameOver();
  if (clock.enabled && !gameOver) startClock();
  saveOfflineGameIfNeeded();
}

/* -------------------------------------------------------------------------
   9. NEW GAME / UNDO / FLIP / RESIGN / DRAW
------------------------------------------------------------------------- */
function resetGameState() {
  game.reset();
  selectedSquare = null;
  legalTargets = [];
  lastMove = null;
  gameOver = false;
  updateStatus();
  updateMoveHistory();
  renderBoard();
}

function startOfflineGame(newMode, difficulty, timeSpec) {
  mode = newMode;
  aiDifficulty = difficulty || 'medium';
  humanColor = 'w';
  boardFlipped = false;
  resetGameState();
  applyTimeSpec(timeSpec);
  $('room-code-badge').classList.add('hidden');
  showScreen('screen-game');
  if (clock.enabled) startClock();
}

function applyTimeSpec(spec) {
  if (!spec || spec === 'none') { setupClock(null); return; }
  const [secs, inc] = spec.split('-').map(Number);
  setupClock(secs, inc);
}

$('btn-flip').addEventListener('click', () => {
  boardFlipped = !boardFlipped;
  renderBoard();
});

$('btn-new-game').addEventListener('click', () => {
  if (mode === 'online') {
    toast("Use 'Play Online' to start a fresh room.");
    return;
  }
  confirmAction('Start a new game? Current progress will be lost.', () => {
    clearTimeout(aiMoveTimer);
    stopClock();
    resetGameState();
    if (clock.enabled) {
      applyTimeSpec($('offline-time-select').value);
      startClock();
    }
  });
});

$('btn-undo').addEventListener('click', () => {
  if (mode === 'online') { toast('Undo is not available in online games.'); return; }
  if (gameOver) return;
  clearTimeout(aiMoveTimer);
  game.undo();
  if (mode === 'pvc') game.undo();
  lastMove = null;
  selectedSquare = null;
  legalTargets = [];
  updateStatus();
  updateMoveHistory();
  renderBoard();
});

$('btn-resign').addEventListener('click', () => {
  confirmAction('Are you sure you want to resign?', () => {
    let winner;
    if (mode === 'online') {
      winner = online.color === 'w' ? 'Black' : 'White';
      endGame(`${winner} wins by resignation`);
      pushOnlineState(true, { resigned: online.color });
    } else {
      winner = game.turn() === 'w' ? 'Black' : 'White';
      endGame(`${winner} wins by resignation`);
    }
  });
});

$('btn-draw-offer').addEventListener('click', () 
