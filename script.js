/* ============================================================
   AURORA CALCULATOR — Logic
   Safe tokenizer + shunting-yard evaluator (no eval())
   ============================================================ */

'use strict';

/* ---------- DOM references ---------- */
const displayOutput    = document.getElementById('displayOutput');
const displayExpression = document.getElementById('displayExpression');
const displayPreview   = document.getElementById('displayPreview');
const keysContainer    = document.getElementById('keys');
const historyList      = document.getElementById('historyList');
const historyEmpty     = document.getElementById('historyEmpty');
const clearHistoryBtn  = document.getElementById('clearHistory');
const themeToggle      = document.getElementById('themeToggle');
const soundToggle      = document.getElementById('soundToggle');
const copyResultBtn    = document.getElementById('copyResult');
const toastEl          = document.getElementById('toast');

/* ---------- Constants ---------- */
const GLYPH      = { '+': '+', '-': '−', '*': '×', '/': '÷' };
const PLAIN_KEY  = 'aurora-calc-theme';
const MUTE_KEY   = 'aurora-calc-muted';
const HISTORY_KEY = 'aurora-calc-history';
const MAX_DIGITS = 15;
const MAX_HISTORY = 40;

/* ---------- State ---------- */
const state = {
  expr: '',            // internal expression, e.g. "12+3×-4"  (digits, '.', + - * /)
  justEvaluated: false,
  lastValue: null,     // JS number of the last computed result
  error: false,
  history: [],
};

/* ============================================================
   Number & expression formatting helpers
   ============================================================ */
const NUM_PART = String.raw`\d+\.?\d*|\.\d+|\d+e[+-]?\d+|\d*\.?\d+e[+-]?\d+`;

function tidy(num) {
  // Strip floating-point artefacts (0.1 + 0.2 -> 0.3)
  if (!Number.isFinite(num)) return num;
  if (num === 0) return 0;
  return parseFloat(num.toPrecision(12));
}

function toPlain(num) {
  // Plain (non-exponential) string safe for the tokenizer
  if (!Number.isFinite(num)) return '0';
  if (num === 0) return '0';
  const abs = Math.abs(num);
  if (abs >= 1e21) return num.toExponential(); // tokenizer understands e-notation
  return String(tidy(num));
}

function formatNumberStr(raw) {
  // Format a raw number literal (from the expression) with thousands separators
  if (!raw) return '';
  if (/e/i.test(raw)) return raw;               // leave e-notation untouched
  const negative = raw.startsWith('-');
  const body = negative ? raw.slice(1) : raw;
  const [int = '', ...rest] = body.split('.');
  const grouped = int ? Number(int).toLocaleString('en-US', { maximumFractionDigits: 0 }) : '';
  const decimals = rest.length ? '.' + rest.join('.') : '';
  return (negative ? '-' : '') + grouped + decimals;
}

function formatResult(num) {
  if (!Number.isFinite(num)) return null;
  const n = Object.is(num, -0) ? 0 : tidy(num);
  const abs = Math.abs(n);
  if (n !== 0 && (abs >= 1e15 || abs < 1e-9)) {
    const [mantissa, exp] = n.toExponential(6).split('e');
    const cleanMantissa = String(tidy(parseFloat(mantissa)));
    return `${cleanMantissa}e${exp.replace('+', '')}`;
  }
  const [int, ...rest] = String(n).split('.');
  const grouped = Number(int).toLocaleString('en-US');
  const decimals = rest.length ? '.' + rest.join('') : '';
  return grouped + decimals;
}

function prettyExpr(s) {
  if (!s) return '';
  const parts = s.match(new RegExp(`(${NUM_PART})|([+\\-*/])`, 'gi')) || [];
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i];
    if (/^[+\-*/]$/.test(t)) {
      const prev = parts[i - 1];
      const isUnary = t === '-' && (i === 0 || /^[+\-*/]$/.test(prev));
      if (isUnary) { out += '−'; continue; }
      out += ' ' + GLYPH[t] + ' ';
    } else {
      out += formatNumberStr(t);
    }
  }
  return out;
}

/* ============================================================
   Tokenizer + shunting-yard evaluator
   ============================================================ */
const PRECEDENCE = { '+': 1, '-': 1, '*': 2, '/': 2 };

