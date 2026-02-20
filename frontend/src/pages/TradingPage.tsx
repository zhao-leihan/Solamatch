import { useState, useCallback, useEffect } from "react";
import logoImg from "../../assets/logo solana.png";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PublicKey } from "@solana/web3.js";
import {
    Box, Flex, Grid, Text, Heading, Badge, Button,
    Card, Table, TextField, Separator, IconButton, Spinner,
} from "@radix-ui/themes";
import {
    ExitIcon, UpdateIcon, LightningBoltIcon,
    ArrowUpIcon, ArrowDownIcon, ActivityLogIcon,
} from "@radix-ui/react-icons";

// ─── Constants ────────────────────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey("77aLU4dN1NTAWVGhNcNgWFwQ5K9XwkFnEWMLjGWWZBDD");
const DEFAULT_MARKET = "38tZpV4CGQWuKbL4po8tiNkTP2L8e7xcbyHGNBVf7Jwf";

// Order account layout byte sizes (must match state.rs Order::LEN = 115)
// 8 discriminator | 32 owner | 32 market | 8 order_id | 1 side |
// 8 price | 8 quantity | 8 filled_qty | 1 status | 8 timestamp | 1 bump
const ORDER_LEN = 115;

// ─── Types ────────────────────────────────────────────────────────────────────
type Side = "buy" | "sell";
const STATUS_MAP = ["open", "partiallyFilled", "filled", "cancelled"] as const;
type Status = typeof STATUS_MAP[number];

interface Order {
    orderId: number; side: Side; price: number;
    quantity: number; filledQuantity: number; status: Status;
    owner: string; timestamp: number;
}

interface Trade {
    bidOrderId: number; askOrderId: number;
    fillPrice: number; fillQuantity: number; timestamp: number;
}

