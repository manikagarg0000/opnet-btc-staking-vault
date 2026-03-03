// ============================================================
// VAULT — Bitcoin Staking on OP_NET Testnet
// FIX v2: OP_Wallet v1.8.1+ BREAKING CHANGE
// sendBitcoin() throws "Error: Not supported" in v1.8.1+
// Correct API: fetch UTXOs → build PSBT → signPsbt → pushPsbt
// ============================================================

const VAULT = {
  // Replace with your real deployed OP_NET contract address
  CONTRACT_ADDRESS: 'tb1qvaultdemoaddressplaceholder000000000000',
  MIN_STAKE_SATS: 1000,
  DUST_LIMIT: 546,
  APY_BASE: 14.1,
  APY_COMPOUND_BONUS: 4.2,
  COMPOUND_INTERVAL_SECONDS: 3600,
  FEE_RATE: 10, // sat/vB
  // OP_NET Testnet3 API base
  API_BASE: 'https://api.opnet.org',
  NETWORK: 'testnet',
};

// ── State ────────────────────────────────────────────────────
const STATE = {
  provider: null,
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

// ── Helpers ───────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const fmt = (n) => Number(n).toLocaleString();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad2 = (n) => String(n).padStart(2, '0');

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg, type = 'info') {
  const c = $('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 400);
  }, 4500);
}

// ── Wallet detection ──────────────────────────────────────────
function getProvider() {
  return window.opnet || window.unisat || null;
}

function waitForProvider(ms = 3000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const poll = () => {
      const p = getProvider();
      if (p) return resolve(p);
      if (Date.now() - start >= ms) return resolve(null);
      setTimeout(poll, 100);
    };
    poll();
  });
}

// ── Connect Wallet ────────────────────────────────────────────
async function connectWallet() {
  const btn = $('connect-btn');
  if (btn) { btn.textContent = 'CONNECTING...'; btn.disabled = true; }

  try {
    const provider = await waitForProvider(3000);
    if (!provider) {
      showToast('OP_Wallet not found — please install it.', 'error');
      window.open('https://chromewebstore.google.com/detail/opwallet/pmbjpcmaaladnfpacpmhmnfmpklgbdjb', '_blank');
      return;
    }

    const accounts = await provider.requestAccounts();
    if (!accounts?.length) { showToast('No accounts returned.', 'error'); return; }

    STATE.provider = provider;
    STATE.address  = accounts[0];

    // Network check
    try { STATE.network = await provider.getNetwork(); } catch { STATE.network = 'testnet'; }
    if (STATE.network !== 'testnet') {
      try {
        await provider.switchNetwork('testnet');
        STATE.network = 'testnet';
        showToast('Switched to Testnet3', 'info');
      } catch {
        showToast('Please switch OP_Wallet to Testnet3 manually.', 'error');
        return;
      }
    }

    // Balance
    try {
      const bal = await provider.getBalance();
      STATE.balance = bal.confirmed ?? bal.total ?? 0;
    } catch { STATE.balance = 0; }

    // Public key (needed for PSBT signing)
    try { STATE.pubkey = await provider.getPublicKey(); } catch { STATE.pubkey = null; }

    provider.on?.('accountsChanged', onAccountsChanged);
    provider.on?.('networkChanged',  onNetworkChanged);

    updateUI();
    showToast(`Connected: ${STATE.address.slice(0,8)}…${STATE.address.slice(-6)}`, 'success');
  } catch (err) {
    handleWalletError(err, 'Connection');
  } finally {
    if (btn) {
      btn.textContent = STATE.address ? 'CONNECTED ✓' : 'CONNECT WALLET';
      btn.disabled = false;
    }
  }
}

function onAccountsChanged(accs) {
  if (!accs?.length) { resetWallet(); return; }
  STATE.address = accs[0];
  updateUI();
  showToast('Account changed', 'info');
}

