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

        msg!("Market '{}' initialized.", market_name);
        Ok(())
    }

    /// Place a buy or sell order.
    /// - BUY: escrows (price * quantity) lamports in the Order PDA.
    /// - SELL: no lamport escrow; records the intent on-chain.
    /// Seeds: ["order", market, order_id_le]
    pub fn place_order(
        ctx: Context<PlaceOrder>,
        side: Side,
        price: u64,
        quantity: u64,
        order_id: u64,
    ) -> Result<()> {
        require!(price > 0, MatchingEngineError::InvalidPrice);
        require!(quantity > 0, MatchingEngineError::InvalidQuantity);
        require!(
            order_id == ctx.accounts.market.next_order_id,
            MatchingEngineError::InvalidOrderId
        );

        let clock = Clock::get()?;

        // ── Pre-capture keys before any mutable borrow ────────────────────────
        let owner_key = ctx.accounts.owner.key();
        let market_key = ctx.accounts.market.key();
        let order_bump = ctx.bumps.order;

        // ── Escrow CPI BEFORE mutable borrow of `order` ──────────────────────
        // (Rust borrow checker: can't hold &mut order while also calling
        //  ctx.accounts.order.to_account_info() for the CPI destination)
        if side == Side::Buy {
            let escrow_lamports = price
                .checked_mul(quantity)
                .ok_or(MatchingEngineError::MathOverflow)?;
            system_program::transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    system_program::Transfer {
                        from: ctx.accounts.owner.to_account_info(),
                        to: ctx.accounts.order.to_account_info(), // OK: no &mut order yet
                    },
                ),
                escrow_lamports,
            )?;
        }

        // ── Populate Order account fields ─────────────────────────────────────
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

        // ── Update market volumes ─────────────────────────────────────────────
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
            "Order #{} placed | side={:?} price={} qty={}",
            order_id,
            order.side,
            price,
            quantity
        );
        Ok(())
    }

    /// Match a compatible bid (buy) and ask (sell) order.
    /// Validates price: bid.price >= ask.price.
    /// Transfers lamports from bid escrow → seller, refunds price improvement → buyer.
    /// Anyone can call this (decentralized matching / crank).
    pub fn match_orders(ctx: Context<MatchOrders>) -> Result<()> {
        // ── Validate sides
        require!(
            ctx.accounts.bid_order.side == Side::Buy,
            MatchingEngineError::InvalidOrderSide
        );
        require!(
            ctx.accounts.ask_order.side == Side::Sell,
            MatchingEngineError::InvalidOrderSide
        );
        // ── Validate both orders are active
        require!(
            ctx.accounts.bid_order.is_active(),
            MatchingEngineError::OrderNotActive
        );
        require!(
            ctx.accounts.ask_order.is_active(),
            MatchingEngineError::OrderNotActive
        );
        // ── Same market
        require!(
            ctx.accounts.bid_order.market == ctx.accounts.ask_order.market,
            MatchingEngineError::MarketMismatch
        );
        // ── Price crossing check
        require!(
            ctx.accounts.bid_order.price >= ctx.accounts.ask_order.price,
            MatchingEngineError::PriceMismatch
        );
        // ── Verify owner accounts
        require!(
            ctx.accounts.bid_owner.key() == ctx.accounts.bid_order.owner,
            MatchingEngineError::BidOwnerMismatch
        );
        require!(
            ctx.accounts.ask_owner.key() == ctx.accounts.ask_order.owner,
            MatchingEngineError::AskOwnerMismatch
        );

        let fill_qty = ctx
            .accounts
            .bid_order
            .remaining_quantity()
            .min(ctx.accounts.ask_order.remaining_quantity());

        let fill_price = ctx.accounts.ask_order.price; // maker price

        let seller_payment = fill_price
            .checked_mul(fill_qty)
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

        let total_debit = seller_payment
            .checked_add(buyer_refund)
            .ok_or(MatchingEngineError::MathOverflow)?;

        // Transfer lamports: bid_order PDA → seller and buyer
        **ctx
            .accounts
            .bid_order
            .to_account_info()
            .try_borrow_mut_lamports()? -= total_debit;
        **ctx
            .accounts
            .ask_owner
            .to_account_info()
            .try_borrow_mut_lamports()? += seller_payment;
        **ctx
            .accounts
            .bid_owner
            .to_account_info()
            .try_borrow_mut_lamports()? += buyer_refund;

        // Update fill state
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

        let clock = Clock::get()?;
        emit!(TradeExecutedEvent {
            bid_order_id: ctx.accounts.bid_order.order_id,
            ask_order_id: ctx.accounts.ask_order.order_id,
            market: ctx.accounts.bid_order.market,
            buyer: ctx.accounts.bid_order.owner,
            seller: ctx.accounts.ask_order.owner,
            fill_price,
            fill_quantity: fill_qty,
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "Trade: {} units @ {} lamports | bid#{} x ask#{}",
            fill_qty,
            fill_price,
            ctx.accounts.bid_order.order_id,
            ctx.accounts.ask_order.order_id
        );
        Ok(())
    }

    /// Cancel an open or partially filled order.
    /// Refunds escrowed lamports to the buyer.
    pub fn cancel_order(ctx: Context<CancelOrder>, _order_id: u64) -> Result<()> {
        let order = &mut ctx.accounts.order;
        require!(order.is_active(), MatchingEngineError::OrderNotActive);

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
    /// This keeps the on-chain state clean and recovers the ~0.002 SOL rent-deposit
    /// that was locked when the order was created.
    pub fn close_order(ctx: Context<CloseOrder>, _order_id: u64) -> Result<()> {
        let order = &ctx.accounts.order;
        require!(
            order.status == OrderStatus::Filled || order.status == OrderStatus::Cancelled,
            MatchingEngineError::OrderNotClosed
        );
        // Anchor's `close = owner` constraint in CloseOrder automatically transfers
        // all lamports to `owner` and zeroes the account data, marking it as closed.
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

#[derive(Accounts)]
#[instruction(side: Side, price: u64, quantity: u64, order_id: u64)]
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

    /// `close = owner` automatically transfers all lamports to `owner`
    /// and zeroes the account, making it available for garbage collection.
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
