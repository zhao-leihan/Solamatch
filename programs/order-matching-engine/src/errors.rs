use anchor_lang::prelude::*;

#[error_code]
pub enum MatchingEngineError {
    // ── Input validation ──────────────────────────────────────────────────────
    #[msg("Price must be greater than zero")]
    InvalidPrice,
    #[msg("Quantity must be greater than zero")]
    InvalidQuantity,
    #[msg("Order ID must match market's next_order_id")]
    InvalidOrderId,

    // ── Matching logic ────────────────────────────────────────────────────────
    #[msg("Bid price must be >= ask price to execute a match")]
    PriceMismatch,
    #[msg("Both orders must belong to the same market")]
    MarketMismatch,
    #[msg("Order is not in an active state (Open or PartiallyFilled)")]
    OrderNotActive,
    #[msg("Invalid order side for this operation")]
    InvalidOrderSide,

    // ── Authorization ──────────────────────────────────────────────────────────
    #[msg("Unauthorized: signer does not own this order")]
    Unauthorized,
    #[msg("bid_owner account does not match bid order owner field")]
    BidOwnerMismatch,
    #[msg("ask_owner account does not match ask order owner field")]
    AskOwnerMismatch,

    // ── Math ──────────────────────────────────────────────────────────────────
    #[msg("Arithmetic overflow")]
    MathOverflow,

    // ── Market metadata ───────────────────────────────────────────────────────
    #[msg("Market name too long (max 32 characters)")]
    MarketNameTooLong,

    // ── Order lifecycle ───────────────────────────────────────────────────────
    #[msg("Order must be Filled or Cancelled before it can be closed")]
    OrderNotClosed,

    // ── Emergency Pause (Kill Switch) ─────────────────────────────────────────
    #[msg("Market is paused — all new orders and matches are halted")]
    MarketPaused,

    // ── Robustness ────────────────────────────────────────────────────────────
    #[msg("Order is currently locked in an active match — retry after confirmation")]
    OrderLocked,
    #[msg("Order has expired (TTL exceeded)")]
    OrderExpired,
    #[msg("Price slippage exceeds the requested maximum basis points")]
    SlippageExceeded,

    // ── Fee Collector ─────────────────────────────────────────────────────────
    #[msg("Fee basis points exceeds hard cap of 500 (5%)")]
    FeeBpsTooHigh,
    #[msg("Treasury account does not match fee config")]
    TreasuryMismatch,
}
