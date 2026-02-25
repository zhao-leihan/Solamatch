// ─────────────────────────────────────────────────────────────────────────────
// SolaMatch API Gateway — Main Server
//
// Fastify server with:
//  • REST endpoints (GET /markets, /orderbook, /trades, /orders)
//  • Swagger UI at /docs  (interactive API playground)
//  • Redoc at /redoc      (clean read-only docs)
//  • WebSocket at /ws     (real-time order book + trade events)
//  • CORS enabled
//
// Start: npm run dev
// ─────────────────────────────────────────────────────────────────────────────

import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import fastifyWebsocket from '@fastify/websocket';
import { WebSocket } from 'ws';
import { SolanaIndexer } from './indexer.js';
import { registerRoutes } from './routes.js';
import { WsMessage, WsSubscribeMessage, OrderBook, Trade } from './types.js';

const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';

async function start() {
    const app = Fastify({ logger: { level: 'info' } });

    // ── CORS ───────────────────────────────────────────────────────────────────
    await app.register(fastifyCors, { origin: '*' });

    // ── OpenAPI / Swagger ──────────────────────────────────────────────────────
    await app.register(fastifySwagger, {
        openapi: {
            openapi: '3.0.3',
            info: {
                title: 'SolaMatch OME API',
                description: `
## SolaMatch Order Matching Engine — B2B API

A production-grade **read API and WebSocket event stream** for the SolaMatch on-chain order matching engine.

### Integrate in 10 lines
\`\`\`typescript
// REST: Get order book
const res = await fetch('https://api.solamatch.io/markets/<MARKET>/orderbook');
const { bids, asks } = await res.json();

// WebSocket: Subscribe to live updates
const ws = new WebSocket('wss://api.solamatch.io/ws');
ws.send(JSON.stringify({ type: 'subscribe', market: '<MARKET>' }));
ws.onmessage = ({ data }) => {
  const { type, data: payload } = JSON.parse(data);
  if (type === 'orderbook_update') console.log(payload.bids, payload.asks);
};
\`\`\`

### Architecture
- **On-chain program** (Anchor): \`77aLU4dN1NTAWVGhNcNgWFwQ5K9XwkFnEWMLjGWWZBDD\`
- **This gateway** reads account changes in real-time and serves decoded data
- B2B clients submit transactions directly to Solana — this API is read-only

### Fee Model
- Protocol fee: configurable in basis points (default 30bps = 0.3%)
- Fee automatically deducted from matched trades via on-chain \`FeeConfig\` PDA
        `,
                version: '1.0.0',
                contact: {
                    name: 'SolaMatch',
                    url: 'https://github.com/zhao-leihan/Solamatch',
                },
                license: { name: 'MIT' },
            },
            servers: [
                { url: 'http://localhost:3000', description: 'Local development' },
                { url: 'https://api.solamatch.io', description: 'Production (devnet)' },
            ],
            tags: [
                { name: 'Markets', description: 'Market account endpoints' },
                { name: 'Order Book', description: 'Live order book snapshot' },
                { name: 'Trades', description: 'Matched trade history' },
                { name: 'Orders', description: 'Individual order data' },
                { name: 'System', description: 'Health and status endpoints' },
            ],
        },
    });

    // ── Swagger UI at /docs ────────────────────────────────────────────────────
    await app.register(fastifySwaggerUi, {
        routePrefix: '/docs',
        uiConfig: {
            docExpansion: 'list',
            deepLinking: true,
            defaultModelsExpandDepth: 2,
            tryItOutEnabled: true,
        },
        theme: {
            title: 'SolaMatch API Docs',
            css: [
                {
                    filename: 'theme.css',
                    content: `
            .swagger-ui .topbar { background: linear-gradient(135deg, #9945ff, #14f195); }
            .swagger-ui .topbar .download-url-wrapper { display: none; }
            body { font-family: 'Inter', sans-serif; }
          `,
                },
            ],
        },
    });

    // ── WebSocket ──────────────────────────────────────────────────────────────
    await app.register(fastifyWebsocket);

    // ── Solana Indexer ─────────────────────────────────────────────────────────
    const indexer = new SolanaIndexer();

    // ── WebSocket client registry ──────────────────────────────────────────────
    // market pubkey → Set of connected WebSocket clients
    const subscribers = new Map<string, Set<WebSocket>>();

    /** Push a typed message to all subscribers of a market. */
    function broadcast(marketPubkey: string, msg: WsMessage) {
        const subs = subscribers.get(marketPubkey);
        if (!subs || subs.size === 0) return;
        const payload = JSON.stringify(msg);
        for (const ws of subs) {
            if (ws.readyState === WebSocket.OPEN) {
                ws.send(payload);
            }
        }
    }

    // Wire indexer callbacks → WebSocket broadcasts
    indexer.onOrderBookUpdate((marketPubkey: string, book: OrderBook) => {
        broadcast(marketPubkey, {
            type: 'orderbook_update',
            market: marketPubkey,
            data: book,
        });
    });

    indexer.onTrade((trade: Trade) => {
        broadcast(trade.market, {
            type: 'trade_executed',
            market: trade.market,
            data: trade,
        });
    });

    // ── WebSocket Route ────────────────────────────────────────────────────────
    app.get('/ws', { websocket: true }, (socket, _req) => {
        const mySubscriptions = new Set<string>();

        socket.on('message', (raw: Buffer) => {
            try {
                const msg: WsSubscribeMessage = JSON.parse(raw.toString());
                const market = msg.market;

                if (msg.type === 'subscribe') {
                    if (!subscribers.has(market)) subscribers.set(market, new Set());
                    subscribers.get(market)!.add(socket as unknown as WebSocket);
                    mySubscriptions.add(market);

                    // Send immediate snapshot
                    const book = indexer.getOrderBook(market);
                    const response: WsMessage = {
                        type: 'subscribed',
                        market,
                        data: { message: `Subscribed to ${market}`, snapshot: book ?? null },
                    };
                    socket.send(JSON.stringify(response));
                }

                if (msg.type === 'unsubscribe') {
                    subscribers.get(market)?.delete(socket as unknown as WebSocket);
                    mySubscriptions.delete(market);
                }
            } catch {
                socket.send(JSON.stringify({ type: 'error', data: { message: 'Invalid JSON' } }));
            }
        });

        socket.on('close', () => {
            for (const market of mySubscriptions) {
                subscribers.get(market)?.delete(socket as unknown as WebSocket);
            }
        });
    });

    // ── REST Routes ────────────────────────────────────────────────────────────
    await registerRoutes(app, indexer);

    // ── Start indexer + server ─────────────────────────────────────────────────
    await indexer.start();

    await app.listen({ port: PORT, host: HOST });
    console.log(`
╔══════════════════════════════════════════════╗
║        SolaMatch API Gateway  v1.0.0         ║
╠══════════════════════════════════════════════╣
║  REST     http://localhost:${PORT}             ║
║  Swagger  http://localhost:${PORT}/docs        ║
║  Redoc    http://localhost:${PORT}/redoc       ║
║  WS       ws://localhost:${PORT}/ws            ║
║  Health   http://localhost:${PORT}/health      ║
╚══════════════════════════════════════════════╝
  `);
}

start().catch(err => {
    console.error('[Fatal]', err);
    process.exit(1);
});
