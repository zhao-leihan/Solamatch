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
} from "@radix-ui/react-icons";
import { Button, Text, Badge } from "@radix-ui/themes";

const FEATURES = [
    {
        icon: <LightningBoltIcon width={22} height={22} />,
        title: "On-Chain Settlement",
        desc: "Every order lives as a Solana PDA. Matching executes trustlessly on-chain — no centralized server, no custody.",
        color: "#9945ff",
    },
    {
        icon: <LockClosedIcon width={22} height={22} />,
        title: "Self-Custodial Escrow",
        desc: "Buy orders escrow SOL directly in your Order PDA. Funds never touch a third party. Cancel anytime for instant refund.",
        color: "#14f195",
    },
    {
        icon: <MixerVerticalIcon width={22} height={22} />,
        title: "Price-Time Priority",
        desc: "Classic exchange matching logic: best price wins, timestamp breaks ties. Open crank model — anyone can match.",
        color: "#60a5fa",
    },
    {
        icon: <BarChartIcon width={22} height={22} />,
        title: "Multi-Wallet Support",
        desc: "Connect with Phantom, Solflare, Backpack, Coinbase, Ledger, or Torus. Your keys, your exchange.",
        color: "#fb923c",
    },
];

const STATS = [
    { label: "Network", value: "Devnet" },
    { label: "Wallets", value: "6+" },
    { label: "Instructions", value: "4" },
    { label: "Latency", value: "~400ms" },
];

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
                    <Badge color="violet" variant="soft" size="1">
                        DEVNET
                    </Badge>
                </div>
                <div className="nav-links">
                    <a
                        href="https://github.com"
                        target="_blank"
                        rel="noreferrer"
                        className="nav-link"
                    >
                        <GitHubLogoIcon width={16} height={16} /> GitHub
                    </a>
                    <a
                        href={`https://explorer.solana.com/address/77aLU4dN1NTAWVGhNcNgWFwQ5K9XwkFnEWMLjGWWZBDD?cluster=devnet`}
                        target="_blank"
                        rel="noreferrer"
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
                        ✅ Live on Solana Devnet
                    </Badge>
                </div>
                <h1 className="hero-title">
                    On-Chain Order
                    <br />
                    <span className="hero-gradient">Matching Engine</span>
                </h1>
                <p className="hero-sub">
                    The first fully trustless order matching engine built as a Solana
                    program. No server. No custody. Pure on-chain logic.
                </p>

                <div className="hero-cta">
                    <button
                        className="cta-primary"
                        onClick={() => setVisible(true)}
                        disabled={connecting}
                    >
                        {connecting ? "Connecting…" : "Connect Wallet"}
                        <ArrowRightIcon width={18} height={18} />
                    </button>
                    <a
                        href="https://github.com"
                        target="_blank"
                        rel="noreferrer"
                        className="cta-secondary"
                    >
                        <GitHubLogoIcon width={16} height={16} />
                        View Source
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
                <p className="section-label">Why On-Chain?</p>
                <h2 className="section-title">Web2 patterns, Solana execution</h2>
                <div className="feature-grid">
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

            {/* ── Architecture callout ── */}
            <section className="arch-section">
                <div className="arch-card">
                    <div className="arch-col">
                        <Badge color="red" variant="soft">
                            Web2
                        </Badge>
                        <h3>Traditional Exchange</h3>
                        <ul>
                            <li>Centralized matching server</li>
                            <li>Orders in PostgreSQL rows</li>
                            <li>Custodial fund storage</li>
                            <li>Trust the operator</li>
                            <li>High throughput, centralized risk</li>
                        </ul>
                    </div>
                    <div className="arch-divider">→</div>
                    <div className="arch-col">
                        <Badge color="green" variant="soft">
                            Solana
                        </Badge>
                        <h3>SolaMatch</h3>
                        <ul>
                            <li>Any crank can match orders</li>
                            <li>Each order = a PDA account</li>
                            <li>Self-custodial SOL escrow</li>
                            <li>Program enforces all rules</li>
                            <li>~400ms finality, trustless</li>
                        </ul>
                    </div>
                </div>
            </section>

            {/* ── Bottom CTA ── */}
            <section className="bottom-cta">
                <h2>Ready to trade on-chain?</h2>
                <p>Connect your Solana wallet to access the live order book.</p>
                <button className="cta-primary" onClick={() => setVisible(true)}>
                    Launch App
                    <ArrowRightIcon width={18} height={18} />
                </button>
            </section>

            {/* ── Footer ── */}
            <footer className="landing-footer">
                <span className="landing-logo" style={{ fontSize: "0.9rem" }}>
                    <img src={logoImg} alt="SolaMatch" className="logo-img" />
                </span>
                <Text size="1" color="gray">
                    Built for the Solana "Rebuild Backend Systems" Challenge · MIT License
                </Text>
            </footer>
        </div>
    );
}
