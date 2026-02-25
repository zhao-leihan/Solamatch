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
    pub is_paused: bool,        // 1  ← Emergency Pause kill switch
}

impl Market {
    // 8 discriminator + fields
    pub const LEN: usize = 8 + 32 + (4 + 32) + 8 + 8 + 8 + 1 + 1;
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
    pub is_locked: bool,         // 1  ← Double-match re-entrancy guard
    pub expires_at: i64,         // 8  ← TTL (0 = no expiry)
}

impl Order {
    // 8 discriminator + fields
    pub const LEN: usize = 8 + 32 + 32 + 8 + 1 + 8 + 8 + 8 + 1 + 8 + 1 + 1 + 8;

    pub fn remaining_quantity(&self) -> u64 {
        self.quantity.saturating_sub(self.filled_quantity)
    }

    pub fn is_active(&self) -> bool {
        self.status == OrderStatus::Open || self.status == OrderStatus::PartiallyFilled
    }

    /// Returns true if the order has a TTL and it has expired.
    pub fn is_expired(&self, now: i64) -> bool {
        self.expires_at > 0 && now > self.expires_at
    }
}

/// Fee configuration PDA — one per market.
/// Seeds: [b"fee_config", market_pubkey]
#[account]
pub struct FeeConfig {
    pub market: Pubkey,          // 32 — parent market
    pub treasury: Pubkey,        // 32 — SOL recipient for fees
    pub fee_bps: u16,            // 2  — basis points (100 = 1%). Max 500 (5%)
    pub accumulated_fees: u64,   // 8  — lifetime total for auditing
    pub bump: u8,                // 1
}

impl FeeConfig {
    pub const LEN: usize = 8 + 32 + 32 + 2 + 8 + 1;
    pub const MAX_FEE_BPS: u16 = 500; // 5% hard cap

    /// Calculate the fee amount for a given payment.
    pub fn calc_fee(&self, payment: u64) -> u64 {
        (payment as u128)
            .checked_mul(self.fee_bps as u128)
            .unwrap_or(0)
            .checked_div(10_000)
            .unwrap_or(0) as u64
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
