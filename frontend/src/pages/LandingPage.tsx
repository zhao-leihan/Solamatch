import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import logoImg from "../../assets/logo solana.png";
import { useWallet } from "@solana/wallet-adapter-react";
import {
    LightningBoltIcon,
    LockClosedIcon,
    MixerVerticalIcon,
    GitHubLogoIcon,
    ArrowRightIcon,
    BarChartIcon,
    CodeIcon,
    StopwatchIcon,
    ShieldIcon,
    CubeIcon,
} from "@radix-ui/react-icons";
import { Button, Text, Badge } from "@radix-ui/themes";

// ─── Feature cards ────────────────────────────────────────────────────────────
const FEATURES = [
    {
        icon: <LightningBoltIcon width={22} height={22} />,
        title: "Sub-ms Matching Engine",
        desc: "O(N) two-pointer algorithm on pre-sorted bids/asks. Parallel batch submission per slot via priority fees — fastest OME on Solana.",
        color: "#9945ff",
    },
    {
        icon: <LockClosedIcon width={22} height={22} />,
        title: "Emergency Pause (Kill Switch)",
        desc: "Single-tx circuit breaker for your market. Authority pauses all new orders and matching instantly. Users always retain cancel rights.",
        color: "#f43f5e",
    },
    {
        icon: <BarChartIcon width={22} height={22} />,
        title: "Configurable Fee Collector",
        desc: "Set fee_bps (0–500bps) per market. Fees auto-deducted from matched trades and streamed to your treasury wallet — on-chain, trustless.",
        color: "#14f195",
    },
    {
        icon: <MixerVerticalIcon width={22} height={22} />,
        title: "Robustness by Design",
        desc: "Re-entrancy locks, order TTL (expires_at), slippage cap, and overflow-safe math. Every edge case covered by on-chain require! guards.",
        color: "#60a5fa",
    },
    {
        icon: <CodeIcon width={22} height={22} />,
        title: "WebSocket + REST API",
        desc: "Fastify gateway with Swagger UI at /docs and Redoc at /redoc. Real-time orderbook_update and trade_executed events via wss://.",
        color: "#fb923c",
    },
    {
        icon: <StopwatchIcon width={22} height={22} />,
        title: "~400ms Finality",
        desc: "Solana BPF execution + Jito-compatible priority fees. Crank submits skipPreflight in parallel for maximum slot utilization.",
        color: "#a78bfa",
    },
];

// ─── Stats ────────────────────────────────────────────────────────────────────
const STATS = [
    { label: "Instructions", value: "7" },
    { label: "Fee Cap", value: "5%" },
    { label: "Finality", value: "~400ms" },
    { label: "API Routes", value: "5+" },
];

// ─── Pricing ─────────────────────────────────────────────────────────────────
const PRICING = [
    {
        tier: "Open Source",
        price: "Free",
        highlight: false,
        features: [
            "Full Anchor program source",
            "Deploy to your own market",
            "No fee unless you configure",
            "Community crank",
            "GitHub access",
        ],
        cta: "View on GitHub",
        link: "https://github.com/zhao-leihan/Solamatch",
    },
    {
        tier: "B2B Protocol",
        price: "0.3% / trade",
        highlight: true,
        features: [
            "Fee collector PDA included",
            "Emergency pause kill switch",
            "Hosted API gateway",
            "Swagger / Redoc docs",
            "WebSocket real-time feed",
            "High-perf crank service",
            "Priority support",
        ],
        cta: "Connect Wallet",
        link: null,
    },
];

// ─── Integration quickstart ─────────────────────────────────────────────────
const CODE_SNIPPET = `// Subscribe to live order book in 5 lines
const ws = new WebSocket('wss://api.solamatch.io/ws');
ws.send(JSON.stringify({ type: 'subscribe', market: MARKET_PUBKEY }));
ws.onmessage = ({ data }) => {
  const { bids, asks } = JSON.parse(data).data;
  console.log('Best bid:', bids[0]?.price, '| Best ask:', asks[0]?.price);
};`;

