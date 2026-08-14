import clsx from "clsx";
import { Fragment, useEffect, useMemo, useState } from "react";
import { TbLoader2, TbPlayerPlayFilled } from "react-icons/tb";
import { Button, Card, Input } from "@heroui/react";
import { RequestPanel } from "./RequestPanel";
import { ResponsePanel } from "./ResponsePanel";
import type { ApiFormValue, ApiKeyValue, ApiPlaygroundProps, ApiPlaygroundRequest, ApiPlaygroundResponse } from "./types";
import { createRow, pathParameterNames, schemaProperties, serializeFormBody } from "./utils";

const toObject = (rows: ApiKeyValue[]) => Object.fromEntries(rows.filter((row) => row.key).map((row) => [row.key, row.value]));

export function ApiPlayground({ route, baseUrl = "", onSend, className, isFramed = true, initialPathParams, initialQuery, initialHeaders, initialBody, onRequestChange }: ApiPlaygroundProps) {
	const [rawPath, setRawPath] = useState(route.path);
	const [pathRows, setPathRows] = useState<ApiKeyValue[]>(() => pathParameterNames(route.path).map((key) => createRow(key, initialPathParams?.[key] ?? "", true)));
	const [queryRows, setQueryRows] = useState<ApiKeyValue[]>(() => schemaProperties(route.querySchema).map((field) => createRow(field.key, initialQuery?.[field.key] ?? "", field.required)));
	const defaultContentType = route.acceptedContentTypes?.[0] ?? "application/json";
	const [contentType, setContentType] = useState(defaultContentType);
	const [headerRows, setHeaderRows] = useState<ApiKeyValue[]>(() => [createRow("Content-Type", defaultContentType, true), ...Object.entries(initialHeaders ?? {}).filter(([key]) => key.toLowerCase() !== "content-type").map(([key, value]) => createRow(key, value))]);
	const [body, setBody] = useState(initialBody ?? "{} ");
	const [formBody, setFormBody] = useState<Record<string, ApiFormValue>>({});
	const [response, setResponse] = useState<ApiPlaygroundResponse>();
	const [isSending, setIsSending] = useState(false);

	// A typed path input is rebuilt from its :name tokens; values survive harmless URL edits.
	useEffect(() => setPathRows((current) => pathParameterNames(rawPath).map((key) => createRow(key, current.find((row) => row.key === key)?.value ?? initialPathParams?.[key] ?? "", true))), [rawPath, initialPathParams]);
	useEffect(() => setHeaderRows((current) => current.map((row) => row.key.toLowerCase() === "content-type" ? { ...row, value: contentType } : row)), [contentType]);

	const request = useMemo(() => buildRequest({ route, rawPath, baseUrl, pathRows, queryRows, headerRows, body, formBody, contentType }), [route, rawPath, baseUrl, pathRows, queryRows, headerRows, body, formBody, contentType]);
	useEffect(() => { onRequestChange?.({ method: request.method, path: request.path, pathParams: request.pathParams, query: request.query, headers: request.headers, contentType: request.contentType }); }, [onRequestChange, request]);

	async function send() {
		setIsSending(true);
		try { setResponse(await onSend(request)); } finally { setIsSending(false); }
	}

	return <Card style={{ padding: 0, gap: 0 }} className={clsx("flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground", isFramed ? "border-border" : "rounded-none border-0", className)}>
		<div className="shrink-0 border-b border-border px-4 py-3">
			<div className="flex h-10 gap-2"><span style={{ width: 78 }} className="inline-flex shrink-0 items-center justify-center rounded-l-md border border-border bg-surface font-mono text-[13px] font-bold text-accent">{route.method}</span><Input aria-label="Request URL" readOnly value={rawPath} className="h-10 min-w-0 flex-1 rounded-r-md font-mono text-[13px]" /><Button isDisabled={isSending} onPress={send} style={{ width: 112 }} className="h-10 shrink-0 font-semibold"><span className="grid w-4 place-items-center">{isSending ? <TbLoader2 className="animate-spin" size={16} /> : <TbPlayerPlayFilled size={15} />}</span><span>{isSending ? "Sending" : "Send"}</span></Button></div>
			<div className="mt-1.5 flex min-w-0 items-center gap-2 overflow-hidden font-mono text-[11px]"><span className="shrink-0 text-muted">preview:</span><PreviewUrl baseUrl={baseUrl} rawPath={rawPath} pathRows={pathRows} queryRows={queryRows} /></div>
		</div>
		<div className="min-h-0 flex-1 overflow-hidden" style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.08fr) minmax(0, 0.92fr)" }}>
			<RequestPanel route={route} rawPath={rawPath} pathRows={pathRows} queryRows={queryRows} headerRows={headerRows} body={body} formBody={formBody} contentType={contentType} onPathRowsChange={setPathRows} onQueryRowsChange={setQueryRows} onHeaderRowsChange={setHeaderRows} onBodyChange={setBody} onFormBodyChange={setFormBody} onContentTypeChange={setContentType} />
			<ResponsePanel response={response} />
		</div>
	</Card>;
}

function PreviewUrl({ baseUrl, rawPath, pathRows, queryRows }: { baseUrl: string; rawPath: string; pathRows: ApiKeyValue[]; queryRows: ApiKeyValue[] }) {
	const pathParams = toObject(pathRows);
	const query = toObject(queryRows);
	const queryString = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== "")).toString();
	const parts = rawPath.split(/(:[A-Za-z0-9_]+)/g);
	return <span className="truncate text-foreground">{baseUrl.replace(/\/$/, "")}{parts.map((part, index) => {
		if (!part.startsWith(":")) return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
		const key = part.slice(1);
		return pathParams[key] ? <Fragment key={key}>{encodeURIComponent(pathParams[key])}</Fragment> : <span className="text-danger" key={key}>{`<${key}>`}</span>;
	})}{queryString ? `${rawPath.includes("?") ? "&" : "?"}${queryString}` : ""}</span>;
}

function buildRequest({ route, rawPath, baseUrl, pathRows, queryRows, headerRows, body, formBody, contentType }: { route: ApiPlaygroundProps["route"]; rawPath: string; baseUrl: string; pathRows: ApiKeyValue[]; queryRows: ApiKeyValue[]; headerRows: ApiKeyValue[]; body: string; formBody: Record<string, ApiFormValue>; contentType: string }): ApiPlaygroundRequest {
	const pathParams = toObject(pathRows);
	const query = toObject(queryRows);
	const headers = toObject(headerRows);
	const expandedPath = rawPath.replace(/:([A-Za-z0-9_]+)/g, (_, key: string) => encodeURIComponent(pathParams[key] ?? `:${key}`));
	const queryString = new URLSearchParams(Object.entries(query).filter(([, value]) => value !== "")).toString();
	const url = `${baseUrl.replace(/\/$/, "")}${expandedPath}${queryString ? `${expandedPath.includes("?") ? "&" : "?"}${queryString}` : ""}`;
	const isForm = contentType === "application/x-www-form-urlencoded" || contentType === "multipart/form-data";
	const payload = isForm ? serializeFormBody(formBody, contentType) : body;
	return { method: route.method, path: rawPath, url, pathParams, query, headers, contentType, body: route.bodySchema ? payload : undefined };
}
