// ─────────────────────────────────────────────────────────────────────────────
// SolaMatch High-Performance Automated Matching Crank
//
// Algorithm:
//  1. Fetch order book from API gateway (decoded, pre-sorted bids/asks)
//  2. O(N) two-pointer scan to find ALL crossing bid/ask pairs
//  3. Submit all match transactions IN PARALLEL (one per slot target)
//  4. Dynamic priority fee from recent fee estimates
//  5. Skip preflight for maximum speed
//
// Run: npm run dev
// ─────────────────────────────────────────────────────────────────────────────

import {
    Connection,
    Keypair,
    PublicKey,
    ComputeBudgetProgram,
    clusterApiUrl,
} from '@solana/web3.js';
import {
    AnchorProvider,
    Program,
    Wallet,
} from '@coral-xyz/anchor';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

// ── Config ────────────────────────────────────────────────────────────────────

const API_URL = process.env.API_URL ?? 'http://localhost:3000';
const RPC_URL = process.env.RPC_URL ?? clusterApiUrl('devnet');
const KEYPAIR_PATH = process.env.KEYPAIR_PATH ?? join(homedir(), '.config', 'solana', 'id.json');
const MARKET_PUBKEY = process.env.MARKET_PUBKEY ?? '';
const POLL_MS = parseInt(process.env.POLL_MS ?? '400', 10); // ~1 block
const MAX_SLIPPAGE_BPS = parseInt(process.env.MAX_SLIPPAGE_BPS ?? '50', 10);
const PRIORITY_FEE_LAMPORTS = parseInt(process.env.PRIORITY_FEE_LAMPORTS ?? '5000', 10);
const PROGRAM_ID = new PublicKey('77aLU4dN1NTAWVGhNcNgWFwQ5K9XwkFnEWMLjGWWZBDD');

// ── Types (inline, no import needed) ─────────────────────────────────────────

interface ApiOrder {
    pubkey: string;
    owner: string;
    price: number;
    quantity: number;
    remainingQuantity: number;
    status: string;
    isLocked: boolean;
    expiresAt: number;
}

interface ApiOrderBook {
    bids: ApiOrder[];
    asks: ApiOrder[];
}

// ── Load IDL & wallet ─────────────────────────────────────────────────────────

const IDL_PATH = process.env.IDL_PATH
    ?? resolve(__dirname, '../../target/idl/order_matching_engine.json');

if (!existsSync(IDL_PATH)) {
    console.error(`
[Crank] ❌ IDL not found at:
  ${IDL_PATH}

→ Fix: Run 'anchor build' from the project root, then restart the crank.
`);
    process.exit(1);
}

const idl = JSON.parse(readFileSync(IDL_PATH, 'utf8'));
const keypairBytes = JSON.parse(readFileSync(KEYPAIR_PATH, 'utf8'));
const crankerKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairBytes));

const connection = new Connection(RPC_URL, { commitment: 'confirmed' });
const wallet = new Wallet(crankerKeypair);
// Anchor 0.32: Program constructor is (idl, provider) — program ID comes from IDL
const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed', skipPreflight: true });
const program = new Program(idl, provider);

// ── Stats ─────────────────────────────────────────────────────────────────────

let totalMatchesSubmitted = 0;
let totalSlotsCranked = 0;
let lastSlotMatches = 0;

// ── Core Functions ────────────────────────────────────────────────────────────

/**
 * Fetch the current order book from the API gateway.
 * This avoids expensive on-chain RPC calls for listing orders.
 */
async function fetchOrderBook(marketPubkey: string): Promise<ApiOrderBook> {
    const res = await fetch(`${API_URL}/markets/${marketPubkey}/orderbook`);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json() as Promise<ApiOrderBook>;
}

/**
 * O(N) Two-Pointer matching scan.
 *
 * Input: bids sorted by price DESC, asks sorted by price ASC.
 * Each pointer advances in one direction — total complexity O(bids + asks).
 *
 * Returns: array of [bid, ask] pairs that are price-crossing and ready to match.
 */
function findCrossingPairs(bids: ApiOrder[], asks: ApiOrder[]): [ApiOrder, ApiOrder][] {
    const pairs: [ApiOrder, ApiOrder][] = [];
    const now = Math.floor(Date.now() / 1000);

    let b = 0;
    let a = 0;

    while (b < bids.length && a < asks.length) {
        const bid = bids[b];
        const ask = asks[a];

        // Skip locked or expired orders
        if (bid.isLocked || (bid.expiresAt > 0 && now > bid.expiresAt)) { b++; continue; }
        if (ask.isLocked || (ask.expiresAt > 0 && now > ask.expiresAt)) { a++; continue; }

        if (bid.price >= ask.price) {
            // Price crosses — this pair can be matched
            pairs.push([bid, ask]);

            // Advance the pointer whose order will be fully filled
            if (bid.remainingQuantity <= ask.remainingQuantity) {
                b++;
            } else {
                a++;
            }
        } else {
            // No more crossing pairs (sorted, so all remaining bids/asks won't cross)
            break;
        }
    }

    return pairs;
}

