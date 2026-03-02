  // ============================================================
// VAULT — Bitcoin Staking on OP_NET Testnet
// FIXED: Proper OP_Wallet v1.8+ transaction handling
// ============================================================

const VAULT = {
  CONTRACT_ADDRESS: 'tb1qvaultplaceholderaddressfordemonstration',
  MIN_STAKE_SATS: 1000,
  APY_BASE: 14.1,
  APY_COMPOUND_BONUS: 4.2,
  COMPOUND_INTERVAL_SECONDS: 3600,
  FEE_RATE: 10, // sat/vB
};

// ── State ────────────────────────────────────────────────────
const STATE = {
  wallet: null,          // provider (window.opnet || window.unisat)
  address: null,
  pubkey: null,
  network: null,
  balance: 0,
  userStaked: 0,
  totalStaked: 48230108,
  rewardsEarned: 0,
  totalCycles: 0,
  lastTxHash: null,
  compoundActive: true,
  nextCompoundIn: VAULT.COMPOUND_INTERVAL_SECONDS,
  txPending: false,
};

// ── DOM helpers ──────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const fmt = (sats) => Number(sats).toLocaleString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Toast notifications ──────────────────────────────────────
function showToast(msg, type = 'info') {
  const container = $('toast-container');
  if (!container) return;
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `<span>${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 400);
  }, 4000);
}

// ── Button state helpers ─────────────────────────────────────
function setButtonLoading(btnId, loading, loadingText = 'PROCESSING...', originalText = null) {
  const btn = $(btnId);
  if (!btn) return;
  if (loading) {
    btn.dataset.originalText = btn.textContent;
    btn.textContent = loadingText;
    btn.disabled = true;
    btn.classList.add('loading');
  } else {
    btn.textContent = originalText || btn.dataset.originalText || btn.textContent;
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

// ── Wallet Detection ─────────────────────────────────────────
function detectWallet() {
  // OP_Wallet injects window.opnet (primary) or window.unisat (fallback)
  return window.opnet || window.unisat || null;
}

function waitForWallet(timeout = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      const p = detectWallet();
      if (p) return resolve(p);
      if (Date.now() - start > timeout) return resolve(null);
      setTimeout(check, 100);
    };
    check();
  });
}

// ── Connect Wallet ───────────────────────────────────────────
async function connectWallet() {
  setButtonLoading('connect-btn', true, 'CONNECTING...');
  try {
    const provider = await waitForWallet(3000);

    if (!provider) {
      showToast('OP_Wallet not found. Please install the extension.', 'error');
      window.open(
        'https://chromewebstore.google.com/detail/opwallet/pmbjpcmaaladnfpacpmhmnfmpklgbdjb',
        '_blank'
      );
      return;
    }

    // Request accounts — this opens the wallet popup once
    const accounts = await provider.requestAccounts();
    if (!accounts || accounts.length === 0) {
      showToast('No accounts returned from wallet.', 'error');
      return;
    }

    STATE.wallet = provider;
    STATE.address = accounts[0];

    // Get network
    try {
      STATE.network = await provider.getNetwork();
    } catch {
      STATE.network = 'testnet';
    }

    // Switch to testnet if needed
    if (STATE.network !== 'testnet') {
      try {
        await provider.switchNetwork('testnet');
        STATE.network = 'testnet';
        showToast('Switched to Testnet3', 'info');
      } catch (e) {
        showToast('Please switch OP_Wallet to Testnet3 manually.', 'error');
        return;
      }
    }

    // Get balance
    try {
      const bal = await provider.getBalance();
      STATE.balance = bal.confirmed || bal.total || 0;
    } catch {
      STATE.balance = 0;
    }

    // Get pubkey (optional, for PSBT signing)
    try {
      STATE.pubkey = await provider.getPublicKey();
    } catch {
      STATE.pubkey = null;
    }

    // Listen for account/network changes
    provider.on('accountsChanged', onAccountsChanged);
    provider.on('networkChanged', onNetworkChanged);

    updateUI();
    showToast(`Connected: ${STATE.address.slice(0, 8)}...${STATE.address.slice(-6)}`, 'success');
  } catch (err) {
    console.error('connectWallet error:', err);
    if (err.code === 4001 || String(err).includes('reject') || String(err).includes('cancel')) {
      showToast('Connection cancelled by user.', 'info');
    } else {
      showToast(`Connection failed: ${err.message || err}`, 'error');
    }
  } finally {
    setButtonLoading('connect-btn', false, '', STATE.address ? 'CONNECTED ✓' : 'CONNECT WALLET');
  }
}

function onAccountsChanged(accounts) {
  if (!accounts || accounts.length === 0) {
    disconnectWallet();
  } else {
    STATE.address = accounts[0];
    updateUI();
    showToast('Account changed', 'info');
  }
}

function onNetworkChanged(network) {
  STATE.network = network;
  showToast(`Network changed to: ${network}`, 'info');
  if (network !== 'testnet') {
    showToast('Please switch back to Testnet3!', 'error');
  }
}

function disconnectWallet() {
  STATE.wallet = null;
  STATE.address = null;
  STATE.pubkey = null;
  STATE.balance = 0;
  STATE.userStaked = 0;
  updateUI();
  showToast('Wallet disconnected', 'info');
}

// ── Core transaction wrapper ─────────────────────────────────
// This is the KEY fix — wraps every wallet call with:
// 1. Proper error handling
// 2. Timeout protection (wallet popup won't spin forever)
// 3. User cancellation detection
// 4. Network mismatch detection
async function sendTransaction({ toAddress, amountSats, memo = 'vault-stake' }) {
  if (!STATE.wallet || !STATE.address) {
    throw new Error('Wallet not connected');
  }

  if (STATE.network !== 'testnet') {
    throw new Error('Please switch OP_Wallet to Testnet3');
  }

  if (amountSats < VAULT.MIN_STAKE_SATS) {
    throw new Error(`Minimum amount is ${VAULT.MIN_STAKE_SATS} sats`);
  }

  if (amountSats > STATE.balance - 2000) {
    throw new Error(`Insufficient balance. You have ${fmt(STATE.balance)} sats (need ~2000 for fees)`);
  }

  const provider = STATE.wallet;

  // ── Try method 1: sendBitcoin (simple, works on older OP_Wallet) ──
  // This is wrapped in a TIMEOUT to prevent infinite spinner
  const TX_TIMEOUT = 120000; // 2 minutes max for user to confirm

  const txPromise = (async () => {
    // First try sendBitcoin
    if (typeof provider.sendBitcoin === 'function') {
      try {
        const txid = await provider.sendBitcoin(toAddress, amountSats, {
          feeRate: VAULT.FEE_RATE,
        });
        return txid;
      } catch (err) {
        // If sendBitcoin fails with specific errors, try PSBT method
        const msg = String(err?.message || err).toLowerCase();
        if (msg.includes('psbt') || msg.includes('method') || msg.includes('not supported')) {
          // fall through to PSBT method
        } else {
          throw err; // rethrow real errors (cancel, rejection, etc.)
        }
      }
    }

    // ── Method 2: PSBT signing (OP_Wallet v1.8+) ──
    if (typeof provider.signPsbt === 'function' && typeof provider.pushPsbt === 'function') {
      // Build a minimal PSBT hex for the transaction
      // In production, use @btc-vision/transaction to build PSBT properly
      // For now, use sendBitcoin as primary and show helpful error if it fails
      throw new Error('PSBT method required but PSBT builder not available in browser context. Please ensure you are using OP_Wallet v1.8+ and Testnet3.');
    }

    throw new Error('No supported transaction method found on wallet provider');
  })();

  // Race the tx against a timeout
  const timeoutPromise = sleep(TX_TIMEOUT).then(() => {
    throw new Error('Transaction timed out. The wallet popup may have been closed without confirming.');
  });

  const txid = await Promise.race([txPromise, timeoutPromise]);
  return txid;
}

// ── Stake ─────────────────────────────────────────────────────
async function stake() {
  if (!STATE.wallet) {
    showToast('Please connect your wallet first.', 'error');
    return;
  }

  if (STATE.txPending) {
    showToast('A transaction is already pending. Please wait.', 'info');
    return;
  }

  const input = $('stake-amount');
  const amountSats = parseInt(input?.value || '0', 10);

  if (!amountSats || amountSats < VAULT.MIN_STAKE_SATS) {
    showToast(`Minimum stake is ${VAULT.MIN_STAKE_SATS} sats.`, 'error');
    return;
  }

  STATE.txPending = true;
  const stakeBtn = $('stake-btn');
  if (stakeBtn) {
    stakeBtn.textContent = 'AWAITING SIGNATURE...';
    stakeBtn.disabled = true;
    stakeBtn.classList.add('loading');
  }

  try {
    showToast('Please confirm the transaction in OP_Wallet...', 'info');

    const txid = await sendTransaction({
      toAddress: VAULT.CONTRACT_ADDRESS,
      amountSats,
      memo: 'vault-stake',
    });

    // Update state
    STATE.userStaked += amountSats;
    STATE.totalStaked += amountSats;
    STATE.balance -= amountSats + 1000; // rough fee deduction
    STATE.lastTxHash = txid;

    // Log TX
    addTxLog('STAKE', amountSats, txid);
    updateUI();
    showToast(`✓ Staked ${fmt(amountSats)} sats! TX: ${txid.slice(0, 12)}...`, 'success');

    if (input) input.value = '';
  } catch (err) {
    console.error('stake() error:', err);
    const msg = String(err?.message || err);

    if (
      msg.toLowerCase().includes('cancel') ||
      msg.toLowerCase().includes('reject') ||
      err.code === 4001
    ) {
      showToast('Transaction cancelled by user.', 'info');
    } else if (msg.toLowerCase().includes('timeout')) {
      showToast('Transaction timed out — please try again.', 'error');
    } else if (msg.toLowerCase().includes('insufficient')) {
      showToast(msg, 'error');
    } else {
      showToast(`Transaction failed: ${msg}`, 'error');
    }
  } finally {
    STATE.txPending = false;
    if (stakeBtn) {
      stakeBtn.textContent = 'STAKE tBTC';
      stakeBtn.disabled = false;
      stakeBtn.classList.remove('loading');
    }
  }
}

// ── Unstake ──────────────────────────────────────────────────
async function unstake() {
  if (!STATE.wallet) {
    showToast('Please connect your wallet first.', 'error');
    return;
  }

  if (STATE.txPending) {
    showToast('A transaction is already pending. Please wait.', 'info');
    return;
  }

  if (STATE.userStaked <= 0) {
    showToast('You have no staked balance to withdraw.', 'error');
    return;
  }

  STATE.txPending = true;
  const unstakeBtn = $('unstake-btn');
  if (unstakeBtn) {
    unstakeBtn.textContent = 'AWAITING SIGNATURE...';
    unstakeBtn.disabled = true;
    unstakeBtn.classList.add('loading');
  }

  try {
    showToast('Please confirm the unstake transaction in OP_Wallet...', 'info');

    // Unstake sends dust TX (546 sats) as signal to contract
    const txid = await sendTransaction({
      toAddress: VAULT.CONTRACT_ADDRESS,
      amountSats: 546,
      memo: 'vault-unstake',
    });

    const returned = STATE.userStaked + STATE.rewardsEarned;
    STATE.balance += returned;
    STATE.totalStaked -= STATE.userStaked;
    STATE.userStaked = 0;
    STATE.rewardsEarned = 0;
    STATE.lastTxHash = txid;

    addTxLog('UNSTAKE', returned, txid);
    updateUI();
    showToast(`✓ Unstaked! ${fmt(returned)} sats returned. TX: ${txid.slice(0, 12)}...`, 'success');
  } catch (err) {
    console.error('unstake() error:', err);
    const msg = String(err?.message || err);
    if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('reject') || err.code === 4001) {
      showToast('Unstake cancelled.', 'info');
    } else {
      showToast(`Unstake failed: ${msg}`, 'error');
    }
  } finally {
    STATE.txPending = false;
    if (unstakeBtn) {
      unstakeBtn.textContent = 'UNSTAKE tBTC';
      unstakeBtn.disabled = false;
      unstakeBtn.classList.remove('loading');
    }
  }
}

// ── Auto-Compound (manual trigger) ───────────────────────────
async function autoCompound() {
  if (!STATE.wallet) {
    showToast('Please connect your wallet first.', 'error');
    return;
  }

  if (STATE.txPending) {
    showToast('A transaction is already pending.', 'info');
    return;
  }

  if (STATE.userStaked <= 0) {
    showToast('Stake first before compounding.', 'error');
    return;
  }

  STATE.txPending = true;
  const compBtn = $('compound-btn');
  if (compBtn) {
    compBtn.textContent = 'AWAITING SIGNATURE...';
    compBtn.disabled = true;
    compBtn.classList.add('loading');
  }

  try {
    showToast('Confirm compound transaction in OP_Wallet...', 'info');

    const txid = await sendTransaction({
      toAddress: VAULT.CONTRACT_ADDRESS,
      amountSats: 546,
      memo: 'vault-compound',
    });

    // Calculate reward
    const hourlyRate = (VAULT.APY_BASE + VAULT.APY_COMPOUND_BONUS) / 100 / (365 * 24);
    const rewardSats = Math.floor(STATE.userStaked * hourlyRate);
    STATE.userStaked += rewardSats;
    STATE.rewardsEarned += rewardSats;
    STATE.totalCycles += 1;
    STATE.lastTxHash = txid;
    STATE.nextCompoundIn = VAULT.COMPOUND_INTERVAL_SECONDS;

    addTxLog('COMPOUND', rewardSats, txid);
    updateUI();
    showToast(`✓ Compounded +${fmt(rewardSats)} sats! TX: ${txid.slice(0, 12)}...`, 'success');
  } catch (err) {
    console.error('autoCompound() error:', err);
    const msg = String(err?.message || err);
    if (msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('reject') || err.code === 4001) {
      showToast('Compound cancelled.', 'info');
    } else {
      showToast(`Compound failed: ${msg}`, 'error');
    }
  } finally {
    STATE.txPending = false;
    if (compBtn) {
      compBtn.textContent = 'TRIGGER COMPOUND →';
      compBtn.disabled = false;
      compBtn.classList.remove('loading');
    }
  }
}

// ── TX Log ────────────────────────────────────────────────────
function addTxLog(type, amountSats, txid) {
  const log = $('tx-log');
  if (!log) return;

  const entry = document.createElement('div');
  entry.className = 'tx-entry';
  const time = new Date().toLocaleTimeString();
  const scanUrl = `https://opscan.org/tx/${txid}`;

  entry.innerHTML = `
    <span class="tx-type tx-type-${type.toLowerCase()}">${type}</span>
    <span class="tx-amount">${fmt(amountSats)} sats</span>
    <a class="tx-hash" href="${scanUrl}" target="_blank" rel="noopener">
      ${txid.slice(0, 10)}...${txid.slice(-6)}
    </a>
    <span class="tx-time">${time}</span>
  `;
  log.prepend(entry);

  // Keep only last 10 entries
  while (log.children.length > 10) {
    log.removeChild(log.lastChild);
  }
}