// ─────────────────────────────────────────────────────────────────────────────
export default function LandingPage() {
    const { setVisible } = useWalletModal();
    const { connecting } = useWallet();

    return (
        <div className="landing animate-enter">
            {/* ── Animated background ── */}
            <div className="landing-bg">
                <div className="orb orb-1" />
                <div className="orb orb-2" />
                <div className="orb orb-3" />
                <div className="grid-overlay" />
            </div>

            {/* ── Nav ── */}
            <nav className="landing-nav">
                <div className="landing-logo">
                    <img src={logoImg} alt="SolaMatch" className="logo-img" />
                    <Badge color="violet" variant="soft" size="1">B2B</Badge>
                </div>
                <div className="nav-links">
                    <a href="#integration" className="nav-link">API Docs</a>
                    <a href="#pricing" className="nav-link">Pricing</a>
                    <a
                        href="https://github.com/zhao-leihan/Solamatch"
                        target="_blank" rel="noreferrer"
                        className="nav-link"
                    >
                        <GitHubLogoIcon width={16} height={16} /> GitHub
                    </a>
                    <a
                        href={`https://explorer.solana.com/address/77aLU4dN1NTAWVGhNcNgWFwQ5K9XwkFnEWMLjGWWZBDD?cluster=devnet`}
                        target="_blank" rel="noreferrer"
                        className="nav-link"
                    >
                        Explorer ↗
                    </a>
                </div>
            </nav>

            {/* ── Hero ── */}
            <section className="hero">
                <div className="hero-eyebrow">
                    <Badge color="green" variant="soft">
                        ✅ Production-Ready · Solana Devnet
                    </Badge>
                </div>
                <h1 className="hero-title">
                    The <span className="hero-gradient">Fastest</span> On-Chain
                    <br />Order Matching Engine
                </h1>
                <p className="hero-sub">
                    A production-grade B2B protocol for decentralized exchanges.
                    Fee collection, kill switch, WebSocket API, and sub-millisecond
                    matching — all on-chain, all trustless.
                </p>

                <div className="hero-cta">
                    <button
                        className="cta-primary"
                        onClick={() => setVisible(true)}
                        disabled={connecting}
                    >
                        {connecting ? "Connecting…" : "Launch Trading Terminal"}
                        <ArrowRightIcon width={18} height={18} />
                    </button>
                    <a
                        href="#integration"
                        className="cta-secondary"
                    >
                        <CodeIcon width={16} height={16} />
                        View API Docs
                    </a>
                </div>

                {/* Stats strip */}
                <div className="hero-stats">
                    {STATS.map((s) => (
                        <div key={s.label} className="hero-stat">
                            <span className="hero-stat-val">{s.value}</span>
                            <span className="hero-stat-label">{s.label}</span>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── Feature grid ── */}
            <section className="features">
                <p className="section-label">Enterprise Features</p>
                <h2 className="section-title">Built for protocols that can't afford downtime</h2>
                <div className="feature-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
                    {FEATURES.map((f) => (
                        <div key={f.title} className="feature-card">
                            <div className="feature-icon" style={{ color: f.color }}>
                                {f.icon}
                            </div>
                            <h3 className="feature-title">{f.title}</h3>
                            <p className="feature-desc">{f.desc}</p>
                        </div>
                    ))}
                </div>
            </section>

            {/* ── API Integration Section ── */}
            <section className="arch-section" id="integration">
                <div style={{ textAlign: "center", marginBottom: "2rem" }}>
                    <p className="section-label">Developer-First API</p>
                    <h2 className="section-title">Integrate in 5 lines of code</h2>
                    <p style={{ color: "var(--gray-10)", maxWidth: 520, margin: "0 auto" }}>
                        Swagger UI at <code style={{ color: "#14f195" }}>/docs</code> · Redoc at <code style={{ color: "#14f195" }}>/redoc</code> · OpenAPI 3.0 spec for SDK generation
                    </p>
                </div>
                <div className="arch-card" style={{ flexDirection: "column", gap: "1.5rem" }}>
                    {/* Code block */}
                    <pre style={{
                        background: "rgba(0,0,0,0.5)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        borderRadius: 12,
                        padding: "1.5rem",
                        color: "#e2e8f0",
                        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                        fontSize: "0.82rem",
                        lineHeight: 1.7,
                        overflowX: "auto",
                        width: "100%",
                        boxSizing: "border-box",
                    }}>
                        <code>
                            {CODE_SNIPPET.split('\n').map((line, i) => (
                                <span key={i}>
                                    {line.startsWith('//') ? (
                                        <span style={{ color: "#64748b" }}>{line}</span>
                                    ) : line.includes("'") ? (
                                        line.split(/('.*?')/).map((part, j) =>
                                            part.startsWith("'") ?
                                                <span key={j} style={{ color: "#14f195" }}>{part}</span> :
                                                <span key={j}>{part}</span>
                                        )
                                    ) : (
                                        <span>{line}</span>
                                    )}
                                    {'\n'}
                                </span>
                            ))}
                        </code>
                    </pre>

                    {/* API endpoint pills */}
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", justifyContent: "center" }}>
                        {[
                            { method: "GET", path: "/markets/:pubkey/orderbook" },
                            { method: "GET", path: "/markets/:pubkey/trades" },
                            { method: "GET", path: "/orders/:pubkey" },
                            { method: "WS", path: "wss://host/ws" },
                            { method: "GET", path: "/docs (Swagger)" },
                        ].map((ep) => (
                            <div key={ep.path} style={{
                                display: "flex", gap: "0.5rem", alignItems: "center",
                                background: "rgba(20,241,149,0.07)",
                                border: "1px solid rgba(20,241,149,0.2)",
                                borderRadius: 8, padding: "0.4rem 0.9rem",
                                fontSize: "0.8rem",
                            }}>
                                <span style={{
                                    color: ep.method === "WS" ? "#9945ff" : "#14f195",
                                    fontWeight: 700, fontFamily: "monospace",
                                }}>{ep.method}</span>
                                <span style={{ color: "#94a3b8" }}>{ep.path}</span>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* ── Architecture callout ── */}
            <section className="arch-section">
                <div className="arch-card">
                    <div className="arch-col">
                        <Badge color="red" variant="soft">Traditional DEX</Badge>
                        <h3>Central Orderbook</h3>
                        <ul>
                            <li>Centralized matching server risk</li>
                            <li>Orders in PostgreSQL rows</li>
                            <li>Custodial fund storage</li>
                            <li>No kill switch transparency</li>
                            <li>Opaque fee routing</li>
                        </ul>
                    </div>
                    <div className="arch-divider">→</div>
                    <div className="arch-col">
                        <Badge color="green" variant="soft">SolaMatch</Badge>
                        <h3>SolaMatch Protocol</h3>
                        <ul>
                            <li>Decentralized crank matching</li>
                            <li>Each order = auditable PDA</li>
                            <li>Self-custodial SOL escrow</li>
                            <li>On-chain kill switch</li>
                            <li>Transparent fee collector PDA</li>
                        </ul>
                    </div>
                </div>
            </section>

            {/* ── Pricing ── */}
            <section className="features" id="pricing">
                <p className="section-label">Simple Pricing</p>
                <h2 className="section-title">Pay only when trades happen</h2>
                <div style={{ display: "flex", gap: "1.5rem", justifyContent: "center", flexWrap: "wrap" }}>
                    {PRICING.map((p) => (
                        <div key={p.tier} className="feature-card" style={{
                            width: 280,
                            border: p.highlight
                                ? "1px solid rgba(153,69,255,0.6)"
                                : "1px solid rgba(255,255,255,0.08)",
                            background: p.highlight
                                ? "linear-gradient(135deg, rgba(153,69,255,0.12), rgba(20,241,149,0.06))"
                                : undefined,
                            position: "relative",
                        }}>
                            {p.highlight && (
                                <Badge color="violet" variant="solid" style={{
                                    position: "absolute", top: -10, right: 16,
                                }}>Recommended</Badge>
                            )}
                            <h3 className="feature-title" style={{ fontSize: "1.1rem" }}>{p.tier}</h3>
                            <p style={{
                                fontSize: "1.8rem", fontWeight: 800,
                                background: p.highlight
                                    ? "linear-gradient(90deg, #9945ff, #14f195)"
                                    : undefined,
                                WebkitBackgroundClip: p.highlight ? "text" : undefined,
                                WebkitTextFillColor: p.highlight ? "transparent" : undefined,
                                color: p.highlight ? undefined : "white",
                                marginBottom: "1rem",
                            }}>{p.price}</p>
                            <ul style={{ listStyle: "none", padding: 0, margin: "0 0 1.5rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                                {p.features.map(feat => (
                                    <li key={feat} style={{ color: "var(--gray-10)", fontSize: "0.88rem" }}>
                                        ✓ {feat}
                                    </li>
                                ))}
                            </ul>
                            {p.link ? (
                                <a href={p.link} target="_blank" rel="noreferrer"
                                    className="cta-secondary" style={{ display: "inline-flex", width: "100%", justifyContent: "center" }}>
                                    {p.cta}
                                </a>
                            ) : (
                                <button className="cta-primary" style={{ width: "100%", justifyContent: "center" }}
                                    onClick={() => setVisible(true)}>
                                    {p.cta} <ArrowRightIcon />
                                </button>
                            )}
                        </div>
                    ))}
                </div>
            </section>

            {/* ── Bottom CTA ── */}
            <section className="bottom-cta">
                <h2>Ready to power your DEX?</h2>
                <p>Connect your Solana wallet to access the live trading terminal.</p>
                <button className="cta-primary" onClick={() => setVisible(true)}>
                    Launch Trading Terminal
                    <ArrowRightIcon width={18} height={18} />
                </button>
            </section>

            {/* ── Footer ── */}
            <footer className="landing-footer">
                <span className="landing-logo" style={{ fontSize: "0.9rem" }}>
                    <img src={logoImg} alt="SolaMatch" className="logo-img" />
                </span>
                <Text size="1" color="gray">
                    SolaMatch — Production B2B Order Matching Protocol on Solana · MIT License
                </Text>
            </footer>
        </div>
    );
}
