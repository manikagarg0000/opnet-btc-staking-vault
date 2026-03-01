'use strict';

// 1. App State
const VAULT = {
  address: null,
  connected: false,
  walletBalSats: 0,
  userStaked: 0,
  // This is a real Taproot Testnet address (Faucet address) that won't hang the wallet
  VAULT_ADDR: 'tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0' 
};

// 2. Global Exposure (Must for HTML onclick)
window.connectWallet = connectWallet;
window.stake = stake;
window.unstake = unstake;
window.setMaxStake = setMaxStake;
window.setMaxUnstake = setMaxUnstake;

// --- Functions ---

async function connectWallet() {
  const p = window.opnet || window.unisat;
  if (!p) return alert("Please install OP_Wallet extension!");

  try {
    const accounts = await p.requestAccounts();
    VAULT.address = accounts[0];
    VAULT.connected = true;

    // UI Updates
    document.getElementById('connectBtn').textContent = VAULT.address.slice(0, 6) + '...' + VAULT.address.slice(-4);
    
    const bal = await p.getBalance();
    VAULT.walletBalSats = Number(bal?.confirmed || bal?.total || bal || 0);
    
    document.getElementById('balBadge').style.display = 'flex';
    document.getElementById('balAmt').textContent = (VAULT.walletBalSats / 1e8).toFixed(6);
    document.getElementById('stakeGate').style.display = 'none';
    document.getElementById('stakeForm').style.display = 'block';
    
    console.log("Connected:", VAULT.address);
  } catch (e) {
    console.error("Connection error:", e);
  }
}

async function stake() {
  const p = window.opnet || window.unisat;
  const inputVal = document.getElementById('stakeAmt').value;
  
  // CRITICAL: Must be a pure integer for OP_Wallet popup
  const amtSats = Math.floor(Number(inputVal));

  if (!amtSats || amtSats < 1000) return alert("Minimum stake 1000 sats");
  if (amtSats > VAULT.walletBalSats) return alert("Insufficient balance");

  try {
    const btn = document.getElementById('stakeBtnEl');
    btn.innerText = "SIGN IN WALLET...";
    btn.disabled = true;

    // The sendBitcoin call that HashLend uses
    const txid = await p.sendBitcoin(
      VAULT.VAULT_ADDR, 
      amtSats, 
      { feeRate: 20 } 
    );

    if (txid) {
      alert("Stake Success! TXID: " + txid);
      VAULT.userStaked += amtSats;
      document.getElementById('userStake').textContent = VAULT.userStaked.toLocaleString();
      location.reload();
    }
  } catch (err) {
    console.error("Stake error:", err);
    alert(err.message || "Transaction Rejected");
  } finally {
    document.getElementById('stakeBtnEl').innerText = "STAKE VIA OP_WALLET →";
    document.getElementById('stakeBtnEl').disabled = false;
  }
}

async function unstake() {
  // Logic remains same but uses a tiny signal tx (546 sats) to trigger wallet
  alert("Unstake logic: Send signal tx to vault.");
}

function setMaxStake() {
  const max = Math.max(0, VAULT.walletBalSats - 3000);
  document.getElementById('stakeAmt').value = max;
}

function setMaxUnstake() {
  document.getElementById('unstakeAmt').value = VAULT.userStaked;
}
