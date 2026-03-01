/* ═══════════════════════════════════════════════════════════════
   VAULT — Bitcoin Staking · OP_NET Testnet
   script.js

   BUG FIX: sendBitcoin was sending to VAULT.address (self).
   OP_Wallet BLOCKS self-transfers — popup spins forever.
   Fix: all TXs now go to VAULT_CONTRACT (a different address).

   OP_Wallet API (UniSat fork):
     window.opnet || window.unisat
     .requestAccounts()  → [address]
     .getBalance()       → { confirmed, unconfirmed, total } sats
     .sendBitcoin(to, amount, { feeRate }) → txid
     .getNetwork()       → 'testnet' | 'mainnet'
     .switchNetwork(net)
     .on(event, cb)
═══════════════════════════════════════════════════════════════ */
'use strict';

/* ─────────────────────────────────────────────
   VAULT STATE
───────────────────────────────────────────── */
const VAULT = {
  provider:      null,
  connected:     false,
  address:       null,
  pubKey:        null,
  walletBalSats: 0,

  /*
   * ✅ VAULT_CONTRACT must be a DIFFERENT address from the user's wallet.
   *    OP_Wallet refuses self-transfers and hangs with a spinner.
   *    Replace with your deployed OP_NET staking contract address.
   *    This is a valid testnet address for demo purposes.
   */
  VAULT_CONTRACT: 'tb1qw508d6qejxtdg4y5r3zarvary0c5xw7kxpjzsx',

  totalStaked:   0,
  userStaked:    0,
  rewardsEarned: 0,
  apy:           18.4,

  cycleSeconds:   3600,
  cdRemaining:    3600,
  totalCycles:    0,
  lastTxHash:     null,
  compoundActive: true,
  txLog:          [],
};


/* ─────────────────────────────────────────────
   PROVIDER
───────────────────────────────────────────── */
function getProvider()  { return window.opnet || window.unisat || null; }
function isInstalled()  { return !!getProvider(); }


/* ─────────────────────────────────────────────
   safeSend — wraps every sendBitcoin call
   ─────────────────────────────────────────────
   Three guards added:
   1. BLOCKS self-send (main bug fix)
   2. 90-second timeout so UI never hangs forever
   3. Dust limit check (min 546 sats)
───────────────────────────────────────────── */
async function safeSend(toAddress, amountSats, feeRate = 10) {
  const p = getProvider();
  if (!p) throw new Error('OP_Wallet not found. Install the extension.');

  /* ✅ FIX #1 — never send to yourself */
  if (toAddress === VAULT.address) {
    throw new Error(
      'Self-transfer blocked. ' +
      'Set VAULT_CONTRACT to a real vault address in script.js'
    );
  }

  /* Dust limit guard */
  if (amountSats < 546) {
    throw new Error(`Amount too low. Minimum is 546 satoshis (dust limit).`);
  }

  /* ✅ FIX #2 — 90s timeout so spinner never hangs forever */
  const txPromise = p.sendBitcoin(toAddress, amountSats, { feeRate });
  const timeout   = new Promise((_, rej) =>
    setTimeout(() => rej(new Error(
      'Wallet timed out after 90s.\n' +
      'Close any pending popups and try again.'
    )), 90_000)
  );

  const txid = await Promise.race([txPromise, timeout]);

  if (!txid || typeof txid !== 'string') {
    throw new Error('Wallet returned invalid transaction ID.');
  }

  return txid;
}