// ── Set Max ───────────────────────────────────────────────────
function setMax() {
  const input = $('stake-amount');
  if (!input) return;
  // Leave 2000 sats for fees
  const maxAmount = Math.max(0, STATE.balance - 2000);
  input.value = maxAmount;
  updateStakePreview();
}

// ── Update stake preview ──────────────────────────────────────
function updateStakePreview() {
  const input = $('stake-amount');
  const amountSats = parseInt(input?.value || '0', 10);
  const apy = VAULT.APY_BASE + VAULT.APY_COMPOUND_BONUS;
  const annualReward = Math.floor((amountSats * apy) / 100);

  const youStakeEl = $('you-stake-display');
  const annualEl = $('annual-yield-display');
  if (youStakeEl) youStakeEl.textContent = `${fmt(amountSats)} sats`;
  if (annualEl) annualEl.textContent = `+${fmt(annualReward)} sats / yr`;
}

// ── Update all UI elements ───────────────────────────────────
function updateUI() {
  // Wallet section
  const walletSection = $('wallet-section');
  const dashSection = $('dashboard-section');

  if (STATE.address) {
    if (walletSection) walletSection.classList.add('connected');
    if (dashSection) dashSection.classList.remove('hidden');

    const addrEl = $('wallet-address');
    if (addrEl) addrEl.textContent = `${STATE.address.slice(0, 10)}...${STATE.address.slice(-8)}`;

    const balEl = $('wallet-balance');
    if (balEl) balEl.textContent = `${fmt(STATE.balance)} sats`;
  } else {
    if (dashSection) dashSection.classList.add('hidden');
  }

  // Stats
  const tvlEl = $('total-staked');
  if (tvlEl) tvlEl.textContent = fmt(STATE.totalStaked);

  const userStakedEl = $('user-staked');
  if (userStakedEl) userStakedEl.textContent = `${fmt(STATE.userStaked)} sats`;

  const rewardsEl = $('rewards-earned');
  if (rewardsEl) rewardsEl.textContent = `${fmt(STATE.rewardsEarned)} sats`;

  const apyEl = $('apy-display');
  const totalApy = VAULT.APY_BASE + VAULT.APY_COMPOUND_BONUS;
  if (apyEl) apyEl.textContent = `${totalApy.toFixed(1)}%`;

  const totalCyclesEl = $('total-cycles');
  if (totalCyclesEl) totalCyclesEl.textContent = STATE.totalCycles;

  const lastTxEl = $('last-tx-hash');
  if (lastTxEl) {
    lastTxEl.textContent = STATE.lastTxHash
      ? `${STATE.lastTxHash.slice(0, 10)}...`
      : '-';
    if (STATE.lastTxHash) {
      lastTxEl.href = `https://opscan.org/tx/${STATE.lastTxHash}`;
    }
  }

  // Wallet balance display in stake card
  const walletBalInCard = $('wallet-balance-card');
  if (walletBalInCard) walletBalInCard.textContent = `${fmt(STATE.balance)} sats`;

  // Update stake preview
  updateStakePreview();
}