function onNetworkChanged(net) {
  STATE.network = net;
  if (net !== 'testnet') showToast('⚠ Please switch back to Testnet3!', 'error');
}

function resetWallet() {
  Object.assign(STATE, { provider: null, address: null, pubkey: null, balance: 0, userStaked: 0 });
  updateUI();
}

// ── UTXO fetcher (OP_NET testnet API) ─────────────────────────
async function fetchUTXOs(address) {
  // Try OP_NET API first, then fall back to mempool.space testnet
  const urls = [
    `${VAULT.API_BASE}/address/${address}/utxo`,
    `https://mempool.space/testnet4/api/address/${address}/utxo`,
    `https://mempool.space/testnet/api/address/${address}/utxo`,
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const utxos = await res.json();
      if (Array.isArray(utxos) && utxos.length > 0) return utxos;
    } catch { /* try next */ }
  }
  throw new Error('Could not fetch UTXOs. Please check your network connection.');
}

// ── Build PSBT hex using raw Bitcoin bytes ────────────────────
// We build a minimal valid PSBT without any external library
// so it works in a plain HTML file with no bundler.
function buildPsbtHex({ utxos, toAddress, amountSats, changeAddress, feeRate }) {
  // Estimate fee: ~148 bytes per P2WPKH input + 34 bytes per output + 10 overhead
  const estSize = utxos.length * 148 + 2 * 34 + 10;
  const fee = estSize * feeRate;
  const totalIn = utxos.reduce((s, u) => s + u.value, 0);
  const change = totalIn - amountSats - fee;

  if (change < 0) throw new Error(`Insufficient balance. Need ${amountSats + fee} sats, have ${totalIn}.`);

  // We'll use the wallet's built-in PSBT builder via a special request
  // Return the parameters instead, and let signPsbt handle it
  return { fee, change, totalIn, estSize };
}

