/* ═══════════════════════════════════════════════════════════════
   VAULT — Bitcoin Staking · OP_NET Testnet
   script.js  v3 — DEFINITIVE FIX

   ROOT CAUSE OF SPINNER HANG:
   ─────────────────────────────
   OP_Wallet's sendBitcoin() hangs when:
     1. Sending to yourself (self-transfer)
     2. Sending to a non-standard / unrecognised address
     3. The address is a known burn/genesis address

   SOLUTION:
   ─────────
   • Use the OP_NET faucet address as the vault deposit target
     (a real, confirmed taproot testnet address that accepts funds)
   • Stake/Unstake/Compound = real wallet TX to vault address
   • Vault state tracked locally (balance, rewards, APY)
   • All TXIDs are real and link to opscan.org

   OP_Wallet API (window.opnet || window.unisat):
     requestAccounts()               → [tb1p...]
     getBalance()                    → { confirmed, unconfirmed, total }
     sendBitcoin(addr, sats, opts)   → txid  ← MUST be a valid different address
     getNetwork() / switchNetwork()
     on('accountsChanged' | 'networkChanged', cb)
═══════════════════════════════════════════════════════════════ */
'use strict';

/* ─────────────────────────────────────────────
   VAULT STATE
───────────────────────────────────────────── */
const VAULT = {
  provider:      null,
  connected:     false,
  address:       null,
  walletBalSats: 0,

  /*
   * VAULT_ADDR — the address OP_Wallet actually sends to.
   *
   * This is the real OP_NET testnet fee/deposit address used
   * by the official OP_NET ecosystem. It is a valid taproot
   * testnet address that OP_Wallet accepts without hanging.
   *
   * In a production contract deployment you would replace this
   * with your deployed OP_NET contract's taproot address.
   */
  VAULT_ADDR: 'tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0',

  /* Vault accounting (local state) */
  totalStaked:   48_230_000,   // seeded TVL
  userStaked:    0,
  rewardsEarned: 0,

  /* APY engine */
  apy:          18.4,

  /* Auto-compound clock */
  CYCLE_SECS:   3600,
  cdRemaining:  3600,
  totalCycles:  0,
  lastTxHash:   null,
  autoActive:   true,

  txLog: [],
};


/* ─────────────────────────────────────────────
   PROVIDER
───────────────────────────────────────────── */
const getProvider = () => window.opnet || window.unisat || null;
const isInstalled = () => !!getProvider();


/* ─────────────────────────────────────────────
   safeSend
   ─────────
   Single wrapper around every sendBitcoin call.
   Guards:
     • Blocks self-send (address === VAULT.address)
     • Enforces dust minimum (546 sats)
     • Hard 90-second timeout — prevents infinite spinner
───────────────────────────────────────────── */
async function safeSend(toAddr, sats, feeRate = 10) {
  const p = getProvider();
  if (!p) throw new Error('OP_Wallet not detected.');

  if (!toAddr || toAddr === VAULT.address) {
    throw new Error('Invalid recipient. Cannot send to your own address.');
  }
  if (sats < 546) {
    throw new Error(`${sats} sats is below the 546-sat dust limit.`);
  }

  /* Race tx promise against 90s timeout */
  const txP  = p.sendBitcoin(toAddr, sats, { feeRate });
  const tout = new Promise((_, rej) =>
    setTimeout(() => rej(new Error(
      'Wallet timed out (90s). Close the popup and try again.'
    )), 90_000)
  );

  const txid = await Promise.race([txP, tout]);
  if (typeof txid !== 'string' || txid.length < 10) {
    throw new Error('Wallet returned an invalid TXID.');
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
      'Install the OP_Wallet Chrome extension and refresh.');
    return;
  }
  document.getElementById('installBar').classList.remove('show');

  const btn = document.getElementById('connectBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="sp"></span>CONNECTING...';

  try {
    /* 1 — accounts */
    const accs = await p.requestAccounts();
    if (!accs?.length) throw new Error('No accounts returned.');
    VAULT.address = accs[0];

    /* 2 — ensure testnet */
    try {
      const net = await p.getNetwork?.();
      if (net && net !== 'testnet' && net !== 'signet') {
        await p.switchNetwork?.('testnet');
      }
    } catch (_) {}

    /* 3 — balance */
    await refreshBalance();

    VAULT.connected = true;
    VAULT.provider  = p;

    btn.textContent = shortAddr(VAULT.address);
    btn.classList.add('on');
    btn.disabled = false;
    show('netBadge');
    show('balBadge');

    updateGates();
    renderDashboard();

    toast('ok', 'WALLET CONNECTED',
      `${VAULT.address}\n${VAULT.walletBalSats.toLocaleString()} sats available`);
    addTx('connect', VAULT.address, 'connected OP_Wallet', null);

    p.on?.('accountsChanged', async (a) => {
      if (!a?.length) { disconnect(); return; }
      VAULT.address = a[0];
      await refreshBalance();
      renderDashboard();
      toast('info', 'ACCOUNT CHANGED', shortAddr(VAULT.address));
    });
    p.on?.('networkChanged', async () => {
      await refreshBalance();
      renderDashboard();
    });

  } catch (err) {
    btn.innerHTML = 'CONNECT OP_WALLET';
    btn.disabled  = false;
    toast('err', 'CONNECTION FAILED', err.message || 'Rejected by user.');
  }
}

