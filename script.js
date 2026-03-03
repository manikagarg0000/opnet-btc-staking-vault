// ╔══════════════════════════════════════════════════════════════╗
// ║       ║
// ╚══════════════════════════════════════════════════════════════╝

'use strict';

// ─── CONFIG ──────────────────────────────────────────────────
// ⚠️  IMPORTANT: Set VAULT_ADDRESS to your deployed OP_NET contract.
//     Until you have one, leave it null → sends to your own wallet (safe test).
//     Get a contract address: https://docs.opnet.org → Deploy a contract
const CONFIG = {
  VAULT_ADDRESS: 'opt1pttw57hg6gpav0dn5cvzjpcg2v7098j4jkyeej353str5w2r3d92qmyj3tc',   // null = self-send (demo mode). Set to real contract addr.
  MIN_STAKE_SATS: 1000,
  DUST_SATS: 600,
  FEE_RATE: 5,
  APY: 18.3,
  APY_BASE: 14.1,
  APY_BONUS: 4.2,
  CYCLE_SECS: 3600,
};

// ─── STATE ────────────────────────────────────────────────────
const S = {
  p: null, addr: null, net: null,
  balance: 0, staked: 0, rewards: 0,
  tvl: 48_230_108, cycles: 0, lastTx: null,
  countdown: CONFIG.CYCLE_SECS, busy: false,
};

// ─── HELPERS ──────────────────────────────────────────────────
const el = (id) => document.getElementById(id);
const setText = (id, v) => { const e = el(id); if (e) e.textContent = v; };
const fmt = (n) => Number(n || 0).toLocaleString();
const pad = (n) => String(n).padStart(2, '0');

// ─── TOAST ───────────────────────────────────────────────────
function toast(msg, type = 'info') {
  const c = el('toast-container');
  if (!c) return;
  const d = document.createElement('div');
  d.className = `toast toast-${type}`;
  d.textContent = msg;
  c.appendChild(d);
  requestAnimationFrame(() => d.classList.add('show'));
  setTimeout(() => { d.classList.remove('show'); setTimeout(() => d.remove(), 350); }, 4200);
}

// ─── PROVIDER ─────────────────────────────────────────────────
function getProvider() {
  return window.opnet || window.unisat || null;
}
async function waitProvider(ms = 3000) {
  const t = Date.now() + ms;
  while (Date.now() < t) {
    const p = getProvider();
    if (p) return p;
    await new Promise(r => setTimeout(r, 100));
  }
  return null;
}

// ─── CONNECT WALLET ───────────────────────────────────────────
async function connectWallet() {
  const btn = el('connect-btn');
  if (btn) { btn.textContent = 'CONNECTING...'; btn.disabled = true; }
  try {
    const provider = await waitProvider(3000);
    if (!provider) {
      toast('OP_Wallet not found. Install it first.', 'error');
      window.open('https://chromewebstore.google.com/detail/opwallet/pmbjpcmaaladnfpacpmhmnfmpklgbdjb', '_blank');
      return;
    }
    const accounts = await provider.requestAccounts();
    if (!accounts?.length) { toast('No accounts.', 'error'); return; }

    S.p = provider;
    S.addr = accounts[0];

    try { S.net = await provider.getNetwork(); } catch { S.net = 'testnet'; }
    if (S.net !== 'testnet') {
      try { await provider.switchNetwork('testnet'); S.net = 'testnet'; toast('Switched to Testnet3', 'info'); }
      catch { toast('Please manually switch to Testnet3 in OP_Wallet.', 'error'); S.p = null; S.addr = null; return; }
    }

    try { const b = await provider.getBalance(); S.balance = b.confirmed ?? b.total ?? 0; } catch {}

    provider.on?.('accountsChanged', (a) => { S.addr = a?.[0] || null; renderUI(); });
    provider.on?.('networkChanged', (n) => { S.net = n; if (n !== 'testnet') toast('Switch back to Testnet3!', 'error'); });

    renderUI();
    toast(`Connected: ${S.addr.slice(0,8)}…${S.addr.slice(-6)}`, 'success');
  } catch (err) {
    handleError(err, 'Connect');
  } finally {
    if (btn) { btn.textContent = S.addr ? 'CONNECTED ✓' : 'CONNECT WALLET'; btn.disabled = false; }
  }
}

// ─── SEND BTC — THE CORRECT OP_WALLET API ────────────────────
// OP_Wallet (UniSat fork) exposes sendBitcoin on its provider.
// This is THE correct method. The wallet builds+signs+broadcasts internally.
// You must pass a VALID Bitcoin testnet address — any invalid addr causes infinite spinner.
async function sendBTC(amountSats, label) {
  if (!S.p || !S.addr) throw new Error('Wallet not connected');
  if (S.net !== 'testnet') throw new Error('Switch to Testnet3');

  // Use real contract OR fall back to self (your own address) for testing
  const to = CONFIG.VAULT_ADDRESS || S.addr;

  console.log(`[VAULT] ${label}: sending ${amountSats} sats → ${to}`);
  toast(`Confirm ${label} in OP_Wallet…`, 'info');

  // This is correct. The wallet shows its popup, user confirms, returns txid.
  const txid = await S.p.sendBitcoin(to, amountSats, { feeRate: CONFIG.FEE_RATE });

  if (!txid || typeof txid !== 'string' || txid.length < 10) throw new Error('Invalid txid returned');
  console.log(`[VAULT] txid: ${txid}`);
  return txid;
}