function evaluate(s) {
  // --- tokenize with unary minus support ---
  const raw = [];
  const re = /(\d+\.?\d*|\.\d+|\d*\.?\d+e[+-]?\d+)|([+\-*/])/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    if (m[1] !== undefined) raw.push({ type: 'num', value: parseFloat(m[1]) });
    else raw.push({ type: 'op', value: m[2] });
  }
  // fold unary minuses into numbers
  const tokens = [];
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    if (t.type === 'op' && t.value === '-' && (i === 0 || raw[i - 1].type === 'op')) {
      const next = raw[i + 1];
      if (next && next.type === 'num') {
        tokens.push({ type: 'num', value: -next.value });
        i++;
        continue;
      }
    }
    tokens.push(t);
  }
  if (!tokens.length) return 0;

  // --- shunting-yard -> RPN ---
  const output = [];
  const ops = [];
  for (const t of tokens) {
    if (t.type === 'num') { output.push(t); continue; }
    while (ops.length) {
      const top = ops[ops.length - 1];
      if (PRECEDENCE[top.value] >= PRECEDENCE[t.value]) output.push(ops.pop());
      else break;
    }
    ops.push(t);
  }
  while (ops.length) output.push(ops.pop());

  // --- evaluate RPN ---
  const stack = [];
  for (const t of output) {
    if (t.type === 'num') { stack.push(t.value); continue; }
    const b = stack.pop();
    const a = stack.pop();
    if (a === undefined || b === undefined) throw new Error('Malformed expression');
    let r;
    switch (t.value) {
      case '+': r = a + b; break;
      case '-': r = a - b; break;
      case '*': r = a * b; break;
      case '/':
        if (b === 0) { const e = new Error('Cannot divide by zero'); e.code = 'DIV_ZERO'; throw e; }
        r = a / b; break;
      default: throw new Error('Unknown operator');
    }
    stack.push(r);
  }
  return tidy(stack[0]);
}

function stripTrailingOps(s) {
  return s.replace(/[+\-*/]+$/, '');
}

function hasOperator(s) {
  const stripped = stripTrailingOps(s);
  return /[+\-*/]/.test(stripped.slice(1)); // ignore leading sign
}

/* ============================================================
   Rendering
   ============================================================ */
function currentSegment() {
  const m = state.expr.match(/[\d.]*$/);
  return m ? m[0] : '';
}

function render() {
  // --- big output ---
  if (state.error) {
    displayOutput.textContent = "Can't divide by 0";
    displayOutput.classList.add('error');
  } else if (state.justEvaluated && state.lastValue !== null) {
    displayOutput.textContent = formatResult(state.lastValue) ?? 'Error';
    displayOutput.classList.remove('error');
  } else {
    const seg = currentSegment();
    displayOutput.textContent = seg ? formatNumberStr(seg) : '0';
    displayOutput.classList.remove('error');
  }

  // --- small expression line ---
  if (state.justEvaluated) {
    displayExpression.textContent = currentCommittedExpression + ' =';
  } else {
    displayExpression.innerHTML = state.expr ? prettyExpr(state.expr) : '&nbsp;';
  }

  // --- live preview ---
  if (state.error || state.justEvaluated) {
    displayPreview.innerHTML = '&nbsp;';
  } else {
    const candidate = stripTrailingOps(state.expr);
    if (candidate && hasOperator(candidate) && !/[+\-*/]$/.test(candidate)) {
      try {
        const result = evaluate(candidate);
        displayPreview.textContent = '= ' + (formatResult(result) ?? 'Error');
      } catch {
        displayPreview.textContent = '= Error';
      }
    } else {
      displayPreview.innerHTML = '&nbsp;';
    }
  }

  // --- highlight active trailing operator ---
  const lastChar = state.expr.slice(-1);
  keysContainer.querySelectorAll('.key-op').forEach(btn => {
    btn.classList.toggle('active-op', !state.justEvaluated && lastChar === btn.dataset.operator && !state.error);
  });
}

let currentCommittedExpression = '';

/* ============================================================
   History
   ============================================================ */
function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    state.history = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(state.history)) state.history = [];
  } catch {
    state.history = [];
  }
}

function saveHistory() {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(0, MAX_HISTORY))); }
  catch { /* storage unavailable — ignore */ }
}