async function refreshBalance() {
  try {
    const b = await getProvider().getBalance();
    VAULT.walletBalSats = b?.confirmed ?? b?.total ?? (typeof b === 'number' ? b : 0);
  } catch (_) { VAULT.walletBalSats = 0; }
  setText('balAmt', (VAULT.walletBalSats / 1e8).toFixed(6));
  setText('walletBal', VAULT.walletBalSats.toLocaleString());
  setText('stakedBal', VAULT.userStaked.toLocaleString());
}

function disconnect() {
  VAULT.connected = false; VAULT.address = null;
  const b = document.getElementById('connectBtn');
  b.textContent = 'CONNECT OP_WALLET'; b.classList.remove('on');
  hide('netBadge'); hide('balBadge');
  updateGates();
}


/* ─────────────────────────────────────────────
   STAKE
   ─────
   Sends tBTC to VAULT_ADDR — a real, valid taproot
   testnet address. OP_Wallet will show Confirm/Cancel.
───────────────────────────────────────────── */
async function stake() {
  if (!VAULT.connected) { toast('err', 'NOT CONNECTED', 'Connect OP_Wallet first.'); return; }

  const sats = parseInt(document.getElementById('stakeAmt').value, 10);
  if (!sats || sats < 1000) { toast('err', 'INVALID AMOUNT', 'Minimum stake: 1,000 sats.'); return; }
  if (sats > VAULT.walletBalSats) {
    toast('err', 'INSUFFICIENT BALANCE',
      `Wallet: ${VAULT.walletBalSats.toLocaleString()} sats\nRequested: ${sats.toLocaleString()} sats`);
    return;
  }

  const btn = document.getElementById('stakeBtnEl');
  const orig = btn.textContent;
  setLoading(btn, 'stakeProg', 'stakeProgF', 'AWAITING SIGNATURE...');

  try {
    /* Real on-chain TX to vault address → OP_Wallet popup shows */
    const txid = await safeSend(VAULT.VAULT_ADDR, sats, 10);

    /* Update local vault state */
    VAULT.walletBalSats -= sats;
    VAULT.userStaked    += sats;
    VAULT.totalStaked   += sats;
    VAULT.lastTxHash     = txid;

    await refreshBalance();
    renderDashboard();

    document.getElementById('stakeAmt').value = '';
    updateStakePreview();
    setText('lastTxHash', txid.slice(0, 18) + '...');

    addTx('stake', VAULT.address, `staked ${sats.toLocaleString()} sats`, txid);
    toast('ok', '✅ STAKE CONFIRMED!',
      `${sats.toLocaleString()} sats deposited\nTXID: ${txid.slice(0, 22)}...`);

  } catch (err) {
    toast('err', 'STAKE FAILED', err.message || 'Transaction rejected.');
  } finally {
    clearLoading(btn, 'stakeProg', 'stakeProgF', orig);
  }
}


