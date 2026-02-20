import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorError } from "@coral-xyz/anchor";
import { OrderMatchingEngine } from "../target/types/order_matching_engine";
import {
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
} from "@solana/web3.js";
import { assert } from "chai";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const program = anchor.workspace.OrderMatchingEngine as Program<OrderMatchingEngine>;
const provider = anchor.AnchorProvider.env();
anchor.setProvider(provider);

async function airdrop(pk: PublicKey, sol = 2) {
    const sig = await provider.connection.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
    await provider.connection.confirmTransaction(sig, "confirmed");
}

function marketPda(authority: PublicKey, name: string): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
        [Buffer.from("market"), authority.toBuffer(), Buffer.from(name)],
        program.programId
    );
}

function orderPda(market: PublicKey, orderId: number): [PublicKey, number] {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(BigInt(orderId));
    return PublicKey.findProgramAddressSync(
        [Buffer.from("order"), market.toBuffer(), buf],
        program.programId
    );
}

// ─────────────────────────────────────────────────────────────────────────────

describe("Order Matching Engine", () => {
    const MARKET_NAME = "SOL/MOCK";
    const authority = provider.wallet;
    const buyer = Keypair.generate();
    const seller = Keypair.generate();
    const stranger = Keypair.generate();

    let [mktPda] = marketPda(authority.publicKey, MARKET_NAME);
    let bidPda: PublicKey, askPda: PublicKey;

    before(async () => {
        await airdrop(buyer.publicKey, 5);
        await airdrop(seller.publicKey, 5);
        await airdrop(stranger.publicKey, 2);
    });

    // ── 1. Initialize Market ─────────────────────────────────────────────────────
    it("Initializes a market", async () => {
        await program.methods
            .initializeMarket(MARKET_NAME)
            .accounts({
                authority: authority.publicKey,
                market: mktPda,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        const mkt = await program.account.market.fetch(mktPda);
        assert.equal(mkt.marketName, MARKET_NAME);
        assert.equal(mkt.nextOrderId.toNumber(), 0);
        assert.equal(mkt.totalBidVolume.toNumber(), 0);
        assert.equal(mkt.totalAskVolume.toNumber(), 0);
    });

    // ── 2. Place BUY order ───────────────────────────────────────────────────────
    it("Places a BUY order and escrows lamports in the Order PDA", async () => {
        const [oPda] = orderPda(mktPda, 0);
        bidPda = oPda;

        const beforeBal = await provider.connection.getBalance(buyer.publicKey);

        await program.methods
            .placeOrder({ buy: {} }, new anchor.BN(100_000), new anchor.BN(5), new anchor.BN(0))
            .accounts({
                owner: buyer.publicKey,
                market: mktPda,
                order: oPda,
                systemProgram: SystemProgram.programId,
            })
            .signers([buyer])
            .rpc();

        const order = await program.account.order.fetch(oPda);
        assert.equal(order.side.buy !== undefined, true, "side should be buy");
        assert.equal(order.price.toNumber(), 100_000);
        assert.equal(order.quantity.toNumber(), 5);
        assert.equal(order.filledQuantity.toNumber(), 0);
        assert.ok(order.status.open !== undefined, "status should be open");

        // Verify escrow: Order PDA should hold price * qty lamports
        const pdaBal = await provider.connection.getBalance(oPda);
        const escrow = 100_000 * 5; // 500_000 lamports
        assert.isAtLeast(pdaBal, escrow, "Order PDA should hold escrowed lamports");

        // Buyer balance should have decreased
        const afterBal = await provider.connection.getBalance(buyer.publicKey);
        assert.isBelow(afterBal, beforeBal, "Buyer balance should decrease after escrow");

        const mkt = await program.account.market.fetch(mktPda);
        assert.equal(mkt.totalBidVolume.toNumber(), 5);
        assert.equal(mkt.nextOrderId.toNumber(), 1);
    });

    // ── 3. Place SELL order ──────────────────────────────────────────────────────
    it("Places a SELL order (no escrow required)", async () => {
        const [oPda] = orderPda(mktPda, 1);
        askPda = oPda;

        const beforeBal = await provider.connection.getBalance(seller.publicKey);

        await program.methods
            .placeOrder({ sell: {} }, new anchor.BN(99_000), new anchor.BN(5), new anchor.BN(1))
            .accounts({
                owner: seller.publicKey,
                market: mktPda,
                order: oPda,
                systemProgram: SystemProgram.programId,
            })
            .signers([seller])
            .rpc();

        const order = await program.account.order.fetch(oPda);
        assert.ok(order.side.sell !== undefined, "side should be sell");
        assert.equal(order.price.toNumber(), 99_000);

        // Seller balance should only decrease by rent (no escrow)
        const afterBal = await provider.connection.getBalance(seller.publicKey);
        const diff = beforeBal - afterBal;
        // Rent for 115 bytes ≈ 0.0016 SOL, no escrow
        assert.isBelow(diff, 3_000_000, "Seller should only pay rent, not escrow");

        const mkt = await program.account.market.fetch(mktPda);
        assert.equal(mkt.totalAskVolume.toNumber(), 5);
    });

    // ── 4. Match orders ──────────────────────────────────────────────────────────
    it("Matches bid and ask: transfers lamports and emits event", async () => {
        const sellerBefore = await provider.connection.getBalance(seller.publicKey);
        const buyerBefore = await provider.connection.getBalance(buyer.publicKey);

        const tx = await program.methods
            .matchOrders()
            .accounts({
                matcher: authority.publicKey,
                bidOrder: bidPda,
                askOrder: askPda,
                bidOwner: buyer.publicKey,
                askOwner: seller.publicKey,
            })
            .rpc();

        // Verify fill state
        const bid = await program.account.order.fetch(bidPda);
        const ask = await program.account.order.fetch(askPda);
        assert.equal(bid.filledQuantity.toNumber(), 5);
        assert.equal(ask.filledQuantity.toNumber(), 5);
        assert.ok(bid.status.filled !== undefined, "bid should be Filled");
        assert.ok(ask.status.filled !== undefined, "ask should be Filled");

        // Seller receives fill_qty * ask_price = 5 * 99_000 = 495_000 lamports
        const sellerAfter = await provider.connection.getBalance(seller.publicKey);
        assert.isAbove(sellerAfter, sellerBefore, "Seller balance should increase");

        // Buyer receives price improvement refund = (100_000 - 99_000) * 5 = 5_000 lamports
        const buyerAfter = await provider.connection.getBalance(buyer.publicKey);
        assert.isAbove(buyerAfter, buyerBefore, "Buyer should receive price improvement refund");
    });

    // ── 5. Reject price mismatch ─────────────────────────────────────────────────
    it("Rejects a match when bid price < ask price", async () => {
        // Place new bid @80k, ask @90k → bid < ask → should fail
        const [bid2] = orderPda(mktPda, 2);
        const [ask2] = orderPda(mktPda, 3);

        await program.methods
            .placeOrder({ buy: {} }, new anchor.BN(80_000), new anchor.BN(1), new anchor.BN(2))
            .accounts({ owner: buyer.publicKey, market: mktPda, order: bid2, systemProgram: SystemProgram.programId })
            .signers([buyer]).rpc();

        await program.methods
            .placeOrder({ sell: {} }, new anchor.BN(90_000), new anchor.BN(1), new anchor.BN(3))
            .accounts({ owner: seller.publicKey, market: mktPda, order: ask2, systemProgram: SystemProgram.programId })
            .signers([seller]).rpc();

        try {
            await program.methods.matchOrders()
                .accounts({ matcher: authority.publicKey, bidOrder: bid2, askOrder: ask2, bidOwner: buyer.publicKey, askOwner: seller.publicKey })
                .rpc();
            assert.fail("Expected PriceMismatch error");
        } catch (err: any) {
            assert.include(err.message, "PriceMismatch");
        }
    });

    // ── 6. Cancel order with refund ──────────────────────────────────────────────
    it("Cancels a BUY order and returns escrowed lamports", async () => {
        const [bid2] = orderPda(mktPda, 2);
        const buyerBefore = await provider.connection.getBalance(buyer.publicKey);

        await program.methods
            .cancelOrder(new anchor.BN(2))
            .accounts({ owner: buyer.publicKey, market: mktPda, order: bid2, systemProgram: SystemProgram.programId })
            .signers([buyer]).rpc();

        const order = await program.account.order.fetch(bid2);
        assert.ok(order.status.cancelled !== undefined, "status should be Cancelled");

        const buyerAfter = await provider.connection.getBalance(buyer.publicKey);
        assert.isAbove(buyerAfter, buyerBefore, "Refund should return escrowed lamports");
    });

    // ── 7. Reject double-match (already filled) ──────────────────────────────────
    it("Rejects matching an already-filled order", async () => {
        // bidPda and askPda are already Filled from test #4
        try {
            await program.methods.matchOrders()
                .accounts({ matcher: authority.publicKey, bidOrder: bidPda, askOrder: askPda, bidOwner: buyer.publicKey, askOwner: seller.publicKey })
                .rpc();
            assert.fail("Expected OrderNotActive error");
        } catch (err: any) {
            assert.include(err.message, "OrderNotActive");
        }
    });

    // ── 8. Reject cross-market match ─────────────────────────────────────────────
    it("Rejects a match between orders from different markets", async () => {
        // Create a second market
        const market2Name = "ETH/MOCK";
        const [mkt2] = marketPda(authority.publicKey, market2Name);
        await program.methods.initializeMarket(market2Name)
            .accounts({ authority: authority.publicKey, market: mkt2, systemProgram: SystemProgram.programId })
            .rpc();

        const [foreignAsk] = orderPda(mkt2, 0);
        await program.methods
            .placeOrder({ sell: {} }, new anchor.BN(95_000), new anchor.BN(1), new anchor.BN(0))
            .accounts({ owner: seller.publicKey, market: mkt2, order: foreignAsk, systemProgram: SystemProgram.programId })
            .signers([seller]).rpc();

        // bid from mktPda (order #3), ask from mkt2 → MarketMismatch
        const [bid3] = orderPda(mktPda, 3);
        try {
            await program.methods.matchOrders()
                .accounts({ matcher: authority.publicKey, bidOrder: bid3, askOrder: foreignAsk, bidOwner: seller.publicKey, askOwner: seller.publicKey })
                .rpc();
            assert.fail("Expected MarketMismatch error");
        } catch (err: any) {
            const msg = err.message ?? "";
            assert.ok(
                msg.includes("MarketMismatch") || msg.includes("AnchorError") || msg.includes("0x"),
                `Expected MarketMismatch, got: ${msg}`
            );
        }
    });

    // ── 9. Reject unauthorized cancel ────────────────────────────────────────────
    it("Rejects cancel by a non-owner (stranger)", async () => {
        // ask order #3 is still open
        const [ask3] = orderPda(mktPda, 3);
        try {
            await program.methods
                .cancelOrder(new anchor.BN(3))
                .accounts({ owner: stranger.publicKey, market: mktPda, order: ask3, systemProgram: SystemProgram.programId })
                .signers([stranger]).rpc();
            assert.fail("Expected Unauthorized error");
        } catch (err: any) {
            const msg = err.message ?? "";
            assert.ok(
                msg.includes("Unauthorized") || msg.includes("ConstraintRaw") || msg.includes("2003"),
                `Expected Unauthorized, got: ${msg}`
            );
        }
    });

    // ── 10. Close filled order, reclaim rent ─────────────────────────────────────
    it("Closes a Filled order PDA and reclaims rent to owner", async () => {
        // bidPda (order #0) is Filled from test #4
        const ownerBefore = await provider.connection.getBalance(buyer.publicKey);

        await program.methods
            .closeOrder(new anchor.BN(0))
            .accounts({
                owner: buyer.publicKey,
                market: mktPda,
                order: bidPda,
                systemProgram: SystemProgram.programId,
            })
            .signers([buyer])
            .rpc();

        // Account should be gone (null info)
        const info = await provider.connection.getAccountInfo(bidPda);
        assert.isNull(info, "Order PDA should be closed (null account info)");

        // Owner should have received rent back
        const ownerAfter = await provider.connection.getBalance(buyer.publicKey);
        assert.isAbove(ownerAfter, ownerBefore, "Rent should be returned to owner");
    });
});
