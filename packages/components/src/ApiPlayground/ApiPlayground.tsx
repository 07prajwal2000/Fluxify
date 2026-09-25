import { Button, Card, Input, toast } from "@heroui/react";
import clsx from "clsx";
import { Fragment, useEffect, useMemo, useState } from "react";
import { TbLoader2, TbPlayerPlayFilled } from "react-icons/tb";
import { RequestPanel } from "./RequestPanel";
import { ResponsePanel } from "./ResponsePanel";
import type {
	ApiKeyValue,
	ApiPlaygroundProps,
	ApiPlaygroundRequest,
	ApiPlaygroundResponse,
	ApiPlaygroundState,
	ApiRequestBody,
} from "./types";
import {
	createRow,
	emptyRequestBody,
	methodTakesBody,
	pathParameterNames,
	resolvePathRows,
	resolveQueryRows,
	serializeRequestBody,
} from "./utils";
import { type PlaygroundValidationErrors, validatePlaygroundRequest } from "./validation";

const toObject = (rows: ApiKeyValue[]) =>
	Object.fromEntries(rows.filter((row) => row.key).map((row) => [row.key, row.value]));

export function ApiPlayground({
	route,
	baseUrl = "",
	onSend,
	className,
	isFramed = true,
	initialPathParams,
	initialQuery,
	initialHeaders,
	initialBody,
	initialState,
	defaultValidate = true,
	onRequestChange,
	onStateChange,
}: ApiPlaygroundProps) {
	const [rawPath, setRawPath] = useState(route.path);
	const [pathRows, setPathRows] = useState<ApiKeyValue[]>(() =>
		resolvePathRows(route.path, initialPathParams, initialState?.pathRows),
	);
	const [queryRows, setQueryRows] = useState<ApiKeyValue[]>(() =>
		resolveQueryRows(route.querySchema, initialQuery, initialState?.queryRows),
	);
	const defaultContentType = route.acceptedContentTypes?.[0] ?? "application/json";
	const [contentType, setContentType] = useState(initialState?.contentType ?? defaultContentType);
	const [headerRows, setHeaderRows] = useState<ApiKeyValue[]>(() => {
		if (initialState?.headerRows && initialState.headerRows.length > 0) {
			return initialState.headerRows;
		}
		return [
			createRow("Content-Type", defaultContentType, true),
			...Object.entries(initialHeaders ?? {})
				.filter(([key]) => key.toLowerCase() !== "content-type")
				.map(([key, value]) => createRow(key, value)),
		];
	});
	const [requestBody, setRequestBody] = useState<ApiRequestBody>(
		() => initialState?.requestBody ?? emptyRequestBody(initialBody ?? "{} "),
	);
	const [response, setResponse] = useState<ApiPlaygroundResponse | undefined>(
		initialState?.response,
	);
	const [isSending, setIsSending] = useState(false);
	const [selectedTab, setSelectedTab] = useState("params");
	const [validateBeforeSend, setValidateBeforeSend] = useState(
		initialState?.validateBeforeSend ?? defaultValidate ?? true,
	);
	const [errors, setErrors] = useState<PlaygroundValidationErrors>({
		pathParams: {},
		queryParams: {},
		formFields: {},
	});

	// A typed path input is rebuilt from its :name tokens; values survive harmless URL edits.
	useEffect(
		() =>
			setPathRows((current) =>
				pathParameterNames(rawPath).map((key) =>
					createRow(
						key,
						current.find((row) => row.key === key)?.value ?? initialPathParams?.[key] ?? "",
						true,
					),
				),
			),
		[rawPath, initialPathParams],
	);
	useEffect(
		() =>
			setHeaderRows((current) =>
				current.map((row) =>
					row.key.toLowerCase() === "content-type" ? { ...row, value: contentType } : row,
				),
			),
		[contentType],
	);

	const request = useMemo(
		() =>
			buildRequest({
				route,
				rawPath,
				baseUrl,
				pathRows,
				queryRows,
				headerRows,
				requestBody,
				contentType,
			}),
		[route, rawPath, baseUrl, pathRows, queryRows, headerRows, requestBody, contentType],
	);
	useEffect(() => {
		onRequestChange?.({
			method: request.method,
			path: request.path,
			pathParams: request.pathParams,
			query: request.query,
			headers: request.headers,
			contentType: request.contentType,
		});
	}, [onRequestChange, request]);
	useEffect(() => {
		onStateChange?.({
			pathRows,
			queryRows,
			headerRows,
			contentType,
			requestBody,
			response,
			validateBeforeSend,
		});
	}, [
		onStateChange,
		pathRows,
		queryRows,
		headerRows,
		contentType,
		requestBody,
		response,
		validateBeforeSend,
	]);

	function handlePathRowsChange(rows: ApiKeyValue[]) {
		setPathRows(rows);
		if (Object.keys(errors.pathParams).length > 0) {
			setErrors((current) => {
				const nextPathParams = { ...current.pathParams };
				for (const row of rows) {
					if (row.value.trim() && nextPathParams[row.key]) {
						delete nextPathParams[row.key];
					}
				}
				return { ...current, pathParams: nextPathParams };
			});
		}
	}

	function handleQueryRowsChange(rows: ApiKeyValue[]) {
		setQueryRows(rows);
		if (Object.keys(errors.queryParams).length > 0) {
			setErrors((current) => {
				const nextQueryParams = { ...current.queryParams };
				for (const row of rows) {
					if (row.value.trim() && nextQueryParams[row.key]) {
						delete nextQueryParams[row.key];
					}
				}
				return { ...current, queryParams: nextQueryParams };
			});
		}
	}

	function handleRequestBodyChange(value: ApiRequestBody) {
		setRequestBody(value);
		if (errors.bodyError || Object.keys(errors.formFields).length > 0) {
			setErrors((current) => ({ ...current, bodyError: undefined, formFields: {} }));
		}
	}

	function handleValidateChange(checked: boolean) {
		setValidateBeforeSend(checked);
		if (!checked) {
			setErrors({ pathParams: {}, queryParams: {}, formFields: {} });
		}
	}

	async function send() {
		if (validateBeforeSend) {
			const validation = validatePlaygroundRequest({
				route,
				rawPath,
				pathRows,
				queryRows,
				contentType,
				body: requestBody.raw,
				formBody: requestBody.form,
				binary: requestBody.binary,
			});

			if (!validation.isValid) {
				toast.danger("Validation failed");
				setErrors(validation.errors);
				if (validation.firstErrorTab) {
					setSelectedTab(validation.firstErrorTab);
				}
				return;
			}
		}

		setErrors({ pathParams: {}, queryParams: {}, formFields: {} });
		setIsSending(true);
		try {
			setResponse(await onSend(request));
		} finally {
			setIsSending(false);
		}
	}

	return (
		<Card
			style={{ padding: 0, gap: 0 }}
			className={clsx(
				"flex h-full min-h-0 flex-col overflow-hidden bg-background text-foreground",
				isFramed ? "border-border" : "rounded-none border-0",
				className,
			)}
		>
			<div className="shrink-0 border-b border-border px-4 py-3">
				<div className="flex h-10 gap-2">
					<span
						style={{ width: 78 }}
						className="inline-flex shrink-0 items-center justify-center rounded-l-md border border-border bg-surface font-mono text-[13px] font-bold text-accent"
					>
						{route.method}
					</span>
					<Input
						aria-label="Request URL"
						readOnly
						value={rawPath}
						className="h-10 min-w-0 flex-1 rounded-r-md font-mono text-[13px]"
					/>
					<Button
						isDisabled={isSending}
						onPress={send}
						style={{ width: 112 }}
						className="h-10 shrink-0 font-semibold"
					>
						<span className="grid w-4 place-items-center">
							{isSending ? (
								<TbLoader2 className="animate-spin" size={16} />
							) : (
								<TbPlayerPlayFilled size={15} />
							)}
						</span>
						<span>{isSending ? "Sending" : "Send"}</span>
					</Button>
				</div>
				<div className="mt-1.5 flex min-w-0 items-center gap-2 overflow-hidden font-mono text-[11px]">
					<span className="shrink-0 text-muted">preview:</span>
					<PreviewUrl
						baseUrl={baseUrl}
						rawPath={rawPath}
						pathRows={pathRows}
						queryRows={queryRows}
					/>
				</div>
			</div>
			<div
				className="min-h-0 flex-1 overflow-hidden"
				style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.08fr) minmax(0, 0.92fr)" }}
			>
				<RequestPanel
					route={route}
					rawPath={rawPath}
					pathRows={pathRows}
					queryRows={queryRows}
					headerRows={headerRows}
					requestBody={requestBody}
					contentType={contentType}
					selectedTab={selectedTab}
					onTabChange={setSelectedTab}
					errors={errors}
					validateBeforeSend={validateBeforeSend}
					onValidateChange={handleValidateChange}
					onPathRowsChange={handlePathRowsChange}
					onQueryRowsChange={handleQueryRowsChange}
					onHeaderRowsChange={setHeaderRows}
					onRequestBodyChange={handleRequestBodyChange}
					onContentTypeChange={setContentType}
				/>
				<ResponsePanel response={response} />
			</div>
		</Card>
	);
}

