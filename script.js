// ====================== OP_NET BTC STAKING VAULT - FINAL FIXED ======================
const VAULT = {
  connected: false,
  address: null,
  walletBalSats: 0,
  userStaked: 0,
  totalStaked: 48230108,
  lastTxHash: null,
  VAULT_CONTRACT: 'opt1qt3c5yrw3rxu7k6d4skertp52g7qjukg6g',  // সঠিক MotoSwap contract
};

let provider = null;

// ==================== PROVIDER ====================
function getProvider() {
  if (typeof window.opnet !== 'undefined') return window.opnet;
  if (typeof window.unisat !== 'undefined') return window.unisat;
  throw new Error('OP Wallet not found. Install OP Wallet extension.');
}

// ==================== CONNECT WALLET (FIXED) ====================
async function connectWallet() {
  try {
    provider = getProvider();

    // OP Wallet / UniSat correct connect
    await provider.requestAccounts();           // ← popup আসবে
    const accounts = await provider.getAccounts();

    VAULT.address = accounts[0];
    VAULT.connected = true;

    const btn = document.getElementById('connectBtn');
    btn.textContent = '✅ Connected';
    btn.style.backgroundColor = '#22c55e';

    await refreshWalletBalance();
    toast('success', 'CONNECTED SUCCESSFULLY', `Wallet: ${VAULT.address.slice(0,8)}...`);
  } catch (err) {
    console.error(err);
    toast('error', 'CONNECT FAILED', err.message || 'Please try again');
  }
}

// ==================== BALANCE ====================
async function refreshWalletBalance() {
  if (!VAULT.connected || !provider) return;
  try {
    const balance = await provider.getBalance();
    VAULT.walletBalSats = parseInt(balance?.total || balance || 0);
    // UI-তে দেখাতে চাইলে এখানে DOM update করো
    console.log('Balance:', VAULT.walletBalSats);
  } catch (e) {}
}

// ==================== STAKE (Real Contract) ====================
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
  const original = btn.textContent;
  btn.textContent = 'AWAITING SIGNATURE...';
  btn.disabled = true;

  try {
    const txid = await provider.sendBitcoin(
      VAULT.VAULT_CONTRACT,
      amtSats,
      { feeRate: 10 }
    );

    VAULT.userStaked += amtSats;
    VAULT.totalStaked += amtSats;
    VAULT.lastTxHash = txid;

    updateDashboard();
    toast('success', 'STAKE CONFIRMED!', 
      `Staked ${amtSats.toLocaleString()} sats\nTXID: ${txid.slice(0,22)}...`);

    document.getElementById('stakeAmt').value = '';
    await refreshWalletBalance();

  } catch (err) {
    console.error(err);
    toast('error', 'STAKE FAILED', err.message.includes('rejected') ? 'User rejected in wallet' : err.message);
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
}

// ==================== HELPER ====================
function updateDashboard() {
  const el = document.getElementById('totalStaked');
  if (el) el.textContent = VAULT.totalStaked.toLocaleString();
}

function toast(type, title, msg) {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:30px;right:30px;padding:16px 22px;border-radius:12px;color:white;z-index:99999;box-shadow:0 10px 30px rgba(0,0,0,0.4);font-family:sans-serif;`;
  t.style.background = type === 'success' ? '#22c55e' : '#ef4444';
  t.innerHTML = `<strong>${title}</strong><br><small>${msg}</small>`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
  const connectBtn = document.getElementById('connectBtn');
  const stakeBtn = document.getElementById('stakeBtnEl');

  if (connectBtn) connectBtn.addEventListener('click', connectWallet);
  if (stakeBtn) stakeBtn.addEventListener('click', stake);

  // Auto refresh balance
  setInterval(refreshWalletBalance, 30000);
});
