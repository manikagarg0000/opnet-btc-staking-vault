  'use strict';

/* ─────────────────────────────────────────────────────────────
   VAULT STATE
───────────────────────────────────────────────────────────── */
const VAULT = {
  provider:      null,
  connected:     false,
  address:       null,
  pubKey:        null,
  walletBalSats: 0,
  VAULT_CONTRACT: 'opt1pttw57hg6gpav0dn5cvzjpcg2v7098j4jkyeej353str5w2r3d92qmyj3tc',
  totalStaked:   48230000,
  userStaked:    0,
  rewardsEarned: 0,
  apy:           18.4,
  baseYield:     14.2,
  compBonus:     4.2,
  cycleSeconds:  3600,
  cdRemaining:   3600,
  totalCycles:   0,
  lastTxHash:    null,
  compoundActive: true,
  txLog:         [],
};

/* ═══════════════════════════════════════════════════════════════
   HELPERS & GLOBAL ASSIGNMENTS (Popup Fix)
═══════════════════════════════════════════════════════════════ */
function getProvider() {
  return window.opnet || window.unisat || null;
}

function isInstalled() {
  return !!getProvider();
}

// Module script theke HTML onclick-e function pathanor jonno
window.connectWallet = connectWallet;
window.stake = stake;
window.unstake = unstake;
window.autoCompound = autoCompound;
window.setMaxStake = setMaxStake;
window.setMaxUnstake = setMaxUnstake;
window.openLastTx = openLastTx;
window.openTx = openTx;

/* ═══════════════════════════════════════════════════════════════
   WALLET FUNCTIONS
═══════════════════════════════════════════════════════════════ */