interface MarketInfo {
    marketName: string; nextOrderId: number;
    totalBidVolume: number; totalAskVolume: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function shortKey(k: string) { return `${k.slice(0, 4)}…${k.slice(-4)}`; }

/** Parse a raw Order account buffer (after discriminator) into an Order object */
function parseOrderAccount(data: Buffer): Order | null {
    try {
        let off = 8; // skip 8-byte discriminator
        const owner = new PublicKey(data.slice(off, off + 32)).toBase58(); off += 32;
        off += 32; // market pubkey
        const orderId = Number(data.readBigUInt64LE(off)); off += 8;
        const sideNum = data[off]; off += 1;
        const price = Number(data.readBigUInt64LE(off)); off += 8;
        const quantity = Number(data.readBigUInt64LE(off)); off += 8;
        const filledQuantity = Number(data.readBigUInt64LE(off)); off += 8;
        const statusNum = data[off]; off += 1;
        const timestamp = Number(data.readBigInt64LE(off));
        return {
            orderId, owner,
            side: sideNum === 0 ? "buy" : "sell",
            price, quantity, filledQuantity,
            status: STATUS_MAP[statusNum] ?? "open",
            timestamp,
        };
    } catch { return null; }
}

/**
 * Parse trade history from recent program transaction logs.
 * Looks for: "Program log: Trade: {qty} units @ {price} lamports | bid#{bid} x ask#{ask}"
 */
function parseTradesFromLogs(logs: string[], timestamp: number): Trade | null {
    for (const log of logs) {
        const m = log.match(/Trade:\s*(\d+)\s*units\s*@\s*(\d+)\s*lamports\s*\|\s*bid#(\d+)\s*x\s*ask#(\d+)/);
        if (m) {
            return {
                fillQuantity: Number(m[1]),
                fillPrice: Number(m[2]),
                bidOrderId: Number(m[3]),
                askOrderId: Number(m[4]),
                timestamp,
            };
        }
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────────────
export default function TradingPage() {
    const { publicKey, disconnect } = useWallet();
    const { connection } = useConnection();

    const [marketAddr, setMarketAddr] = useState(DEFAULT_MARKET);
    const [market, setMarket] = useState<MarketInfo | null>(null);
    const [bids, setBids] = useState<Order[]>([]);
    const [asks, setAsks] = useState<Order[]>([]);
    const [allOrders, setAllOrders] = useState<Order[]>([]);
    const [trades, setTrades] = useState<Trade[]>([]);
    const [side, setSide] = useState<Side>("buy");
    const [price, setPrice] = useState("");
    const [qty, setQty] = useState("");
    const [loading, setLoading] = useState(false);
    const [fetching, setFetching] = useState(false);
    const [solBalance, setSolBalance] = useState<number | null>(null);
    const [toast, setToast] = useState<{ msg: string; type: "ok" | "err" } | null>(null);

    const showToast = (msg: string, type: "ok" | "err" = "ok") => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 5000);
    };

    // ── Fetch Market info ───────────────────────────────────────────────────────
    const fetchMarket = useCallback(async () => {
        if (!marketAddr || marketAddr.length < 32) return;
        try {
            setFetching(true);
            const info = await connection.getAccountInfo(new PublicKey(marketAddr));
            if (!info) { showToast("Market not found", "err"); return; }
            const data = info.data as Buffer;
            let off = 8 + 32; // discriminator + authority
            const nameLen = data.readUInt32LE(off); off += 4;
            const name = data.slice(off, off + nameLen).toString("utf8"); off += nameLen;
            const nextOrderId = Number(data.readBigUInt64LE(off)); off += 8;
            const totalBidVolume = Number(data.readBigUInt64LE(off)); off += 8;
            const totalAskVolume = Number(data.readBigUInt64LE(off));
            setMarket({ marketName: name, nextOrderId, totalBidVolume, totalAskVolume });
        } catch (e: any) { showToast(e.message, "err"); }
        finally { setFetching(false); }
    }, [marketAddr, connection]);

    // ── Fetch all orders for the market via getProgramAccounts ─────────────────
    const fetchOrders = useCallback(async () => {
        if (!marketAddr || marketAddr.length < 32) return;
        try {
            const mktPk = new PublicKey(marketAddr);

            const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
                filters: [
                    { dataSize: ORDER_LEN },
                    // market field starts at offset 8 (discriminator) + 32 (owner) = 40
                    { memcmp: { offset: 40, bytes: mktPk.toBase58() } },
                ],
            });

            const parsed: Order[] = accounts
                .map(({ account }) => parseOrderAccount(account.data as Buffer))
                .filter((o): o is Order => o !== null);

            setAllOrders(parsed);

            const active = parsed.filter(
                o => o.status === "open" || o.status === "partiallyFilled"
            );

            const newBids = active
                .filter(o => o.side === "buy")
                .sort((a, b) => b.price - a.price);

            const newAsks = active
                .filter(o => o.side === "sell")
                .sort((a, b) => a.price - b.price);

            setBids(newBids);
            setAsks(newAsks);
        } catch (e: any) {
            console.error("fetchOrders:", e);
        }
    }, [marketAddr, connection]);

    // ── Fetch wallet SOL balance ────────────────────────────────────────────────
    const fetchBalance = useCallback(async () => {
        if (!publicKey) return;
        try {
            const bal = await connection.getBalance(publicKey);
            setSolBalance(bal / 1e9);
        } catch { /* ignore */ }
    }, [publicKey, connection]);

    // ── Fetch recent trade history by parsing program transaction logs ──────────
    const fetchTrades = useCallback(async () => {
        try {
            const sigs = await connection.getSignaturesForAddress(PROGRAM_ID, { limit: 30 });
            const txResults = await Promise.all(
                sigs.map(s => connection.getTransaction(s.signature, {
                    maxSupportedTransactionVersion: 0,
                }))
            );

            const parsedTrades: Trade[] = [];
            for (const tx of txResults) {
                if (!tx?.meta?.logMessages) continue;
                const ts = tx.blockTime ?? Math.floor(Date.now() / 1000);
                const trade = parseTradesFromLogs(tx.meta.logMessages, ts);
                if (trade) parsedTrades.push(trade);
            }

            // Most recent first, max 10
            parsedTrades.sort((a, b) => b.timestamp - a.timestamp);
            setTrades(parsedTrades.slice(0, 10));
        } catch (e: any) {
            console.error("fetchTrades:", e);
        }
    }, [connection]);

    // ── Refresh all data ────────────────────────────────────────────────────────
    const refreshAll = useCallback(async () => {
        setFetching(true);
        await Promise.all([fetchMarket(), fetchOrders(), fetchTrades(), fetchBalance()]);
        setFetching(false);
        showToast("Data refreshed from chain");
    }, [fetchMarket, fetchOrders, fetchTrades, fetchBalance]);