function renderHistory() {
  historyList.innerHTML = '';
  const has = state.history.length > 0;
  historyEmpty.style.display = has ? 'none' : 'block';
  clearHistoryBtn.style.visibility = has ? 'visible' : 'hidden';

  for (const entry of state.history) {
    const li = document.createElement('li');
    li.className = 'history-item';
    li.tabIndex = 0;
    li.setAttribute('role', 'button');
    li.title = 'Click to reuse this result';
    li.innerHTML = `
      <div class="history-expr">${escapeHtml(entry.expr)} =</div>
      <div class="history-result">${escapeHtml(entry.display)}</div>`;
    const reuse = () => {
      state.expr = entry.raw;
      state.lastValue = null;
      state.justEvaluated = true;
      state.error = false;
      currentCommittedExpression = entry.expr;
      state.lastValue = parseFloat(entry.raw);
      render();
    };
    li.addEventListener('click', reuse);
    li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); reuse(); } });
    historyList.appendChild(li);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function addToHistory(exprPretty, resultNum) {
  const raw = toPlain(resultNum);
  const display = formatResult(resultNum) ?? raw;
  state.history.unshift({ expr: exprPretty, raw, display, ts: Date.now() });
  if (state.history.length > MAX_HISTORY) state.history.length = MAX_HISTORY;
  saveHistory();
  renderHistory();
}

/* ============================================================
   Core actions
   ============================================================ */
function resetAll() {
  state.expr = '';
  state.justEvaluated = false;
  state.lastValue = null;
  state.error = false;
  currentCommittedExpression = '';
  render();
}

function inputDigit(d) {
  if (state.error) resetAll();
  if (state.justEvaluated) { state.expr = ''; state.justEvaluated = false; state.lastValue = null; }

  const seg = currentSegment();
  if (seg.replace('-', '').replace('.', '').length >= MAX_DIGITS) return;

  // avoid "00" / leading zeros like "007"
  if (seg === '0') { state.expr = state.expr.slice(0, -1) + d; }
  else state.expr += d;
  render();
}

function inputDecimal() {
  if (state.error) resetAll();
  if (state.justEvaluated) { state.expr = '0'; state.justEvaluated = false; state.lastValue = null; }

  const seg = currentSegment();
  if (seg.includes('.')) return;               // one dot per number
  if (!seg) state.expr += '0.';
  else state.expr += '.';
  render();
}

const TRAILING_UNARY = /([+\-*/])\-$/;

function inputOperator(op) {
  if (state.error) return; // require AC after an error

  if (state.justEvaluated && state.lastValue !== null) {
    state.expr = toPlain(state.lastValue);
    state.justEvaluated = false;
  }

  let s = state.expr;
  if (s === '' || s === '-') {
    if (op === '-') state.expr = '-';          // leading negative sign
    return;
  }
  s = s.replace(TRAILING_UNARY, '$1');         // "5+-" -> "5+"
  s = s.replace(/[+\-*/]$/, '');               // drop trailing binary operator
  state.expr = s + op;
  render();
}

function inputPercent() {
  if (state.error) return;
  if (state.justEvaluated && state.lastValue !== null) {
    state.expr = toPlain(state.lastValue);
    state.justEvaluated = false;
    state.lastValue = null;
  }
  const m = state.expr.match(/[\d.]*$/);
  const seg = m ? m[0] : '';
  if (!seg) return;
  const value = tidy(parseFloat(seg) / 100);
  state.expr = state.expr.slice(0, state.expr.length - seg.length) + String(value);
  render();
}

function inputNegate() {
  if (state.error) return;
  const base = state.justEvaluated && state.lastValue !== null
    ? toPlain(state.lastValue)
    : state.expr;

  const segMatch = base.match(/[\d.]*$/);
  const seg = segMatch ? segMatch[0] : '';
  const before = base.slice(0, base.length - seg.length);

  state.justEvaluated = false;
  state.lastValue = null;

  if (seg) {
    if (before.endsWith('-') && (before.length === 1 || /[+\-*/]$/.test(before.slice(0, -1)))) {
      state.expr = before.slice(0, -1) + seg;  // drop unary minus
    } else {
      state.expr = before + '-' + seg;         // add unary minus
    }
  } else {
    if (before === '') state.expr = '-';
    else if (/[+\-*/]$/.test(before)) state.expr = before + '-';
  }
  render();
}

function inputBackspace() {
  if (state.error) { resetAll(); return; }
  if (state.justEvaluated) { resetAll(); return; }
  state.expr = state.expr.slice(0, -1);
  render();
}

function inputEquals() {
  if (state.error) return;
  const cleaned = stripTrailingOps(state.expr);
  if (!/\d/.test(cleaned)) return;

  const pretty = prettyExpr(cleaned);
  try {
    const result = evaluate(cleaned);
    currentCommittedExpression = pretty;
    state.lastValue = result;
    state.expr = '';
    state.justEvaluated = true;
    addToHistory(pretty, result);
  } catch (err) {
    if (err && err.code === 'DIV_ZERO') {
      state.error = true;
      state.justEvaluated = false;
      state.lastValue = null;
      state.expr = cleaned; // keep the attempted expression visible behind the error
      render();
      return;
    }
    // Fallback: show a generic error rather than crashing
    state.error = true;
    render();
    return;
  }
  render();
}