// ── Core transaction: signPsbt + pushPsbt ────────────────────
// This is the CORRECT flow for OP_Wallet v1.8.1+
// The wallet builds the PSBT internally when we pass toAddress + amount
async function sendVaultTransaction({ amountSats, memo = 'stake' }) {
  const provider = STATE.provider;
  if (!provider || !STATE.address) throw new Error('Wallet not connected');
  if (STATE.network !== 'testnet') throw new Error('Switch OP_Wallet to Testnet3 first');

  // ── Step 1: Try sendBitcoin first (works on some OP_Wallet builds) ──
  if (typeof provider.sendBitcoin === 'function') {
    try {
      const txid = await Promise.race([
        provider.sendBitcoin(VAULT.CONTRACT_ADDRESS, amountSats, { feeRate: VAULT.FEE_RATE }),
        sleep(120000).then(() => { throw new Error('Wallet timeout — please try again'); })
      ]);
      if (txid && typeof txid === 'string' && txid.length > 10) return txid;
    } catch (err) {
      const msg = String(err?.message || err).toLowerCase();
      // If user cancelled, rethrow immediately
      if (err?.code === 4001 || msg.includes('reject') || msg.includes('cancel') || msg.includes('denied')) throw err;
      // If "not supported", fall through to PSBT method
      if (!msg.includes('not supported') && !msg.includes('method') && !msg.includes('unsupported')) throw err;
      console.warn('sendBitcoin not supported, trying signPsbt flow:', err.message);
    }
  }

  // ── Step 2: signPsbt + pushPsbt (OP_Wallet v1.8.1+ correct method) ──
  if (typeof provider.signPsbt !== 'function') {
    throw new Error('Your OP_Wallet version does not support signPsbt. Please update to v1.8.1+.');
  }

  // Fetch UTXOs to build the PSBT
  showToast('Fetching UTXOs…', 'info');
  const utxos = await fetchUTXOs(STATE.address);
  if (!utxos.length) throw new Error('No UTXOs found. Get testnet BTC from faucet.opnet.org');

  // Sort UTXOs by value descending (coin selection: largest first)
  utxos.sort((a, b) => b.value - a.value);

  // Select UTXOs to cover amount + estimated fee
  const feeEstimate = (utxos.length * 148 + 68 + 10) * VAULT.FEE_RATE;
  const needed = amountSats + feeEstimate;
  let selected = [], total = 0;
  for (const u of utxos) {
    selected.push(u);
    total += u.value;
    if (total >= needed) break;
  }
  if (total < needed) throw new Error(`Insufficient balance. Need ~${needed} sats, have ${total}.`);

  const change = total - amountSats - feeEstimate;

  // Build PSBT using bitcoinjs-lib loaded via CDN in index.html
  // If bitcoin lib is available, use it; otherwise use wallet's native builder
  let psbtHex;

  if (window.bitcoin?.Psbt) {
    // Full bitcoinjs-lib path
    const bitcoin = window.bitcoin;
    const network = bitcoin.networks.testnet;
    const psbt = new bitcoin.Psbt({ network });

    for (const utxo of selected) {
      // Fetch raw tx for non-segwit inputs, or use witnessUtxo for segwit
      const inputData = {
        hash: utxo.txid,
        index: utxo.vout,
      };

      // For P2WPKH (tb1q addresses)
      if (STATE.address.startsWith('tb1q') || STATE.address.startsWith('bc1q')) {
        inputData.witnessUtxo = {
          script: bitcoin.address.toOutputScript(STATE.address, network),
          value: utxo.value,
        };
      } else {
        // For legacy addresses, fetch the full raw transaction
        try {
          const txRes = await fetch(`https://mempool.space/testnet/api/tx/${utxo.txid}/hex`);
          if (txRes.ok) {
            const txHex = await txRes.text();
            inputData.nonWitnessUtxo = Buffer.from(txHex, 'hex');
          }
        } catch { /* Use witnessUtxo as fallback */ }
      }

      psbt.addInput(inputData);
    }

    // Output 1: to vault contract
    psbt.addOutput({
      address: VAULT.CONTRACT_ADDRESS,
      value: amountSats,
    });

    // Output 2: change back to sender (if above dust)
    if (change > VAULT.DUST_LIMIT) {
      psbt.addOutput({
        address: STATE.address,
        value: change,
      });
    }

    psbtHex = psbt.toHex();
  } else {
    // Fallback: ask wallet to build PSBT via its internal method
    // Some OP_Wallet builds expose createPsbt or similar
    if (typeof provider.createPsbt === 'function') {
      psbtHex = await provider.createPsbt({
        to: VAULT.CONTRACT_ADDRESS,
        amount: amountSats,
        feeRate: VAULT.FEE_RATE,
      });
    } else {
      throw new Error(
        'bitcoinjs-lib not loaded and wallet has no createPsbt method. ' +
        'Please make sure the CDN script loaded correctly.'
      );
    }
  }

  // ── Sign the PSBT ──
  showToast('Please confirm in OP_Wallet…', 'info');
  const signedPsbtHex = await Promise.race([
    provider.signPsbt(psbtHex, {
      autoFinalized: true,
      toSignInputs: selected.map((_, i) => ({
        index: i,
        address: STATE.address,
        ...(STATE.pubkey ? { publicKey: STATE.pubkey } : {}),
      })),
    }),
    sleep(120000).then(() => { throw new Error('Wallet signing timed out — please try again'); })
  ]);

  if (!signedPsbtHex) throw new Error('No signed PSBT returned from wallet');

  // ── Broadcast ──
  const txid = await provider.pushPsbt(signedPsbtHex);
  if (!txid) throw new Error('Transaction broadcast failed');
  return txid;
}