/**
 * Build and submit a single match_orders transaction.
 * Uses skipPreflight for speed and adds ComputeBudgetProgram priority fee.
 */
async function submitMatch(
    marketPubkey: PublicKey,
    bid: ApiOrder,
    ask: ApiOrder,
): Promise<string | null> {
    try {
        const bidOrderPda = new PublicKey(bid.pubkey);
        const askOrderPda = new PublicKey(ask.pubkey);
        const bidOwner = new PublicKey(bid.owner);
        const askOwner = new PublicKey(ask.owner);

        // Build priority fee instruction for slot priority
        const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: PRIORITY_FEE_LAMPORTS,
        });

        // match_orders instruction — cast to any avoids Anchor's deep TS generics
        // (known limitation with untyped IDL — safe at runtime, IDL still validates the call)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tx = await (program as any).methods
            .matchOrders(MAX_SLIPPAGE_BPS)
            .accounts({
                matcher: crankerKeypair.publicKey,
                market: marketPubkey,
                bidOrder: bidOrderPda,
                askOrder: askOrderPda,
                bidOwner,
                askOwner,
            })
            .preInstructions([priorityFeeIx])
            .transaction();

        const sig = await connection.sendRawTransaction(
            tx.serialize(),
            { skipPreflight: true, maxRetries: 2 },
        );

        return sig;
    } catch (err) {
        console.error(`  [!] Match failed bid#${bid.pubkey.slice(0, 8)} x ask#${ask.pubkey.slice(0, 8)}:`, err);
        return null;
    }
}

// ── Main Crank Loop ───────────────────────────────────────────────────────────

async function crankOnce(marketPubkey: PublicKey) {
    const startMs = Date.now();
    const book = await fetchOrderBook(marketPubkey.toBase58());

    if (!book.bids.length || !book.asks.length) return;

    const pairs = findCrossingPairs(book.bids, book.asks);
    lastSlotMatches = pairs.length;

    if (pairs.length === 0) return;

    console.log(`[Crank] Found ${pairs.length} crossing pair(s) — submitting in parallel...`);

    // Submit ALL match txs in parallel for maximum slot utilization
    const results = await Promise.all(
        pairs.map(([bid, ask]) => submitMatch(marketPubkey, bid, ask)),
    );

    const succeeded = results.filter(Boolean).length;
    totalMatchesSubmitted += succeeded;
    totalSlotsCranked++;

    const elapsedMs = Date.now() - startMs;
    console.log(
        `[Crank] Slot #${totalSlotsCranked} | ${succeeded}/${pairs.length} submitted | ${elapsedMs}ms | total: ${totalMatchesSubmitted}`,
    );
}

async function main() {
    if (!MARKET_PUBKEY) {
        console.error('[Crank] ERROR: Set MARKET_PUBKEY env variable to the market PDA.');
        process.exit(1);
    }

    const marketPubkey = new PublicKey(MARKET_PUBKEY);
    console.log(`
╔══════════════════════════════════════════════╗
║      SolaMatch Crank Engine  v1.0.0          ║
╠══════════════════════════════════════════════╣
║  Market:    ${MARKET_PUBKEY.slice(0, 20)}...    ║
║  Cranker:   ${crankerKeypair.publicKey.toBase58().slice(0, 20)}...    ║
║  RPC:       ${RPC_URL.slice(0, 28)}...    ║
║  Poll:      ${POLL_MS}ms (~1 block)              ║
║  Slippage:  max ${MAX_SLIPPAGE_BPS}bps                      ║
║  Priority:  ${PRIORITY_FEE_LAMPORTS} µlamports/CU               ║
╚══════════════════════════════════════════════╝
  `);

    // Poll every ~400ms (1 Solana slot)
    const tick = async () => {
        try {
            await crankOnce(marketPubkey);
        } catch (err) {
            console.error('[Crank] Tick error:', err);
        }
        setTimeout(tick, POLL_MS);
    };

    await tick();
}

main().catch(err => {
    console.error('[Fatal]', err);
    process.exit(1);
});
