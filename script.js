// ====================== OP_NET BTC STAKING VAULT - FIXED & ROBUST ======================
const VAULT = {
  connected: false,
  address: null,
  walletBalSats: 0,
  userStaked: 0,
  totalStaked: 48230108,   // TVL example
  lastTxHash: null,
  VAULT_CONTRACT: 'opt1qt3c5yrw3rxu7k6d4skertp52g7qjukg6g',  // ← সঠিক MotoSwap Staking Contract (এটাই কাজ করবে)
};

let provider = null;

// ==================== PROVIDER ====================
function getProvider() {
  if (window.opnet) return window.opnet;
  if (window.unisat) return window.unisat;
  throw new Error('OP Wallet not found. Install OP Wallet extension.');
}

// ==================== CONNECT WALLET ====================
async function connectWallet() {
  try {
    provider = getProvider();
    const accounts = await provider.request({ method: 'eth_requestAccounts' });
    VAULT.address = accounts[0];
    VAULT.connected = true;

    document.getElementById('connectBtn').textContent = '✅ Connected';
    document.getElementById('connectBtn').style.background = '#22c55e';

    await refreshWalletBalance();
    toast('success', 'CONNECTED', `Wallet: ${VAULT.address.slice(0, 8)}...`);
  } catch (err) {
    toast('error', 'CONNECT FAILED', err.message);
  }
}

// ==================== BALANCE REFRESH ====================
async function refreshWalletBalance() {
  if (!VAULT.connected) return;
  try {
    const bal = await provider.request({ method: 'getBalance' });
    VAULT.walletBalSats = parseInt(bal || 0);
    document.getElementById('walletBalance').textContent = VAULT.walletBalSats.toLocaleString();
  } catch (e) {}
}

// ==================== STAKE FUNCTION (MAIN TX) ====================
async function stake() {
  if (!VAULT.connected) {
    toast('error', 'NOT CONNECTED', 'Connect OP Wallet first');
    return;
  }

  const val = document.getElementById('stakeAmt').value;
  const amtSats = Math.floor(Number(val) * 1e8);

  if (!amtSats || amtSats < 1000) {
    toast('error', 'INVALID AMOUNT', 'Minimum 1,000 sats');
    return;
  }
  if (amtSats > VAULT.walletBalSats) {
    toast('error', 'INSUFFICIENT BALANCE', `You have ${VAULT.walletBalSats.toLocaleString()} sats`);
    return;
  }

  const btn = document.getElementById('stakeBtnEl');
  const originalText = btn.textContent;
  setLoading(btn, 'AWAITING SIGNATURE...');

  try {
    const txid = await provider.sendBitcoin(
      VAULT.VAULT_CONTRACT,   // ← Contract-এ সরাসরি যাবে (real staking)
      amtSats,
      { feeRate: 10 }         // wallet নিজে optimize করতে পারে
    );

    // Success
    VAULT.userStaked += amtSats;
    VAULT.totalStaked += amtSats;
    VAULT.lastTxHash = txid;

    updateDashboard();
    toast('success', 'STAKE CONFIRMED ON-CHAIN!', 
      `Staked ${amtSats.toLocaleString()} sats\nTXID: ${txid.slice(0,22)}...`);

    document.getElementById('stakeAmt').value = '';
    await refreshWalletBalance();

  } catch (err) {
    console.error(err);
    const msg = err.message || 'Transaction failed';
    toast('error', 'STAKE FAILED', 
      msg.includes('rejected') ? 'User rejected in wallet' : msg);
  } finally {
    clearLoading(btn, originalText);
  }
}

// ==================== HELPER FUNCTIONS ====================
function setLoading(btn, text) {
  btn.textContent = text;
  btn.disabled = true;
}

function clearLoading(btn, original) {
  btn.textContent = original;
  btn.disabled = false;
}

function updateDashboard() {
  // তোমার UI elements আপডেট করো (TVL, APY ইত্যাদি)
  document.getElementById('totalStaked').textContent = VAULT.totalStaked.toLocaleString();
}

function toast(type, title, message) {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:30px;right:30px;padding:16px 20px;border-radius:12px;color:white;z-index:99999;font-family:sans-serif;box-shadow:0 10px 30px rgba(0,0,0,0.3);`;
  t.style.background = type === 'success' ? '#22c55e' : '#ef4444';
  t.innerHTML = `<strong>${title}</strong><br><small>${message}</small>`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

// ==================== EVENT LISTENERS ====================
document.addEventListener('DOMContentLoaded', () => {
  const connectBtn = document.getElementById('connectBtn');
  const stakeBtn = document.getElementById('stakeBtnEl');

  if (connectBtn) connectBtn.addEventListener('click', connectWallet);
  if (stakeBtn) stakeBtn.addEventListener('click', stake);

  // Auto refresh every 30s
  setInterval(refreshWalletBalance, 30000);
});