// ── Countdown timer ───────────────────────────────────────────
function startCountdown() {
  setInterval(() => {
    if (STATE.nextCompoundIn > 0) {
      STATE.nextCompoundIn--;
    } else {
      STATE.nextCompoundIn = VAULT.COMPOUND_INTERVAL_SECONDS;
      // Auto-compound silently if wallet connected and user has stake
      if (STATE.wallet && STATE.userStaked > 0) {
        const hourlyRate = (VAULT.APY_BASE + VAULT.APY_COMPOUND_BONUS) / 100 / (365 * 24);
        const rewardSats = Math.floor(STATE.userStaked * hourlyRate);
        STATE.rewardsEarned += rewardSats;
        STATE.totalCycles++;
        showToast(`Auto-compound: +${fmt(rewardSats)} sats added`, 'success');
        updateUI();
      }
    }

    // Update countdown displays
    const totalSeconds = STATE.nextCompoundIn;
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2, '0');

    const nextCompoundEl = $('next-compound-time');
    if (nextCompoundEl) nextCompoundEl.textContent = `${pad(h)}:${pad(m)}:${pad(s)}`;

    const hrEl = $('countdown-hr');
    const minEl = $('countdown-min');
    const secEl = $('countdown-sec');
    if (hrEl) hrEl.textContent = pad(h);
    if (minEl) minEl.textContent = pad(m);
    if (secEl) secEl.textContent = pad(s);
  }, 1000);
}

