// ====================== OP_NET BTC STAKING VAULT - FINAL WORKING VERSION ======================
const VAULT = {
  connected: false,
  address: null,
  walletBalSats: 0,
  userStaked: 0,
  totalStaked: 48230108,
  lastTxHash: null,
  VAULT_CONTRACT: 'opt1qt3c5yrw3rxu7k6d4skertp52g7qjukg6g',  // সঠিক contract
};

let provider = null;

function getProvider() {
  if (typeof window.opnet !== 'undefined') return window.opnet;
  if (typeof window.unisat !== 'undefined') return window.unisat;
  throw new Error('OP Wallet not found');
}

async function connectWallet() {
  try {
    provider = getProvider();
    await provider.requestAccounts();
    const accounts = await provider.getAccounts();
    VAULT.address = accounts[0];
    VAULT.connected = true;

    const btn = document.getElementById('connectBtn');
    btn.textContent = '✅ Connected';
    btn.style.backgroundColor = '#22c55e';

    await refreshWalletBalance();
    toast('success', 'CONNECTED', `Wallet: ${VAULT.address.slice(0,8)}...`);
  } catch (err) {
    toast('error', 'CONNECT FAILED', err.message);
  }
}

async function refreshWalletBalance() {
  if (!VAULT.connected || !provider) return;
  try {
    const balance = await provider.getBalance();
    VAULT.walletBalSats = parseInt(balance?.total || balance || 0);
    const balEl = document.getElementById('walletBalance');
    if (balEl) balEl.textContent = VAULT.walletBalSats.toLocaleString();
  } catch (e) {}
}

async function stake() {
  if (!VAULT.connected) {
    toast('error', 'NOT CONNECTED', 'Connect OP Wallet first');
    return;
  }

  const val = document.getElementById('stakeAmt').value.trim();
  const amtSats = parseInt(val, 10);

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

    toast('success', 'STAKE CONFIRMED!', 
      `Staked ${amtSats.toLocaleString()} sats\nTXID: ${txid.slice(0,22)}...`);

    document.getElementById('stakeAmt').value = '';
    await refreshWalletBalance();

  } catch (err) {
    toast('error', 'STAKE FAILED', err.message.includes('rejected') ? 'User rejected' : err.message);
  } finally {
    btn.textContent = original;
    btn.disabled = false;
  }
}

function toast(type, title, msg) {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:30px;right:30px;padding:16px 22px;border-radius:12px;color:white;z-index:99999;box-shadow:0 10px 30px rgba(0,0,0,0.4);`;
  t.style.background = type === 'success' ? '#22c55e' : '#ef4444';
  t.innerHTML = `<strong>${title}</strong><br><small>${msg}</small>`;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 6000);
}

document.addEventListener('DOMContentLoaded', () => {
  const connectBtn = document.getElementById('connectBtn');
  const stakeBtn = document.getElementById('stakeBtnEl');

  if (connectBtn) connectBtn.addEventListener('click', connectWallet);
  if (stakeBtn) stakeBtn.addEventListener('click', stake);

  setInterval(refreshWalletBalance, 30000);
});
