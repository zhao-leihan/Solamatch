#!/usr/bin/env ts-node
/**
 * Order Matching Engine — CLI Client
 * Connects to Solana Devnet and interacts with the on-chain program.
 *
 * Usage:
 *   npx ts-node cli.ts <command> [options]
 *
 * Commands:
 *   init-market       Initialize a new market
 *   place-order       Place a buy or sell order
 *   match             Match a bid and ask order
 *   cancel            Cancel an open order
 *   get-market        Show market info
 *   get-order         Show a specific order
 *   list-orders       List all orders for a market
 */

import * as anchor from "@coral-xyz/anchor";
import {
    Connection,
    Keypair,
    LAMPORTS_PER_SOL,
    PublicKey,
    SystemProgram,
} from "@solana/web3.js";
import { Command } from "commander";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ── IDL (paste your generated IDL here after `anchor build`) ─────────────────
// For demo purposes this is a minimal inline IDL matching our program.
const PROGRAM_ID = new PublicKey("77aLU4dN1NTAWVGhNcNgWFwQ5K9XwkFnEWMLjGWWZBDD");

const DEVNET_URL = "https://api.devnet.solana.com";

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadWallet(keyPath?: string): Keypair {
    const p = keyPath ?? path.join(os.homedir(), ".config", "solana", "id.json");
    if (!fs.existsSync(p)) {
        console.error(`Wallet not found at ${p}. Run: solana-keygen new`);
        process.exit(1);
    }
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function getProvider(wallet: Keypair, url = DEVNET_URL): anchor.AnchorProvider {
    const connection = new Connection(url, "confirmed");
    const anchorWallet = new anchor.Wallet(wallet);
    const provider = new anchor.AnchorProvider(connection, anchorWallet, {
        commitment: "confirmed",
    });
    anchor.setProvider(provider);
    return provider;
}

function getProgram(provider: anchor.AnchorProvider, idl: any): anchor.Program {
    return new anchor.Program(idl, provider);
}

function marketPda(authority: PublicKey, name: string, programId: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("market"), authority.toBuffer(), Buffer.from(name)],
        programId
    );
    return pda;
}

function orderPda(market: PublicKey, orderId: number, programId: PublicKey): PublicKey {
    const [pda] = PublicKey.findProgramAddressSync(
        [
            Buffer.from("order"),
            market.toBuffer(),
            Buffer.from(new anchor.BN(orderId).toArrayLike(Buffer, "le", 8)),
        ],
        programId
    );
    return pda;
}

