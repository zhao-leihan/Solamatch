import { Flex, Text, Box } from "@radix-ui/themes";
import logoImg from "../../assets/logo solana.png";
import { useEffect, useState } from "react";

export default function LoadingScreen() {
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        const timer = setInterval(() => {
            setProgress(prev => {
                if (prev >= 100) {
                    clearInterval(timer);
                    return 100;
                }
                return prev + 2; // finish in ~5s (50 ticks * 100ms)
            });
        }, 100);
        return () => clearInterval(timer);
    }, []);

    return (
        <Flex
            align="center"
            justify="center"
            direction="column"
            style={{
                position: "fixed",
                inset: 0,
                background: "#0a0b0e",
                zIndex: 9999,
                color: "#fff"
            }}
        >
            <div className="landing-bg">
                <div className="orb orb-1" style={{ width: 300, height: 300, opacity: 0.15 }} />
                <div className="orb orb-2" style={{ width: 300, height: 300, opacity: 0.15 }} />
            </div>

            <Box style={{ position: "relative", zIndex: 10, textAlign: "center" }}>
                <img
                    src={logoImg}
                    alt="SolaMatch"
                    style={{
                        width: 300,
                        height: 300,
                        objectFit: "contain",
                        marginBottom: "1.5rem",
                        animation: "pulseGlow 2s ease-in-out infinite"
                    }}
                />



                <div style={{
                    width: 200,
                    height: 4,
                    background: "rgba(255,255,255,0.1)",
                    borderRadius: 2,
                    overflow: "hidden",
                    margin: "0 auto"
                }}>
                    <div style={{
                        height: "100%",
                        background: "linear-gradient(90deg, #9945ff, #14f195)",
                        width: `${progress}%`,
                        transition: "width 0.1s linear"
                    }} />
                </div>

                <Text size="1" color="gray" style={{ fontFamily: "var(--mono)", marginTop: "0.5rem", opacity: 0.6 }}>
                    INITIALIZING ON-CHAIN CONNECTION...
                </Text>
            </Box>
        </Flex>
    );
}
