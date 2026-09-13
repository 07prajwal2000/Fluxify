import type { ApiFormValue, ApiKeyValue, ApiPlaygroundRoute } from "./types";
import { pathParameterNames, schemaProperties } from "./utils";
import { validatePropertyValue } from "./propertyValidation";

export { validatePropertyValue };

export type PlaygroundValidationErrors = {
	pathParams: Record<string, string>;
	queryParams: Record<string, string>;
	formFields: Record<string, string>;
	bodyError?: string;
};

export type PlaygroundValidationResult = {
	isValid: boolean;
	firstErrorTab?: "params" | "body";
	toastMessage?: string;
	errors: PlaygroundValidationErrors;
};

export function getMissingPathParams(rawPath: string, pathRows: ApiKeyValue[]): string[] {
	const requiredNames = pathParameterNames(rawPath);
	const valueMap = new Map(pathRows.map((r) => [r.key, r.value]));
	return requiredNames.filter((name) => {
		const val = valueMap.get(name);
		return val === undefined || val.trim() === "";
	});
}

function validatePathParameters(rawPath: string, pathRows: ApiKeyValue[], route: ApiPlaygroundRoute) {
	const pathParamNames = pathParameterNames(rawPath);
	const pathPropsMap = new Map(schemaProperties(route.paramsSchema).map((p) => [p.key, p]));
	const pathRowsMap = new Map(pathRows.map((r) => [r.key, r.value]));
	const errors: Record<string, string> = {};
	const missing: string[] = [];
	const invalid: string[] = [];

	for (const key of pathParamNames) {
		const val = pathRowsMap.get(key);
		const prop = pathPropsMap.get(key) ?? { key, required: true, dataType: "str" };
		const err = validatePropertyValue(val, { ...prop, required: true }, { coerce: true, isPathParam: true });
		if (err) {
			errors[key] = err;
			if (val === undefined || val.trim() === "") missing.push(key);
			else invalid.push(`${key}: ${err}`);
		}
	}
	return { errors, missing, invalid };
}

function validateQueryParameters(queryRows: ApiKeyValue[], route: ApiPlaygroundRoute) {
	const queryPropsMap = new Map(schemaProperties(route.querySchema).map((p) => [p.key, p]));
	const errors: Record<string, string> = {};
	const missing: string[] = [];
	const invalid: string[] = [];

	for (const row of queryRows) {
		if (!row.key) continue;
		const prop = queryPropsMap.get(row.key);
		if (prop) {
			const err = validatePropertyValue(row.value, prop, { coerce: true });
			if (err) {
				errors[row.key] = err;
				if (!row.value || row.value.trim() === "") missing.push(row.key);
				else invalid.push(`${row.key}: ${err}`);
			}
		} else if (row.required && (!row.value || row.value.trim() === "")) {
			errors[row.key] = "Query parameter is required";
			missing.push(row.key);
		}
	}
	return { errors, missing, invalid };
}

function validateFormBody(formBody: Record<string, ApiFormValue>, route: ApiPlaygroundRoute) {
	const errors: Record<string, string> = {};
	const missing: string[] = [];
	const invalid: string[] = [];
	const schemaFields = schemaProperties(route.bodySchema);

	for (const field of schemaFields) {
		const val = formBody[field.key];
		const err = validatePropertyValue(val, field, { coerce: true });
		if (err) {
			errors[field.key] = err;
			if (val === undefined || val === null || (typeof val === "string" && val.trim() === "")) missing.push(field.key);
			else invalid.push(`${field.key}: ${err}`);
		}
	}
	return { errors, missing, invalid };
}

function validateJsonBody(body: string, route: ApiPlaygroundRoute): string | undefined {
	const trimmed = body.trim();
	const schemaFields = schemaProperties(route.bodySchema);
	const hasRequired = schemaFields.some((f) => f.required);

	if (!trimmed) {
		return hasRequired ? "Request body is required" : undefined;
	}

	try {
		const parsed = JSON.parse(trimmed);
		if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
			const invalidProps: string[] = [];
			for (const field of schemaFields) {
				const val = (parsed as Record<string, unknown>)[field.key];
				const err = validatePropertyValue(val, field, { coerce: false });
				if (err) invalidProps.push(`${field.key}: ${err}`);
			}
			return invalidProps.length > 0 ? `Invalid body: ${invalidProps.join("; ")}` : undefined;
		}
		const rootType = (
			(route.bodySchema as { dataType?: string; type?: string })?.dataType ??
			(route.bodySchema as { dataType?: string; type?: string })?.type ??
			""
		).toLowerCase();
		if (rootType === "object" && (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))) {
			return "Request body must be a JSON object";
		}
		if ((rootType === "arr" || rootType === "array") && !Array.isArray(parsed)) {
			return "Request body must be a JSON array";
		}
	} catch (err) {
		return `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`;
	}
	return undefined;
}

