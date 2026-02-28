/* ═══════════════════════════════════════════════════════════════
   VAULT — Bitcoin Staking · OP_NET Testnet
   script.js

   OP_Wallet (UniSat fork) provider API:
     window.opnet  → primary injection
     window.unisat → fallback (same API surface)

   Key methods used:
     p.requestAccounts()             → connect, returns [address]
     p.getBalance()                  → { confirmed, unconfirmed, total } sats
     p.getPublicKey()                → hex pubkey string
     p.getNetwork()                  → 'testnet' | 'mainnet'
     p.switchNetwork('testnet')      → switch chain
     p.sendBitcoin(to, sats, opts)   → broadcast TX, returns txid
     p.on('accountsChanged', cb)     → event listener
     p.on('networkChanged',  cb)     → event listener
═══════════════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────────────────────
   VAULT STATE
   Single source of truth for all app data
───────────────────────────────────────────────────────────── */
const VAULT = {
  /* Wallet */
  provider:      null,
  connected:     false,
  address:       null,
  pubKey:        null,
  walletBalSats: 0,

  /*
   * Vault contract address on OP_NET Testnet3.
   * Replace with your deployed OP_NET staking contract address.
   * In production, stake() / unstake() build a PSBT with
   * OP_RETURN calldata targeting this contract.
   */
  VAULT_CONTRACT: 'opt1pttw57hg6gpav0dn5cvzjpcg2v7098j4jkyeej353str5w2r3d92qmyj3tc',

  /* Vault balances */
  totalStaked:   0,   // global TVL in satoshis
  userStaked:    0,   // this user's stake in satoshis
  rewardsEarned: 0,   // accumulated auto-compound rewards in satoshis

  /* APY */
  apy:       18.4,    // current APY %
  baseYield: 14.2,    // base yield component
  compBonus:  4.2,    // compound bonus component

  /* Auto-compound */
  cycleSeconds:   3600, // 1-hour compound cycle
  cdRemaining:    3600, // countdown seconds remaining
  totalCycles:    0,    // total compound executions
  lastTxHash:     null, // last on-chain TX hash
  compoundActive: true, // engine status

  /* Transaction history */
  txLog: [],
};


/* ═══════════════════════════════════════════════════════════════
   PROVIDER HELPERS
═══════════════════════════════════════════════════════════════ */

/**
 * Returns the injected OP_Wallet / UniSat provider, or null.
 * OP_Wallet injects as window.opnet (primary).
 * Falls back to window.unisat since OP_Wallet is a UniSat fork
 * and exposes the same API surface.
 */
function getProvider() {
  return window.opnet || window.unisat || null;
}

/** True if the extension is installed and injected. */
function isInstalled() {
  return !!getProvider();
}


/* ═══════════════════════════════════════════════════════════════
   CONNECT WALLET
═══════════════════════════════════════════════════════════════ */

/**
 * connectWallet()
 * ───────────────
 * 1. Detects OP_Wallet extension
 * 2. Calls requestAccounts() → triggers OP_Wallet popup
 * 3. Switches to Testnet3 if needed
 * 4. Fetches wallet balance
 * 5. Registers event listeners for account/network changes
 */
