'use strict';

// ── Config ────────────────────────────────────
const CFG = {
  VAULT: 'opt1pttw57hg6gpav0dn5cvzjpcg2v7098j4jkyeej353str5w2r3d92qmyj3tc',
  MIN_SATS:   1000,
  DUST_SATS:  600,
  FEE_RATE:   5,
  APY:        18.3,
  CYCLE_SECS: 3600,
};

// ── State ─────────────────────────────────────
const S = {
  p: null, addr: null, net: null,
  bal: 0, staked: 0, rewards: 0,
  tvl: 48_230_108, cycles: 0, lastTx: null,
  cd: CFG.CYCLE_SECS, busy: false,
};

// ── Helpers ───────────────────────────────────
const el   = id => document.getElementById(id);
const set  = (id, v) => { const e = el(id); if (e) e.textContent = v; };
const fmt  = n => Number(n || 0).toLocaleString();
const pad  = n => String(n).padStart(2, '0');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Toast ─────────────────────────────────────
function toast(msg, type = 'info') {
  const c = el('toast-container');
  if (!c) return;
  const d = document.createElement('div');
  d.className = `toast toast-${type}`;
  d.textContent = msg;
  c.appendChild(d);
  requestAnimationFrame(() => d.classList.add('show'));
  setTimeout(() => {
    d.classList.remove('show');
    setTimeout(() => d.remove(), 300);
  }, 4500);
}

// ── Provider ──────────────────────────────────
const getProvider = () => window.opnet || window.unisat || null;

async function waitProvider(ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const p = getProvider();
    if (p) return p;
    await sleep(100);
  }
  return null;
}

// ── Connect ───────────────────────────────────
async function connectWallet() {
  const btn = el('connect-btn');
  if (btn) { btn.textContent = 'CONNECTING...'; btn.disabled = true; }

  try {
    const p = await waitProvider(3000);
    if (!p) {
      toast('OP_Wallet not found. Install it first.', 'error');
      window.open('https://chromewebstore.google.com/detail/opwallet/pmbjpcmaaladnfpacpmhmnfmpklgbdjb', '_blank');
      return;
    }

    const accounts = await p.requestAccounts();
    if (!accounts?.length) { toast('No accounts returned.', 'error'); return; }

    S.p    = p;
    S.addr = accounts[0];

    // Ensure testnet3
    try { S.net = await p.getNetwork(); } catch { S.net = 'testnet'; }
    if (S.net !== 'testnet') {
      try { await p.switchNetwork('testnet'); S.net = 'testnet'; toast('Switched to Testnet3', 'info'); }
      catch { toast('Please switch OP_Wallet to Testnet3 manually.', 'error'); S.p = null; S.addr = null; return; }
    }

    // Balance
    try { const b = await p.getBalance(); S.bal = b.confirmed ?? b.total ?? 0; } catch {}

    // Events
    p.on?.('accountsChanged', a => { S.addr = a?.[0] || null; renderUI(); });
    p.on?.('networkChanged', n => { S.net = n; if (n !== 'testnet') toast('Switch back to Testnet3!', 'error'); });

    renderUI();
    toast(`Connected: ${S.addr.slice(0,8)}…${S.addr.slice(-6)}`, 'success');
  } catch (err) {
    onErr(err, 'Connect');
  } finally {
    if (btn) { btn.textContent = S.addr ? 'CONNECTED ✓' : 'CONNECT WALLET'; btn.disabled = false; }
  }
}

// ── Send BTC — correct OP_Wallet API ─────────
// sendBitcoin is the right method (UniSat fork).
// Wallet builds PSBT internally, shows popup, user confirms, returns txid.
async function sendBTC(sats, label) {
  if (!S.p || !S.addr) throw new Error('Wallet not connected');
  if (S.net !== 'testnet') throw new Error('Switch OP_Wallet to Testnet3');

  toast(`Confirm ${label} in OP_Wallet…`, 'info');
  const txid = await S.p.sendBitcoin(CFG.VAULT, sats, { feeRate: CFG.FEE_RATE });
  if (!txid || typeof txid !== 'string' || txid.length < 10) throw new Error('Bad txid returned');
  return txid;
}

