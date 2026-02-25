use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("77aLU4dN1NTAWVGhNcNgWFwQ5K9XwkFnEWMLjGWWZBDD");

pub mod errors;
pub mod events;
pub mod state;

use errors::MatchingEngineError;
use events::*;
use state::*;

// ─────────────────────────────────────────────────────────────────────────────
// Program Instructions
// ─────────────────────────────────────────────────────────────────────────────
#[program]
pub mod order_matching_engine {
    use super::*;

    // ═══════════════════════════════════════════════════════════════════════
    // Market Management
    // ═══════════════════════════════════════════════════════════════════════

    /// Create a new order book market.
    /// Seeds: ["market", authority, market_name]
    pub fn initialize_market(
        ctx: Context<InitializeMarket>,
        market_name: String,
    ) -> Result<()> {
        require!(
            market_name.len() <= Market::MAX_NAME_LEN,
            MatchingEngineError::MarketNameTooLong
        );
        let market = &mut ctx.accounts.market;
        market.authority = ctx.accounts.authority.key();
        market.market_name = market_name.clone();
        market.next_order_id = 0;
        market.total_bid_volume = 0;
        market.total_ask_volume = 0;
        market.bump = ctx.bumps.market;
        market.is_paused = false;

        msg!("Market '{}' initialized.", market_name);
        Ok(())
    }

    /// ⚡ KILL SWITCH: Pause all new orders and matching for this market.
    /// Only the market authority can call this.
    /// cancel_order remains unaffected — users can always reclaim funds.
    pub fn pause_market(ctx: Context<AuthorityAction>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        require!(!market.is_paused, MatchingEngineError::MarketPaused);
        market.is_paused = true;
        msg!("Market '{}' PAUSED by authority.", market.market_name);
        Ok(())
    }

    /// Resume a paused market. Only the market authority can call this.
    pub fn resume_market(ctx: Context<AuthorityAction>) -> Result<()> {
        let market = &mut ctx.accounts.market;
        market.is_paused = false;
        msg!("Market '{}' RESUMED by authority.", market.market_name);
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Fee Configuration
    // ═══════════════════════════════════════════════════════════════════════

    /// Initialize a fee config PDA for this market.
    /// Seeds: ["fee_config", market]
    /// Only callable by market authority.
    pub fn initialize_fee_config(
        ctx: Context<InitializeFeeConfig>,
        fee_bps: u16,
        treasury: Pubkey,
    ) -> Result<()> {
        require!(
            fee_bps <= FeeConfig::MAX_FEE_BPS,
            MatchingEngineError::FeeBpsTooHigh
        );
        let fee_config = &mut ctx.accounts.fee_config;
        fee_config.market = ctx.accounts.market.key();
        fee_config.treasury = treasury;
        fee_config.fee_bps = fee_bps;
        fee_config.accumulated_fees = 0;
        fee_config.bump = ctx.bumps.fee_config;
        msg!(
            "FeeConfig initialized: {}bps → treasury {}",
            fee_bps,
            treasury
        );
        Ok(())
    }

    /// Update fee_bps or treasury. Only callable by market authority.
    pub fn update_fee_config(
        ctx: Context<UpdateFeeConfig>,
        new_fee_bps: u16,
        new_treasury: Pubkey,
    ) -> Result<()> {
        require!(
            new_fee_bps <= FeeConfig::MAX_FEE_BPS,
            MatchingEngineError::FeeBpsTooHigh
        );
        let fee_config = &mut ctx.accounts.fee_config;
        fee_config.fee_bps = new_fee_bps;
        fee_config.treasury = new_treasury;
        msg!(
            "FeeConfig updated: {}bps → treasury {}",
            new_fee_bps,
            new_treasury
        );
        Ok(())
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Order Lifecycle
    // ═══════════════════════════════════════════════════════════════════════

    /// Place a buy or sell order.
    /// - BUY: escrows (price * quantity) lamports in the Order PDA.
    /// - SELL: no lamport escrow; records the intent on-chain.
    /// - expires_at: Unix timestamp after which the order is invalid (0 = no expiry).
    /// Seeds: ["order", market, order_id_le]
    pub fn place_order(
        ctx: Context<PlaceOrder>,
        side: Side,
        price: u64,
        quantity: u64,
        order_id: u64,
        expires_at: i64,
    ) -> Result<()> {
        // ── Pause guard ─────────────────────────────────────────────────────
        require!(
            !ctx.accounts.market.is_paused,
            MatchingEngineError::MarketPaused
        );
        // ── Input validation ────────────────────────────────────────────────
        require!(price > 0, MatchingEngineError::InvalidPrice);
        require!(quantity > 0, MatchingEngineError::InvalidQuantity);
        require!(
            order_id == ctx.accounts.market.next_order_id,
            MatchingEngineError::InvalidOrderId
        );

        let clock = Clock::get()?;

        // Validate TTL if set
        if expires_at > 0 {
            require!(
                expires_at > clock.unix_timestamp,
                MatchingEngineError::OrderExpired
            );
        }

        // ── Pre-capture keys before any mutable borrow ──────────────────────
        let owner_key = ctx.accounts.owner.key();
        let market_key = ctx.accounts.market.key();
        let order_bump = ctx.bumps.order;

        // ── Escrow CPI BEFORE mutable borrow of `order` ─────────────────────
        if side == Side::Buy {
            let escrow_lamports = price
                .checked_mul(quantity)
                .ok_or(MatchingEngineError::MathOverflow)?;
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.owner.to_account_info(),
                        to: ctx.accounts.order.to_account_info(),
                    },
                ),
                escrow_lamports,
            )?;
        }