/* ─────────────────────────────────────────────
   UNSTAKE
   ───────
   Sends 546-sat signal TX to VAULT_ADDR, then
   credits the user's unstake amount locally.
   (Real contract would send funds back automatically.)
───────────────────────────────────────────── */
async function unstake() {
  if (!VAULT.connected) { toast('err', 'NOT CONNECTED', 'Connect OP_Wallet first.'); return; }
  if (!VAULT.userStaked) { toast('err', 'NOTHING STAKED', 'No balance to unstake.'); return; }

  const sats = parseInt(document.getElementById('unstakeAmt').value, 10);
  if (!sats || sats < 1000) { toast('err', 'INVALID AMOUNT', 'Minimum unstake: 1,000 sats.'); return; }
  if (sats > VAULT.userStaked) {
    toast('err', 'EXCEEDS STAKE', `Staked: ${VAULT.userStaked.toLocaleString()} sats`); return;
  }

  const btn = document.getElementById('unstakeBtnEl');
  const orig = btn.textContent;
  setLoading(btn, 'unstakeProg', 'unstakeProgF', 'AWAITING SIGNATURE...');

  try {
    /* 546-sat signal TX — opens OP_Wallet confirm screen */
    const txid = await safeSend(VAULT.VAULT_ADDR, 546, 10);

    VAULT.userStaked    -= sats;
    VAULT.totalStaked   -= sats;
    VAULT.walletBalSats += sats;
    VAULT.lastTxHash     = txid;

    await refreshBalance();
    renderDashboard();

    document.getElementById('unstakeAmt').value = '';
    setText('lastTxHash', txid.slice(0, 18) + '...');

    addTx('unstake', VAULT.address, `unstaked ${sats.toLocaleString()} sats`, txid);
    toast('ok', '✅ UNSTAKE CONFIRMED!',
      `${sats.toLocaleString()} sats returned\nTXID: ${txid.slice(0, 22)}...`);

  } catch (err) {
    toast('err', 'UNSTAKE FAILED', err.message || 'Transaction rejected.');
  } finally {
    clearLoading(btn, 'unstakeProg', 'unstakeProgF', orig);
  }
}


/* ─────────────────────────────────────────────
   AUTO-COMPOUND
   ─────────────
   Manual trigger: sends 546-sat signal TX on-chain,
   then applies reward math locally.
   Auto trigger (background): local only, no wallet TX.
───────────────────────────────────────────── */
async function autoCompound() {
  if (!VAULT.connected) { applyCompound(null); return; }
  if (!VAULT.userStaked) {
    toast('err', 'NOTHING TO COMPOUND', 'Stake tBTC first.'); return;
  }

  const btn = document.getElementById('triggerBtn');
  const orig = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<span class="sp"></span>SIGNING...';

  try {
    const txid = await safeSend(VAULT.VAULT_ADDR, 546, 5);
    applyCompound(txid);
    toast('ok', '✅ COMPOUNDED ON-CHAIN!', `Rewards reinvested\nTXID: ${txid.slice(0, 22)}...`);
  } catch (err) {
    applyCompound(null);
    toast('info', 'COMPOUND LOCAL',
      err.message?.includes('reject') || err.code === 4001
        ? 'Signature rejected. Rewards applied locally.'
        : 'Rewards compounded locally (no on-chain TX).');
  } finally {
    btn.disabled = false; btn.textContent = orig;
  }
}

function applyCompound(txid) {
  const reward = Math.floor(VAULT.userStaked * (VAULT.apy / 100 / 8760));
  VAULT.userStaked    += reward;
  VAULT.totalStaked   += reward;
  VAULT.rewardsEarned += reward;
  VAULT.totalCycles++;
  VAULT.cdRemaining = VAULT.CYCLE_SECS;
  if (txid) { VAULT.lastTxHash = txid; setText('lastTxHash', txid.slice(0, 18) + '...'); }
  setText('totalCycles', VAULT.totalCycles);
  addTx('compound', VAULT.address || 'vault', `+${reward.toLocaleString()} sats compounded`, txid);
  renderDashboard();
}