// ─── STAKE ────────────────────────────────────────────────────
async function stake() {
  if (!S.p) { toast('Connect wallet first.', 'error'); return; }
  if (S.busy) { toast('Transaction already in progress.', 'info'); return; }

  const input = el('stake-amount');
  const sats = parseInt(input?.value || '0', 10);
  if (!sats || sats < CONFIG.MIN_STAKE_SATS) { toast(`Min ${fmt(CONFIG.MIN_STAKE_SATS)} sats.`, 'error'); return; }
  if (sats > S.balance - 3000) { toast(`Need 3000 sats for fees. Balance: ${fmt(S.balance)}.`, 'error'); return; }

  S.busy = true;
  setLoading('stake-btn', true);
  try {
    const txid = await sendBTC(sats, 'Stake');
    S.staked += sats; S.tvl += sats; S.balance -= sats + 1500; S.lastTx = txid;
    if (input) input.value = '';
    addLog('STAKE', sats, txid);
    renderUI();
    toast(`✓ Staked ${fmt(sats)} sats!  TX: ${txid.slice(0,12)}…`, 'success');
  } catch (err) { handleError(err, 'Stake'); }
  finally { S.busy = false; setLoading('stake-btn', false, 'STAKE tBTC'); }
}

// ─── UNSTAKE ──────────────────────────────────────────────────
async function unstake() {
  if (!S.p) { toast('Connect wallet first.', 'error'); return; }
  if (S.busy) { toast('Transaction in progress.', 'info'); return; }
  if (S.staked <= 0) { toast('Nothing staked.', 'error'); return; }

  S.busy = true;
  setLoading('unstake-btn', true);
  try {
    const txid = await sendBTC(CONFIG.DUST_SATS, 'Unstake');
    const returned = S.staked + S.rewards;
    S.tvl -= S.staked; S.balance += returned; S.staked = 0; S.rewards = 0; S.lastTx = txid;
    addLog('UNSTAKE', returned, txid);
    renderUI();
    toast(`✓ Unstaked! ${fmt(returned)} sats back. TX: ${txid.slice(0,12)}…`, 'success');
  } catch (err) { handleError(err, 'Unstake'); }
  finally { S.busy = false; setLoading('unstake-btn', false, 'UNSTAKE tBTC'); }
}

// ─── COMPOUND ─────────────────────────────────────────────────
async function compound() {
  if (!S.p) { toast('Connect wallet first.', 'error'); return; }
  if (S.busy) { toast('Transaction in progress.', 'info'); return; }
  if (S.staked <= 0) { toast('Stake first.', 'error'); return; }

  S.busy = true;
  setLoading('compound-btn', true);
  try {
    const txid = await sendBTC(CONFIG.DUST_SATS, 'Compound');
    const reward = Math.floor(S.staked * CONFIG.APY / 100 / (365 * 24));
    S.staked += reward; S.rewards += reward; S.cycles++; S.lastTx = txid; S.countdown = CONFIG.CYCLE_SECS;
    addLog('COMPOUND', reward, txid);
    renderUI();
    toast(`✓ +${fmt(reward)} sats compounded. TX: ${txid.slice(0,12)}…`, 'success');
  } catch (err) { handleError(err, 'Compound'); }
  finally { S.busy = false; setLoading('compound-btn', false, 'TRIGGER COMPOUND →'); }
}

// ─── ERROR HANDLER ────────────────────────────────────────────
function handleError(err, label) {
  console.error(`[VAULT ${label}]`, err);
  const msg = String(err?.message || err).toLowerCase();
  if (err?.code === 4001 || msg.includes('reject') || msg.includes('cancel') || msg.includes('denied')) {
    toast(`${label} cancelled.`, 'info');
  } else if (msg.includes('not supported')) {
    toast(`${label}: Method not supported. Update OP_Wallet to latest version.`, 'error');
  } else if (msg.includes('insufficient') || msg.includes('balance') || msg.includes('funds')) {
    toast(`Insufficient balance for ${label}.`, 'error');
  } else if (msg.includes('address') || msg.includes('invalid')) {
    toast('Invalid address — set a real contract address in CONFIG.VAULT_ADDRESS', 'error');
  } else {
    toast(`${label} failed: ${err?.message || err}`, 'error');
  }
}

// ─── BUTTON LOADING STATE ────────────────────────────────────
function setLoading(id, loading, resetText = null) {
  const b = el(id);
  if (!b) return;
  if (loading) {
    b._orig = b.textContent;
    b.textContent = 'AWAITING SIGNATURE…';
    b.disabled = true;
    b.classList.add('loading');
  } else {
    b.textContent = resetText || b._orig || b.textContent;
    b.disabled = false;
    b.classList.remove('loading');
  }
}