function explorerUrl(sig: string): string {
    return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

function loadIdl(): any {
    const idlPath = path.join(__dirname, "..", "target", "idl", "order_matching_engine.json");
    if (!fs.existsSync(idlPath)) {
        console.error("IDL not found. Run `anchor build` first.");
        process.exit(1);
    }
    return JSON.parse(fs.readFileSync(idlPath, "utf-8"));
}

function formatLamports(lamports: number): string {
    return `${lamports} lamports (${(lamports / LAMPORTS_PER_SOL).toFixed(6)} SOL)`;
}

// ── CLI Program ───────────────────────────────────────────────────────────────

const cli = new Command()
    .name("order-matching-engine")
    .description("Solana On-Chain Order Matching Engine CLI")
    .version("1.0.0")
    .option("-k, --keypair <path>", "Solana keypair path")
    .option("-u, --url <url>", "RPC URL", DEVNET_URL);

// ── init-market ───────────────────────────────────────────────────────────────
cli
    .command("init-market")
    .description("Initialize a new order book market")
    .requiredOption("-n, --name <name>", "Market name (e.g. SOL/MOCK)")
    .action(async (opts) => {
        const parent = cli.opts();
        const wallet = loadWallet(parent.keypair);
        const provider = getProvider(wallet, parent.url);
        const idl = loadIdl();
        const program = getProgram(provider, idl);

        const mktPda = marketPda(wallet.publicKey, opts.name, PROGRAM_ID);

        console.log(`\n🏪 Initializing market "${opts.name}"...`);
        console.log(`  Market PDA : ${mktPda.toBase58()}`);

        const tx = await program.methods
            .initializeMarket(opts.name)
            .accounts({
                authority: wallet.publicKey,
                market: mktPda,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        console.log(`  ✅ Tx: ${explorerUrl(tx)}`);
        console.log(`  Market PDA (save this!): ${mktPda.toBase58()}`);
    });

// ── place-order ───────────────────────────────────────────────────────────────
cli
    .command("place-order")
    .description("Place a buy or sell order")
    .requiredOption("-m, --market <pda>", "Market PDA address")
    .requiredOption("-s, --side <side>", "Order side: buy | sell")
    .requiredOption("-p, --price <n>", "Price in lamports per unit")
    .requiredOption("-q, --quantity <n>", "Quantity in units")
    .action(async (opts) => {
        const parent = cli.opts();
        const wallet = loadWallet(parent.keypair);
        const provider = getProvider(wallet, parent.url);
        const idl = loadIdl();
        const program = getProgram(provider, idl);

        const mktPda = new PublicKey(opts.market);
        const market = await program.account.market.fetch(mktPda);
        const orderId = (market.nextOrderId as anchor.BN).toNumber();

        const odrPda = orderPda(mktPda, orderId, PROGRAM_ID);
        const side = opts.side === "buy" ? { buy: {} } : { sell: {} };
        const price = new anchor.BN(parseInt(opts.price));
        const quantity = new anchor.BN(parseInt(opts.quantity));

        const escrow = opts.side === "buy" ? price.toNumber() * quantity.toNumber() : 0;

        console.log(`\n📋 Placing ${opts.side.toUpperCase()} order #${orderId}...`);
        console.log(`  Price    : ${formatLamports(price.toNumber())} / unit`);
        console.log(`  Quantity : ${quantity.toString()} units`);
        if (escrow > 0) console.log(`  Escrow   : ${formatLamports(escrow)}`);
        console.log(`  Order PDA: ${odrPda.toBase58()}`);

        const tx = await program.methods
            .placeOrder(side, price, quantity, new anchor.BN(orderId))
            .accounts({
                owner: wallet.publicKey,
                market: mktPda,
                order: odrPda,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        console.log(`  ✅ Tx: ${explorerUrl(tx)}`);
        console.log(`  Order #${orderId} PDA (save this!): ${odrPda.toBase58()}`);
    });

// ── match ─────────────────────────────────────────────────────────────────────
cli
    .command("match")
    .description("Match a bid and ask order (price-time priority)")
    .requiredOption("-b, --bid <pda>", "Bid (buy) order PDA")
    .requiredOption("-a, --ask <pda>", "Ask (sell) order PDA")
    .action(async (opts) => {
        const parent = cli.opts();
        const wallet = loadWallet(parent.keypair);
        const provider = getProvider(wallet, parent.url);
        const idl = loadIdl();
        const program = getProgram(provider, idl);

        const bidPda = new PublicKey(opts.bid);
        const askPda = new PublicKey(opts.ask);

        const bid = await program.account.order.fetch(bidPda);
        const ask = await program.account.order.fetch(askPda);

        console.log("\n⚡ Matching orders...");
        console.log(`  BID #${bid.orderId}: price=${bid.price} qty=${bid.quantity} remaining=${bid.quantity.sub(bid.filledQuantity)}`);
        console.log(`  ASK #${ask.orderId}: price=${ask.price} qty=${ask.quantity} remaining=${ask.quantity.sub(ask.filledQuantity)}`);

        if (bid.price.toNumber() < ask.price.toNumber()) {
            console.error(`  ❌ Price mismatch: bid (${bid.price}) < ask (${ask.price})`);
            process.exit(1);
        }

        const tx = await program.methods
            .matchOrders()
            .accounts({
                matcher: wallet.publicKey,
                bidOrder: bidPda,
                askOrder: askPda,
                bidOwner: bid.owner,
                askOwner: ask.owner,
            })
            .rpc();

        const fillQty = Math.min(
            bid.quantity.sub(bid.filledQuantity).toNumber(),
            ask.quantity.sub(ask.filledQuantity).toNumber()
        );

        console.log(`  ✅ Matched ${fillQty} units @ ${ask.price.toString()} lamports each`);
        console.log(`  ✅ Tx: ${explorerUrl(tx)}`);
    });

// ── cancel ────────────────────────────────────────────────────────────────────
cli
    .command("cancel")
    .description("Cancel an open order and get refund")
    .requiredOption("-m, --market <pda>", "Market PDA address")
    .requiredOption("-i, --order-id <n>", "Order ID number")
    .action(async (opts) => {
        const parent = cli.opts();
        const wallet = loadWallet(parent.keypair);
        const provider = getProvider(wallet, parent.url);
        const idl = loadIdl();
        const program = getProgram(provider, idl);

        const mktPda = new PublicKey(opts.market);
        const ordId = parseInt(opts.orderId);
        const odrPda = orderPda(mktPda, ordId, PROGRAM_ID);

        const order = await program.account.order.fetch(odrPda);
        const refundAmount =
            "buy" in order.side
                ? order.price.toNumber() * order.quantity.sub(order.filledQuantity).toNumber()
                : 0;

        console.log(`\n🗑️  Cancelling order #${ordId}...`);
        if (refundAmount > 0) {
            console.log(`  Expected refund: ${formatLamports(refundAmount)}`);
        }

        const tx = await program.methods
            .cancelOrder(new anchor.BN(ordId))
            .accounts({
                owner: wallet.publicKey,
                market: mktPda,
                order: odrPda,
                systemProgram: SystemProgram.programId,
            })
            .rpc();

        console.log(`  ✅ Order cancelled. Tx: ${explorerUrl(tx)}`);
    });

// ── get-market ────────────────────────────────────────────────────────────────
cli
    .command("get-market")
    .description("Show market info")
    .requiredOption("-m, --market <pda>", "Market PDA address")
    .action(async (opts) => {
        const parent = cli.opts();
        const wallet = loadWallet(parent.keypair);
        const provider = getProvider(wallet, parent.url);
        const idl = loadIdl();
        const program = getProgram(provider, idl);

        const mktPda = new PublicKey(opts.market);
        const market = await program.account.market.fetch(mktPda);

        console.log("\n📊 Market Info");
        console.log("─".repeat(40));
        console.log(`  Name          : ${market.marketName}`);
        console.log(`  Authority     : ${market.authority.toBase58()}`);
        console.log(`  Next Order ID : ${market.nextOrderId.toString()}`);
        console.log(`  Bid Volume    : ${market.totalBidVolume.toString()} units`);
        console.log(`  Ask Volume    : ${market.totalAskVolume.toString()} units`);
    });

// ── get-order ─────────────────────────────────────────────────────────────────
cli
    .command("get-order")
    .description("Show a specific order")
    .requiredOption("-m, --market <pda>", "Market PDA address")
    .requiredOption("-i, --order-id <n>", "Order ID number")
    .action(async (opts) => {
        const parent = cli.opts();
        const wallet = loadWallet(parent.keypair);
        const provider = getProvider(wallet, parent.url);
        const idl = loadIdl();
        const program = getProgram(provider, idl);

        const mktPda = new PublicKey(opts.market);
        const ordId = parseInt(opts.orderId);
        const odrPda = orderPda(mktPda, ordId, PROGRAM_ID);
        const order = await program.account.order.fetch(odrPda);

        const side = "buy" in order.side ? "BUY" : "SELL";
        const status = Object.keys(order.status)[0].toUpperCase();
        const remaining = order.quantity.sub(order.filledQuantity);

        console.log(`\n📋 Order #${ordId}`);
        console.log("─".repeat(40));
        console.log(`  Owner     : ${order.owner.toBase58()}`);
        console.log(`  Side      : ${side}`);
        console.log(`  Price     : ${order.price.toString()} lamports/unit`);
        console.log(`  Quantity  : ${order.quantity.toString()} units`);
        console.log(`  Filled    : ${order.filledQuantity.toString()} units`);
        console.log(`  Remaining : ${remaining.toString()} units`);
        console.log(`  Status    : ${status}`);
        console.log(`  Timestamp : ${new Date(order.timestamp.toNumber() * 1000).toISOString()}`);
        console.log(`  PDA       : ${odrPda.toBase58()}`);
    });

// ── list-orders ───────────────────────────────────────────────────────────────
cli
    .command("list-orders")
    .description("List all orders for a market")
    .requiredOption("-m, --market <pda>", "Market PDA address")
    .option("--status <s>", "Filter by status: open|filled|cancelled|partiallyFilled")
    .action(async (opts) => {
        const parent = cli.opts();
        const wallet = loadWallet(parent.keypair);
        const provider = getProvider(wallet, parent.url);
        const idl = loadIdl();
        const program = getProgram(provider, idl);

        const mktPda = new PublicKey(opts.market);
        const market = await program.account.market.fetch(mktPda);
        const total = (market.nextOrderId as anchor.BN).toNumber();

        console.log(`\n📋 Orders for market ${opts.market.slice(0, 8)}... (total: ${total})`);
        console.log("─".repeat(70));
        console.log(
            " ID  │ SIDE │ PRICE      │ QTY │ FILLED │ STATUS"
        );
        console.log("─".repeat(70));

        for (let i = 0; i < total; i++) {
            const odrPda = orderPda(mktPda, i, PROGRAM_ID);
            try {
                const order = await program.account.order.fetch(odrPda);
                const side = "buy" in order.side ? " BUY" : "SELL";
                const status = Object.keys(order.status)[0];

                if (opts.status && status !== opts.status) continue;

                console.log(
                    ` ${String(i).padEnd(3)} │ ${side} │ ${String(order.price).padEnd(10)} │ ${String(order.quantity).padEnd(3)} │ ${String(order.filledQuantity).padEnd(6)} │ ${status}`
                );
            } catch {
                // order account may not exist if id was skipped
            }
        }
        console.log("─".repeat(70));
    });

cli.parse(process.argv);