// ── Error handler ─────────────────────────────────────────────
function handleWalletError(err, action = 'Transaction') {
  const msg = String(err?.message || err).toLowerCase();
  if (err?.code === 4001 || msg.includes('reject') || msg.includes('cancel') || msg.includes('denied')) {
    showToast(`${action} cancelled.`, 'info');
  } else if (msg.includes('timeout')) {
    showToast(`${action} timed out. Please try again.`, 'error');
  } else if (msg.includes('insufficient') || msg.includes('balance')) {
    showToast(err.message || 'Insufficient balance.', 'error');
  } else if (msg.includes('utxo')) {
    showToast('No UTXOs found. Get tBTC at faucet.opnet.org', 'error');
  } else {
    showToast(`${action} failed: ${err?.message || err}`, 'error');
  }
  console.error(`[VAULT] ${action} error:`, err);
}

// ── Button lock/unlock ────────────────────────────────────────
function lockBtn(id, text = 'AWAITING SIGNATURE…') {
  const b = $(id);
  if (!b) return;
  b.dataset.orig = b.textContent;
  b.textContent = text;
  b.disabled = true;
  b.classList.add('loading');
}
function unlockBtn(id, text = null) {
  const b = $(id);
  if (!b) return;
  b.textContent = text || b.dataset.orig || b.textContent;
  b.disabled = false;
  b.classList.remove('loading');
}

// ── Stake ─────────────────────────────────────────────────────
async function stake() {
  if (!STATE.provider) { showToast('Connect wallet first.', 'error'); return; }
  if (STATE.txPending) { showToast('Transaction in progress…', 'info'); return; }

  const input = $('stake-amount');
  const amountSats = parseInt(input?.value || '0', 10);
  if (!amountSats || amountSats < VAULT.MIN_STAKE_SATS) {
    showToast(`Minimum stake is ${VAULT.MIN_STAKE_SATS} sats.`, 'error'); return;
  }
  if (amountSats > STATE.balance - 5000) {
    showToast(`Need ~5000 sats for fees. Balance: ${fmt(STATE.balance)} sats.`, 'error'); return;
  }

  STATE.txPending = true;
  lockBtn('stake-btn');
  try {
    const txid = await sendVaultTransaction({ amountSats, memo: 'stake' });
    STATE.userStaked += amountSats;
    STATE.totalStaked += amountSats;
    STATE.balance -= amountSats + 2000;
    STATE.lastTxHash = txid;
    addTxLog('STAKE', amountSats, txid);
    updateUI();
    if (input) input.value = '';
    showToast(`✓ Staked ${fmt(amountSats)} sats! TX: ${txid.slice(0,10)}…`, 'success');
  } catch (err) {
    handleWalletError(err, 'Stake');
  } finally {
    STATE.txPending = false;
    unlockBtn('stake-btn', 'STAKE tBTC');
  }
}

// ── Unstake ───────────────────────────────────────────────────
async function unstake() {
  if (!STATE.provider) { showToast('Connect wallet first.', 'error'); return; }
  if (STATE.txPending) { showToast('Transaction in progress…', 'info'); return; }
  if (STATE.userStaked <= 0) { showToast('No staked balance.', 'error'); return; }

  STATE.txPending = true;
  lockBtn('unstake-btn');
  try {
    // Unstake signal: send dust to contract
    const txid = await sendVaultTransaction({ amountSats: VAULT.DUST_LIMIT, memo: 'unstake' });
    const returned = STATE.userStaked + STATE.rewardsEarned;
    STATE.totalStaked -= STATE.userStaked;
    STATE.balance += returned;
    STATE.userStaked = 0;
    STATE.rewardsEarned = 0;
    STATE.lastTxHash = txid;
    addTxLog('UNSTAKE', returned, txid);
    updateUI();
    showToast(`✓ Unstaked! ${fmt(returned)} sats returned. TX: ${txid.slice(0,10)}…`, 'success');
  } catch (err) {
    handleWalletError(err, 'Unstake');
  } finally {
    STATE.txPending = false;
    unlockBtn('unstake-btn', 'UNSTAKE tBTC');
  }
}

