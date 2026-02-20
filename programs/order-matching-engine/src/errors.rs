use anchor_lang::prelude::*;

#[error_code]
pub enum MatchingEngineError {
    #[msg("Price must be greater than zero")]
    InvalidPrice,
    #[msg("Quantity must be greater than zero")]
    InvalidQuantity,
    #[msg("Order ID must match market's next_order_id")]
    InvalidOrderId,
    #[msg("Bid price must be >= ask price to execute a match")]
    PriceMismatch,
    #[msg("Both orders must belong to the same market")]
    MarketMismatch,
    #[msg("Order is not in an active state (Open or PartiallyFilled)")]
    OrderNotActive,
    #[msg("Invalid order side for this operation")]
    InvalidOrderSide,
    #[msg("Unauthorized: signer does not own this order")]
    Unauthorized,
    #[msg("Arithmetic overflow")]
    MathOverflow,
    #[msg("Market name too long (max 32 characters)")]
    MarketNameTooLong,
    #[msg("bid_owner account does not match bid order owner field")]
    BidOwnerMismatch,
    #[msg("ask_owner account does not match ask order owner field")]
    AskOwnerMismatch,
    #[msg("Order must be Filled or Cancelled before it can be closed")]
    OrderNotClosed,
}
