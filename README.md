# <img src="solana.png" width="100" height="100" alt="Solana Logo" /> 
## SolaMatch — On-Chain Order Matching Engine

> **A traditional centralized exchange order book rebuilt as a trustless Solana program.**  
> Built for the *"Rebuild Backend Systems as On-Chain Rust Programs"* community challenge.

[![Devnet](https://img.shields.io/badge/Solana-Devnet-9945FF?logo=solana)](https://explorer.solana.com/address/77aLU4dN1NTAWVGhNcNgWFwQ5K9XwkFnEWMLjGWWZBDD?cluster=devnet)
[![Anchor](https://img.shields.io/badge/Anchor-0.32.1-14F195)](https://book.anchor-lang.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

---

## 📌 Program Details

| | |
|---|---|
| **Program ID** | `77aLU4dN1NTAWVGhNcNgWFwQ5K9XwkFnEWMLjGWWZBDD` |
| **Market PDA** | `38tZpV4CGQWuKbL4po8tiNkTP2L8e7xcbyHGNBVf7Jwf` |
| **Network** | Solana Devnet |
| **Framework** | Anchor 0.32.1 |

---

## 📸 Screenshots

### 🖥️ Frontend

| **Landing Page (Hero & Stats)** | **Architecture Comparison** |
|---|---|
| ![Landing Page](Screenshot/Screenshot%202026-02-20%20133611.png) | ![Architecture](Screenshot/Screenshot%202026-02-20%20133600.png) |

| **Live Order Book** | **Place Order Form** |
|---|---|
| ![Order Book](Screenshot/Screenshot%202026-02-20%20133550.png) | ![Place Order](Screenshot/Screenshot%202026-02-20%20133542.png) |

---

### ⚙️ Backend Review

| **Backend View 1** | **Backend View 2** | **Backend View 3** |
|---|---|---|
| ![Backend 1](Screenshot/Screenshot%20(681).png) | ![Backend 2](Screenshot/Screenshot%20(682).png) | ![Backend 3](Screenshot/Screenshot%20(683).png) |

## 🏛️ Architecture

### The Core Insight

A traditional order matching engine is fundamentally a **state machine**:
- **State** = the current order book (bids, asks, balances)
- **Transitions** = place order, cancel, match, settle

Solana *is* a globally replicated state machine. This makes it a perfect execution environment for an exchange — with the added property that every state transition is **cryptographically verifiable** and **permissionless to observe**.

---

## 🔄 Web2 vs. Solana Design

### How it works in Web2

```
┌────────────────────────────────────────────────┐
│                  Centralized Exchange           │
│                                                 │
│  User ──HTTP──► REST API ──► Matching Engine   │
│                                │                │
│                         ┌──────▼──────┐         │
│                         │  PostgreSQL  │         │
│                         │  orders tbl  │         │
│                         └──────┬──────┘         │
│                                │                │
│              Background Job ◄──┘                │
│         (price-time priority loop)              │
│                    │                            │
│              Settlement DB ──► User balances    │
└────────────────────────────────────────────────┘
```

**Key properties:**
- **Custodial**: Exchange holds user funds
- **Trusted**: Users trust the operator not to front-run or censor
- **Fast**: Microsecond matching via in-memory data structures
- **Opaque**: Order book state is controlled by operator

---

### How it works on Solana (SolaMatch)

```
                         ┌─────────────────────────┐
                         │    Solana Validator Set  │
                         │                          │
  Buyer  ──sign tx──►   │  order_matching_engine   │
                         │  Program (BPF/SBF)       │
  Seller ──sign tx──►   │                          │
                         │  ┌──────────┐            │
  Anyone ──match tx──►  │  │ Market   │  (PDA)     │
                         │  │  PDA     │            │
                         │  └──────────┘            │
                         │  ┌──────────┐            │
                         │  │ Order #0 │  (PDA)     │
                         │  │   PDA    │            │
                         │  └──────────┘            │
                         │  ┌──────────┐            │
                         │  │ Order #1 │  (PDA)     │
                         │  │   PDA    │            │
                         │  └──────────┘            │
                         └─────────────────────────┘
```

**Key properties:**
- **Self-custodial**: SOL escrowed in the *buyer's own* Order PDA
- **Trustless**: Program enforces all rules; no operator can override
- **Transparent**: Entire order book is public on-chain state
- **Open crank**: Anyone can call `match_orders` (decentralized matching)

---

## 📦 Account Model

### `Market` PDA
```
Seeds: [b"market", authority_pubkey, market_name_bytes]
```

| Field | Type | Description |
|---|---|---|
| `authority` | `Pubkey` | Market creator |
| `market_name` | `String` | e.g. "SOL/MOCK" |
| `next_order_id` | `u64` | Monotonic counter |
| `total_bid_volume` | `u64` | Aggregate open bid units |
| `total_ask_volume` | `u64` | Aggregate open ask units |
| `bump` | `u8` | PDA bump seed |

---

### `Order` PDA
```
Seeds: [b"order", market_pubkey, order_id_le_bytes]
```

| Field | Type | Description |
|---|---|---|
| `owner` | `Pubkey` | Order placer |
| `market` | `Pubkey` | Parent market |
| `order_id` | `u64` | Unique ID within market |
| `side` | `Side` | `Buy` or `Sell` |
| `price` | `u64` | Limit price in lamports/unit |
| `quantity` | `u64` | Total units |
| `filled_quantity` | `u64` | Units already matched |
| `status` | `OrderStatus` | Open → PartiallyFilled → Filled/Cancelled |
| `timestamp` | `i64` | Unix timestamp (for time priority) |
| `bump` | `u8` | PDA bump seed |

---

### Trade Lifecycle (Sequence Diagram)

```
Buyer                 Program              Seller
  │                     │                    │
  │──place_order(buy)──►│                    │
  │  [escrow SOL in PDA]│                    │
  │                     │                    │
  │                     │◄─place_order(sell)─│
  │                     │                    │
  │  ◄─[Anyone calls match_orders]           │
  │                     │                    │
  │                     │ validate prices    │
  │                     │ bid.price ≥ ask.price
  │                     │                    │
  │◄─[refund overpay]──►│──[fill_price SOL]─►│
  │  (price improvement)│                    │
  │                     │                    │
  │──close_order()─────►│                    │
  │◄─[rent reclaimed]───│                    │
```

---

## 🔧 Instructions

| Instruction | Description | Who signs |
|---|---|---|
| `initialize_market` | Create a new market PDA | Authority |
| `place_order` | Place buy (escrow SOL) or sell limit order | Trader |
| `match_orders` | Match compatible bid+ask, transfer SOL | Anyone (crank) |
| `cancel_order` | Cancel open order, refund escrow | Order owner |
| `close_order` | Close filled/cancelled PDA, reclaim rent | Order owner |

---

## ⚖️ Tradeoffs & Constraints

| Concern | Web2 | Solana |
|---|---|---|
| **Settlement finality** | Database commit (~ms) | ~400ms (1 block) |
| **Throughput** | Millions of matches/sec | ~1,000 TPS (shared network) |
| **Matching cost** | ~$0 marginal | ~0.000005 SOL/match |
| **Order storage cost** | Free (DB row) | ~0.002 SOL rent per order PDA |
| **Partial fill** | Trivial (update row qty) | Supported (filled_quantity field) |
| **Front-running** | Possible by operator | Validator-level MEV risk |
| **Censorship** | Operator can block orders | Permissionless — any validator |
| **Auditability** | Trust audit logs | Every tx on-chain forever |
| **Custody** | Exchange custodial | Self-custodial escrow |

**Why the "crank" model?** On-chain loops are gas/compute expensive. Instead, matching logic runs off-chain (client selects compatible pairs) and the program *validates* the match. This is the same model used by OpenBook (formerly Serum), Mango Markets, and most Solana DEXes.

---

## 🚀 Quick Start

### Prerequisites
```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# Install Solana CLI (v1.18+)
sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"

# Install Anchor via AVM
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
avm install 0.32.1 && avm use 0.32.1
```

> **Windows users**: Run everything in **WSL 2** (`wsl --install` in PowerShell as Admin)

### Build & Test
```bash
npm install
anchor build
anchor test
```

Expected output:
```
  Order Matching Engine
    ✔ Initializes a market (450ms)
    ✔ Places a BUY order with escrow (312ms)
    ✔ Places a SELL order (289ms)
    ✔ Matches bid and ask (501ms)
    ✔ Rejects price mismatch (124ms)
    ✔ Cancels order with refund (389ms)
    ✔ Rejects double-match (210ms)
    ✔ Rejects cross-market match (198ms)
    ✔ Rejects unauthorized cancel (176ms)
    ✔ Closes filled order, reclaims rent (351ms)

  10 passing (3s)
```

### Deploy to Devnet
```bash
solana config set --url devnet
solana airdrop 2
anchor deploy --provider.cluster devnet
```

---

## 🖥️ CLI Client

```bash
cd client && npm install

# Initialize a market
npx ts-node --transpile-only cli.ts init-market --name "SOL/MOCK"

# Place orders (use the Market PDA from above)
npx ts-node --transpile-only cli.ts place-order \
  -m <MARKET_PDA> --side buy --price 101000 --quantity 10

npx ts-node --transpile-only cli.ts place-order \
  -m <MARKET_PDA> --side sell --price 99000 --quantity 5

# Match orders (crank)
npx ts-node --transpile-only cli.ts match \
  --bid <BID_PDA> --ask <ASK_PDA>

# Cancel an order
npx ts-node --transpile-only cli.ts cancel \
  -m <MARKET_PDA> --order-id 0

# Close a filled order (reclaim rent)
npx ts-node --transpile-only cli.ts close-order \
  -m <MARKET_PDA> --order-id 0

# Inspect state
npx ts-node --transpile-only cli.ts get-market -m <MARKET_PDA>
npx ts-node --transpile-only cli.ts get-order -m <MARKET_PDA> --order-id 0
npx ts-node --transpile-only cli.ts list-orders -m <MARKET_PDA>
```

---

## 🌐 Frontend (SolaMatch UI)

```bash
cd frontend && npm install && npm run dev
# Open: http://localhost:5173
```

Features:
- 🔐 Multi-wallet: Phantom & Solflare
- 📊 Live order book (auto-refreshes from chain every 10s)
- ⚡ Real trade history (parsed from transaction logs)
- 📋 My Orders view (all orders for connected wallet)
- 🏗️ Web2 vs Solana architecture panel

---

## 🔗 Devnet Transactions

| Action | Transaction |
|---|---|
| Initialize Market | [View ↗](https://explorer.solana.com/tx/S4YjgbwooFn6eigtQ96Jk33z2NiBV5T3WZZ4x2ZuTcervfxjuRxx5CCSZBKUjCVcoPsCSqcWmqzXosMGXYuMGPx?cluster=devnet) |
| Place BUY Order | _after running CLI_ |
| Place SELL Order | _after running CLI_ |
| Match Orders | _after running CLI_ |

---

## 📁 Project Structure

```
├── programs/order-matching-engine/src/
│   ├── lib.rs          # 5 instructions: initialize_market, place_order,
│   │                   #   match_orders, cancel_order, close_order
│   ├── state.rs        # Market + Order PDA account structs
│   ├── errors.rs       # 12 custom error codes
│   └── events.rs       # OrderPlaced, TradeExecuted, OrderCancelled events
├── tests/
│   └── order-matching-engine.ts   # 10 comprehensive Anchor tests
├── client/
│   └── cli.ts          # 8 CLI commands (Commander.js + Anchor)
└── frontend/
    └── src/
        ├── pages/LandingPage.tsx  # Marketing + architecture page
        └── pages/TradingPage.tsx  # Live order book + place order form
```

---

## 🏆 Built for the Solana Backend Challenge

This project demonstrates that **Solana is not just a crypto tool** — it's a distributed state-machine backend. The order matching engine pattern shows:

1. **State** maps cleanly to PDAs (one account per order)
2. **Permissions** are enforced by the program (Anchor constraints)  
3. **Settlement** is atomic and trustless (no escrow operator)
4. **Auditability** is built in (every action on-chain forever)

Traditional developers can immediately recognize the `place_order → match → settle` lifecycle — because it's the same workflow they already know, just running on a globally replicated state machine instead of a private server.