        // ── Populate Order account fields ────────────────────────────────────
        let order = &mut ctx.accounts.order;
        order.owner = owner_key;
        order.market = market_key;
        order.order_id = order_id;
        order.side = side.clone();
        order.price = price;
        order.quantity = quantity;
        order.filled_quantity = 0;
        order.status = OrderStatus::Open;
        order.timestamp = clock.unix_timestamp;
        order.bump = order_bump;
        order.is_locked = false;
        order.expires_at = expires_at;

        // ── Update market volumes ────────────────────────────────────────────
        if side == Side::Buy {
            ctx.accounts.market.total_bid_volume = ctx
                .accounts
                .market
                .total_bid_volume
                .checked_add(quantity)
                .ok_or(MatchingEngineError::MathOverflow)?;
        } else {
            ctx.accounts.market.total_ask_volume = ctx
                .accounts
                .market
                .total_ask_volume
                .checked_add(quantity)
                .ok_or(MatchingEngineError::MathOverflow)?;
        }

        ctx.accounts.market.next_order_id = ctx
            .accounts
            .market
            .next_order_id
            .checked_add(1)
            .ok_or(MatchingEngineError::MathOverflow)?;

        emit!(OrderPlacedEvent {
            order_id,
            owner: order.owner,
            market: order.market,
            side,
            price,
            quantity,
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Order #{} placed | side={:?} price={} qty={} expires_at={}",
            order_id,
            order.side,
            price,
            quantity,
            expires_at,
        );
        Ok(())
    }