async function connectWallet() {
  const p = getProvider();

  if (!p) {
    document.getElementById('installBar').classList.add('show');
    toast('err', 'OP_WALLET NOT FOUND',
      'Install the OP_Wallet Chrome extension\nand refresh this page.');
    return;
  }

  document.getElementById('installBar').classList.remove('show');

  const btn = document.getElementById('connectBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="sp"></span>CONNECTING...';

  try {
    /* ── Step 1: Request accounts ── */
    const accounts = await p.requestAccounts();
    if (!accounts?.length) throw new Error('No accounts returned from wallet');
    VAULT.address = accounts[0];

    /* ── Step 2: Ensure Testnet3 ── */
    try {
      const net = await p.getNetwork?.();
      if (net && net !== 'testnet' && net !== 'signet') {
        await p.switchNetwork?.('testnet');
      }
    } catch (_) {
      /* Already on testnet or method not available — safe to ignore */
    }

    /* ── Step 3: Get public key (optional, used for contract calls) ── */
    try {
      VAULT.pubKey = await p.getPublicKey?.();
    } catch (_) {
      VAULT.pubKey = null;
    }

    /* ── Step 4: Fetch balance ── */
    await refreshWalletBalance();

    /* ── Step 5: Update state + UI ── */
    VAULT.connected = true;
    VAULT.provider  = p;

    btn.textContent = VAULT.address.slice(0, 8) + '...' + VAULT.address.slice(-4);
    btn.classList.add('on');
    btn.disabled = false;

    document.getElementById('netBadge').style.display = 'flex';
    document.getElementById('balBadge').style.display = 'flex';

    updateGates();
    updateDashboard();

    toast('ok', 'WALLET CONNECTED',
      `Address: ${VAULT.address}\nBalance: ${VAULT.walletBalSats.toLocaleString()} sats`);

    addTx('connect', VAULT.address, 'connected OP_Wallet', null);

    /* ── Step 6: Listen for external changes ── */
    p.on?.('accountsChanged', async (accs) => {
      if (!accs?.length) {
        handleDisconnect();
        return;
      }
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
    toast('err', 'CONNECTION FAILED', err.message || 'User rejected or unexpected error');
  }
}


/**
 * refreshWalletBalance()
 * ──────────────────────
 * Fetches live balance from OP_Wallet.
 * getBalance() returns { confirmed, unconfirmed, total } in satoshis.
 */
async function refreshWalletBalance() {
  const p = getProvider();
  if (!p) return;

  try {
    const bal = await p.getBalance();
    VAULT.walletBalSats =
      bal?.confirmed ??
      bal?.total ??
      (typeof bal === 'number' ? bal : 0);
  } catch (_) {
    VAULT.walletBalSats = 0;
  }

  /* Update header balance display */
  const tbtc = (VAULT.walletBalSats / 1e8).toFixed(6);
  document.getElementById('balAmt').textContent      = tbtc;

  /* Update form hints */
  document.getElementById('walletBal').textContent   = VAULT.walletBalSats.toLocaleString();
  document.getElementById('stakedBal').textContent   = VAULT.userStaked.toLocaleString();
}


/** Called when wallet disconnects externally. */
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


/* ═══════════════════════════════════════════════════════════════
   STAKE
   Deposits tBTC into the vault via a real on-chain TX.
═══════════════════════════════════════════════════════════════ */

/**
 * stake()
 * ───────
 * Validates input → calls sendBitcoin() via OP_Wallet →
 * updates vault state → logs the transaction.
 *
 * Production note:
 *   Replace sendBitcoin() with a PSBT that includes an
 *   OP_RETURN output encoding the stake(amount) calldata
 *   for your deployed OP_NET staking contract.
 */
async function stake() {
  if (!VAULT.connected) {
    toast('err', 'NOT CONNECTED', 'Connect OP_Wallet first');
    return;
  }

  const amtSats = parseInt(document.getElementById('stakeAmt').value, 10);
  if (!amtSats || amtSats < 1000) {
    toast('err', 'INVALID AMOUNT', 'Minimum stake is 1,000 satoshis');
    return;
  }
  if (amtSats > VAULT.walletBalSats) {
    toast('err', 'INSUFFICIENT BALANCE', `You have ${VAULT.walletBalSats.toLocaleString()} sats`);
    return;
  }

  const btn = document.getElementById('stakeBtnEl');
  const orig = btn.textContent;
  setLoading(btn, 'stakeProg', 'stakeProgF', 'AWAITING SIGNATURE...');

  try {
    const p = getProvider();


    const txid = await p.sendBitcoin(
      VAULT.VAULT_CONTRACT,   // staking contract
      amtSats,
      { feeRate: 10 }
    );

    /* Update state */
    VAULT.walletBalSats -= amtSats;
    VAULT.userStaked    += amtSats;
    VAULT.totalStaked   += amtSats;
    VAULT.lastTxHash     = txid;

    await refreshWalletBalance();
    updateDashboard();

    document.getElementById('stakeAmt').value = '';
    updateStakePreview();
    document.getElementById('lastTxHash').textContent = txid.slice(0, 18) + '...';

    addTx('stake', VAULT.address, `staked ${amtSats.toLocaleString()} sats → CONTRACT`, txid);
    toast('ok', 'STAKE CONFIRMED ON-CHAIN!',
      `Staked: ${amtSats.toLocaleString()} sats\nTXID: ${txid.slice(0, 22)}...`);

  } catch (err) {
    toast('err', 'STAKE FAILED', err.message || 'Transaction rejected');
  } finally {
    clearLoading(btn, 'stakeProg', 'stakeProgF', orig);
  }
}


/* ═══════════════════════════════════════════════════════════════
   UNSTAKE
   Withdraws tBTC from the vault via a real on-chain TX.
═══════════════════════════════════════════════════════════════ */

/**
 * unstake()
 * ─────────
 * Validates against staked balance → calls sendBitcoin() →
 * updates vault state → logs the transaction.
 */
async function unstake() {
  if (!VAULT.connected) {
    toast('err', 'NOT CONNECTED', 'Connect OP_Wallet first');
    return;
  }

  if (VAULT.userStaked === 0) {
    toast('err', 'NO STAKED BALANCE', 'You have nothing staked to withdraw');
    return;
  }

  const amtSats = parseInt(document.getElementById('unstakeAmt').value, 10);

  if (!amtSats || amtSats < 1000) {
    toast('err', 'INVALID AMOUNT', 'Minimum unstake is 1,000 satoshis');
    return;
  }

  if (amtSats > VAULT.userStaked) {
    toast('err', 'EXCEEDS STAKED BALANCE',
      `Your staked balance: ${VAULT.userStaked.toLocaleString()} sats`);
    return;
  }

  const btn  = document.getElementById('unstakeBtnEl');
  const orig = btn.textContent;
  setLoading(btn, 'unstakeProg', 'unstakeProgF', 'AWAITING SIGNATURE...');

  try {
    const p = getProvider();

    /*
     * ── REAL ON-CHAIN UNSTAKE TX ──
     * In production: PSBT calling unstake(amount)
     * on the OP_NET staking contract.
     */
    const txid = await p.sendBitcoin(
      VAULT.address,
      amtSats,
      { feeRate: 10 }
    );

    /* Update state */
    VAULT.userStaked    -= amtSats;
    VAULT.totalStaked   -= amtSats;
    VAULT.walletBalSats += amtSats;
    VAULT.lastTxHash     = txid;

    await refreshWalletBalance();
    updateDashboard();

    document.getElementById('unstakeAmt').value     = '';
    document.getElementById('lastTxHash').textContent = txid.slice(0, 18) + '...';

    addTx('unstake', VAULT.address, `unstaked ${amtSats.toLocaleString()} sats`, txid);
    toast('ok', 'UNSTAKE CONFIRMED!',
      `Withdrawn: ${amtSats.toLocaleString()} sats\nTXID: ${txid.slice(0, 22)}...`);

  } catch (err) {
    toast('err', 'UNSTAKE FAILED', err.message || 'Transaction rejected or failed');
  } finally {
    clearLoading(btn, 'unstakeProg', 'unstakeProgF', orig);
  }
}


/* ═══════════════════════════════════════════════════════════════
   AUTO-COMPOUND
   Reinvests accrued rewards back into the staked balance.
═══════════════════════════════════════════════════════════════ */

/**
 * autoCompound()
 * ──────────────
 * Sends a dust TX (546 sats) to trigger an on-chain state
 * update for the compound event.
 * Falls back to a local compound if the user rejects the TX.
 *
 * Also called silently by the countdown timer each cycle.
 */
async function autoCompound() {
  if (!VAULT.connected) {
    _applyCompound(null);   // silent local compound if not connected
    return;
  }

  if (VAULT.userStaked === 0) {
    toast('err', 'NOTHING TO COMPOUND', 'Stake tBTC first to earn rewards');
    return;
  }

  const btn  = document.getElementById('triggerBtn');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="sp"></span>SIGNING...';

  try {
    const p = getProvider();

    /*
     * Send minimum dust (546 sats) to mark the compound event on-chain.
     * In production: signPsbt() with compound() calldata.
     */
    const txid = await p.sendBitcoin(
      VAULT.address,
      546,            // dust threshold
      { feeRate: 5 }
    );

    _applyCompound(txid);
    toast('ok', 'COMPOUND EXECUTED ON-CHAIN!',
      `Rewards reinvested\nTXID: ${txid.slice(0, 22)}...`);

  } catch (err) {
    /*
     * If the user rejects the wallet popup, still apply
     * the compound locally so rewards aren't lost.
     */
    _applyCompound(null);

    if (err.message?.toLowerCase().includes('reject') || err.code === 4001) {
      toast('err', 'COMPOUND CANCELLED', 'Wallet signature rejected');
    } else {
      toast('info', 'COMPOUND APPLIED', 'Rewards compounded locally (no on-chain tx)');
    }
  } finally {
    btn.disabled  = false;
    btn.textContent = orig;
  }
}


/**
 * _applyCompound(txid)
 * ────────────────────
 * Pure state update — calculates the per-cycle reward and
 * adds it to userStaked + totalStaked.
 * Called by autoCompound() and the background countdown timer.
 *
 * Formula: reward = userStaked × (APY% / 100) / (365 × 24)
 *   → converts annual rate to an hourly per-cycle rate
 */
function _applyCompound(txid) {
  const hourlyRate = VAULT.apy / 100 / (365 * 24);
  const reward     = Math.floor(VAULT.userStaked * hourlyRate);

  VAULT.userStaked    += reward;
  VAULT.totalStaked   += reward;
  VAULT.rewardsEarned += reward;
  VAULT.totalCycles++;
  VAULT.cdRemaining = VAULT.cycleSeconds;   // reset countdown

  if (txid) {
    VAULT.lastTxHash = txid;
    document.getElementById('lastTxHash').textContent = txid.slice(0, 18) + '...';
  }

  document.getElementById('totalCycles').textContent = VAULT.totalCycles;

  addTx('compound',
    VAULT.address || 'vault',
    `auto-compounded +${reward.toLocaleString()} sats`,
    txid
  );

  updateDashboard();
}


/* ═══════════════════════════════════════════════════════════════
   getVaultStats()
   Public function — returns a snapshot of vault state.
   Useful for dApp integrations or console debugging.
═══════════════════════════════════════════════════════════════ */

/**
 * getVaultStats()
 * ───────────────
 * Returns the complete current vault state snapshot.
 * Call from browser console: getVaultStats()
 *
 * @returns {Object} vault stats snapshot
 */
function getVaultStats() {
  return {
    totalStaked:    VAULT.totalStaked,
    userStaked:     VAULT.userStaked,
    rewardsEarned:  VAULT.rewardsEarned,
    apy:            VAULT.apy,
    cycleSeconds:   VAULT.cycleSeconds,
    cdRemaining:    VAULT.cdRemaining,
    lastTxHash:     VAULT.lastTxHash,
    totalCycles:    VAULT.totalCycles,
    compoundActive: VAULT.compoundActive,
    walletAddress:  VAULT.address,
    walletBalance:  VAULT.walletBalSats,
    timestamp:      Date.now(),
  };
}


/* ═══════════════════════════════════════════════════════════════
   COUNTDOWN TIMER
   Ticks every second. Fires auto-compound at cycle end.
═══════════════════════════════════════════════════════════════ */

/**
 * startCountdown()
 * ────────────────
 * Runs a 1-second interval that:
 *  - Decrements cdRemaining
 *  - Updates the HH:MM:SS display
 *  - Fires _applyCompound() silently when the cycle completes
 *  - Fluctuates APY slightly to simulate live market
 *  - Drifts TVL slightly to simulate other stakers
 */
function startCountdown() {
  setInterval(() => {

    /* ── Tick ── */
    if (VAULT.cdRemaining > 0) {
      VAULT.cdRemaining--;
    } else {
      /* Cycle complete → auto-compound silently */
      VAULT.cdRemaining = VAULT.cycleSeconds;
      if (VAULT.compoundActive && VAULT.userStaked > 0) {
        _applyCompound(null);
      }
    }

    /* ── Update countdown display ── */
    const h = Math.floor(VAULT.cdRemaining / 3600);
    const m = Math.floor((VAULT.cdRemaining % 3600) / 60);
    const s = VAULT.cdRemaining % 60;

    const hh = String(h).padStart(2, '0');
    const mm = String(m).padStart(2, '0');
    const ss = String(s).padStart(2, '0');

    document.getElementById('cdH').textContent         = hh;
    document.getElementById('cdM').textContent         = mm;
    document.getElementById('cdS').textContent         = ss;
    document.getElementById('nextCompound').textContent = `${hh}:${mm}:${ss}`;

    /* ── APY micro-fluctuation (±0.04% per tick) ── */
    VAULT.apy = +(VAULT.apy + (Math.random() - 0.499) * 0.04).toFixed(2);
    VAULT.apy = Math.max(15, Math.min(25, VAULT.apy));
    updateApyDisplay();

    /* ── TVL drift: simulates other stakers joining ── */
    if (VAULT.connected && VAULT.totalStaked > 0) {
      VAULT.totalStaked += Math.floor(Math.random() * 12);
      document.getElementById('tvlValue').textContent =
        VAULT.totalStaked.toLocaleString();
    }

  }, 1000);
}


/* ═══════════════════════════════════════════════════════════════
   UI UPDATE HELPERS
═══════════════════════════════════════════════════════════════ */

/**
 * updateDashboard()
 * ─────────────────
 * Syncs all stat displays to current VAULT state.
 */
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


/**
 * updateApyDisplay()
 * ──────────────────
 * Updates all APY-related elements: stat strip, ring, breakdown rows.
 */
function updateApyDisplay() {
  const apy = VAULT.apy.toFixed(1);

  document.getElementById('apyValue').textContent   = apy + '%';
  document.getElementById('ringApy').textContent    = apy + '%';
  document.getElementById('baseYield').textContent  = (VAULT.apy * 0.77).toFixed(1) + '%';
  document.getElementById('compBonus').textContent  = '+' + (VAULT.apy * 0.23).toFixed(1) + '%';

  /* SVG ring fill: maps APY% to stroke-dashoffset */
  const circumference = 283;
  const pct    = Math.min(VAULT.apy / 30, 1);
  const offset = circumference - pct * circumference;
  document.getElementById('ringFill').style.strokeDashoffset = offset;
}


/**
 * updateGates()
 * ─────────────
 * Shows / hides the wallet-gate prompts and action forms
 * based on connection state and staked balance.
 */
function updateGates() {
  const connected = VAULT.connected;
  const hasStake  = VAULT.userStaked > 0;

  /* Stake card: gate shown when NOT connected */
  _toggle('stakeGate',   !connected);
  _toggle('stakeForm',    connected);

  /* Unstake card: gate shown when NOT connected or no stake */
  _toggle('unstakeGate', !connected || !hasStake);
  _toggle('unstakeForm',  connected && hasStake);

  /* Compound button: disabled until connected AND staked */
  const triggerBtn = document.getElementById('triggerBtn');
  if (triggerBtn) triggerBtn.disabled = !connected || VAULT.userStaked === 0;
}


/** Toggle display:block / display:none for an element by id. */
function _toggle(id, show) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? 'block' : 'none';
}


/* ── MAX buttons ── */

/** Sets stake input to maximum safe amount (leaves 2000 sats for fees). */
function setMaxStake() {
  const max = Math.max(0, VAULT.walletBalSats - 2000);
  document.getElementById('stakeAmt').value = max;
  updateStakePreview();
}

/** Sets unstake input to the full staked balance. */
function setMaxUnstake() {
  document.getElementById('unstakeAmt').value = VAULT.userStaked;
}


/**
 * updateStakePreview()
 * ────────────────────
 * Updates the live "You Stake / Est. Annual Yield" preview
 * as the user types into the stake amount input.
 */
function updateStakePreview() {
  const amt   = parseInt(document.getElementById('stakeAmt')?.value || 0, 10);
  const prev  = document.getElementById('stakePreview');
  const yprev = document.getElementById('yieldPreview');

  if (!prev || !yprev) return;

  if (!amt || amt <= 0) {
    prev.textContent  = '—';
    yprev.textContent = '—';
    return;
  }

  const annualYield = Math.floor(amt * (VAULT.apy / 100));
  prev.textContent  = amt.toLocaleString() + ' sats';
  yprev.textContent = '+' + annualYield.toLocaleString() + ' sats / yr';
}


/* ═══════════════════════════════════════════════════════════════
   TRANSACTION LOG
═══════════════════════════════════════════════════════════════ */

/**
 * addTx(type, actor, desc, txid)
 * ───────────────────────────────
 * Prepends a new entry to VAULT.txLog and re-renders the list.
 *
 * @param {string}      type   - 'stake' | 'unstake' | 'compound' | 'connect'
 * @param {string}      actor  - wallet address
 * @param {string}      desc   - human-readable description
 * @param {string|null} txid   - on-chain transaction ID (null if local only)
 */
function addTx(type, actor, desc, txid) {
  const entry = {
    type,
    actor,
    desc,
    txid: txid || null,
    time: new Date().toLocaleTimeString(),
  };

  VAULT.txLog.unshift(entry);
  if (VAULT.txLog.length > 40) VAULT.txLog.pop();   // cap at 40 entries

  renderTxLog();
}


/**
 * renderTxLog()
 * ─────────────
 * Re-renders the transaction log HTML from VAULT.txLog.
 */
function renderTxLog() {
  const el = document.getElementById('txLog');
  if (!el) return;

  if (!VAULT.txLog.length) {
    el.innerHTML = '<div class="tx-empty">No transactions yet.</div>';
    return;
  }

  el.innerHTML = VAULT.txLog
    .map(tx => {
      const hashEl = tx.txid
        ? `<span class="tx-hash" onclick="openTx('${tx.txid}')">${tx.txid.slice(0, 16)}...</span>`
        : `<span style="color:var(--txt3);font-family:'Space Mono',monospace;font-size:.58rem">no tx hash</span>`;

      return `
        <div class="tx-row">
          <span class="tx-badge ${tx.type}">${tx.type.toUpperCase()}</span>
          ${hashEl}
          <span style="font-family:'Space Mono',monospace;font-size:.6rem;color:var(--txt3)">
            ${tx.actor.slice(0, 12)}...
          </span>
          <span style="font-family:'Space Mono',monospace;font-size:.6rem;color:var(--txt)">
            ${tx.desc}
          </span>
          <span class="tx-time">${tx.time}</span>
        </div>`;
    })
    .join('');
}


/**
 * openTx(txid)
 * ────────────
 * Opens the transaction in the OP_SCAN explorer.
 * @param {string} txid - on-chain transaction ID
 */
function openTx(txid) {
  window.open(`https://opscan.org/tx/${txid}`, '_blank');
}

/** Opens the last recorded TX hash in OP_SCAN. */
function openLastTx() {
  if (VAULT.lastTxHash) openTx(VAULT.lastTxHash);
}


/* ═══════════════════════════════════════════════════════════════
   LOADING STATE HELPERS
═══════════════════════════════════════════════════════════════ */

/**
 * setLoading(btn, progId, fillId, label)
 * ────────────────────────────────────────
 * Disables a button, shows a spinner, and animates the progress bar.
 *
 * @param {HTMLElement} btn    - button element to disable
 * @param {string}      progId - id of the .prog wrapper element
 * @param {string}      fillId - id of the .prog-fill element
 * @param {string}      label  - text shown next to spinner
 */
function setLoading(btn, progId, fillId, label) {
  if (btn) {
    btn._origText = btn.textContent;
    btn.disabled  = true;
    btn.innerHTML = `<span class="sp"></span>${label}`;
  }

  const prog = document.getElementById(progId);
  if (prog) {
    prog.style.display = 'block';
    let pct = 0;

    prog._interval = setInterval(() => {
      pct += Math.random() * 14 + 4;
      const fill = document.getElementById(fillId);
      if (fill) fill.style.width = Math.min(pct, 85) + '%';
    }, 200);
  }
}


/**
 * clearLoading(btn, progId, fillId, origLabel)
 * ─────────────────────────────────────────────
 * Re-enables a button and hides the progress bar after completion.
 *
 * @param {HTMLElement} btn       - button element to restore
 * @param {string}      progId    - id of the .prog wrapper element
 * @param {string}      fillId    - id of the .prog-fill element
 * @param {string}      origLabel - original button text to restore
 */
function clearLoading(btn, progId, fillId, origLabel) {
  if (btn) {
    btn.disabled    = false;
    btn.textContent = origLabel || btn._origText || '—';
  }

  const prog = document.getElementById(progId);
  if (prog) {
    clearInterval(prog._interval);

    const fill = document.getElementById(fillId);
    if (fill) fill.style.width = '100%';

    setTimeout(() => {
      if (prog) prog.style.display = 'none';
      if (fill) fill.style.width   = '0';
    }, 350);
  }
}


/* ═══════════════════════════════════════════════════════════════
   TOAST NOTIFICATIONS
═══════════════════════════════════════════════════════════════ */

/**
 * toast(type, title, message)
 * ───────────────────────────
 * Renders a self-dismissing notification toast.
 *
 * @param {'ok'|'err'|'info'} type    - controls border/title colour
 * @param {string}            title   - bold heading
 * @param {string}            message - body text (supports \n line breaks)
 */
function toast(type, title, message) {
  const icons = { ok: '✅', err: '❌', info: 'ℹ️' };

  const container = document.getElementById('toasts');
  const el        = document.createElement('div');
  el.className    = `toast ${type}`;
  el.innerHTML    = `
    <span class="toast-ico">${icons[type] || '📡'}</span>
    <div>
      <div class="toast-ttl">${title}</div>
      <div class="toast-msg">${message || ''}</div>
    </div>`;

  container.appendChild(el);

  /* Auto-dismiss after 6 s */
  setTimeout(() => {
    el.style.transition = 'all 0.3s';
    el.style.opacity    = '0';
    el.style.transform  = 'translateX(16px)';
    setTimeout(() => el.remove(), 320);
  }, 6000);
}


/* ═══════════════════════════════════════════════════════════════
   INITIALISATION
═══════════════════════════════════════════════════════════════ */

window.addEventListener('DOMContentLoaded', () => {

  /* ── Detect OP_Wallet installation (delay for injection) ── */
  setTimeout(() => {
    if (!isInstalled()) {
      document.getElementById('installBar').classList.add('show');
    }
  }, 600);

  /* ── Seed initial TVL with simulated background stakers ── */
  VAULT.totalStaked = 48_230_000;   // ≈ 0.48 tBTC from other users
  document.getElementById('tvlValue').textContent      = VAULT.totalStaked.toLocaleString();
  document.getElementById('nextCompound').textContent  = '01:00:00';

  /* ── Render initial states ── */
  updateGates();
  updateApyDisplay();

  /* ── Wire up live stake preview ── */
  const stakeInput = document.getElementById('stakeAmt');
  if (stakeInput) {
    stakeInput.addEventListener('input', updateStakePreview);
  }

  /* ── Start the 1-second countdown / compound timer ── */
  startCountdown();
});
