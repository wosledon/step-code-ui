import { createRoot } from "react-dom/client";
import App from "./App";
import { I18nProvider } from "./lib/i18n";
import "./styles.css";

const container = document.getElementById("root");
if (!container) throw new Error("#root element is missing");

// No StrictMode: the ACP connection is a long-lived WebSocket and must be created once.
createRoot(container).render(<I18nProvider><App /></I18nProvider>);