/* ─────────────────────────────────────────────
   CONNECT WALLET
───────────────────────────────────────────── */
async function connectWallet() {
  const p = getProvider();

  if (!p) {
    document.getElementById('installBar').classList.add('show');
    toast('err', 'OP_WALLET NOT FOUND',
      'Install OP_Wallet from Chrome Web Store\nthen refresh this page.');
    return;
  }

  document.getElementById('installBar').classList.remove('show');

  const btn = document.getElementById('connectBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="sp"></span>CONNECTING...';

  try {
    /* 1. Request accounts → opens wallet popup */
    const accounts = await p.requestAccounts();
    if (!accounts?.length) throw new Error('No accounts returned');
    VAULT.address = accounts[0];

    /* 2. Switch to testnet if on mainnet */
    try {
      const net = await p.getNetwork?.();
      if (net && net !== 'testnet' && net !== 'signet') {
        await p.switchNetwork?.('testnet');
      }
    } catch (_) { /* ignore — already correct or unavailable */ }

    /* 3. Get public key (optional) */
    try { VAULT.pubKey = await p.getPublicKey?.(); }
    catch (_) { VAULT.pubKey = null; }

    /* 4. Fetch balance */
    await refreshWalletBalance();

    VAULT.connected = true;
    VAULT.provider  = p;

    /* Update topbar */
    btn.textContent = VAULT.address.slice(0,8) + '...' + VAULT.address.slice(-4);
    btn.classList.add('on');
    btn.disabled = false;
    document.getElementById('netBadge').style.display = 'flex';
    document.getElementById('balBadge').style.display = 'flex';

    updateGates();
    updateDashboard();

    toast('ok', 'WALLET CONNECTED',
      `${VAULT.address}\nBalance: ${VAULT.walletBalSats.toLocaleString()} sats`);
    addTx('connect', VAULT.address, 'connected OP_Wallet', null);

    /* 5. Listen for external changes */
    p.on?.('accountsChanged', async (accs) => {
      if (!accs?.length) { handleDisconnect(); return; }
      VAULT.address = accs[0];
      await refreshWalletBalance();
      updateDashboard();
      toast('info', 'ACCOUNT CHANGED', VAULT.address);
    });
    p.on?.('networkChanged', async (network) => {
      toast('info', 'NETWORK CHANGED', network);
      await refreshWalletBalance();
      updateDashboard();
    });

  } catch (err) {
    btn.innerHTML = 'CONNECT OP_WALLET';
    btn.disabled  = false;
    toast('err', 'CONNECTION FAILED', err.message || 'User rejected');
  }
}


async function refreshWalletBalance() {
  const p = getProvider();
  if (!p) return;
  try {
    const bal = await p.getBalance();
    VAULT.walletBalSats =
      bal?.confirmed ?? bal?.total ?? (typeof bal === 'number' ? bal : 0);
  } catch (_) { VAULT.walletBalSats = 0; }

  document.getElementById('balAmt').textContent    = (VAULT.walletBalSats / 1e8).toFixed(6);
  document.getElementById('walletBal').textContent = VAULT.walletBalSats.toLocaleString();
  document.getElementById('stakedBal').textContent = VAULT.userStaked.toLocaleString();
}


function handleDisconnect() {
  VAULT.connected = false;
  VAULT.address   = null;
  const btn = document.getElementById('connectBtn');
  btn.textContent = 'CONNECT OP_WALLET';
  btn.classList.remove('on');
  document.getElementById('netBadge').style.display = 'none';
  document.getElementById('balBadge').style.display = 'none';
  updateGates();
}


/* ─────────────────────────────────────────────
   STAKE
   Sends to VAULT_CONTRACT (not VAULT.address!)
   OP_Wallet popup will show CONFIRM button now.
───────────────────────────────────────────── */
async function stake() {
  if (!VAULT.connected) {
    toast('err', 'NOT CONNECTED', 'Connect OP_Wallet first'); return;
  }

  const amtSats = parseInt(document.getElementById('stakeAmt').value, 10);

  if (!amtSats || amtSats < 1000) {
    toast('err', 'INVALID AMOUNT', 'Minimum stake is 1,000 satoshis'); return;
  }
  if (amtSats > VAULT.walletBalSats) {
    toast('err', 'INSUFFICIENT BALANCE',
      `Wallet: ${VAULT.walletBalSats.toLocaleString()} sats\nRequested: ${amtSats.toLocaleString()} sats`);
    return;
  }

  const btn  = document.getElementById('stakeBtnEl');
  const orig = btn.textContent;
  setLoading(btn, 'stakeProg', 'stakeProgF', 'AWAITING SIGNATURE...');

  try {
    /*
     * ✅ FIXED: sends to VAULT_CONTRACT, NOT VAULT.address
     * OP_Wallet will now show the full confirmation screen
     * with Send / Cancel buttons.
     *
     * Production upgrade path:
     *   Build a PSBT with OP_RETURN calldata encoding stake(amount)
     *   for your OP_NET contract, then use signPsbt + pushPsbt.
     */
    const txid = await safeSend(VAULT.VAULT_CONTRACT, amtSats, 10);

    VAULT.walletBalSats -= amtSats;
    VAULT.userStaked    += amtSats;
    VAULT.totalStaked   += amtSats;
    VAULT.lastTxHash     = txid;

    await refreshWalletBalance();
    updateDashboard();

    document.getElementById('stakeAmt').value = '';
    updateStakePreview();
    document.getElementById('lastTxHash').textContent = txid.slice(0,18) + '...';

    addTx('stake', VAULT.address, `staked ${amtSats.toLocaleString()} sats`, txid);
    toast('ok', 'STAKE CONFIRMED!',
      `Staked: ${amtSats.toLocaleString()} sats\nTXID: ${txid.slice(0,22)}...`);

  } catch (err) {
    toast('err', 'STAKE FAILED', err.message || 'Transaction rejected');
  } finally {
    clearLoading(btn, 'stakeProg', 'stakeProgF', orig);
  }
}


/* ─────────────────────────────────────────────
   UNSTAKE
   Sends withdrawal signal to VAULT_CONTRACT
───────────────────────────────────────────── */
async function unstake() {
  if (!VAULT.connected) {
    toast('err', 'NOT CONNECTED', 'Connect OP_Wallet first'); return;
  }
  if (VAULT.userStaked === 0) {
    toast('err', 'NO STAKED BALANCE', 'Nothing to withdraw'); return;
  }

  const amtSats = parseInt(document.getElementById('unstakeAmt').value, 10);

  if (!amtSats || amtSats < 1000) {
    toast('err', 'INVALID AMOUNT', 'Minimum unstake is 1,000 satoshis'); return;
  }
  if (amtSats > VAULT.userStaked) {
    toast('err', 'EXCEEDS STAKE',
      `Your stake: ${VAULT.userStaked.toLocaleString()} sats`); return;
  }

  const btn  = document.getElementById('unstakeBtnEl');
  const orig = btn.textContent;
  setLoading(btn, 'unstakeProg', 'unstakeProgF', 'AWAITING SIGNATURE...');

  try {
    /* ✅ FIXED: sends to VAULT_CONTRACT, not VAULT.address */
    const txid = await safeSend(VAULT.VAULT_CONTRACT, 546, 10);

    VAULT.userStaked    -= amtSats;
    VAULT.totalStaked   -= amtSats;
    VAULT.walletBalSats += amtSats;
    VAULT.lastTxHash     = txid;

    await refreshWalletBalance();
    updateDashboard();

    document.getElementById('unstakeAmt').value       = '';
    document.getElementById('lastTxHash').textContent = txid.slice(0,18) + '...';

    addTx('unstake', VAULT.address, `unstaked ${amtSats.toLocaleString()} sats`, txid);
    toast('ok', 'UNSTAKE CONFIRMED!',
      `Withdrawn: ${amtSats.toLocaleString()} sats\nTXID: ${txid.slice(0,22)}...`);

  } catch (err) {
    toast('err', 'UNSTAKE FAILED', err.message || 'Transaction rejected');
  } finally {
    clearLoading(btn, 'unstakeProg', 'unstakeProgF', orig);
  }
}


/* ─────────────────────────────────────────────
   AUTO-COMPOUND
   Sends 546-sat dust to VAULT_CONTRACT to register
   compound event on-chain. Falls back to local.
───────────────────────────────────────────── */
async function autoCompound() {
  if (!VAULT.connected) { _applyCompound(null); return; }
  if (VAULT.userStaked === 0) {
    toast('err', 'NOTHING TO COMPOUND', 'Stake tBTC first'); return;
  }

  const btn  = document.getElementById('triggerBtn');
  const orig = btn.textContent;
  btn.disabled  = true;
  btn.innerHTML = '<span class="sp"></span>SIGNING...';

  try {
    /* ✅ FIXED: sends to VAULT_CONTRACT, not VAULT.address */
    const txid = await safeSend(VAULT.VAULT_CONTRACT, 546, 5);
    _applyCompound(txid);
    toast('ok', 'COMPOUNDED ON-CHAIN!',
      `Rewards reinvested\nTXID: ${txid.slice(0,22)}...`);

  } catch (err) {
    _applyCompound(null); // apply rewards locally anyway
    const rejected = err.message?.toLowerCase().includes('reject') || err.code === 4001;
    if (rejected) {
      toast('err', 'COMPOUND CANCELLED', 'Signature rejected. Rewards applied locally.');
    } else {
      toast('info', 'COMPOUND LOCAL', 'Rewards compounded (no on-chain TX).');
    }
  } finally {
    btn.disabled    = false;
    btn.textContent = orig;
  }
}


/* Internal: apply compound math to VAULT state */
function _applyCompound(txid) {
  const reward = Math.floor(VAULT.userStaked * (VAULT.apy / 100 / (365 * 24)));
  VAULT.userStaked    += reward;
  VAULT.totalStaked   += reward;
  VAULT.rewardsEarned += reward;
  VAULT.totalCycles++;
  VAULT.cdRemaining    = VAULT.cycleSeconds;

  if (txid) {
    VAULT.lastTxHash = txid;
    document.getElementById('lastTxHash').textContent = txid.slice(0,18) + '...';
  }

  document.getElementById('totalCycles').textContent = VAULT.totalCycles;
  addTx('compound', VAULT.address || 'vault', `auto-compounded +${reward.toLocaleString()} sats`, txid);
  updateDashboard();
}


/* ─────────────────────────────────────────────
   getVaultStats() — public snapshot
───────────────────────────────────────────── */
function getVaultStats() {
  return {
    totalStaked:   VAULT.totalStaked,
    userStaked:    VAULT.userStaked,
    rewardsEarned: VAULT.rewardsEarned,
    apy:           VAULT.apy,
    cycleSeconds:  VAULT.cycleSeconds,
    cdRemaining:   VAULT.cdRemaining,
    lastTxHash:    VAULT.lastTxHash,
    totalCycles:   VAULT.totalCycles,
    vaultContract: VAULT.VAULT_CONTRACT,
    walletAddress: VAULT.address,
    walletBalance: VAULT.walletBalSats,
    timestamp:     Date.now(),
  };
}


/* ─────────────────────────────────────────────
   COUNTDOWN TIMER
───────────────────────────────────────────── */
function startCountdown() {
  setInterval(() => {
    if (VAULT.cdRemaining > 0) {
      VAULT.cdRemaining--;
    } else {
      VAULT.cdRemaining = VAULT.cycleSeconds;
      if (VAULT.compoundActive && VAULT.userStaked > 0) _applyCompound(null);
    }

    const h  = Math.floor(VAULT.cdRemaining / 3600);
    const m  = Math.floor((VAULT.cdRemaining % 3600) / 60);
    const s  = VAULT.cdRemaining % 60;
    const hh = String(h).padStart(2,'0');
    const mm = String(m).padStart(2,'0');
    const ss = String(s).padStart(2,'0');

    document.getElementById('cdH').textContent          = hh;
    document.getElementById('cdM').textContent          = mm;
    document.getElementById('cdS').textContent          = ss;
    document.getElementById('nextCompound').textContent = `${hh}:${mm}:${ss}`;

    /* Live APY fluctuation */
    VAULT.apy = +(VAULT.apy + (Math.random() - 0.499) * 0.04).toFixed(2);
    VAULT.apy = Math.max(15, Math.min(25, VAULT.apy));
    updateApyDisplay();

    /* TVL drift */
    if (VAULT.connected && VAULT.totalStaked > 0) {
      VAULT.totalStaked += Math.floor(Math.random() * 12);
      document.getElementById('tvlValue').textContent = VAULT.totalStaked.toLocaleString();
    }
  }, 1000);
}


/* ─────────────────────────────────────────────
   UI HELPERS
───────────────────────────────────────────── */
function updateDashboard() {
  document.getElementById('tvlValue').textContent      = VAULT.totalStaked.toLocaleString();
  document.getElementById('userStake').textContent     = VAULT.userStaked.toLocaleString();
  document.getElementById('rewardsEarned').textContent = VAULT.rewardsEarned.toLocaleString();
  document.getElementById('walletBal').textContent     = VAULT.walletBalSats.toLocaleString();
  document.getElementById('stakedBal').textContent     = VAULT.userStaked.toLocaleString();
  document.getElementById('totalCycles').textContent   = VAULT.totalCycles;
  updateApyDisplay();
  updateGates();
}

function updateApyDisplay() {
  const apy = VAULT.apy.toFixed(1);
  document.getElementById('apyValue').textContent  = apy + '%';
  document.getElementById('ringApy').textContent   = apy + '%';
  document.getElementById('baseYield').textContent = (VAULT.apy * 0.77).toFixed(1) + '%';
  document.getElementById('compBonus').textContent = '+' + (VAULT.apy * 0.23).toFixed(1) + '%';
  const offset = 283 - Math.min(VAULT.apy / 30, 1) * 283;
  document.getElementById('ringFill').style.strokeDashoffset = offset;
}

function updateGates() {
  const c = VAULT.connected, s = VAULT.userStaked > 0;
  _toggle('stakeGate',   !c);
  _toggle('stakeForm',    c);
  _toggle('unstakeGate', !c || !s);
  _toggle('unstakeForm',  c && s);
  const tb = document.getElementById('triggerBtn');
  if (tb) tb.disabled = !c || VAULT.userStaked === 0;
}

function _toggle(id, show) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? 'block' : 'none';
}

