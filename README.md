# opnet-btc-staking-vault

# ₿ VAULT — Bitcoin Staking on OP_NET Testnet

A production-ready Bitcoin staking vault web app built on **OP_NET Testnet3**.  
Every stake, unstake, and compound action is a **real on-chain transaction** signed by the user's OP_Wallet.

---

## 📁 File Structure

```
btc-staking-vault/
├── index.html     ← HTML structure & layout
├── style.css      ← All styles, animations, responsive design
├── script.js      ← Vault logic + OP_Wallet integration
└── README.md
```

---

## ✨ Features

| Feature | Description |
|---|---|
| 🔐 OP_Wallet Connect | Connects via `window.opnet` (UniSat fork) provider |
| ₿ Stake tBTC | Real on-chain TX via `sendBitcoin()` |
| 🔓 Unstake tBTC | Withdraw from vault with wallet signature |
| 🔄 Auto-Compound | Rewards reinvested every hour automatically |
| 📊 Live Dashboard | TVL, user stake, APY, rewards, countdown timer |
| 📡 TX Log | Every transaction logged with TXID → OP_SCAN link |
| 🔔 Toast Alerts | Success / error / info notifications |

---

## 🚀 Getting Started

### 1. Install OP_Wallet

Install the Chrome extension:  
→ [OP_Wallet on Chrome Web Store](https://chromewebstore.google.com/detail/opwallet/pmbjpcmaaladnfpacpmhmnfmpklgbdjb)

### 2. Set to Testnet3

Open OP_Wallet → click the network icon (top right) → select **Testnet3**

### 3. Get tBTC

Claim free testnet Bitcoin from the faucet:  
→ [faucet.opnet.org](https://faucet.opnet.org)

### 4. Run the App

Open `index.html` directly in Chrome, or serve with any static server:

```bash
# Python
python -m http.server 8080

# Node (npx)
npx serve .

# VS Code
# Use the Live Server extension
```

Then open `http://localhost:8080`

---

## 🔧 OP_Wallet API Reference

OP_Wallet injects `window.opnet` (primary) or `window.unisat` (fallback).

```js
const p = window.opnet || window.unisat;

// Connect wallet
const accounts = await p.requestAccounts();

// Get balance → { confirmed, unconfirmed, total } in satoshis
const bal = await p.getBalance();

// Get network
const net = await p.getNetwork(); // 'testnet' | 'mainnet'

// Switch network
await p.switchNetwork('testnet');

// Send Bitcoin → returns txid string
const txid = await p.sendBitcoin(toAddress, amountSats, { feeRate: 10 });

// Get public key
const pubKey = await p.getPublicKey();

// Events
p.on('accountsChanged', (accounts) => { });
p.on('networkChanged',  (network)  => { });
```

---

## ⚙️ Core Functions (`script.js`)

```js
// Connect OP_Wallet (opens popup)
connectWallet()

// Stake tBTC into vault
stake()

// Withdraw tBTC from vault
unstake()

// Trigger manual auto-compound
autoCompound()

// Get full vault state snapshot
getVaultStats()
```

### `getVaultStats()` returns:

```js
{
  totalStaked:    48230000,  // global TVL in satoshis
  userStaked:     10000,     // your stake in satoshis
  rewardsEarned:  210,       // total rewards compounded
  apy:            18.4,      // current APY %
  cycleSeconds:   3600,      // compound cycle duration (1 hour)
  cdRemaining:    2847,      // seconds until next compound
  lastTxHash:     "abc123...",
  totalCycles:    3,
  compoundActive: true,
  walletAddress:  "tb1q...",
  walletBalance:  95000,     // wallet balance in satoshis
  timestamp:      1700000000000
}
```

---

## 🔄 Auto-Compound Formula

Rewards per cycle are calculated as:

```
hourly_rate = APY% / 100 / (365 × 24)
reward_sats = floor(userStaked × hourly_rate)
```

The cycle fires every **1 hour** (3600 seconds).  
When triggered with a connected wallet, it sends a 546-sat dust TX on-chain.  
When the countdown hits zero, it compounds silently in the background.

---

## 🌐 Production Upgrade Path

To use a real OP_NET staking contract, replace `sendBitcoin()` calls with:

```js
// Build a PSBT with OP_RETURN calldata for the contract
const psbt   = buildStakePsbt(userAddress, VAULT_CONTRACT, amtSats);
const signed = await p.signPsbt(psbt);
const txid   = await p.pushPsbt(signed);
```

Replace `VAULT.VAULT_CONTRACT` with your deployed OP_NET contract address.

---

## 🔗 Links

| Resource | URL |
|---|---|
| OP_NET Docs | [docs.opnet.org](https://docs.opnet.org) |
| OP_SCAN Explorer | [opscan.org](https://opscan.org) |
| tBTC Faucet | [faucet.opnet.org](https://faucet.opnet.org) |
| OP_Wallet GitHub | [github.com/btc-vision/opwallet](https://github.com/btc-vision/opwallet) |
| OP_NET GitHub | [github.com/btc-vision](https://github.com/btc-vision) |

---

## 📄 License

MIT — free to use, fork, and build on.