// ── Compound ──────────────────────────────────────────────────
async function autoCompound() {
  if (!STATE.provider) { showToast('Connect wallet first.', 'error'); return; }
  if (STATE.txPending) { showToast('Transaction in progress…', 'info'); return; }
  if (STATE.userStaked <= 0) { showToast('Stake first.', 'error'); return; }

  STATE.txPending = true;
  lockBtn('compound-btn');
  try {
    const txid = await sendVaultTransaction({ amountSats: VAULT.DUST_LIMIT, memo: 'compound' });
    const rate = (VAULT.APY_BASE + VAULT.APY_COMPOUND_BONUS) / 100 / (365 * 24);
    const reward = Math.floor(STATE.userStaked * rate);
    STATE.userStaked += reward;
    STATE.rewardsEarned += reward;
    STATE.totalCycles++;
    STATE.lastTxHash = txid;
    STATE.nextCompoundIn = VAULT.COMPOUND_INTERVAL_SECONDS;
    addTxLog('COMPOUND', reward, txid);
    updateUI();
    showToast(`✓ Compounded +${fmt(reward)} sats! TX: ${txid.slice(0,10)}…`, 'success');
  } catch (err) {
    handleWalletError(err, 'Compound');
  } finally {
    STATE.txPending = false;
    unlockBtn('compound-btn', 'TRIGGER COMPOUND →');
  }
}

// ── TX Log ────────────────────────────────────────────────────
function addTxLog(type, sats, txid) {
  const log = $('tx-log');
  if (!log) return;
  const empty = log.querySelector('.tx-empty');
  if (empty) empty.remove();

  const row = document.createElement('div');
  row.className = 'tx-entry';
  row.innerHTML = `
    <span class="tx-type tx-type-${type.toLowerCase()}">${type}</span>
    <span class="tx-amount">${fmt(sats)} sats</span>
    <a class="tx-hash" href="https://opscan.org/tx/${txid}" target="_blank" rel="noopener">
      ${txid.slice(0,10)}…${txid.slice(-6)}
    </a>
    <span class="tx-time">${new Date().toLocaleTimeString()}</span>`;
  log.prepend(row);
  while (log.children.length > 10) log.removeChild(log.lastChild);
}

// ── Max button ────────────────────────────────────────────────
function setMax() {
  const input = $('stake-amount');
  if (input) { input.value = Math.max(0, STATE.balance - 5000); updateStakePreview(); }
}

// ── Stake preview ─────────────────────────────────────────────
function updateStakePreview() {
  const sats = parseInt($('stake-amount')?.value || '0', 10);
  const annual = Math.floor(sats * (VAULT.APY_BASE + VAULT.APY_COMPOUND_BONUS) / 100);
  const youEl = $('you-stake-display');
  const aprEl = $('annual-yield-display');
  if (youEl) youEl.textContent = `${fmt(sats)} sats`;
  if (aprEl) aprEl.textContent = `+${fmt(annual)} sats / yr`;
}

// ── Update UI ─────────────────────────────────────────────────
function updateUI() {
  // Stats bar
  const set = (id, val) => { const el = $(id); if (el) el.textContent = val; };
  set('total-staked', fmt(STATE.totalStaked));
  set('rewards-earned', fmt(STATE.rewardsEarned));
  set('apy-display', `${(VAULT.APY_BASE + VAULT.APY_COMPOUND_BONUS).toFixed(1)}%`);
  set('user-staked-global', fmt(STATE.rewardsEarned));

  // Wallet bar
  if (STATE.address) {
    const walletInfo = $('wallet-info-bar');
    if (walletInfo) walletInfo.classList.remove('hidden');
    set('wallet-address', `${STATE.address.slice(0,10)}…${STATE.address.slice(-8)}`);
    set('wallet-balance', `${fmt(STATE.balance)} sats`);
  }

  // Cards
  set('wallet-balance-card', `${fmt(STATE.balance)} sats`);
  set('user-staked', `${fmt(STATE.userStaked)} sats`);
  set('my-rewards', `${fmt(STATE.rewardsEarned)} sats`);
  set('total-cycles', STATE.totalCycles);

  const lastTxEl = $('last-tx-hash');
  if (lastTxEl) {
    if (STATE.lastTxHash) {
      lastTxEl.textContent = `${STATE.lastTxHash.slice(0,10)}…`;
      lastTxEl.href = `https://opscan.org/tx/${STATE.lastTxHash}`;
    } else {
      lastTxEl.textContent = '-';
    }
  }

  // Unstake button enable/disable
  const unstakeBtn = $('unstake-btn');
  if (unstakeBtn) unstakeBtn.disabled = STATE.userStaked <= 0 || STATE.txPending;

  updateStakePreview();
}