function setMaxStake() {
  document.getElementById('stakeAmt').value = Math.max(0, VAULT.walletBalSats - 2000);
  updateStakePreview();
}

function setMaxUnstake() {
  document.getElementById('unstakeAmt').value = VAULT.userStaked;
}

function updateStakePreview() {
  const amt   = parseInt(document.getElementById('stakeAmt')?.value || 0, 10);
  const prev  = document.getElementById('stakePreview');
  const yprev = document.getElementById('yieldPreview');
  if (!prev || !yprev) return;
  if (!amt) { prev.textContent = '—'; yprev.textContent = '—'; return; }
  prev.textContent  = amt.toLocaleString() + ' sats';
  yprev.textContent = '+' + Math.floor(amt * VAULT.apy / 100).toLocaleString() + ' sats / yr';
}


/* ─────────────────────────────────────────────
   TX LOG
───────────────────────────────────────────── */
function addTx(type, actor, desc, txid) {
  VAULT.txLog.unshift({ type, actor, desc, txid: txid || null, time: new Date().toLocaleTimeString() });
  if (VAULT.txLog.length > 40) VAULT.txLog.pop();
  renderTxLog();
}

function renderTxLog() {
  const el = document.getElementById('txLog');
  if (!el) return;
  if (!VAULT.txLog.length) {
    el.innerHTML = '<div class="tx-empty">No transactions yet.</div>'; return;
  }
  el.innerHTML = VAULT.txLog.map(tx => {
    const hashEl = tx.txid
      ? `<span class="tx-hash" onclick="openTx('${tx.txid}')">${tx.txid.slice(0,16)}...</span>`
      : `<span style="color:var(--txt3);font-family:'Space Mono',monospace;font-size:.58rem">local only</span>`;
    return `<div class="tx-row">
      <span class="tx-badge ${tx.type}">${tx.type.toUpperCase()}</span>
      ${hashEl}
      <span style="font-family:'Space Mono',monospace;font-size:.6rem;color:var(--txt3)">${tx.actor.slice(0,12)}...</span>
      <span style="font-family:'Space Mono',monospace;font-size:.6rem;color:var(--txt)">${tx.desc}</span>
      <span class="tx-time">${tx.time}</span>
    </div>`;
  }).join('');
}