async function connectWallet() {
  const p = getProvider();
  if (!p) {
    document.getElementById('installBar').classList.add('show');
    toast('err', 'OP_WALLET NOT FOUND', 'Install extension and refresh.');
    return;
  }

  const btn = document.getElementById('connectBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="sp"></span>CONNECTING...';

  try {
    const accounts = await p.requestAccounts();
    VAULT.address = accounts[0];
    
    try {
      const net = await p.getNetwork?.();
      if (net && net !== 'testnet') await p.switchNetwork?.('testnet');
    } catch (_) {}

    await refreshWalletBalance();
    VAULT.connected = true;
    VAULT.provider = p;

    btn.textContent = VAULT.address.slice(0, 8) + '...' + VAULT.address.slice(-4);
    btn.classList.add('on');
    btn.disabled = false;

    document.getElementById('netBadge').style.display = 'flex';
    document.getElementById('balBadge').style.display = 'flex';

    updateGates();
    updateDashboard();
    toast('ok', 'CONNECTED', VAULT.address);

    p.on?.('accountsChanged', (accs) => location.reload());
  } catch (err) {
    btn.innerHTML = 'CONNECT OP_WALLET';
    btn.disabled = false;
    toast('err', 'FAILED', err.message);
  }
}

async function refreshWalletBalance() {
  const p = getProvider();
  if (!p) return;
  try {
    const bal = await p.getBalance();
    VAULT.walletBalSats = bal?.confirmed ?? bal?.total ?? (typeof bal === 'number' ? bal : 0);
  } catch (_) { VAULT.walletBalSats = 0; }
  
  document.getElementById('balAmt').textContent = (VAULT.walletBalSats / 1e8).toFixed(6);
  document.getElementById('walletBal').textContent = VAULT.walletBalSats.toLocaleString();
}

/* ═══════════════════════════════════════════════════════════════
   STAKE & UNSTAKE (Transaction Fix)
═══════════════════════════════════════════════════════════════ */

async function stake() {
  if (!VAULT.connected) return toast('err', 'NOT CONNECTED', 'Connect first');
  const amtSats = parseInt(document.getElementById('stakeAmt').value, 10);
  
  if (!amtSats || amtSats < 1000) return toast('err', 'INVALID', 'Min 1,000 sats');
  if (amtSats > VAULT.walletBalSats) return toast('err', 'NO BALANCE', 'Check your wallet');

  const btn = document.getElementById('stakeBtnEl');
  const orig = btn.textContent;
  setLoading(btn, 'stakeProg', 'stakeProgF', 'SIGNING...');

  try {
    const p = getProvider();
    // Popup blank houya bondho korte feeRate koman/baran
    const txid = await p.sendBitcoin(VAULT.VAULT_CONTRACT, amtSats, { feeRate: 10 });

    VAULT.userStaked += amtSats;
    await refreshWalletBalance();
    updateDashboard();
    toast('ok', 'STAKED!', 'TXID: ' + txid.slice(0,10));
  } catch (err) {
    toast('err', 'FAILED', err.message || 'Rejected');
  } finally {
    clearLoading(btn, 'stakeProg', 'stakeProgF', orig);
  }
}

async function unstake() {
  if (!VAULT.connected || VAULT.userStaked === 0) return;
  const amtSats = parseInt(document.getElementById('unstakeAmt').value, 10);
  if (!amtSats || amtSats > VAULT.userStaked) return toast('err', 'INVALID', 'Check amount');

  const btn = document.getElementById('unstakeBtnEl');
  const orig = btn.textContent;
  setLoading(btn, 'unstakeProg', 'unstakeProgF', 'SIGNING...');

  try {
    const p = getProvider();
    const txid = await p.sendBitcoin(VAULT.address, amtSats, { feeRate: 10 });
    VAULT.userStaked -= amtSats;
    updateDashboard();
    toast('ok', 'UNSTAKED!', 'TXID: ' + txid.slice(0,10));
  } catch (err) {
    toast('err', 'FAILED', err.message);
  } finally {
    clearLoading(btn, 'unstakeProg', 'unstakeProgF', orig);
  }
}

/* ═══════════════════════════════════════════════════════════════
   UI & DASHBOARD
═══════════════════════════════════════════════════════════════ */

function updateDashboard() {
  document.getElementById('tvlValue').textContent = VAULT.totalStaked.toLocaleString();
  document.getElementById('userStake').textContent = VAULT.userStaked.toLocaleString();
  document.getElementById('stakedBal').textContent = VAULT.userStaked.toLocaleString();
  updateApyDisplay();
  updateGates();
}

function updateApyDisplay() {
  const apy = VAULT.apy.toFixed(1);
  document.getElementById('apyValue').textContent = apy + '%';
  if(document.getElementById('ringApy')) document.getElementById('ringApy').textContent = apy + '%';
  const circumference = 283;
  const offset = circumference - (Math.min(VAULT.apy / 30, 1) * circumference);
  const fill = document.getElementById('ringFill');
  if(fill) fill.style.strokeDashoffset = offset;
}

function updateGates() {
  const c = VAULT.connected;
  _toggle('stakeGate', !c);
  _toggle('stakeForm', c);
  _toggle('unstakeGate', !c || VAULT.userStaked === 0);
  _toggle('unstakeForm', c && VAULT.userStaked > 0);
}

function _toggle(id, show) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? 'block' : 'none';
}

function setMaxStake() {
  document.getElementById('stakeAmt').value = Math.max(0, VAULT.walletBalSats - 2000);
}

function setMaxUnstake() {
  document.getElementById('unstakeAmt').value = VAULT.userStaked;
}

/* ═══════════════════════════════════════════════════════════════
   INITIALIZATION
═══════════════════════════════════════════════════════════════ */

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => { if (!isInstalled()) document.getElementById('installBar').classList.add('show'); }, 600);
  updateDashboard();
  // Timer and other simulation logic can go here
});

// Toast, Loading, etc. functions keep as your original code...
function toast(type, title, message) {
  const container = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<div><b>${title}</b><br>${message}</div>`;
  container.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

function setLoading(btn, progId, fillId, label) {
  btn.disabled = true; btn.innerHTML = label;
  const prog = document.getElementById(progId);
  if (prog) prog.style.display = 'block';
}

function clearLoading(btn, progId, fillId, orig) {
  btn.disabled = false; btn.textContent = orig;
  const prog = document.getElementById(progId);
  if (prog) prog.style.display = 'none';
}

async function autoCompound() { /* Original logic */ }
function openTx(txid) { window.open(`https://opscan.org/tx/${txid}`, '_blank'); }
function openLastTx() { if (VAULT.lastTxHash) openTx(VAULT.lastTxHash); }
