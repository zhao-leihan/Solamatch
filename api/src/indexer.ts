// ─────────────────────────────────────────────────────────────────────────────
// Solana Account Indexer
// Subscribes to on-chain program account changes and maintains an in-memory
// decoded order book cache. Also parses transaction logs for trade history.
// ─────────────────────────────────────────────────────────────────────────────

import {
    Connection,
    PublicKey,
    clusterApiUrl,
} from '@solana/web3.js';
import { BorshCoder, EventParser, Idl } from '@coral-xyz/anchor';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import {
    DecodedOrder,
    DecodedMarket,
    DecodedFeeConfig,
    OrderBook,
    Trade,
} from './types.js';

// ── IDL Loading ───────────────────────────────────────────────────────────────
// Default: <project_root>/target/idl/order_matching_engine.json
// Override with IDL_PATH env var.
const IDL_PATH = process.env.IDL_PATH
    ?? resolve(__dirname, '../../target/idl/order_matching_engine.json');

if (!existsSync(IDL_PATH)) {
    console.error(`
[SolaMatch API] ❌ IDL not found at:
  ${IDL_PATH}

→ Fix: Run 'anchor build' from the project root, then restart the server.
  Or set the IDL_PATH environment variable to the correct path.
`);
    process.exit(1);
}

const idl: Idl = JSON.parse(readFileSync(IDL_PATH, 'utf-8'));


const PROGRAM_ID = new PublicKey('77aLU4dN1NTAWVGhNcNgWFwQ5K9XwkFnEWMLjGWWZBDD');
const RPC_URL = process.env.RPC_URL ?? clusterApiUrl('devnet');

type OrderBookUpdateCallback = (marketPubkey: string, book: OrderBook) => void;
type TradeCallback = (trade: Trade) => void;

export class SolanaIndexer {
    private connection: Connection;
    private coder: BorshCoder;

    // In-memory caches
    private markets = new Map<string, DecodedMarket>();
    private orders = new Map<string, DecodedOrder>();      // pubkey → order
    private orderBooks = new Map<string, OrderBook>();     // market pubkey → book
    private trades: Trade[] = [];

    // Subscribers
    private orderBookListeners: OrderBookUpdateCallback[] = [];
    private tradeListeners: TradeCallback[] = [];

    private eventParser: EventParser;

    constructor() {
        this.connection = new Connection(RPC_URL, {
            commitment: 'confirmed',
            wsEndpoint: RPC_URL.replace('https', 'wss').replace('http', 'ws'),
        });
        this.coder = new BorshCoder(idl as Idl);
        this.eventParser = new EventParser(PROGRAM_ID, this.coder);
    }

    // ── Public API ─────────────────────────────────────────────────────────────

    getMarkets(): DecodedMarket[] {
        return [...this.markets.values()];
    }

    getMarket(pubkey: string): DecodedMarket | undefined {
        return this.markets.get(pubkey);
    }

    getOrderBook(marketPubkey: string): OrderBook | undefined {
        return this.orderBooks.get(marketPubkey);
    }

    getOrder(pubkey: string): DecodedOrder | undefined {
        return this.orders.get(pubkey);
    }

    getRecentTrades(marketPubkey: string, limit = 50): Trade[] {
        return this.trades
            .filter(t => t.market === marketPubkey)
            .slice(-limit)
            .reverse();
    }

    onOrderBookUpdate(cb: OrderBookUpdateCallback) {
        this.orderBookListeners.push(cb);
    }

    onTrade(cb: TradeCallback) {
        this.tradeListeners.push(cb);
    }

    // ── Startup ────────────────────────────────────────────────────────────────

    async start() {
        console.log(`[Indexer] Connecting to ${RPC_URL}`);
        console.log(`[Indexer] Watching program: ${PROGRAM_ID.toBase58()}`);

        // 1. Do a full initial snapshot
        await this.fullSnapshot();

        // 2. Subscribe to real-time account changes
        this.connection.onProgramAccountChange(
            PROGRAM_ID,
            (keyedAccountInfo) => {
                const pubkey = keyedAccountInfo.accountId.toBase58();
                const data = keyedAccountInfo.accountInfo.data;
                this.decodeAndCache(pubkey, data);
            },
            'confirmed',
        );

        // 3. Subscribe to program transaction logs for trade events
        this.connection.onLogs(
            PROGRAM_ID,
            (logs) => this.parseTradeFromLogs(logs.logs, logs.signature),
            'confirmed',
        );

        console.log('[Indexer] Subscriptions active.');
    }

