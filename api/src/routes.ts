// ─────────────────────────────────────────────────────────────────────────────
// REST Route Definitions with OpenAPI/Swagger schemas
// ─────────────────────────────────────────────────────────────────────────────

import { FastifyInstance } from 'fastify';
import { SolanaIndexer } from './indexer.js';

// ── Reusable schemas ─────────────────────────────────────────────────────────

const OrderSchema = {
    type: 'object',
    properties: {
        pubkey: { type: 'string', description: 'Order PDA public key (base58)' },
        owner: { type: 'string', description: 'Owner wallet address' },
        market: { type: 'string', description: 'Parent market PDA' },
        orderId: { type: 'number' },
        side: { type: 'string', enum: ['Buy', 'Sell'] },
        price: { type: 'number', description: 'Limit price in lamports per unit' },
        quantity: { type: 'number' },
        filledQuantity: { type: 'number' },
        remainingQuantity: { type: 'number' },
        status: { type: 'string', enum: ['Open', 'PartiallyFilled', 'Filled', 'Cancelled'] },
        timestamp: { type: 'number', description: 'Unix timestamp (seconds)' },
        isLocked: { type: 'boolean' },
        expiresAt: { type: 'number', description: 'Expiry unix timestamp (0 = none)' },
    },
};

const MarketSchema = {
    type: 'object',
    properties: {
        pubkey: { type: 'string' },
        authority: { type: 'string' },
        marketName: { type: 'string' },
        nextOrderId: { type: 'number' },
        totalBidVolume: { type: 'number' },
        totalAskVolume: { type: 'number' },
        isPaused: { type: 'boolean', description: 'True if emergency pause is active' },
    },
};

const OrderBookSchema = {
    type: 'object',
    properties: {
        market: { type: 'string' },
        bids: { type: 'array', items: OrderSchema },
        asks: { type: 'array', items: OrderSchema },
        timestamp: { type: 'number', description: 'Last update time (unix ms)' },
    },
};

const TradeSchema = {
    type: 'object',
    properties: {
        bidOrderId: { type: 'number' },
        askOrderId: { type: 'number' },
        market: { type: 'string' },
        buyer: { type: 'string' },
        seller: { type: 'string' },
        fillPrice: { type: 'number' },
        fillQuantity: { type: 'number' },
        feeAmount: { type: 'number', description: 'Protocol fee deducted from trade (lamports)' },
        timestamp: { type: 'number' },
        signature: { type: 'string', description: 'Solana transaction signature' },
    },
};

// ── Route registration ────────────────────────────────────────────────────────

export async function registerRoutes(app: FastifyInstance, indexer: SolanaIndexer) {

    // GET /markets
    app.get('/markets', {
        schema: {
            summary: 'List all tracked markets',
            description: 'Returns all on-chain markets indexed by the SolaMatch gateway.',
            tags: ['Markets'],
            response: {
                200: {
                    description: 'Array of market accounts',
                    type: 'array',
                    items: MarketSchema,
                },
            },
        },
    }, async () => {
        return indexer.getMarkets();
    });

    // GET /markets/:pubkey
    app.get<{ Params: { pubkey: string } }>('/markets/:pubkey', {
        schema: {
            summary: 'Get a single market by public key',
            tags: ['Markets'],
            params: {
                type: 'object',
                properties: { pubkey: { type: 'string', description: 'Market PDA (base58)' } },
            },
            response: {
                200: { description: 'Market account', ...MarketSchema },
                404: { description: 'Market not found', type: 'object', properties: { error: { type: 'string' } } },
            },
        },
    }, async (req, reply) => {
        const market = indexer.getMarket(req.params.pubkey);
        if (!market) return reply.code(404).send({ error: 'Market not found' });
        return market;
    });

    // GET /markets/:pubkey/orderbook
    app.get<{ Params: { pubkey: string } }>('/markets/:pubkey/orderbook', {
        schema: {
            summary: 'Get the current order book snapshot for a market',
            description: `Returns all active bids (sorted: highest price first) and asks 
(sorted: lowest price first). This endpoint is the primary data feed for B2B clients.

**10-line quickstart:**
\`\`\`typescript
const res = await fetch('https://api.solamatch.io/markets/<MARKET_PUBKEY>/orderbook');
const { bids, asks } = await res.json();
console.log('Best bid:', bids[0]?.price, '| Best ask:', asks[0]?.price);
\`\`\``,
            tags: ['Order Book'],
            params: {
                type: 'object',
                properties: { pubkey: { type: 'string', description: 'Market PDA (base58)' } },
            },
            response: {
                200: { description: 'Order book snapshot', ...OrderBookSchema },
                404: { description: 'Market not found', type: 'object', properties: { error: { type: 'string' } } },
            },
        },
    }, async (req, reply) => {
        const book = indexer.getOrderBook(req.params.pubkey);
        if (!book) return reply.code(404).send({ error: 'Market not found or no data yet' });
        return book;
    });

    // GET /markets/:pubkey/trades
    app.get<{
        Params: { pubkey: string };
        Querystring: { limit?: string };
    }>('/markets/:pubkey/trades', {
        schema: {
            summary: 'Get recent matched trades for a market',
            description: 'Returns trades parsed from on-chain TradeExecutedEvent logs. Includes fee amounts.',
            tags: ['Trades'],
            params: {
                type: 'object',
                properties: { pubkey: { type: 'string' } },
            },
            querystring: {
                type: 'object',
                properties: { limit: { type: 'string', description: 'Max trades to return (default: 50)' } },
            },
            response: {
                200: { type: 'array', items: TradeSchema },
            },
        },
    }, async (req) => {
        const limit = parseInt(req.query.limit ?? '50', 10);
        return indexer.getRecentTrades(req.params.pubkey, limit);
    });

    // GET /orders/:pubkey
    app.get<{ Params: { pubkey: string } }>('/orders/:pubkey', {
        schema: {
            summary: 'Get a single order by its PDA public key',
            tags: ['Orders'],
            params: {
                type: 'object',
                properties: { pubkey: { type: 'string', description: 'Order PDA (base58)' } },
            },
            response: {
                200: { description: 'Order account data', ...OrderSchema },
                404: { description: 'Order not found', type: 'object', properties: { error: { type: 'string' } } },
            },
        },
    }, async (req, reply) => {
        const order = indexer.getOrder(req.params.pubkey);
        if (!order) return reply.code(404).send({ error: 'Order not found' });
        return order;
    });

    // GET /health
    app.get('/health', {
        schema: {
            summary: 'Health check',
            tags: ['System'],
            response: {
                200: {
                    type: 'object',
                    properties: {
                        status: { type: 'string' },
                        marketsTracked: { type: 'number' },
                        timestamp: { type: 'number' },
                    },
                },
            },
        },
    }, async () => ({
        status: 'ok',
        marketsTracked: indexer.getMarkets().length,
        timestamp: Date.now(),
    }));
}
