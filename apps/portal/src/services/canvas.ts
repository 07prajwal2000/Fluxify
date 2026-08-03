import { httpClient } from "@/lib/http";

/**
 * One canvas contract on the client, mirroring the server's: routes and custom
 * blocks store the same blocks and edges and expose the same two endpoints, so
 * they differ by base URL and nothing else.
 */
export type CanvasAction = { id: string; action: "upsert" | "delete" };
export type CanvasSavePayload = {
	actionsToPerform: { blocks: CanvasAction[]; edges: CanvasAction[] };
	changes: {
		blocks: {
			id: string;
			type: string;
			data: unknown;
			position: { x: number; y: number };
		}[];
		edges: {
			id: string;
			from: string;
			to: string;
			fromHandle: string;
			toHandle: string;
		}[];
	};
};

export type CanvasItems = {
	blocks: { id: string; type: string; data: unknown; position: { x: number; y: number } }[];
	edges: { id: string; from: string; to: string; fromHandle: string; toHandle: string }[];
};

export function canvasEndpoints(baseUrl: string) {
	return {
		async getCanvasItems(id: string): Promise<CanvasItems> {
			const result = await httpClient.get(`${baseUrl}/${id}/canvas-items`);
			return result.data;
		},
		async saveCanvasItems(id: string, payload: CanvasSavePayload) {
			await httpClient.put(`${baseUrl}/${id}/save-canvas`, payload);
		},
	};
}
