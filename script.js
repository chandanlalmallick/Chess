/* =========================================================================
   CHESS WEBSITE — script.js
   Uses chess.js (CDN) for rules. Custom minimax AI (no Stockfish — see
   README for why). Firebase Realtime Database for online multiplayer.
   ========================================================================= */

/* -------------------------------------------------------------------------
   0. FIREBASE CONFIGURATION
   Paste your Firebase project's config object below. See README.md for
   step-by-step instructions on where to get these values.
   If you leave this as-is, Offline play still works fully — only
   "Play Online" will show an error telling you Firebase isn't configured.
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
const game = new Chess();

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
   3. SOUND (Web Audio — no external files needed)
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
  } catch (e) { /* audio not available — silently ignore */ }
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
  boardEl.innerHTML = '';

  const board = game.board(); // board[0] = rank 8 ... board[7] = rank 1
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

      // check highlight on king square
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

      // coordinates on edge squares
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
  if (gameOver) return;
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

  // select a new square if it has a piece of the side to move
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
  return true; // pvp — both sides use same device
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
  $('clock-white-time').textContent = formatMs(clock.whiteMs);
  $('clock-black-time').textContent = formatMs(clock.blackMs);
  $('clock-white').classList.toggle('active', clock.activeColor === 'w' && !gameOver);
  $('clock-black').classList.toggle('active', clock.activeColor === 'b' && !gameOver);
  $('clock-white-time').classList.toggle('low', clock.whiteMs < 20000);
  $('clock-black-time').classList.toggle('low', clock.blackMs < 20000);
}

/* -------------------------------------------------------------------------
   8. CHESS AI (minimax + alpha-beta — no external engine required)
------------------------------------------------------------------------- */
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

// Simple piece-square tables (white's perspective; mirrored for black)
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
const CENTER_TABLE = [ // rough table reused for bishop/rook/queen/king leaning central
  -20,-10,-10,-10,-10,-10,-10,-20,
  -10,0,0,0,0,0,0,-10,
  -10,0,5,5,5,5,0,-10,
  -10,0,5,10,10,5,0,-10,
  -10,0,5,10,10,5,0,-10,
  -10,0,5,5,5,5,0,-10,
  -10,0,0,0,0,0,0,-10,
  -20,-10,-10,-10,-10,-10,-10,-20
];

function squareIndex(file, rank) { return rank * 8 + file; } // rank 0 = rank8 row per board()

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
  return score; // positive favors white
}

