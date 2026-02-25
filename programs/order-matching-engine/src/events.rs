use anchor_lang::prelude::*;
use crate::state::Side;

#[event]
pub struct OrderPlacedEvent {
    pub order_id: u64,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub side: Side,
    pub price: u64,
    pub quantity: u64,
    pub timestamp: i64,
}

#[event]
pub struct TradeExecutedEvent {
    pub bid_order_id: u64,
    pub ask_order_id: u64,
    pub market: Pubkey,
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub fill_price: u64,
    pub fill_quantity: u64,
    pub fee_amount: u64,       // Protocol fee deducted from seller payment
    pub timestamp: i64,
}

#[event]
pub struct OrderCancelledEvent {
    pub order_id: u64,
    pub owner: Pubkey,
    pub market: Pubkey,
    pub refund_lamports: u64,
}

#[event]
pub struct MarketPausedEvent {
    pub market: Pubkey,
    pub authority: Pubkey,
    pub is_paused: bool,
    pub timestamp: i64,
}