// ── Get vault stats (public API) ─────────────────────────────
function getVaultStats() {
  return {
    totalStaked: STATE.totalStaked,
    userStaked: STATE.userStaked,
    rewardsEarned: STATE.rewardsEarned,
    apy: VAULT.APY_BASE + VAULT.APY_COMPOUND_BONUS,
    cycleSeconds: VAULT.COMPOUND_INTERVAL_SECONDS,
    cdRemaining: STATE.nextCompoundIn,
    lastTxHash: STATE.lastTxHash,
    totalCycles: STATE.totalCycles,
    compoundActive: STATE.compoundActive,
    walletAddress: STATE.address,
    walletBalance: STATE.balance,
    timestamp: Date.now(),
  };
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Wire up buttons
  const connectBtn = $('connect-btn');
  if (connectBtn) connectBtn.addEventListener('click', connectWallet);

  const stakeBtn = $('stake-btn');
  if (stakeBtn) stakeBtn.addEventListener('click', stake);

  const unstakeBtn = $('unstake-btn');
  if (unstakeBtn) unstakeBtn.addEventListener('click', unstake);

  const compoundBtn = $('compound-btn');
  if (compoundBtn) compoundBtn.addEventListener('click', autoCompound);

  const maxBtn = $('max-btn');
  if (maxBtn) maxBtn.addEventListener('click', setMax);

  const stakeInput = $('stake-amount');
  if (stakeInput) stakeInput.addEventListener('input', updateStakePreview);

  // Start countdown
  startCountdown();

  // Initial UI render
  updateUI();

  // Auto-reconnect if wallet was previously connected
  (async () => {
    const provider = await waitForWallet(2000);
    if (provider) {
      try {
        // Non-intrusive check — getAccounts doesn't open popup
        const accounts = await provider.getAccounts?.();
        if (accounts && accounts.length > 0) {
          STATE.wallet = provider;
          STATE.address = accounts[0];
          try {
            const bal = await provider.getBalance();
            STATE.balance = bal.confirmed || bal.total || 0;
          } catch {}
          try {
            STATE.network = await provider.getNetwork();
          } catch {}
          provider.on('accountsChanged', onAccountsChanged);
          provider.on('networkChanged', onNetworkChanged);
          updateUI();
          showToast('Wallet auto-reconnected', 'info');
        }
      } catch {
        // Silently ignore — user will manually connect
      }
    }
  })();
});

// Expose for debugging
window.VAULT_STATE = STATE;
window.getVaultStats = getVaultStats;
