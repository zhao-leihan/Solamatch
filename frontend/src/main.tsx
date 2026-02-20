import React, { useMemo } from "react";
import ReactDOM from "react-dom/client";
import { Buffer } from "buffer";
import { clusterApiUrl } from "@solana/web3.js";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { Theme } from "@radix-ui/themes";
import App from "./App";

import "@radix-ui/themes/styles.css";
import "@solana/wallet-adapter-react-ui/styles.css";
import "./index.css";

// Polyfill for Solana web3.js
window.Buffer = Buffer;

const DEVNET_ENDPOINT = clusterApiUrl("devnet");

function Root() {
    const wallets = useMemo(
        () => [
            new PhantomWalletAdapter(),
            new SolflareWalletAdapter(),
        ],
        []
    );

    return (
        <ConnectionProvider endpoint={DEVNET_ENDPOINT}>
            <WalletProvider wallets={wallets} autoConnect>
                <WalletModalProvider>
                    <Theme
                        appearance="dark"
                        accentColor="violet"
                        grayColor="slate"
                        radius="medium"
                        scaling="100%"
                    >
                        <App />
                    </Theme>
                </WalletModalProvider>
            </WalletProvider>
        </ConnectionProvider>
    );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <Root />
    </React.StrictMode>
);
