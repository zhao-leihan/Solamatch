// ─────────────────────────────────────────────────────────────────────────────
// Shared TypeScript types for the SolaMatch API Gateway
// ─────────────────────────────────────────────────────────────────────────────

export type OrderSide = 'Buy' | 'Sell';
export type OrderStatus = 'Open' | 'PartiallyFilled' | 'Filled' | 'Cancelled';

export interface DecodedOrder {
    pubkey: string;
    owner: string;
    market: string;
    orderId: number;
    side: OrderSide;
    price: number;          // lamports per unit
    quantity: number;
    filledQuantity: number;
    remainingQuantity: number;
    status: OrderStatus;
    timestamp: number;      // unix seconds
    isLocked: boolean;
    expiresAt: number;      // 0 = no expiry
}

export interface DecodedMarket {
    pubkey: string;
    authority: string;
    marketName: string;
    nextOrderId: number;
    totalBidVolume: number;
    totalAskVolume: number;
    isPaused: boolean;
}

export interface DecodedFeeConfig {
    market: string;
    treasury: string;
    feeBps: number;
    accumulatedFees: number;
}

export interface OrderBook {
    market: string;
    bids: DecodedOrder[];   // sorted: highest price first
    asks: DecodedOrder[];   // sorted: lowest price first
    timestamp: number;      // last update unix ms
}

export interface Trade {
    bidOrderId: number;
    askOrderId: number;
    market: string;
    buyer: string;
    seller: string;
    fillPrice: number;
    fillQuantity: number;
    feeAmount: number;
    timestamp: number;
    signature: string;
}

// WebSocket message types (server → client)
export interface WsMessage {
    type: 'orderbook_update' | 'trade_executed' | 'market_status' | 'subscribed' | 'error';
    market?: string;
    data: unknown;
}

// WebSocket subscription message (client → server)
export interface WsSubscribeMessage {
    type: 'subscribe' | 'unsubscribe';
    market: string;
}