function validateBinaryBody(body: string, route: ApiPlaygroundRoute): string | undefined {
	const byteLength = new TextEncoder().encode(body).byteLength;
	const rules = (route.bodySchema as { rules?: Array<{ type: string; value?: unknown }> })?.rules ?? [];
	const maxSize = rules.find((r) => r.type === "maxSize" && r.value != null);
	const minSize = rules.find((r) => r.type === "minSize" && r.value != null);

	if (maxSize && byteLength > Number(maxSize.value)) {
		return `Body size (${byteLength} bytes) exceeds maximum of ${maxSize.value} bytes`;
	}
	if (minSize && byteLength < Number(minSize.value)) {
		return `Body size (${byteLength} bytes) is below minimum of ${minSize.value} bytes`;
	}
	return undefined;
}

export function validatePlaygroundRequest({
	route,
	rawPath,
	pathRows,
	queryRows,
	contentType,
	body,
	formBody,
}: {
	route: ApiPlaygroundRoute;
	rawPath: string;
	pathRows: ApiKeyValue[];
	queryRows: ApiKeyValue[];
	contentType: string;
	body: string;
	formBody: Record<string, ApiFormValue>;
}): PlaygroundValidationResult {
	const isForm = contentType === "application/x-www-form-urlencoded" || contentType === "multipart/form-data";
	const isJson = contentType.includes("json");
	const isBinary =
		contentType === "application/octet-stream" ||
		(route.bodySchema as { dataType?: string } | null | undefined)?.dataType === "blob";

	const pathResult = validatePathParameters(rawPath, pathRows, route);
	const queryResult = validateQueryParameters(queryRows, route);
	const formResult = isForm && route.bodySchema ? validateFormBody(formBody, route) : { errors: {}, missing: [], invalid: [] };
	const bodyError = isJson && route.bodySchema
		? validateJsonBody(body, route)
		: isBinary && route.bodySchema
			? validateBinaryBody(body, route)
			: undefined;

	const errors: PlaygroundValidationErrors = {
		pathParams: pathResult.errors,
		queryParams: queryResult.errors,
		formFields: formResult.errors,
		bodyError,
	};

	const hasPathErrors = Object.keys(pathResult.errors).length > 0;
	const hasQueryErrors = Object.keys(queryResult.errors).length > 0;
	const hasFormErrors = Object.keys(formResult.errors).length > 0;
	const hasBodyError = Boolean(bodyError);

	if (!hasPathErrors && !hasQueryErrors && !hasFormErrors && !hasBodyError) {
		return { isValid: true, errors };
	}

	if (hasPathErrors) {
		return {
			isValid: false,
			firstErrorTab: "params",
			toastMessage: pathResult.missing.length > 0
				? `Missing required route parameter${pathResult.missing.length > 1 ? "s" : ""}: ${pathResult.missing.map((k) => `:${k}`).join(", ")}`
				: `Route parameter error: ${pathResult.invalid.join("; ")}`,
			errors,
		};
	}

	if (hasQueryErrors) {
		return {
			isValid: false,
			firstErrorTab: "params",
			toastMessage: queryResult.missing.length > 0
				? `Missing required query parameter${queryResult.missing.length > 1 ? "s" : ""}: ${queryResult.missing.join(", ")}`
				: `Query parameter error: ${queryResult.invalid.join("; ")}`,
			errors,
		};
	}

	if (hasFormErrors) {
		return {
			isValid: false,
			firstErrorTab: "body",
			toastMessage: formResult.missing.length > 0
				? `Missing required form field${formResult.missing.length > 1 ? "s" : ""}: ${formResult.missing.join(", ")}`
				: `Form field error: ${formResult.invalid.join("; ")}`,
			errors,
		};
	}

	return {
		isValid: false,
		firstErrorTab: "body",
		toastMessage: bodyError ?? "Invalid request body",
		errors,
	};
}
