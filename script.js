'use strict';

const VAULT = {
  address: null,
  walletBalSats: 0,
 
  VAULT_ADDR: 'tb1pqqqqp399et2xygdj5xreqhjjvcmzhxw4aywxecjdzew6hylgvsesf3hn0'
};

// Global Exposure for HTML
window.connectWallet = connectWallet;
window.stake = stake;
window.setMaxStake = setMaxStake;

async function connectWallet() {
  const p = window.opnet || window.unisat;
  if (!p) return alert("Install OP_Wallet");
  try {
    const accs = await p.requestAccounts();
    VAULT.address = accs[0];
    document.getElementById('connectBtn').textContent = VAULT.address.slice(0,6)+'...'+VAULT.address.slice(-4);
    
    const bal = await p.getBalance();
    VAULT.walletBalSats = Number(bal?.confirmed || bal || 0);
    
    document.getElementById('balBadge').style.display = 'flex';
    document.getElementById('balAmt').textContent = (VAULT.walletBalSats / 1e8).toFixed(6);
    document.getElementById('stakeGate').style.display = 'none';
    document.getElementById('stakeForm').style.display = 'block';
  } catch (e) { console.error(accs); }
}

async function stake() {
  const p = window.opnet || window.unisat;
  const val = document.getElementById('stakeAmt').value;
  
  // FIXED: OP_Wallet requires pure integer (No decimals!)
  const amtSats = Math.floor(Number(val));

  if (!amtSats || amtSats < 1000) return alert("Min 1000 sats");
  if (amtSats > VAULT.walletBalSats) return alert("Insufficient balance");

  try {
    const btn = document.getElementById('stakeBtnEl');
    btn.innerText = "CHECK WALLET POPUP...";
    btn.disabled = true;

    // Fixed call jeta blank popup hobe na
    const txid = await p.sendBitcoin(
      VAULT.VAULT_ADDR, 
      amtSats, 
      { feeRate: 25 } // Higher fee for faster testnet confirmation
    );

    if (txid) {
      alert("Success! TXID: " + txid);
      location.reload();
    }
  } catch (err) {
    alert("Error: " + (err.message || "User Rejected"));
    console.error(err);
  } finally {
    document.getElementById('stakeBtnEl').innerText = "STAKE NOW →";
    document.getElementById('stakeBtnEl').disabled = false;
  }
}

function setMaxStake() {
  const safeMax = Math.max(0, VAULT.walletBalSats - 3000);
  document.getElementById('stakeAmt').value = safeMax;
}