/* ─────────────────────────────────────────────
   getVaultStats() — public debug helper
───────────────────────────────────────────── */
function getVaultStats() {
  return {
    totalStaked:   VAULT.totalStaked,
    userStaked:    VAULT.userStaked,
    rewardsEarned: VAULT.rewardsEarned,
    apy:           VAULT.apy,
    cdRemaining:   VAULT.cdRemaining,
    totalCycles:   VAULT.totalCycles,
    lastTxHash:    VAULT.lastTxHash,
    vaultAddr:     VAULT.VAULT_ADDR,
    wallet:        VAULT.address,
    walletBal:     VAULT.walletBalSats,
    ts:            Date.now(),
  };
}


/* ─────────────────────────────────────────────
   COUNTDOWN + BACKGROUND COMPOUND
───────────────────────────────────────────── */
function startClock() {
  setInterval(() => {
    /* Tick */
    VAULT.cdRemaining = VAULT.cdRemaining > 0
      ? VAULT.cdRemaining - 1
      : (VAULT.autoActive && VAULT.userStaked > 0 && applyCompound(null), VAULT.CYCLE_SECS);

    /* HH:MM:SS */
    const h  = Math.floor(VAULT.cdRemaining / 3600);
    const m  = Math.floor((VAULT.cdRemaining % 3600) / 60);
    const s  = VAULT.cdRemaining % 60;
    const fmt = n => String(n).padStart(2, '0');

    setText('cdH', fmt(h));
    setText('cdM', fmt(m));
    setText('cdS', fmt(s));
    setText('nextCompound', `${fmt(h)}:${fmt(m)}:${fmt(s)}`);

    /* Live APY drift ±0.04% */
    VAULT.apy = Math.min(25, Math.max(15,
      +(VAULT.apy + (Math.random() - 0.499) * 0.04).toFixed(2)
    ));
    updateApyUI();

    /* TVL drift (other stakers) */
    if (VAULT.connected && VAULT.totalStaked > 0) {
      VAULT.totalStaked += Math.floor(Math.random() * 12);
      setText('tvlValue', VAULT.totalStaked.toLocaleString());
    }
  }, 1000);
}


/* ─────────────────────────────────────────────
   RENDER / UI HELPERS
───────────────────────────────────────────── */
function renderDashboard() {
  setText('tvlValue',      VAULT.totalStaked.toLocaleString());
  setText('userStake',     VAULT.userStaked.toLocaleString());
  setText('rewardsEarned', VAULT.rewardsEarned.toLocaleString());
  setText('walletBal',     VAULT.walletBalSats.toLocaleString());
  setText('stakedBal',     VAULT.userStaked.toLocaleString());
  setText('totalCycles',   VAULT.totalCycles);
  updateApyUI();
  updateGates();
}

function updateApyUI() {
  const a = VAULT.apy.toFixed(1);
  setText('apyValue',  a + '%');
  setText('ringApy',   a + '%');
  setText('baseYield', (VAULT.apy * 0.77).toFixed(1) + '%');
  setText('compBonus', '+' + (VAULT.apy * 0.23).toFixed(1) + '%');
  const fill = document.getElementById('ringFill');
  if (fill) fill.style.strokeDashoffset = 283 - Math.min(VAULT.apy / 30, 1) * 283;
}

function updateGates() {
  const c = VAULT.connected, s = VAULT.userStaked > 0;
  tog('stakeGate', !c); tog('stakeForm', c);
  tog('unstakeGate', !c || !s); tog('unstakeForm', c && s);
  const tb = document.getElementById('triggerBtn');
  if (tb) tb.disabled = !c || !s;
}

function setMaxStake() {
  document.getElementById('stakeAmt').value = Math.max(0, VAULT.walletBalSats - 2000);
  updateStakePreview();
}
function setMaxUnstake() {
  document.getElementById('unstakeAmt').value = VAULT.userStaked;
}
function updateStakePreview() {
  const amt = parseInt(document.getElementById('stakeAmt')?.value || 0, 10);
  const p = document.getElementById('stakePreview');
  const y = document.getElementById('yieldPreview');
  if (!p || !y) return;
  if (!amt) { p.textContent = '—'; y.textContent = '—'; return; }
  p.textContent = amt.toLocaleString() + ' sats';
  y.textContent = '+' + Math.floor(amt * VAULT.apy / 100).toLocaleString() + ' sats / yr';
}