function minimax(g, depth, alpha, beta, maximizing) {
  if (g.in_checkmate()) {
    // side to move is checkmated — very bad for whoever's turn it is
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

  // shuffle for variety among equal-value moves
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
    // 65% random legal move, 35% a shallow-best move — makes "Easy" beatable
    if (Math.random() < 0.65) {
      return moves[Math.floor(Math.random() * moves.length)];
    }
    return pickBestMove(game, 1);
  }
  if (aiDifficulty === 'medium') return pickBestMove(game, 2);
  return pickBestMove(game, 3); // hard
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
  if (mode === 'pvc') game.undo(); // undo both the AI move and the human move
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

$('btn-draw-offer').addEventListener('click', () => {
  if (mode === 'online') {
    if (!online.roomRef) return;
    online.roomRef.child('drawOffer').set(online.color);
    toast('Draw offer sent.');
  } else {
    confirmAction('Agree to a draw?', () => endGame('Draw agreed'));
  }
});

$('btn-draw-accept').addEventListener('click', () => {
  hideModal('draw-offer-modal');
  if (online.roomRef) online.roomRef.update({ drawOffer: null, result: 'draw-agreed', status: 'finished' });
  endGame('Draw agreed');
});
$('btn-draw-decline').addEventListener('click', () => {
  hideModal('draw-offer-modal');
  if (online.roomRef) online.roomRef.child('drawOffer').set(null);
});

function confirmAction(text, onYes) {
  $('confirm-text').textContent = text;
  showModal('confirm-modal');
  const yesBtn = $('btn-confirm-yes');
  const noBtn = $('btn-confirm-no');
  const cleanup = () => {
    yesBtn.replaceWith(yesBtn.cloneNode(true));
    noBtn.replaceWith(noBtn.cloneNode(true));
  };
  cleanup();
  $('btn-confirm-yes').addEventListener('click', () => { hideModal('confirm-modal'); onYes(); });
  $('btn-confirm-no').addEventListener('click', () => hideModal('confirm-modal'));
}

$('btn-sound-toggle').addEventListener('click', () => {
  soundOn = !soundOn;
  localStorage.setItem('chess_sound_pref', soundOn ? 'on' : 'off');
  $('btn-sound-toggle').textContent = soundOn ? '🔊' : '🔇';
});

/* -------------------------------------------------------------------------
   10. OFFLINE PERSISTENCE (localStorage) — resume unfinished game
------------------------------------------------------------------------- */
function saveOfflineGameIfNeeded() {
  if (mode === 'online' || gameOver) {
    if (gameOver) localStorage.removeItem('chess_offline_game');
    return;
  }
  const data = {
    fen: game.fen(),
    mode, aiDifficulty, humanColor, boardFlipped,
    clock: clock.enabled ? { whiteMs: clock.whiteMs, blackMs: clock.blackMs, incrementMs: clock.incrementMs, activeColor: clock.activeColor } : null
  };
  localStorage.setItem('chess_offline_game', JSON.stringify(data));
}

function loadOfflineGame() {
  const raw = localStorage.getItem('chess_offline_game');
  if (!raw) return false;
  try {
    const data = JSON.parse(raw);
    game.load(data.fen);
    mode = data.mode;
    aiDifficulty = data.aiDifficulty;
    humanColor = data.humanColor;
    boardFlipped = data.boardFlipped;
    gameOver = false;
    selectedSquare = null;
    legalTargets = [];
    lastMove = null;
    if (data.clock) {
      clock.enabled = true;
      clock.whiteMs = data.clock.whiteMs;
      clock.blackMs = data.clock.blackMs;
      clock.incrementMs = data.clock.incrementMs;
      clock.activeColor = data.clock.activeColor;
      $('clocks-row').classList.remove('hidden');
    } else {
      clock.enabled = false;
      $('clocks-row').classList.add('hidden');
    }
    updateStatus();
    updateMoveHistory();
    renderBoard();
    updateClockDisplay();
    $('room-code-badge').classList.add('hidden');
    showScreen('screen-game');
    if (clock.enabled) startClock();
    return true;
  } catch (e) {
    return false;
  }
}

/* -------------------------------------------------------------------------
   11. ONLINE MULTIPLAYER
------------------------------------------------------------------------- */
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function getOrCreatePlayerId() {
  let id = localStorage.getItem('chess_player_id');
  if (!id) {
    id = 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem('chess_player_id', id);
  }
  return id;
}

function showOnlineError(msg) {
  const el = $('online-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}
function hideOnlineError() { $('online-error').classList.add('hidden'); }

$('btn-create-room').addEventListener('click', async () => {
  hideOnlineError();
  if (!initFirebase()) { showOnlineError('Online play is not configured yet. See README.md to add your Firebase config.'); return; }

  const code = generateRoomCode();
  const playerId = getOrCreatePlayerId();
  const timeSpec = $('online-time-select').value;
  let clockConfig = null;
  if (timeSpec !== 'none') {
    const [secs, inc] = timeSpec.split('-').map(Number);
    clockConfig = { whiteMs: secs * 1000, blackMs: secs * 1000, incrementMs: inc * 1000 };
  }

  const roomData = {
    fen: new Chess().fen(),
    turn: 'w',
    white: playerId,
    black: null,
    status: 'waiting',
    result: null,
    resigned: null,
    drawOffer: null,
    clock: clockConfig,
    createdAt: Date.now()
  };

  try {
    await fbDb.ref('rooms/' + code).set(roomData);
  } catch (e) {
    showOnlineError('Could not create room. Check your internet connection.');
    return;
  }

  online.roomCode = code;
  online.playerId = playerId;
  online.color = 'w';
  localStorage.setItem('chess_online_session', JSON.stringify({ roomCode: code, playerId, color: 'w' }));

  $('room-code-display').textContent = code;
  $('online-setup-forms').classList.add('hidden');
  $('online-waiting').classList.remove('hidden');

  attachRoomListener(code);
});

$('btn-copy-link').addEventListener('click', () => {
  const url = location.href.split('?')[0] + '?room=' + online.roomCode;
  navigator.clipboard?.writeText(url).then(() => toast('Link copied!')).catch(() => toast(url));
});

$('btn-cancel-room').addEventListener('click', async () => {
  if (online.roomRef) online.roomRef.off();
  if (fbDb && online.roomCode) {
    try { await fbDb.ref('rooms/' + online.roomCode).remove(); } catch (e) {}
  }
  localStorage.removeItem('chess_online_session');
  online = { roomCode: null, playerId: null, color: null, roomRef: null, listener: null, applyingRemote: false };
  $('online-setup-forms').classList.remove('hidden');
  $('online-waiting').classList.add('hidden');
});

$('btn-join-room').addEventListener('click', async () => {
  hideOnlineError();
  if (!initFirebase()) { showOnlineError('Online play is not configured yet. See README.md to add your Firebase config.'); return; }

  const code = $('join-code-input').value.trim().toUpperCase();
  if (code.length !== 6) { showOnlineError('Enter a valid 6-character room code.'); return; }

  const playerId = getOrCreatePlayerId();
  const roomRef = fbDb.ref('rooms/' + code);

  let snap;
  try {
    snap = await roomRef.get();
  } catch (e) {
    showOnlineError('Could not reach the server. Check your internet connection.');
    return;
  }

  if (!snap.exists()) { showOnlineError('Room not found. Check the code and try again.'); return; }
  const roomData = snap.val();

  if (roomData.black && roomData.black !== playerId && roomData.white !== playerId) {
    showOnlineError('This room is already full.');
    return;
  }

  if (!roomData.black && roomData.white !== playerId) {
    await roomRef.update({ black: playerId, status: 'active' });
    online.color = 'b';
  } else if (roomData.white === playerId) {
    online.color = 'w';
  } else {
    online.color = 'b';
  }

  online.roomCode = code;
  online.playerId = playerId;
  localStorage.setItem('chess_online_session', JSON.stringify({ roomCode: code, playerId, color: online.color }));

  enterOnlineGame(code);
});

function attachRoomListener(code) {
  online.roomRef = fbDb.ref('rooms/' + code);
  online.listener = online.roomRef.on('value', (snap) => {
    if (!snap.exists()) {
      toast('The game room was closed.');
      return;
    }
    const data = snap.val();
    handleRemoteRoomUpdate(data);
  });
}

function enterOnlineGame(code) {
  mode = 'online';
  boardFlipped = online.color === 'b';
  gameOver = false;
  $('room-code-badge').textContent = 'Room: ' + code;
  $('room-code-badge').classList.remove('hidden');
  showScreen('screen-game');
  if (!online.roomRef) attachRoomListener(code); // creator already has a listener from btn-create-room
}

function handleRemoteRoomUpdate(data) {
  online.applyingRemote = true;

  if (data.status === 'waiting') {
    // still shown on waiting screen; nothing to render yet
    online.applyingRemote = false;
    return;
  }

  if ($('screen-game').classList.contains('active') === false) {
    // opponent joined while we were on the waiting screen
    $('online-waiting').classList.add('hidden');
    enterOnlineGame(online.roomCode);
  }

  if (data.fen && data.fen !== game.fen()) {
    game.load(data.fen);
  }

  if (data.clock) {
    clock.enabled = true;
    clock.whiteMs = data.clock.whiteMs;
    clock.blackMs = data.clock.blackMs;
    clock.incrementMs = data.clock.incrementMs || 0;
    clock.activeColor = game.turn();
    $('clocks-row').classList.remove('hidden');
  } else {
    clock.enabled = false;
    $('clocks-row').classList.add('hidden');
  }

  selectedSquare = null;
  legalTargets = [];
  updateStatus();
  updateMoveHistory();
  renderBoard();
  updateClockDisplay();

  if (data.drawOffer && data.drawOffer !== online.color) {
    $('draw-offer-text').textContent = 'Opponent offered a draw';
    showModal('draw-offer-modal');
  } else {
    hideModal('draw-offer-modal');
  }

  if (data.resigned) {
    const winner = data.resigned === 'w' ? 'Black' : 'White';
    endGame(`${winner} wins by resignation`);
  } else if (data.result === 'draw-agreed') {
    endGame('Draw agreed');
  } else if (game.game_over() && !gameOver) {
    checkGameOver();
  }

  if (data.status === 'active' && clock.enabled && !gameOver) {
    startClock();
  }

  online.applyingRemote = false;
}

function pushOnlineState(finished, extra) {
  if (!online.roomRef) return;
  const payload = {
    fen: game.fen(),
    turn: game.turn(),
    status: finished ? 'finished' : 'active',
    drawOffer: null
  };
  if (clock.enabled) {
    payload.clock = { whiteMs: clock.whiteMs, blackMs: clock.blackMs, incrementMs: clock.incrementMs };
  }
  if (extra) Object.assign(payload, extra);
  online.roomRef.update(payload).catch(() => toast('Could not sync move — check your connection.'));
}

/* Attempt to restore an online session on page load (refresh / reconnect) */
function tryRestoreOnlineSession() {
  const raw = localStorage.getItem('chess_online_session');
  if (!raw) return false;
  let session;
  try { session = JSON.parse(raw); } catch (e) { return false; }
  if (!session || !session.roomCode) return false;
  if (!initFirebase()) return false;

  fbDb.ref('rooms/' + session.roomCode).get().then((snap) => {
    if (!snap.exists()) { localStorage.removeItem('chess_online_session'); return; }
    online.roomCode = session.roomCode;
    online.playerId = session.playerId;
    online.color = session.color;
    enterOnlineGame(session.roomCode);
  }).catch(() => {});
  return true;
}

/* -------------------------------------------------------------------------
   12. NAVIGATION / SETUP SCREEN WIRING
------------------------------------------------------------------------- */
$('btn-play-offline').addEventListener('click', () => {
  const hasSaved = !!localStorage.getItem('chess_offline_game');
  $('resume-banner').classList.toggle('hidden', !hasSaved);
  showScreen('screen-offline-setup');
});

$('btn-resume-game').addEventListener('click', () => {
  if (!loadOfflineGame()) toast('Could not resume — starting fresh.');
});

$('btn-play-online').addEventListener('click', () => {
  hideOnlineError();
  $('online-setup-forms').classList.remove('hidden');
  $('online-waiting').classList.add('hidden');
  showScreen('screen-online-setup');
});

$('btn-how-to-play').addEventListener('click', () => showScreen('screen-howto'));

document.querySelectorAll('[data-back]').forEach(btn => {
  btn.addEventListener('click', () => showScreen(btn.dataset.back));
});

$('btn-back-home').addEventListener('click', () => {
  confirmAction('Leave this game and go home?', () => {
    clearTimeout(aiMoveTimer);
    stopClock();
    if (mode === 'online' && online.roomRef) {
      online.roomRef.off();
    }
    showScreen('screen-home');
  });
});

document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const timeSpec = $('offline-time-select').value;
    startOfflineGame('pvc', btn.dataset.diff, timeSpec);
  });
});

$('btn-start-pvp').addEventListener('click', () => {
  const timeSpec = $('offline-time-select').value;
  startOfflineGame('pvp', null, timeSpec);
});

/* -------------------------------------------------------------------------
   13. INIT
------------------------------------------------------------------------- */
function init() {
  $('btn-sound-toggle').textContent = soundOn ? '🔊' : '🔇';

  // If URL has ?room=CODE, pre-fill join field
  const params = new URLSearchParams(location.search);
  if (params.get('room')) {
    $('join-code-input').value = params.get('room').toUpperCase();
  }

  const restoredOnline = tryRestoreOnlineSession();
  if (!restoredOnline) {
    renderBoard(); // draw an initial empty-ish board so screen-game isn't blank if reached directly
  }

  showScreen('screen-home');

  window.addEventListener('beforeunload', () => {
    saveOfflineGameIfNeeded();
  });
}

init();