/* ============================================================
   Keypad wiring
   ============================================================ */
keysContainer.addEventListener('click', e => {
  const key = e.target.closest('.key');
  if (!key) return;
  clickSound();
  handleKey(key.dataset);
});

function handleKey(dataset) {
  if (dataset.digit !== undefined) return inputDigit(dataset.digit);
  if (dataset.operator !== undefined) return inputOperator(mapGlyph(dataset.operator));
  switch (dataset.action) {
    case 'decimal':   return inputDecimal();
    case 'clear':     return resetAll();
    case 'backspace': return inputBackspace();
    case 'equals':    clickSound(1320); return inputEquals();
    case 'percent':   return inputPercent();
    case 'negate':    return inputNegate();
  }
}

function mapGlyph(op) {
  // dataset holds display glyphs; internal parser uses ASCII
  return { '−': '-', '×': '*', '÷': '/', '+': '+' }[op] || op;
}

/* ============================================================
   Keyboard support
   ============================================================ */
const KEY_MAP = {
  '*': '×', 'x': '×', 'X': '×',
  '/': '÷',
  '-': '−',
  '+': '+',
};

document.addEventListener('keydown', e => {
  const k = e.key;

  if (/^[0-9]$/.test(k)) { flashKey(`[data-digit="${k}"]`); return inputDigit(k); }
  if (k === '.' || k === ',') { flashKey('[data-action="decimal"]'); e.preventDefault(); return inputDecimal(); }
  if (KEY_MAP[k]) { flashKey(`[data-operator="${KEY_MAP[k]}"]`); e.preventDefault(); return inputOperator(mapGlyph(KEY_MAP[k])); }
  if (k === 'Enter' || k === '=') { flashKey('[data-action="equals"]'); e.preventDefault(); return inputEquals(); }
  if (k === 'Backspace') { flashKey('[data-action="backspace"]'); return inputBackspace(); }
  if (k === 'Escape' || k === 'c' || k === 'C' || k === 'Delete') { flashKey('[data-action="clear"]'); return resetAll(); }
  if (k === '%') { flashKey('[data-action="percent"]'); return inputPercent(); }
});

function flashKey(selector) {
  const el = keysContainer.querySelector(selector);
  if (!el) return;
  el.classList.add('pressed');
  setTimeout(() => el.classList.remove('pressed'), 130);
}

/* ============================================================
   Sound (tiny WebAudio clicks)
   ============================================================ */
let audioCtx = null;
function isMuted() { return localStorage.getItem(MUTE_KEY) === '1'; }

function clickSound(freq = 840) {
  if (isMuted()) return;
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, t);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.055, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.1);
  } catch { /* audio unavailable — stay silent */ }
}

soundToggle.addEventListener('click', () => {
  const next = !isMuted();
  localStorage.setItem(MUTE_KEY, next ? '1' : '0');
  soundToggle.setAttribute('aria-pressed', String(next));
  soundToggle.title = next ? 'Key sounds off' : 'Key sounds on';
  if (!next) clickSound(990);
});

/* ============================================================
   Theme toggle
   ============================================================ */
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem(PLAIN_KEY, theme);
}

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  applyTheme(current === 'light' ? 'dark' : 'light');
});

/* ============================================================
   Copy result & toast
   ============================================================ */
let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
}

copyResultBtn.addEventListener('click', async () => {
  const text = displayOutput.textContent.replace(/,/g, '').trim();
  try {
    await navigator.clipboard.writeText(text);
    showToast('Result copied to clipboard');
  } catch {
    // Fallback for older browsers / non-secure contexts
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); showToast('Result copied to clipboard'); }
    catch { showToast('Copy not available'); }
    document.body.removeChild(ta);
  }
});

/* ============================================================
   History clear
   ============================================================ */
clearHistoryBtn.addEventListener('click', () => {
  state.history = [];
  saveHistory();
  renderHistory();
  showToast('History cleared');
});

/* ============================================================
   Init
   ============================================================ */
(function init() {
  applyTheme(localStorage.getItem(PLAIN_KEY) || 'dark');
  soundToggle.setAttribute('aria-pressed', String(isMuted()));
  soundToggle.title = isMuted() ? 'Key sounds off' : 'Key sounds on';
  loadHistory();
  renderHistory();
  render();
})();
