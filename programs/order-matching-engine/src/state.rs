use anchor_lang::prelude::*;

// ─── Account Structs ──────────────────────────────────────────────────────────

#[account]
pub struct Market {
    pub authority: Pubkey,      // 32
    pub market_name: String,    // 4 + 32 = 36
    pub next_order_id: u64,     // 8
    pub total_bid_volume: u64,  // 8
    pub total_ask_volume: u64,  // 8
    pub bump: u8,               // 1
}

impl Market {
    // 8 discriminator + fields
    pub const LEN: usize = 8 + 32 + (4 + 32) + 8 + 8 + 8 + 1;
    pub const MAX_NAME_LEN: usize = 32;
}

#[account]
pub struct Order {
    pub owner: Pubkey,           // 32
    pub market: Pubkey,          // 32
    pub order_id: u64,           // 8
    pub side: Side,              // 1
    pub price: u64,              // 8
    pub quantity: u64,           // 8
    pub filled_quantity: u64,    // 8
    pub status: OrderStatus,     // 1
    pub timestamp: i64,          // 8
    pub bump: u8,                // 1
}

impl Order {
    // 8 discriminator + fields
    pub const LEN: usize = 8 + 32 + 32 + 8 + 1 + 8 + 8 + 8 + 1 + 8 + 1;

    pub fn remaining_quantity(&self) -> u64 {
        self.quantity.saturating_sub(self.filled_quantity)
    }

    pub fn is_active(&self) -> bool {
        self.status == OrderStatus::Open || self.status == OrderStatus::PartiallyFilled
    }
}

// ─── Enums ────────────────────────────────────────────────────────────────────

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum Side {
    Buy,
    Sell,
}

impl Default for Side {
    fn default() -> Self {
        Side::Buy
    }
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum OrderStatus {
    Open,
    PartiallyFilled,
    Filled,
    Cancelled,
}

impl Default for OrderStatus {
    fn default() -> Self {
        OrderStatus::Open
    }
}