    // Auto-fetch on mount and when market changes, then poll every 10s
    useEffect(() => {
        if (!marketAddr || marketAddr.length < 32) return;
        refreshAll();
        const id = setInterval(refreshAll, 10_000);
        return () => clearInterval(id);
    }, [marketAddr]); // eslint-disable-line react-hooks/exhaustive-deps

    const handlePlaceOrder = async () => {
        if (!price || !qty || !publicKey) return;
        setLoading(true);
        showToast("Use the CLI to place orders → ts-node cli.ts place-order", "ok");
        setTimeout(() => setLoading(false), 1500);
    };

    const total = price && qty ? parseInt(price) * parseInt(qty) : 0;
    const spread = asks.length && bids.length
        ? `${(asks[0].price - bids[0].price).toLocaleString()} λ` : "—";

    return (
        <div className="trading-shell animate-enter">
            {/* ── Header ── */}
            <header className="trading-header">
                <Flex align="center" gap="3">
                    <img src={logoImg} alt="SolaMatch" className="logo-img" style={{ height: 32 }} />
                    <Badge color="violet" variant="soft" size="1">DEVNET</Badge>
                    <Badge color="green" variant="soft" size="1">
                        <ActivityLogIcon /> LIVE
                    </Badge>
                    {fetching && <Spinner size="1" />}
                </Flex>

                <Flex align="center" gap="3">
                    <TextField.Root
                        size="1"
                        placeholder="Market PDA…"
                        value={marketAddr}
                        onChange={e => setMarketAddr(e.target.value)}
                        style={{ width: 280, fontFamily: "var(--mono)" }}
                    >
                        <TextField.Slot side="right">
                            <IconButton size="1" variant="ghost" onClick={refreshAll} title="Refresh from chain">
                                <UpdateIcon />
                            </IconButton>
                        </TextField.Slot>
                    </TextField.Root>

                    <WalletMultiButton style={{ height: 34, fontSize: 13, borderRadius: 8 }} />

                    <IconButton size="2" variant="soft" color="gray" onClick={disconnect} title="Disconnect">
                        <ExitIcon />
                    </IconButton>
                </Flex>
            </header>

            {/* ── Stats bar ── */}
            <div className="stats-bar">
                {[
                    { label: "Market", value: market?.marketName ?? "—", accent: "violet" },
                    { label: "Total Orders", value: market?.nextOrderId != null ? market.nextOrderId : "—", accent: "blue" },
                    { label: "Bids", value: bids.length, accent: "green" },
                    { label: "Asks", value: asks.length, accent: "red" },
                    { label: "SOL Balance", value: solBalance !== null ? `${solBalance.toFixed(4)} ◎` : "—", accent: "yellow" },
                ].map(s => (
                    <Card key={s.label} className="stat-card">
                        <Text size="1" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</Text>
                        <Text size="4" weight="bold" color={s.accent as any} style={{ fontFamily: "var(--mono)", display: "block", marginTop: 2 }}>
                            {String(s.value)}
                        </Text>
                    </Card>
                ))}
            </div>

            {/* ── Main 3-col grid ── */}
            <Grid columns="1fr 1fr 340px" gap="4" className="main-grid">

                {/* Order Book */}
                <Card style={{ overflow: "hidden" }}>
                    <Flex justify="between" align="center" mb="3">
                        <Text size="1" weight="bold" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
                            Order Book
                        </Text>
                        <Text size="1" color="gray">
                            {asks.length + bids.length} active orders
                        </Text>
                    </Flex>

                    {asks.length === 0 && bids.length === 0 ? (
                        <Flex direction="column" align="center" gap="2" py="6">
                            <Text size="2" color="gray">No open orders on-chain</Text>
                            <Text size="1" color="gray">Place orders via CLI to populate</Text>
                        </Flex>
                    ) : (
                        <>
                            <Table.Root size="1">
                                <Table.Header>
                                    <Table.Row>
                                        <Table.ColumnHeaderCell>Price (λ)</Table.ColumnHeaderCell>
                                        <Table.ColumnHeaderCell align="right">Qty</Table.ColumnHeaderCell>
                                        <Table.ColumnHeaderCell align="right">Rem.</Table.ColumnHeaderCell>
                                    </Table.Row>
                                </Table.Header>
                                <Table.Body>
                                    {[...asks].reverse().map(o => (
                                        <Table.Row key={o.orderId}>
                                            <Table.Cell>
                                                <Flex align="center" gap="1">
                                                    <ArrowUpIcon color="var(--red-9)" />
                                                    <Text size="1" color="red" weight="bold" style={{ fontFamily: "var(--mono)" }}>
                                                        {o.price.toLocaleString()}
                                                    </Text>
                                                </Flex>
                                            </Table.Cell>
                                            <Table.Cell align="right">
                                                <Text size="1" color="gray" style={{ fontFamily: "var(--mono)" }}>{o.quantity}</Text>
                                            </Table.Cell>
                                            <Table.Cell align="right">
                                                <Text size="1" style={{ fontFamily: "var(--mono)" }}>{o.quantity - o.filledQuantity}</Text>
                                            </Table.Cell>
                                        </Table.Row>
                                    ))}
                                </Table.Body>
                            </Table.Root>

                            <Flex justify="center" my="2">
                                <Badge color="violet" variant="soft" size="1">SPREAD: {spread}</Badge>
                            </Flex>

                            <Table.Root size="1">
                                <Table.Body>
                                    {bids.map(o => (
                                        <Table.Row key={o.orderId}>
                                            <Table.Cell>
                                                <Flex align="center" gap="1">
                                                    <ArrowDownIcon color="var(--green-9)" />
                                                    <Text size="1" color="green" weight="bold" style={{ fontFamily: "var(--mono)" }}>
                                                        {o.price.toLocaleString()}
                                                    </Text>
                                                </Flex>
                                            </Table.Cell>
                                            <Table.Cell align="right">
                                                <Text size="1" color="gray" style={{ fontFamily: "var(--mono)" }}>{o.quantity}</Text>
                                            </Table.Cell>
                                            <Table.Cell align="right">
                                                <Text size="1" style={{ fontFamily: "var(--mono)" }}>{o.quantity - o.filledQuantity}</Text>
                                            </Table.Cell>
                                        </Table.Row>
                                    ))}
                                </Table.Body>
                            </Table.Root>
                        </>
                    )}
                </Card>

                {/* Trade History */}
                <Card style={{ overflow: "hidden" }}>
                    <Flex justify="between" align="center" mb="3">
                        <Text size="1" weight="bold" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
                            Recent Trades
                        </Text>
                        <Text size="1" color="gray">{trades.length} trades found</Text>
                    </Flex>

                    {trades.length === 0 ? (
                        <Flex direction="column" align="center" gap="2" py="6">
                            <Text size="2" color="gray">No trades yet</Text>
                            <Text size="1" color="gray">Execute a match via CLI to see trades here</Text>
                        </Flex>
                    ) : (
                        <Table.Root size="1">
                            <Table.Header>
                                <Table.Row>
                                    <Table.ColumnHeaderCell>Price (λ)</Table.ColumnHeaderCell>
                                    <Table.ColumnHeaderCell>Qty</Table.ColumnHeaderCell>
                                    <Table.ColumnHeaderCell>Orders</Table.ColumnHeaderCell>
                                    <Table.ColumnHeaderCell>Time</Table.ColumnHeaderCell>
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {trades.map((t, i) => (
                                    <Table.Row key={i}>
                                        <Table.Cell>
                                            <Text size="1" color="green" weight="bold" style={{ fontFamily: "var(--mono)" }}>
                                                {t.fillPrice.toLocaleString()}
                                            </Text>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Text size="1" style={{ fontFamily: "var(--mono)" }}>{t.fillQuantity}</Text>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Text size="1" color="gray">#{t.bidOrderId}/#{t.askOrderId}</Text>
                                        </Table.Cell>
                                        <Table.Cell>
                                            <Text size="1" color="gray">{new Date(t.timestamp * 1000).toLocaleTimeString()}</Text>
                                        </Table.Cell>
                                    </Table.Row>
                                ))}
                            </Table.Body>
                        </Table.Root>
                    )}
                </Card>

                {/* Place Order Form */}
                <Card>
                    <Text size="1" weight="bold" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
                        Place Order
                    </Text>
                    <Flex gap="2" mt="3" mb="4">
                        <Button size="2" style={{ flex: 1 }} variant={side === "buy" ? "solid" : "soft"}
                            color={side === "buy" ? "green" : "gray"} onClick={() => setSide("buy")}>
                            <ArrowDownIcon /> BUY
                        </Button>
                        <Button size="2" style={{ flex: 1 }} variant={side === "sell" ? "solid" : "soft"}
                            color={side === "sell" ? "red" : "gray"} onClick={() => setSide("sell")}>
                            <ArrowUpIcon /> SELL
                        </Button>
                    </Flex>

                    <Flex direction="column" gap="3">
                        <Box>
                            <Text size="1" color="gray" mb="1" style={{ display: "block" }}>Price (lamports/unit)</Text>
                            <TextField.Root placeholder="e.g. 100000" type="number" value={price}
                                onChange={e => setPrice(e.target.value)} style={{ fontFamily: "var(--mono)" }} />
                        </Box>
                        <Box>
                            <Text size="1" color="gray" mb="1" style={{ display: "block" }}>Quantity (units)</Text>
                            <TextField.Root placeholder="e.g. 10" type="number" value={qty}
                                onChange={e => setQty(e.target.value)} style={{ fontFamily: "var(--mono)" }} />
                        </Box>
                    </Flex>

                    {total > 0 && (
                        <Card mt="3" variant="surface">
                            <Flex direction="column" gap="1">
                                <Flex justify="between">
                                    <Text size="1" color="gray">Side</Text>
                                    <Text size="1" weight="bold" color={side === "buy" ? "green" : "red"}>{side.toUpperCase()}</Text>
                                </Flex>
                                <Flex justify="between">
                                    <Text size="1" color="gray">Total</Text>
                                    <Text size="1" weight="bold" style={{ fontFamily: "var(--mono)" }}>{total.toLocaleString()} λ</Text>
                                </Flex>
                                {side === "buy" && (
                                    <Flex justify="between">
                                        <Text size="1" color="gray">Escrow</Text>
                                        <Text size="1" color="violet" style={{ fontFamily: "var(--mono)" }}>{(total / 1e9).toFixed(6)} SOL</Text>
                                    </Flex>
                                )}
                            </Flex>
                        </Card>
                    )}

                    <Separator size="4" my="3" />

                    <Button size="3" style={{ width: "100%" }} color={side === "buy" ? "green" : "red"}
                        disabled={loading || !price || !qty} onClick={handlePlaceOrder}>
                        <LightningBoltIcon />
                        {loading ? "Processing…" : `Place ${side.toUpperCase()} Order`}
                    </Button>

                    <Text size="1" color="gray" mt="2" style={{ display: "block", textAlign: "center", lineHeight: 1.6 }}>
                        Full CLI:{" "}
                        <code style={{ fontFamily: "var(--mono)", color: "var(--violet-9)", fontSize: "0.72rem" }}>
                            ts-node cli.ts place-order
                        </code>
                    </Text>
                </Card>
            </Grid>

            {/* ── Architecture Panel ── */}
            <Card mt="4" style={{ borderLeft: "3px solid var(--violet-9)" }}>
                <Flex justify="between" align="start" gap="6" wrap="wrap">
                    <Box style={{ flex: 1, minWidth: 260 }}>
                        <Badge color="red" variant="soft" mb="2">Web2</Badge>
                        <Text as="p" size="2" color="gray" mt="1">
                            Centralized server → PostgreSQL order rows → background matching loop →
                            DB atomic commit. Custodial. Trust the operator.
                        </Text>
                    </Box>
                    <Box style={{ alignSelf: "center", fontSize: "1.5rem" }}>→</Box>
                    <Box style={{ flex: 1, minWidth: 260 }}>
                        <Badge color="green" variant="soft" mb="2">Solana</Badge>
                        <Text as="p" size="2" color="gray" mt="1">
                            Each order = PDA account. Market PDA holds aggregates. Anyone calls
                            match_orders (crank). Lamports transfer directly. Trustless.
                        </Text>
                    </Box>
                    <Box style={{ flex: 1, minWidth: 260 }}>
                        <Badge color="violet" variant="soft" mb="2">Tradeoff</Badge>
                        <Text as="p" size="2" color="gray" mt="1">
                            1 match = 1 tx (~0.000005 SOL). Client finds compatible pairs off-chain
                            then program validates — same model as OpenBook/Serum.
                        </Text>
                    </Box>
                </Flex>
            </Card>

            {/* ── My Orders ── */}
            {publicKey && (
                <Card mt="4">
                    <Flex justify="between" align="center" mb="3">
                        <Text size="1" weight="bold" color="gray" style={{ textTransform: "uppercase", letterSpacing: "0.08em" }}>
                            My Orders
                        </Text>
                        <Badge color="violet" variant="soft" size="1">
                            {allOrders.filter(o => o.owner === publicKey.toBase58()).length} total
                        </Badge>
                    </Flex>

                    {allOrders.filter(o => o.owner === publicKey.toBase58()).length === 0 ? (
                        <Flex align="center" gap="2" py="4">
                            <Text size="2" color="gray">No orders found for your wallet on this market.</Text>
                        </Flex>
                    ) : (
                        <Table.Root size="1">
                            <Table.Header>
                                <Table.Row>
                                    <Table.ColumnHeaderCell>#ID</Table.ColumnHeaderCell>
                                    <Table.ColumnHeaderCell>Side</Table.ColumnHeaderCell>
                                    <Table.ColumnHeaderCell>Price (λ)</Table.ColumnHeaderCell>
                                    <Table.ColumnHeaderCell>Qty</Table.ColumnHeaderCell>
                                    <Table.ColumnHeaderCell>Filled</Table.ColumnHeaderCell>
                                    <Table.ColumnHeaderCell>Status</Table.ColumnHeaderCell>
                                    <Table.ColumnHeaderCell>Time</Table.ColumnHeaderCell>
                                </Table.Row>
                            </Table.Header>
                            <Table.Body>
                                {allOrders
                                    .filter(o => o.owner === publicKey.toBase58())
                                    .sort((a, b) => b.orderId - a.orderId)
                                    .map(o => (
                                        <Table.Row key={o.orderId}>
                                            <Table.Cell>
                                                <Text size="1" color="gray" style={{ fontFamily: "var(--mono)" }}>#{o.orderId}</Text>
                                            </Table.Cell>
                                            <Table.Cell>
                                                <Badge
                                                    color={o.side === "buy" ? "green" : "red"}
                                                    variant="soft" size="1"
                                                >
                                                    {o.side.toUpperCase()}
                                                </Badge>
                                            </Table.Cell>
                                            <Table.Cell>
                                                <Text size="1" weight="bold" style={{ fontFamily: "var(--mono)" }}>
                                                    {o.price.toLocaleString()}
                                                </Text>
                                            </Table.Cell>
                                            <Table.Cell>
                                                <Text size="1" style={{ fontFamily: "var(--mono)" }}>{o.quantity}</Text>
                                            </Table.Cell>
                                            <Table.Cell>
                                                <Text size="1" color={o.filledQuantity > 0 ? "green" : "gray"} style={{ fontFamily: "var(--mono)" }}>
                                                    {o.filledQuantity}/{o.quantity}
                                                </Text>
                                            </Table.Cell>
                                            <Table.Cell>
                                                <Badge
                                                    size="1"
                                                    variant="soft"
                                                    color={
                                                        o.status === "open" ? "blue" :
                                                            o.status === "partiallyFilled" ? "yellow" :
                                                                o.status === "filled" ? "green" : "gray"
                                                    }
                                                >
                                                    {o.status}
                                                </Badge>
                                            </Table.Cell>
                                            <Table.Cell>
                                                <Text size="1" color="gray">
                                                    {new Date(o.timestamp * 1000).toLocaleTimeString()}
                                                </Text>
                                            </Table.Cell>
                                        </Table.Row>
                                    ))
                                }
                            </Table.Body>
                        </Table.Root>
                    )}
                </Card>
            )}

            {/* ── Footer ── */}
            <footer className="landing-footer" style={{ marginTop: "4rem", borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: "2rem" }}>
                <Flex align="center" justify="center" gap="2" mb="2">
                    <img src={logoImg} alt="SolaMatch" className="logo-img" style={{ height: 24 }} />
                </Flex>
                <Text size="1" color="gray" align="center" style={{ display: "block" }}>
                    Built for the Solana "Rebuild Backend Systems" Challenge · MIT License
                </Text>
            </footer>

            {/* ── Toast ── */}
            {toast && (
                <div className={`rt-toast ${toast.type === "err" ? "rt-toast-err" : "rt-toast-ok"}`}>
                    {toast.msg}
                </div>
            )}
        </div>
    );
}