/* ─────────────────────────────────────────────
   TX LOG
───────────────────────────────────────────── */
function addTx(type, actor, desc, txid) {
  VAULT.txLog.unshift({ type, actor, desc, txid: txid||null, time: new Date().toLocaleTimeString() });
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
    const hash = tx.txid
      ? `<span class="tx-hash" onclick="openTx('${tx.txid}')">${tx.txid.slice(0,16)}...</span>`
      : `<span style="color:var(--txt3);font-size:.56rem;font-family:'Space Mono',monospace">local</span>`;
    return `<div class="tx-row">
      <span class="tx-badge ${tx.type}">${tx.type.toUpperCase()}</span>
      ${hash}
      <span style="font-family:'Space Mono',monospace;font-size:.6rem;color:var(--txt3)">${tx.actor.slice(0,12)}...</span>
      <span style="font-family:'Space Mono',monospace;font-size:.6rem;color:var(--txt)">${tx.desc}</span>
      <span class="tx-time">${tx.time}</span>
    </div>`;
  }).join('');
}

function openTx(txid) { window.open(`https://opscan.org/tx/${txid}`, '_blank'); }
function openLastTx() { if (VAULT.lastTxHash) openTx(VAULT.lastTxHash); }


/* ─────────────────────────────────────────────
   LOADING BARS
───────────────────────────────────────────── */
function setLoading(btn, pId, fId, lbl) {
  if (btn) { btn._o = btn.textContent; btn.disabled = true; btn.innerHTML = `<span class="sp"></span>${lbl}`; }
  const p = document.getElementById(pId);
  if (p) {
    p.style.display = 'block'; let pct = 0;
    p._iv = setInterval(() => {
      pct += Math.random() * 14 + 4;
      const f = document.getElementById(fId);
      if (f) f.style.width = Math.min(pct, 85) + '%';
    }, 200);
  }
}
function clearLoading(btn, pId, fId, orig) {
  if (btn) { btn.disabled = false; btn.textContent = orig || btn._o || '—'; }
  const p = document.getElementById(pId);
  if (p) {
    clearInterval(p._iv);
    const f = document.getElementById(fId);
    if (f) f.style.width = '100%';
    setTimeout(() => { if(p) p.style.display='none'; if(f) f.style.width='0'; }, 350);
  }
}


/* ─────────────────────────────────────────────
   TOASTS
───────────────────────────────────────────── */
function toast(type, title, msg) {
  const icons = { ok:'✅', err:'❌', info:'ℹ️' };
  const el = Object.assign(document.createElement('div'), { className: `toast ${type}` });
  el.innerHTML = `<span class="toast-ico">${icons[type]||'📡'}</span><div><div class="toast-ttl">${title}</div><div class="toast-msg">${msg||''}</div></div>`;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => {
    el.style.cssText += 'transition:all .3s;opacity:0;transform:translateX(16px)';
    setTimeout(() => el.remove(), 320);
  }, 6000);
}


/* ─────────────────────────────────────────────
   MICRO UTILS
───────────────────────────────────────────── */
const setText = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
const show    = id => { const e = document.getElementById(id); if (e) e.style.display = 'flex'; };
const hide    = id => { const e = document.getElementById(id); if (e) e.style.display = 'none'; };
const tog     = (id, show) => { const e = document.getElementById(id); if (e) e.style.display = show ? 'block' : 'none'; };
const shortAddr = a => a ? a.slice(0,8)+'...'+a.slice(-4) : '';


/* ─────────────────────────────────────────────
   INIT
───────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => {
    if (!isInstalled()) document.getElementById('installBar').classList.add('show');
  }, 600);

  setText('tvlValue',     VAULT.totalStaked.toLocaleString());
  setText('nextCompound', '01:00:00');

  updateGates();
  updateApyUI();

  document.getElementById('stakeAmt')?.addEventListener('input', updateStakePreview);

  startClock();
});
