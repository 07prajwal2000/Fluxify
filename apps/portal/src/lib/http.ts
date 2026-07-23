import axios from "axios";

// Relative base -> requests go through the Vite dev proxy (see vite.config.ts)
// and, in prod, through Caddy to the standalone server.
const API_BASE_URL = "/_/admin/api";

export const httpClient = axios.create({
	baseURL: API_BASE_URL,
	headers: { "Content-Type": "application/json" },
});