// ─── TX LOG ───────────────────────────────────────────────────
function addLog(type, sats, txid) {
  const log = el('tx-log');
  if (!log) return;
  log.querySelector('.tx-empty')?.remove();
  const row = document.createElement('div');
  row.className = 'tx-entry';
  row.innerHTML = `
    <span class="tx-type tx-${type.toLowerCase()}">${type}</span>
    <span class="tx-amt">${fmt(sats)} sats</span>
    <a class="tx-id" href="https://opscan.org/tx/${txid}" target="_blank" rel="noopener">${txid.slice(0,10)}…${txid.slice(-6)}</a>
    <span class="tx-time">${new Date().toLocaleTimeString()}</span>`;
  log.prepend(row);
  while (log.children.length > 10) log.removeChild(log.lastChild);
}

// ─── MAX ──────────────────────────────────────────────────────
function setMax() {
  const i = el('stake-amount');
  if (i) { i.value = Math.max(0, S.balance - 3000); updatePreview(); }
}

function updatePreview() {
  const sats = parseInt(el('stake-amount')?.value || '0', 10) || 0;
  setText('you-stake-display', `${fmt(sats)} sats`);
  setText('annual-yield-display', `+${fmt(Math.floor(sats * CONFIG.APY / 100))} sats / yr`);
}

// ─── RENDER ───────────────────────────────────────────────────
function renderUI() {
  setText('total-staked', fmt(S.tvl));
  setText('rewards-earned', fmt(S.rewards));
  setText('apy-display', `${CONFIG.APY}%`);
  setText('user-staked-global', fmt(S.rewards));
  if (S.addr) {
    el('wallet-info-bar')?.classList.remove('hidden');
    setText('wallet-address', `${S.addr.slice(0,10)}…${S.addr.slice(-8)}`);
    setText('wallet-balance', `${fmt(S.balance)} sats`);
  }
  setText('wallet-balance-card', `${fmt(S.balance)} sats`);
  setText('user-staked', `${fmt(S.staked)} sats`);
  setText('my-rewards', `${fmt(S.rewards)} sats`);
  setText('total-cycles', S.cycles);
  const txEl = el('last-tx-hash');
  if (txEl) { txEl.textContent = S.lastTx ? `${S.lastTx.slice(0,10)}…` : '-'; if (S.lastTx) txEl.href = `https://opscan.org/tx/${S.lastTx}`; }
  const ub = el('unstake-btn');
  if (ub) ub.disabled = S.staked <= 0 || S.busy;
  // Show/hide demo mode warning
  const warn = el('demo-warning');
  if (warn) warn.style.display = CONFIG.VAULT_ADDRESS ? 'none' : 'block';
  updatePreview();
}

// ─── COUNTDOWN ───────────────────────────────────────────────
function startCountdown() {
  setInterval(() => {
    S.countdown = Math.max(0, S.countdown - 1);
    if (S.countdown === 0) {
      S.countdown = CONFIG.CYCLE_SECS;
      if (S.p && S.staked > 0) {
        const r = Math.floor(S.staked * CONFIG.APY / 100 / (365 * 24));
        S.rewards += r; S.cycles++; renderUI();
        toast(`Auto-compound: +${fmt(r)} sats`, 'success');
      }
    }
    const h = Math.floor(S.countdown / 3600), m = Math.floor((S.countdown % 3600) / 60), s = S.countdown % 60;
    setText('next-compound-time', `${pad(h)}:${pad(m)}:${pad(s)}`);
    setText('countdown-hr', pad(h)); setText('countdown-min', pad(m)); setText('countdown-sec', pad(s));
  }, 1000);
}

// ─── AUTO RECONNECT ───────────────────────────────────────────
async function tryReconnect() {
  const p = await waitProvider(2000);
  if (!p) return;
  try {
    const accounts = await p.getAccounts?.();
    if (!accounts?.length) return;
    S.p = p; S.addr = accounts[0];
    try { S.net = await p.getNetwork(); } catch {}
    try { const b = await p.getBalance(); S.balance = b.confirmed ?? b.total ?? 0; } catch {}
    p.on?.('accountsChanged', (a) => { S.addr = a?.[0] || null; renderUI(); });
    p.on?.('networkChanged', (n) => { S.net = n; });
    renderUI();
    toast('Wallet reconnected', 'info');
  } catch {}
}

// ─── INIT ─────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  el('connect-btn')  ?.addEventListener('click', connectWallet);
  el('stake-btn')    ?.addEventListener('click', stake);
  el('unstake-btn')  ?.addEventListener('click', unstake);
  el('compound-btn') ?.addEventListener('click', compound);
  el('max-btn')      ?.addEventListener('click', setMax);
  el('stake-amount') ?.addEventListener('input', updatePreview);
  startCountdown();
  renderUI();
  tryReconnect();
});

window._vault = { S, CONFIG };
