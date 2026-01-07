import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { logAppInit } from "./utils/debugLogger";

// Initialize debug logging for native app monitoring
logAppInit();

createRoot(document.getElementById("root")!).render(<App />);
