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
  cycleSeconds:  3600,
  cdRemaining:   3600,
  totalCycles:   0,
  lastTxHash:    null,
  compoundActive: true,
  txLog:         [],
};

/* ═══════════════════════════════════════════════════════════════
   GLOBAL EXPOSURE (Button Fix)
═══════════════════════════════════════════════════════════════ */
window.connectWallet = connectWallet;
window.stake = stake;
window.unstake = unstake;
window.autoCompound = autoCompound;
window.setMaxStake = setMaxStake;
window.setMaxUnstake = setMaxUnstake;
window.openLastTx = openLastTx;

function getProvider() {
  return window.opnet || window.unisat || null;
}

function isInstalled() {
  return !!getProvider();
}

/* ═══════════════════════════════════════════════════════════════
   CONNECT WALLET
═══════════════════════════════════════════════════════════════ */
async function connectWallet() {
  const p = getProvider();
  if (!p) {
    document.getElementById('installBar').classList.add('show');
    return;
  }
  const btn = document.getElementById('connectBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="sp"></span>CONNECTING...';

  try {
    const accounts = await p.requestAccounts();
    VAULT.address = accounts[0];
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
  } catch (err) {
    btn.innerHTML = 'CONNECT OP_WALLET';
    btn.disabled = false;
  }
}

async function refreshWalletBalance() {
  const p = getProvider();
  if (!p) return;
  try {
    const bal = await p.getBalance();
    VAULT.walletBalSats = Number(bal?.confirmed ?? bal?.total ?? (typeof bal === 'number' ? bal : 0));
    document.getElementById('balAmt').textContent = (VAULT.walletBalSats / 1e8).toFixed(6);
    document.getElementById('walletBal').textContent = VAULT.walletBalSats.toLocaleString();
  } catch (_) { }
}

/* ═══════════════════════════════════════════════════════════════
   STAKE (Popup Data Fix)
═══════════════════════════════════════════════════════════════ */
async function stake() {
  if (!VAULT.connected) return;
  
  const rawAmt = document.getElementById('stakeAmt').value;
  const amtSats = parseInt(rawAmt, 10);

  if (!amtSats || amtSats < 1000) {
    alert("Minimum stake 1,000 sats");
    return;
  }

  const btn = document.getElementById('stakeBtnEl');
  const orig = btn.textContent;
  setLoading(btn, 'stakeProg', 'stakeProgF', 'SIGNING...');

  try {
    const p = getProvider();
    
    // Number conversion nishchit kora hocche jate popup faka na thake
    const txid = await p.sendBitcoin(
      VAULT.VAULT_CONTRACT,
      Number(amtSats), 
      { feeRate: 20 } // Fee rate bariye deya holo
    );

    VAULT.userStaked += amtSats;
    await refreshWalletBalance();
    updateDashboard();
    toast('ok', 'STAKED SUCCESS!', txid);
  } catch (err) {
    console.error(err);
    toast('err', 'STAKE FAILED', err.message || 'Rejected');
  } finally {
    clearLoading(btn, 'stakeProg', 'stakeProgF', orig);
  }
}

/* ═══════════════════════════════════════════════════════════════
   UI HELPERS
═══════════════════════════════════════════════════════════════ */
function updateDashboard() {
  document.getElementById('tvlValue').textContent = VAULT.totalStaked.toLocaleString();
  document.getElementById('userStake').textContent = VAULT.userStaked.toLocaleString();
  document.getElementById('stakedBal').textContent = VAULT.userStaked.toLocaleString();
}

function updateGates() {
  const c = VAULT.connected;
  document.getElementById('stakeGate').style.display = c ? 'none' : 'block';
  document.getElementById('stakeForm').style.display = c ? 'block' : 'none';
}

function setMaxStake() {
  document.getElementById('stakeAmt').value = Math.max(0, VAULT.walletBalSats - 2000);
}

function setMaxUnstake() {
  document.getElementById('unstakeAmt').value = VAULT.userStaked;
}

function setLoading(btn, progId, fillId, label) {
  btn.disabled = true; btn.innerHTML = `<span class="sp"></span>${label}`;
  const prog = document.getElementById(progId);
  if (prog) prog.style.display = 'block';
}

function clearLoading(btn, progId, fillId, orig) {
  btn.disabled = false; btn.textContent = orig;
  const prog = document.getElementById(progId);
  if (prog) prog.style.display = 'none';
}

function toast(type, title, msg) {
  alert(title + ": " + msg);
}

// Dummy functions for remaining buttons
function unstake() { alert("Unstake logic goes here"); }
function autoCompound() { alert("Compound logic goes here"); }
function openLastTx() { if(VAULT.lastTxHash) window.open("https://opscan.org/tx/"+VAULT.lastTxHash); }

window.addEventListener('DOMContentLoaded', () => {
  updateDashboard();
});