    /// Match a compatible bid (buy) and ask (sell) order.
    ///
    /// - Validates price crossing: bid.price >= ask.price
    /// - Optional slippage guard: max_slippage_bps (0 = no limit)
    /// - Deducts protocol fee from seller payment → treasury
    /// - Transfers lamports from bid escrow: seller_net + fee + buyer_refund
    /// - is_locked guard prevents re-entrancy on same order
    /// - Anyone can call this (decentralized crank model)
    pub fn match_orders(
        ctx: Context<MatchOrders>,
        max_slippage_bps: u16,
    ) -> Result<()> {
        let clock = Clock::get()?;

        // ── Pause guard ─────────────────────────────────────────────────────
        require!(
            !ctx.accounts.market.is_paused,
            MatchingEngineError::MarketPaused
        );

        // ── Validate sides ───────────────────────────────────────────────────
        require!(
            ctx.accounts.bid_order.side == Side::Buy,
            MatchingEngineError::InvalidOrderSide
        );
        require!(
            ctx.accounts.ask_order.side == Side::Sell,
            MatchingEngineError::InvalidOrderSide
        );

        // ── Validate both orders are active ──────────────────────────────────
        require!(
            ctx.accounts.bid_order.is_active(),
            MatchingEngineError::OrderNotActive
        );
        require!(
            ctx.accounts.ask_order.is_active(),
            MatchingEngineError::OrderNotActive
        );

        // ── Re-entrancy locks ────────────────────────────────────────────────
        require!(
            !ctx.accounts.bid_order.is_locked,
            MatchingEngineError::OrderLocked
        );
        require!(
            !ctx.accounts.ask_order.is_locked,
            MatchingEngineError::OrderLocked
        );

        // ── TTL / Expiry check ────────────────────────────────────────────────
        require!(
            !ctx.accounts.bid_order.is_expired(clock.unix_timestamp),
            MatchingEngineError::OrderExpired
        );
        require!(
            !ctx.accounts.ask_order.is_expired(clock.unix_timestamp),
            MatchingEngineError::OrderExpired
        );

        // ── Same market ───────────────────────────────────────────────────────
        require!(
            ctx.accounts.bid_order.market == ctx.accounts.ask_order.market,
            MatchingEngineError::MarketMismatch
        );

        // ── Price crossing check ──────────────────────────────────────────────
        require!(
            ctx.accounts.bid_order.price >= ctx.accounts.ask_order.price,
            MatchingEngineError::PriceMismatch
        );

        // ── Optional slippage guard ───────────────────────────────────────────
        // Slippage = (bid_price - ask_price) / bid_price
        // Revert if it exceeds max_slippage_bps
        if max_slippage_bps > 0 && ctx.accounts.bid_order.price > 0 {
            let spread = ctx.accounts.bid_order.price
                .saturating_sub(ctx.accounts.ask_order.price);
            let slippage_bps = (spread as u128)
                .checked_mul(10_000)
                .unwrap_or(u128::MAX)
                .checked_div(ctx.accounts.bid_order.price as u128)
                .unwrap_or(u128::MAX) as u64;
            require!(
                slippage_bps <= max_slippage_bps as u64,
                MatchingEngineError::SlippageExceeded
            );
        }

        // ── Verify owner accounts ─────────────────────────────────────────────
        require!(
            ctx.accounts.bid_owner.key() == ctx.accounts.bid_order.owner,
            MatchingEngineError::BidOwnerMismatch
        );
        require!(
            ctx.accounts.ask_owner.key() == ctx.accounts.ask_order.owner,
            MatchingEngineError::AskOwnerMismatch
        );

        // ── Set re-entrancy locks ─────────────────────────────────────────────
        ctx.accounts.bid_order.is_locked = true;
        ctx.accounts.ask_order.is_locked = true;

        // ── Compute fill amounts ──────────────────────────────────────────────
        let fill_qty = ctx
            .accounts
            .bid_order
            .remaining_quantity()
            .min(ctx.accounts.ask_order.remaining_quantity());

        let fill_price = ctx.accounts.ask_order.price; // maker price

        let gross_seller_payment = fill_price
            .checked_mul(fill_qty)
            .ok_or(MatchingEngineError::MathOverflow)?;

        // ── Fee deduction ─────────────────────────────────────────────────────
        let fee_amount = if let Some(fee_config) = &ctx.accounts.fee_config {
            let fee = fee_config.calc_fee(gross_seller_payment);
            // Verify treasury account matches fee_config
            require!(
                ctx.accounts.treasury.key() == fee_config.treasury,
                MatchingEngineError::TreasuryMismatch
            );
            fee
        } else {
            0u64
        };

        let net_seller_payment = gross_seller_payment
            .checked_sub(fee_amount)
            .ok_or(MatchingEngineError::MathOverflow)?;

        // Price improvement refund to buyer
        let price_improvement = ctx
            .accounts
            .bid_order
            .price
            .checked_sub(ctx.accounts.ask_order.price)
            .ok_or(MatchingEngineError::MathOverflow)?;
        let buyer_refund = price_improvement
            .checked_mul(fill_qty)
            .ok_or(MatchingEngineError::MathOverflow)?;

        let total_debit = gross_seller_payment
            .checked_add(buyer_refund)
            .ok_or(MatchingEngineError::MathOverflow)?;

        // ── Transfer lamports from bid PDA ────────────────────────────────────
        // Debit bid_order escrow
        **ctx
            .accounts
            .bid_order
            .to_account_info()
            .try_borrow_mut_lamports()? -= total_debit;

        // Pay seller (net of fee)
        **ctx
            .accounts
            .ask_owner
            .to_account_info()
            .try_borrow_mut_lamports()? += net_seller_payment;

        // Refund buyer overpay (price improvement)
        **ctx
            .accounts
            .bid_owner
            .to_account_info()
            .try_borrow_mut_lamports()? += buyer_refund;

        // Send fee to treasury
        if fee_amount > 0 {
            **ctx
                .accounts
                .treasury
                .to_account_info()
                .try_borrow_mut_lamports()? += fee_amount;

            // Update accumulated_fees in FeeConfig
            if let Some(fee_config) = &mut ctx.accounts.fee_config {
                fee_config.accumulated_fees = fee_config
                    .accumulated_fees
                    .saturating_add(fee_amount);
            }
        }

        // ── Update fill state ─────────────────────────────────────────────────
        ctx.accounts.bid_order.filled_quantity += fill_qty;
        ctx.accounts.ask_order.filled_quantity += fill_qty;

        ctx.accounts.bid_order.status = if ctx.accounts.bid_order.filled_quantity
            >= ctx.accounts.bid_order.quantity
        {
            OrderStatus::Filled
        } else {
            OrderStatus::PartiallyFilled
        };

        ctx.accounts.ask_order.status = if ctx.accounts.ask_order.filled_quantity
            >= ctx.accounts.ask_order.quantity
        {
            OrderStatus::Filled
        } else {
            OrderStatus::PartiallyFilled
        };

        // ── Release re-entrancy locks ─────────────────────────────────────────
        ctx.accounts.bid_order.is_locked = false;
        ctx.accounts.ask_order.is_locked = false;

        emit!(TradeExecutedEvent {
            bid_order_id: ctx.accounts.bid_order.order_id,
            ask_order_id: ctx.accounts.ask_order.order_id,
            market: ctx.accounts.bid_order.market,
            buyer: ctx.accounts.bid_order.owner,
            seller: ctx.accounts.ask_order.owner,
            fill_price,
            fill_quantity: fill_qty,
            fee_amount,
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Trade: {} units @ {} lamports | bid#{} x ask#{} | fee={} lamports",
            fill_qty,
            fill_price,
            ctx.accounts.bid_order.order_id,
            ctx.accounts.ask_order.order_id,
            fee_amount,
        );
        Ok(())
    }

    /// Cancel an open or partially filled order.
    /// Refunds escrowed lamports to the buyer.
    /// NOTE: cancel_order is NOT affected by the market pause — users can always reclaim funds.
    pub fn cancel_order(ctx: Context<CancelOrder>, _order_id: u64) -> Result<()> {
        let order = &mut ctx.accounts.order;
        require!(order.is_active(), MatchingEngineError::OrderNotActive);
        require!(!order.is_locked, MatchingEngineError::OrderLocked);

        let mut refund_lamports: u64 = 0;
        if order.side == Side::Buy {
            refund_lamports = order
                .price
                .checked_mul(order.remaining_quantity())
                .ok_or(MatchingEngineError::MathOverflow)?;
            if refund_lamports > 0 {
                **order.to_account_info().try_borrow_mut_lamports()? -= refund_lamports;
                **ctx
                    .accounts
                    .owner
                    .to_account_info()
                    .try_borrow_mut_lamports()? += refund_lamports;
            }
        }

        // Update market volumes
        let remaining = order.remaining_quantity();
        if order.side == Side::Buy {
            ctx.accounts.market.total_bid_volume =
                ctx.accounts.market.total_bid_volume.saturating_sub(remaining);
        } else {
            ctx.accounts.market.total_ask_volume =
                ctx.accounts.market.total_ask_volume.saturating_sub(remaining);
        }

        let order_id = order.order_id;
        let owner = order.owner;
        let market_key = order.market;
        order.status = OrderStatus::Cancelled;

        emit!(OrderCancelledEvent {
            order_id,
            owner,
            market: market_key,
            refund_lamports,
        });

        msg!("Order #{} cancelled. Refund: {} lamports", order_id, refund_lamports);
        Ok(())
    }

    /// Close a Filled or Cancelled order PDA, returning rent to the owner.
    pub fn close_order(ctx: Context<CloseOrder>, _order_id: u64) -> Result<()> {
        let order = &ctx.accounts.order;
        require!(
            order.status == OrderStatus::Filled || order.status == OrderStatus::Cancelled,
            MatchingEngineError::OrderNotClosed
        );
        msg!(
            "Order #{} closed. Rent reclaimed to {}",
            order.order_id,
            ctx.accounts.owner.key()
        );
        Ok(())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Account Validation Contexts
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(market_name: String)]
pub struct InitializeMarket<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = Market::LEN,
        seeds = [b"market", authority.key().as_ref(), market_name.as_bytes()],
        bump,
    )]
    pub market: Account<'info, Market>,

    pub system_program: Program<'info, System>,
}