// ── Stake ─────────────────────────────────────
async function stake() {
  if (!S.p)    { toast('Connect wallet first.', 'error'); return; }
  if (S.busy)  { toast('Transaction in progress…', 'info'); return; }

  const sats = parseInt(el('stake-input')?.value || '0', 10);
  if (!sats || sats < CFG.MIN_SATS) { toast(`Minimum ${fmt(CFG.MIN_SATS)} sats.`, 'error'); return; }
  if (sats > S.bal - 3000)          { toast(`Need 3000 sats for fees. Balance: ${fmt(S.bal)}.`, 'error'); return; }

  S.busy = true;
  btnLoad('stake-btn');
  try {
    const txid = await sendBTC(sats, 'Stake');
    S.staked += sats; S.tvl += sats; S.bal -= sats + 1500; S.lastTx = txid;
    const inp = el('stake-input'); if (inp) inp.value = '';
    logTx('STAKE', sats, txid);
    renderUI();
    toast(`✓ Staked ${fmt(sats)} sats!  TX: ${txid.slice(0,12)}…`, 'success');
  } catch (e) { onErr(e, 'Stake'); }
  finally { S.busy = false; btnReset('stake-btn', 'STAKE tBTC'); }
}

// ── Unstake ───────────────────────────────────
async function unstake() {
  if (!S.p)           { toast('Connect wallet first.', 'error'); return; }
  if (S.busy)         { toast('Transaction in progress…', 'info'); return; }
  if (S.staked <= 0)  { toast('Nothing staked.', 'error'); return; }

  S.busy = true;
  btnLoad('unstake-btn');
  try {
    const txid = await sendBTC(CFG.DUST_SATS, 'Unstake');
    const total = S.staked + S.rewards;
    S.tvl -= S.staked; S.bal += total; S.staked = 0; S.rewards = 0; S.lastTx = txid;
    logTx('UNSTAKE', total, txid);
    renderUI();
    toast(`✓ Unstaked! ${fmt(total)} sats returned.  TX: ${txid.slice(0,12)}…`, 'success');
  } catch (e) { onErr(e, 'Unstake'); }
  finally { S.busy = false; btnReset('unstake-btn', 'UNSTAKE tBTC'); }
}

// ── Compound ──────────────────────────────────
async function compound() {
  if (!S.p)           { toast('Connect wallet first.', 'error'); return; }
  if (S.busy)         { toast('Transaction in progress…', 'info'); return; }
  if (S.staked <= 0)  { toast('Stake first.', 'error'); return; }

  S.busy = true;
  btnLoad('compound-btn');
  try {
    const txid = await sendBTC(CFG.DUST_SATS, 'Compound');
    const reward = Math.floor(S.staked * CFG.APY / 100 / (365 * 24));
    S.staked += reward; S.rewards += reward; S.cycles++; S.lastTx = txid; S.cd = CFG.CYCLE_SECS;
    logTx('COMPOUND', reward, txid);
    renderUI();
    toast(`✓ +${fmt(reward)} sats compounded.  TX: ${txid.slice(0,12)}…`, 'success');
  } catch (e) { onErr(e, 'Compound'); }
  finally { S.busy = false; btnReset('compound-btn', 'TRIGGER COMPOUND →'); }
}

// ── Error handler ─────────────────────────────
function onErr(err, label) {
  console.error(`[VAULT:${label}]`, err);
  const msg = String(err?.message || err).toLowerCase();
  if (err?.code === 4001 || msg.includes('reject') || msg.includes('cancel') || msg.includes('denied')) {
    toast(`${label} cancelled.`, 'info');
  } else if (msg.includes('not supported')) {
    toast(`${label}: Method not supported. Please update OP_Wallet.`, 'error');
  } else if (msg.includes('insufficient') || msg.includes('balance') || msg.includes('funds')) {
    toast(`Insufficient balance for ${label}.`, 'error');
  } else {
    toast(`${label} failed: ${err?.message || String(err)}`, 'error');
  }
}

// ── Button loading ────────────────────────────
function btnLoad(id) {
  const b = el(id); if (!b) return;
  b._orig = b.textContent;
  b.textContent = 'AWAITING SIGNATURE…';
  b.disabled = true;
  b.classList.add('btn-loading');
}
function btnReset(id, text) {
  const b = el(id); if (!b) return;
  b.textContent = text || b._orig || b.textContent;
  b.disabled = false;
  b.classList.remove('btn-loading');
}

