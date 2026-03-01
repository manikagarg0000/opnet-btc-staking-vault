async function stake() {
  const p = window.opnet || window.unisat;
  const val = document.getElementById('stakeAmt').value;

  // convert BTC → sats
  const amtSats = Math.floor(Number(val) * 1e8);

  if (!amtSats || amtSats < 1000) return alert("Min 1000 sats");
  if (amtSats > VAULT.walletBalSats) return alert("Insufficient balance");

  try {
    const btn = document.getElementById('stakeBtnEl');
    btn.innerText = "CHECK WALLET POPUP...";
    btn.disabled = true;

    const txid = await p.sendBitcoin(
      VAULT.VAULT_ADDR,
      amtSats,
      { feeRate: 15 }
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