/// Context for authority-only market state changes (pause / resume).
#[derive(Accounts)]
pub struct AuthorityAction<'info> {
    #[account(
        constraint = authority.key() == market.authority @ MatchingEngineError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.authority.as_ref(), market.market_name.as_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct InitializeFeeConfig<'info> {
    #[account(
        mut,
        constraint = authority.key() == market.authority @ MatchingEngineError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"market", market.authority.as_ref(), market.market_name.as_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        init,
        payer = authority,
        space = FeeConfig::LEN,
        seeds = [b"fee_config", market.key().as_ref()],
        bump,
    )]
    pub fee_config: Account<'info, FeeConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateFeeConfig<'info> {
    #[account(
        constraint = authority.key() == market.authority @ MatchingEngineError::Unauthorized
    )]
    pub authority: Signer<'info>,

    #[account(
        seeds = [b"market", market.authority.as_ref(), market.market_name.as_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [b"fee_config", market.key().as_ref()],
        bump = fee_config.bump,
        constraint = fee_config.market == market.key() @ MatchingEngineError::TreasuryMismatch,
    )]
    pub fee_config: Account<'info, FeeConfig>,
}

#[derive(Accounts)]
#[instruction(side: Side, price: u64, quantity: u64, order_id: u64, expires_at: i64)]
pub struct PlaceOrder<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.authority.as_ref(), market.market_name.as_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        init,
        payer = owner,
        space = Order::LEN,
        seeds = [b"order", market.key().as_ref(), &order_id.to_le_bytes()],
        bump,
    )]
    pub order: Account<'info, Order>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MatchOrders<'info> {
    /// Matcher / crank — can be anyone (no authority restriction)
    pub matcher: Signer<'info>,

    /// The market account — must not be paused.
    #[account(
        seeds = [b"market", market.authority.as_ref(), market.market_name.as_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(mut)]
    pub bid_order: Account<'info, Order>,

    #[account(mut)]
    pub ask_order: Account<'info, Order>,

    /// CHECK: Verified in instruction body against bid_order.owner
    #[account(mut)]
    pub bid_owner: UncheckedAccount<'info>,

    /// CHECK: Verified in instruction body against ask_order.owner
    #[account(mut)]
    pub ask_owner: UncheckedAccount<'info>,

    /// Optional fee config PDA. If present, fee is deducted.
    /// Seeds: ["fee_config", market]
    #[account(
        mut,
        seeds = [b"fee_config", market.key().as_ref()],
        bump = fee_config.bump,
    )]
    pub fee_config: Option<Account<'info, FeeConfig>>,

    /// CHECK: Treasury account from fee_config. Verified in instruction body.
    #[account(mut)]
    pub treasury: UncheckedAccount<'info>,
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        mut,
        seeds = [b"market", market.authority.as_ref(), market.market_name.as_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        constraint = order.owner == owner.key() @ MatchingEngineError::Unauthorized,
        seeds = [b"order", market.key().as_ref(), &order_id.to_le_bytes()],
        bump = order.bump,
    )]
    pub order: Account<'info, Order>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct CloseOrder<'info> {
    /// The order owner receives the reclaimed rent.
    #[account(mut)]
    pub owner: Signer<'info>,

    #[account(
        seeds = [b"market", market.authority.as_ref(), market.market_name.as_bytes()],
        bump = market.bump,
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        close = owner,
        constraint = order.owner == owner.key() @ MatchingEngineError::Unauthorized,
        seeds = [b"order", market.key().as_ref(), &order_id.to_le_bytes()],
        bump = order.bump,
    )]
    pub order: Account<'info, Order>,

    pub system_program: Program<'info, System>,
}