    // ── Private helpers ────────────────────────────────────────────────────────

    private async fullSnapshot() {
        const accounts = await this.connection.getProgramAccounts(PROGRAM_ID);
        console.log(`[Indexer] Snapshot: ${accounts.length} accounts`);
        for (const { pubkey, account } of accounts) {
            this.decodeAndCache(pubkey.toBase58(), account.data);
        }
    }

    private decodeAndCache(pubkey: string, data: Buffer) {
        if (data.length < 8) return;

        try {
            // Try decoding as Market
            const market = this.coder.accounts.decode<any>('Market', data);
            const decoded: DecodedMarket = {
                pubkey,
                authority: market.authority.toBase58(),
                marketName: market.marketName,
                nextOrderId: market.nextOrderId.toNumber(),
                totalBidVolume: market.totalBidVolume.toNumber(),
                totalAskVolume: market.totalAskVolume.toNumber(),
                isPaused: market.isPaused,
            };
            this.markets.set(pubkey, decoded);
            return;
        } catch { }

        try {
            // Try decoding as Order
            const order = this.coder.accounts.decode<any>('Order', data);
            const decoded: DecodedOrder = {
                pubkey,
                owner: order.owner.toBase58(),
                market: order.market.toBase58(),
                orderId: order.orderId.toNumber(),
                side: order.side.buy !== undefined ? 'Buy' : 'Sell',
                price: order.price.toNumber(),
                quantity: order.quantity.toNumber(),
                filledQuantity: order.filledQuantity.toNumber(),
                remainingQuantity: order.quantity.toNumber() - order.filledQuantity.toNumber(),
                status: this.decodeStatus(order.status),
                timestamp: order.timestamp.toNumber(),
                isLocked: order.isLocked,
                expiresAt: order.expiresAt.toNumber(),
            };
            this.orders.set(pubkey, decoded);
            this.rebuildOrderBook(decoded.market);
            return;
        } catch { }

        // FeeConfig — silently ignore on decode failure
    }

    private decodeStatus(status: any): DecodedOrder['status'] {
        if (status.open !== undefined) return 'Open';
        if (status.partiallyFilled !== undefined) return 'PartiallyFilled';
        if (status.filled !== undefined) return 'Filled';
        return 'Cancelled';
    }

    /** Rebuild and cache the sorted order book for a market, then notify listeners. */
    private rebuildOrderBook(marketPubkey: string) {
        const allOrders = [...this.orders.values()].filter(
            o => o.market === marketPubkey && (o.status === 'Open' || o.status === 'PartiallyFilled'),
        );

        const bids = allOrders
            .filter(o => o.side === 'Buy')
            .sort((a, b) => b.price - a.price || a.timestamp - b.timestamp); // price desc, time asc

        const asks = allOrders
            .filter(o => o.side === 'Sell')
            .sort((a, b) => a.price - b.price || a.timestamp - b.timestamp); // price asc, time asc

        const book: OrderBook = { market: marketPubkey, bids, asks, timestamp: Date.now() };
        this.orderBooks.set(marketPubkey, book);
        this.orderBookListeners.forEach(cb => cb(marketPubkey, book));
    }

    private async parseTradeFromLogs(logs: string[], signature: string) {
        // Use Anchor's EventParser to decode on-chain events from transaction logs.
        // EventParser handles the "Program data: <base64>" lines internally.
        try {
            const events = [...this.eventParser.parseLogs(logs)];
            for (const event of events) {
                if (event.name !== 'TradeExecutedEvent') continue;
                const d = event.data as any;
                const trade: Trade = {
                    bidOrderId: d.bidOrderId.toNumber(),
                    askOrderId: d.askOrderId.toNumber(),
                    market: d.market.toBase58(),
                    buyer: d.buyer.toBase58(),
                    seller: d.seller.toBase58(),
                    fillPrice: d.fillPrice.toNumber(),
                    fillQuantity: d.fillQuantity.toNumber(),
                    feeAmount: d.feeAmount.toNumber(),
                    timestamp: d.timestamp.toNumber(),
                    signature,
                };
                this.trades.push(trade);
                if (this.trades.length > 1000) this.trades.shift();
                this.tradeListeners.forEach(cb => cb(trade));
            }
        } catch {
            // Ignore non-SolaMatch logs
        }
    }
}
