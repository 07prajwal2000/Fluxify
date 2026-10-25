import type { ValidationSchema } from "@fluxify/components";
import type { responseSchemaItem } from "@fluxify/server/src/api/v1/routes/response-schemas/dto";
import type z from "zod";
import { httpClient } from "@/lib/http";

// the server stores the editor's format as an opaque record; here it is the editor's own type
export type ResponseSchemaItem = Omit<z.infer<typeof responseSchemaItem>, "schema"> & {
	schema: ValidationSchema;
};
export type ResponseSchemaList = ResponseSchemaItem[];
/** exactly one of `schema` (editor format) or `sample` (a parsed JSON body to infer from) */
export type PutResponseSchemaBody = { schema?: ValidationSchema; sample?: unknown };

const base = (routeId: string) => `/v1/routes/${routeId}/response-schemas`;

export const responseSchemasService = {
	async list(routeId: string): Promise<ResponseSchemaList> {
		return (await httpClient.get(base(routeId))).data;
	},
	async put(
		routeId: string,
		statusCode: number,
		body: PutResponseSchemaBody,
	): Promise<ResponseSchemaItem> {
		return (await httpClient.put(`${base(routeId)}/${statusCode}`, body)).data;
	},
	async remove(routeId: string, statusCode: number): Promise<void> {
		await httpClient.delete(`${base(routeId)}/${statusCode}`);
	},
};
