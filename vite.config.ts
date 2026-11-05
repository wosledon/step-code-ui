import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev-only proxy target: `npm run dev` starts the bridge on this address and
// forwards same-origin /api and /ws requests to it.
const bridgeOrigin = process.env.STEP_UI_BRIDGE_ORIGIN ?? "http://127.0.0.1:4173";

export default defineConfig({
	plugins: [react(), tailwindcss()],
	server: {
		port: 5173,
		proxy: {
			"/api": { target: bridgeOrigin, changeOrigin: true },
			"/ws": { target: bridgeOrigin.replace(/^http/, "ws"), ws: true },
		},
	},
	build: {
		outDir: "dist/web",
		chunkSizeWarningLimit: 2048,
	},
});
