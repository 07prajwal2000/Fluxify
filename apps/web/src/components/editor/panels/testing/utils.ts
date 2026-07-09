import { ValidationSchema, SchemaProperty } from "@/types/schemaEditor";
import z from "zod";
import { responseSchema as getByIdResponseSchema } from "@fluxify/server/src/api/v1/routes/get-by-id/dto";

export function generateSampleData(prop: ValidationSchema | SchemaProperty): unknown {
	if (!prop) return null;
	if (prop.dataType === "str") return "string";
	if (prop.dataType === "int") return 0;
	if (prop.dataType === "float") return 0.0;
	if (prop.dataType === "bool") return false;
	if (prop.dataType === "enum") {
		const enumRule = prop.rules?.find((r: any) => r.type === "enum");
		if (
			enumRule &&
			Array.isArray(enumRule.value) &&
			enumRule.value.length > 0
		) {
			return enumRule.value[0];
		}
		return "enum_value";
	}
	if (prop.dataType === "arr") {
		const p = prop as SchemaProperty;
		if (p.items) return [generateSampleData(p.items)];
		return [];
	}
	if (prop.dataType === "object") {
		const obj: Record<string, unknown> = {};
		if (prop.properties) {
			prop.properties.forEach((p: SchemaProperty) => {
				if (p.key) {
					obj[p.key] = generateSampleData(p);
				}
			});
		}
		return obj;
	}
	return null;
}

export function getInitialRequestData(route: z.infer<typeof getByIdResponseSchema>) {
    const pathParams: Record<string, string> = {};
    const params = route.path?.match(/:[a-zA-Z0-9_]+/g);
    if (params) {
        params.forEach((p: string) => {
            pathParams[p.substring(1)] = "";
        });
    }

    const queryParams: Record<string, string> = {};
    const querySchema = route.querySchema as ValidationSchema | undefined;
    if (querySchema?.properties) {
        querySchema.properties.forEach((p: SchemaProperty) => {
            if (p.key) {
                queryParams[p.key] = "";
            }
        });
    }

    let body = "{\n  \n}";
    const bodySchema = route.bodySchema as ValidationSchema | undefined;
    if (bodySchema) {
        const sampleData = generateSampleData(bodySchema);
        if (
            sampleData &&
            typeof sampleData === "object" &&
            Object.keys(sampleData).length > 0
        ) {
            body = JSON.stringify(sampleData, null, 2);
        } else if (Array.isArray(sampleData) && sampleData.length > 0) {
            body = JSON.stringify(sampleData, null, 2);
        }
    }

    return { pathParams, queryParams, body };
}