// ── TX Log ────────────────────────────────────
function logTx(type, sats, txid) {
  const log = el('tx-log'); if (!log) return;
  log.querySelector('.tx-empty')?.remove();
  const typeClass = { STAKE: 'badge-stake', UNSTAKE: 'badge-unstake', COMPOUND: 'badge-compound' }[type] || '';
  const row = document.createElement('div');
  row.className = 'tx-row';
  row.innerHTML = `
    <span class="tx-badge ${typeClass}">${type}</span>
    <span class="tx-sats">${fmt(sats)} sats</span>
    <a class="tx-hash" href="https://opscan.org/tx/${txid}" target="_blank" rel="noopener">${txid.slice(0,10)}…${txid.slice(-6)}</a>
    <span class="tx-time">${new Date().toLocaleTimeString()}</span>`;
  log.prepend(row);
  while (log.children.length > 10) log.removeChild(log.lastChild);
}

// ── Max ───────────────────────────────────────
function setMax() {
  const i = el('stake-input');
  if (i) { i.value = Math.max(0, S.bal - 3000); updatePreview(); }
}

function updatePreview() {
  const sats = parseInt(el('stake-input')?.value || '0', 10) || 0;
  set('p-stake', `${fmt(sats)} sats`);
  set('p-yield', `+${fmt(Math.floor(sats * CFG.APY / 100))} sats / yr`);
}

// ── Render ────────────────────────────────────
function renderUI() {
  // Stats strip
  set('s-tvl',         fmt(S.tvl));
  set('s-rewards',     fmt(S.rewards));
  set('s-apy',         `${CFG.APY}%`);
  set('s-compounded',  fmt(S.rewards));

  // Wallet header bar
  const wbar = el('wallet-bar');
  if (S.addr && wbar) {
    wbar.style.display = 'flex';
    set('hdr-addr', `${S.addr.slice(0,10)}…${S.addr.slice(-8)}`);
    set('hdr-bal',  `${fmt(S.bal)} sats`);
  }

  // Stake card
  set('f-balance', `${fmt(S.bal)} sats`);

  // Unstake card
  set('u-staked',  `${fmt(S.staked)} sats`);
  set('u-rewards', `${fmt(S.rewards)} sats`);

  // Engine
  set('e-cycles', S.cycles);
  const txEl = el('e-txhash');
  if (txEl) { txEl.textContent = S.lastTx ? `${S.lastTx.slice(0,10)}…` : '—'; if (S.lastTx) txEl.href = `https://opscan.org/tx/${S.lastTx}`; }

  // Unstake button
  const ub = el('unstake-btn');
  if (ub) ub.disabled = S.staked <= 0 || S.busy;

  updatePreview();
}

// ── Countdown ─────────────────────────────────
function startCountdown() {
  setInterval(() => {
    S.cd = Math.max(0, S.cd - 1);
    if (S.cd === 0) {
      S.cd = CFG.CYCLE_SECS;
      if (S.p && S.staked > 0) {
        const r = Math.floor(S.staked * CFG.APY / 100 / (365 * 24));
        S.rewards += r; S.cycles++; renderUI();
        toast(`Auto-compound: +${fmt(r)} sats`, 'success');
      }
    }
    const h = Math.floor(S.cd / 3600), m = Math.floor((S.cd % 3600) / 60), s = S.cd % 60;
    set('e-next',  `${pad(h)}:${pad(m)}:${pad(s)}`);
    set('cd-h', pad(h)); set('cd-m', pad(m)); set('cd-s', pad(s));
  }, 1000);
}

// ── Auto reconnect ────────────────────────────
async function tryReconnect() {
  const p = await waitProvider(2000);
  if (!p) return;
  try {
    const accs = await p.getAccounts?.();
    if (!accs?.length) return;
    S.p = p; S.addr = accs[0];
    try { S.net = await p.getNetwork(); } catch {}
    try { const b = await p.getBalance(); S.bal = b.confirmed ?? b.total ?? 0; } catch {}
    p.on?.('accountsChanged', a => { S.addr = a?.[0] || null; renderUI(); });
    p.on?.('networkChanged',  n => { S.net = n; });
    renderUI();
    toast('Wallet reconnected', 'info');
  } catch {}
}

// ── Init ──────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  el('connect-btn')  ?.addEventListener('click', connectWallet);
  el('stake-btn')    ?.addEventListener('click', stake);
  el('unstake-btn')  ?.addEventListener('click', unstake);
  el('compound-btn') ?.addEventListener('click', compound);
  el('max-btn')      ?.addEventListener('click', setMax);
  el('stake-input')  ?.addEventListener('input', updatePreview);
  startCountdown();
  renderUI();
  tryReconnect();
});

window._vault = { S, CFG };