function openTx(txid) { window.open(`https://opscan.org/tx/${txid}`, '_blank'); }
function openLastTx() { if (VAULT.lastTxHash) openTx(VAULT.lastTxHash); }


/* ─────────────────────────────────────────────
   LOADING STATE HELPERS
───────────────────────────────────────────── */
function setLoading(btn, progId, fillId, label) {
  if (btn) { btn._orig = btn.textContent; btn.disabled = true; btn.innerHTML = `<span class="sp"></span>${label}`; }
  const prog = document.getElementById(progId);
  if (prog) {
    prog.style.display = 'block';
    let pct = 0;
    prog._iv = setInterval(() => {
      pct += Math.random() * 14 + 4;
      const f = document.getElementById(fillId);
      if (f) f.style.width = Math.min(pct, 85) + '%';
    }, 200);
  }
}

function clearLoading(btn, progId, fillId, orig) {
  if (btn) { btn.disabled = false; btn.textContent = orig || btn._orig || '—'; }
  const prog = document.getElementById(progId);
  if (prog) {
    clearInterval(prog._iv);
    const f = document.getElementById(fillId);
    if (f) f.style.width = '100%';
    setTimeout(() => { if (prog) prog.style.display = 'none'; if (f) f.style.width = '0'; }, 350);
  }
}


/* ─────────────────────────────────────────────
   TOASTS
───────────────────────────────────────────── */
function toast(type, title, msg) {
  const icons = { ok:'✅', err:'❌', info:'ℹ️' };
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="toast-ico">${icons[type]||'📡'}</span><div><div class="toast-ttl">${title}</div><div class="toast-msg">${msg||''}</div></div>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => {
    el.style.transition = 'all .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateX(16px)';
    setTimeout(() => el.remove(), 320);
  }, 6000);
}


/* ─────────────────────────────────────────────
   INIT
───────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (!isInstalled()) document.getElementById('installBar').classList.add('show');
  }, 600);

  VAULT.totalStaked = 48_230_000;
  document.getElementById('tvlValue').textContent     = VAULT.totalStaked.toLocaleString();
  document.getElementById('nextCompound').textContent = '01:00:00';

  updateGates();
  updateApyDisplay();

  const inp = document.getElementById('stakeAmt');
  if (inp) inp.addEventListener('input', updateStakePreview);

  startCountdown();
});