function PreviewUrl({
	baseUrl,
	rawPath,
	pathRows,
	queryRows,
}: {
	baseUrl: string;
	rawPath: string;
	pathRows: ApiKeyValue[];
	queryRows: ApiKeyValue[];
}) {
	const pathParams = toObject(pathRows);
	const query = toObject(queryRows);
	const queryString = new URLSearchParams(
		Object.entries(query).filter(([, value]) => value !== ""),
	).toString();
	const parts = rawPath.split(/(:[A-Za-z0-9_]+)/g);
	return (
		<span className="truncate text-foreground">
			{baseUrl.replace(/\/$/, "")}
			{parts.map((part, index) => {
				if (!part.startsWith(":")) return <Fragment key={`${part}-${index}`}>{part}</Fragment>;
				const key = part.slice(1);
				return pathParams[key] ? (
					<Fragment key={key}>{encodeURIComponent(pathParams[key])}</Fragment>
				) : (
					<span className="text-danger" key={key}>{`<${key}>`}</span>
				);
			})}
			{queryString ? `${rawPath.includes("?") ? "&" : "?"}${queryString}` : ""}
		</span>
	);
}

function buildRequest({
	route,
	rawPath,
	baseUrl,
	pathRows,
	queryRows,
	headerRows,
	requestBody,
	contentType,
}: {
	route: ApiPlaygroundProps["route"];
	rawPath: string;
	baseUrl: string;
	pathRows: ApiKeyValue[];
	queryRows: ApiKeyValue[];
	headerRows: ApiKeyValue[];
	requestBody: ApiRequestBody;
	contentType: string;
}): ApiPlaygroundRequest {
	const pathParams = toObject(pathRows);
	const query = toObject(queryRows);
	const headers = toObject(headerRows);
	const expandedPath = rawPath.replace(/:([A-Za-z0-9_]+)/g, (_, key: string) =>
		encodeURIComponent(pathParams[key] ?? `:${key}`),
	);
	const queryString = new URLSearchParams(
		Object.entries(query).filter(([, value]) => value !== ""),
	).toString();
	const url = `${baseUrl.replace(/\/$/, "")}${expandedPath}${queryString ? `${expandedPath.includes("?") ? "&" : "?"}${queryString}` : ""}`;
	return {
		method: route.method,
		path: rawPath,
		url,
		pathParams,
		query,
		headers,
		contentType,
		body: methodTakesBody(route.method)
			? serializeRequestBody(requestBody, contentType, route.bodySchema)
			: undefined,
	};
}
