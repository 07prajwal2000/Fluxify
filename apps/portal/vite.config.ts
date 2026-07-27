import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import path from "node:path";

// Served behind Caddy at /_/admin/ui in prod; dev proxies the admin API to the
// standalone server (5500) and the AI gateway (8001), same routing as Caddyfile.
export default defineConfig({
	base: "/_/admin/ui/",
	plugins: [
		{
			name: "ignore-node-binaries",
			resolveId(id) {
				if (id.endsWith(".node") || id.includes("@napi-rs/") || id.includes("snappy")) {
					return "\0empty-node-binary";
				}
			},
			load(id) {
				if (id === "\0empty-node-binary") {
					return "export default {};";
				}
			},
		},
		tanstackRouter({ target: "react", autoCodeSplitting: true }),
		react(),
		tailwindcss(),
	],
	resolve: {
		alias: {
			"@": path.resolve(import.meta.dirname, "src"),
			"snappy": path.resolve(import.meta.dirname, "src/lib/empty.ts"),
			"winston-loki": path.resolve(import.meta.dirname, "src/lib/empty.ts"),
		},
	},
	server: {
		port: 3001,
		proxy: {
			// ws: the harness socket.io transport lives at /_/admin/api/ai/socket.io/
			// and upgrades to a websocket; without this it never leaves long-polling.
			"/_/admin/api/ai": {
				target: "http://localhost:8001",
				changeOrigin: true,
				ws: true,
			},
			"/_/admin/api": { target: "http://localhost:5500", changeOrigin: true },
		},
	},
});
