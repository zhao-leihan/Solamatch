import { useWallet } from "@solana/wallet-adapter-react";
import LandingPage from "./pages/LandingPage";
import TradingPage from "./pages/TradingPage";
import LoadingScreen from "./components/LoadingScreen";
import { useEffect, useState } from "react";

export default function App() {
    const { connected } = useWallet();
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => {
            setLoading(false);
        }, 5000); // 5 seconds loading
        return () => clearTimeout(timer);
    }, []);

    if (loading) return <LoadingScreen />;

    return connected ? <TradingPage /> : <LandingPage />;
}
