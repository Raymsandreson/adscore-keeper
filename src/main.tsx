import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { logAppInit } from "./utils/debugLogger";
import { initPWAUpdater } from "./lib/pwaUpdater";

// Initialize debug logging for native app monitoring
logAppInit();

// Force PWA to auto-update when new version is deployed
initPWAUpdater();

createRoot(document.getElementById("root")!).render(<App />);