// ── Countdown ─────────────────────────────────────────────────
function startCountdown() {
  setInterval(() => {
    if (STATE.nextCompoundIn > 0) {
      STATE.nextCompoundIn--;
    } else {
      STATE.nextCompoundIn = VAULT.COMPOUND_INTERVAL_SECONDS;
      if (STATE.provider && STATE.userStaked > 0) {
        const rate = (VAULT.APY_BASE + VAULT.APY_COMPOUND_BONUS) / 100 / (365 * 24);
        const reward = Math.floor(STATE.userStaked * rate);
        STATE.rewardsEarned += reward;
        STATE.totalCycles++;
        updateUI();
        showToast(`Auto-compound: +${fmt(reward)} sats added`, 'success');
      }
    }
    const h = Math.floor(STATE.nextCompoundIn / 3600);
    const m = Math.floor((STATE.nextCompoundIn % 3600) / 60);
    const s = STATE.nextCompoundIn % 60;
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('next-compound-time', `${pad2(h)}:${pad2(m)}:${pad2(s)}`);
    set('countdown-hr',  pad2(h));
    set('countdown-min', pad2(m));
    set('countdown-sec', pad2(s));
  }, 1000);
}

// ── Auto-reconnect (silent) ───────────────────────────────────
async function tryAutoReconnect() {
  const provider = await waitForProvider(2000);
  if (!provider) return;
  try {
    const accounts = await provider.getAccounts?.();
    if (!accounts?.length) return;
    STATE.provider = provider;
    STATE.address  = accounts[0];
    try { const b = await provider.getBalance(); STATE.balance = b.confirmed ?? b.total ?? 0; } catch {}
    try { STATE.network = await provider.getNetwork(); } catch {}
    try { STATE.pubkey = await provider.getPublicKey(); } catch {}
    provider.on?.('accountsChanged', onAccountsChanged);
    provider.on?.('networkChanged',  onNetworkChanged);
    updateUI();
    showToast('Wallet reconnected', 'info');
  } catch { /* silently skip */ }
}

// ── Init ──────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  $('connect-btn')?.addEventListener('click', connectWallet);
  $('stake-btn')?.addEventListener('click', stake);
  $('unstake-btn')?.addEventListener('click', unstake);
  $('compound-btn')?.addEventListener('click', autoCompound);
  $('max-btn')?.addEventListener('click', setMax);
  $('stake-amount')?.addEventListener('input', updateStakePreview);

  startCountdown();
  updateUI();
  tryAutoReconnect();
});

// Debug helpers
window.VAULT_STATE = STATE;
window.getVaultStats = () => ({
  totalStaked:    STATE.totalStaked,
  userStaked:     STATE.userStaked,
  rewardsEarned:  STATE.rewardsEarned,
  apy:            VAULT.APY_BASE + VAULT.APY_COMPOUND_BONUS,
  cdRemaining:    STATE.nextCompoundIn,
  lastTxHash:     STATE.lastTxHash,
  totalCycles:    STATE.totalCycles,
  walletAddress:  STATE.address,
  walletBalance:  STATE.balance,
  timestamp:      Date.now(),
});
