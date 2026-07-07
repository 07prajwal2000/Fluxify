import { useState, useEffect, useMemo } from "react";
import { Box, Button, Loader, Stack, Text, Tooltip } from "@mantine/core";
import { TbPlayerPlayFilled } from "react-icons/tb";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import UrlBar from "./components/UrlBar";
import RequestConfig from "./components/RequestConfig";
import ResponseSection from "./components/ResponseSection";
import z from "zod";
import { responseSchema as getByIdResponseSchema } from "@fluxify/server/src/api/v1/routes/get-by-id/dto";
import { showNotification } from "@mantine/notifications";
import { ValidationSchema, SchemaProperty } from "@/types/schemaEditor";

function generateSampleData(prop: ValidationSchema | SchemaProperty): unknown {
	if (!prop) return null;
	if (prop.dataType === 'str') return "string";
	if (prop.dataType === 'int') return 0;
	if (prop.dataType === 'float') return 0.0;
	if (prop.dataType === 'bool') return false;
	if (prop.dataType === 'enum') {
		const enumRule = prop.rules?.find((r: any) => r.type === 'enum');
		if (enumRule && Array.isArray(enumRule.value) && enumRule.value.length > 0) {
			return enumRule.value[0];
		}
		return "enum_value";
	}
	if (prop.dataType === 'arr') {
		const p = prop as SchemaProperty;
		if (p.items) return [generateSampleData(p.items)];
		return [];
	}
	if (prop.dataType === 'object') {
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

const Playground = ({
	route,
}: {
	route: z.infer<typeof getByIdResponseSchema>;
}) => {
	const [pathParams, setPathParams] = useState<Record<string, string>>(() => {
		const params = route.path.match(/:[a-zA-Z0-9_]+/g);
		const initial: Record<string, string> = {};
		if (params) {
			params.forEach((p: string) => {
				initial[p.substring(1)] = "";
			});
		}
		return initial;
	});
	const [queryParams, setQueryParams] = useState<Record<string, string>>(() => {
		const initialQuery: Record<string, string> = {};
		const querySchema = route.querySchema as ValidationSchema | undefined;
		if (querySchema?.properties) {
			querySchema.properties.forEach((p: SchemaProperty) => {
				if (p.key) {
					initialQuery[p.key] = "";
				}
			});
		}
		return initialQuery;
	});
	const [headers, setHeaders] = useState<Record<string, string>>({
		"Content-Type": "application/json",
	});
	const [body, setBody] = useState<string>(() => {
		const bodySchema = route.bodySchema as ValidationSchema | undefined;
		if (bodySchema) {
			const sampleData = generateSampleData(bodySchema);
			if (sampleData && typeof sampleData === 'object' && Object.keys(sampleData).length > 0) {
				return JSON.stringify(sampleData, null, 2);
			} else if (Array.isArray(sampleData) && sampleData.length > 0) {
				return JSON.stringify(sampleData, null, 2);
			}
		}
		return "{\n  \n}";
	});

	const resolvedUrl = useMemo(() => {
		let finalPath = route.path;
		Object.entries(pathParams).forEach(([key, value]) => {
			finalPath = finalPath.replace(`:${key}`, value || `:${key}`);
		});

		const searchParams = new URLSearchParams();
		Object.entries(queryParams).forEach(([key, value]) => {
			if (key) searchParams.append(key, value);
		});

		const qs = searchParams.toString();
		return `${window.location.origin}${finalPath}${qs ? `?${qs}` : ""}`;
	}, [route.path, pathParams, queryParams]);

	const fetchRequest = async () => {
		const startTime = Date.now();

		try {
			let finalPath = route.path;
			let errors = 0;
			Object.entries(pathParams).forEach(([key, value]) => {
				if (!value) {
					errors++;
				}
				finalPath = finalPath.replace(
					`:${key}`,
					encodeURIComponent(value || `:${key}`),
				);
			});
			if (errors > 0) {
				showNotification({
					title: "Error",
					message: "Please fill in all path parameters",
					color: "red",
					id: "path-params-error",
				});
				return;
			}

			let parsedBody;
			try {
				parsedBody = JSON.parse(body);
				if (
					["POST", "PUT"].includes(route.method.toUpperCase()) &&
					(!!parsedBody || Object.keys(parsedBody).length === 0)
				) {
					showNotification({
						title: "Error",
						message: "Invalid JSON body",
						color: "red",
						id: "invalid-json-body",
					});
					return;
				}
			} catch (e) {
				showNotification({
					title: "Error",
					message: "Invalid JSON body",
					color: "red",
					id: "invalid-json-body",
				});
				return;
			}

			const res = await axios({
				method: route.method,
				url: finalPath,
				baseURL: window.location.origin,
				headers,
				params: queryParams,
				data: !["GET", "DELETE"].includes(route.method.toUpperCase())
					? parsedBody
					: undefined,
			});

			return {
				status: res.status,
				statusText: res.statusText,
				data: res.data,
				headers: res.headers,
				time: Date.now() - startTime,
				size: formatBytes(JSON.stringify(res.data).length),
			};
		} catch (err: any) {
			return {
				status: err.response?.status || 500,
				statusText: err.response?.statusText || "Error",
				data: err.response?.data || { error: err.message },
				headers: err.response?.headers || {},
				time: Date.now() - startTime,
				size: formatBytes(JSON.stringify(err.response?.data || {}).length),
			};
		}
	};

	const {
		data: response,
		isFetching: loading,
		refetch,
	} = useQuery({
		queryKey: ["playground", route.id],
		queryFn: fetchRequest,
		enabled: false,
		staleTime: Infinity,
	});

	const handleSend = () => {
		refetch();
	};

	return (
		<Box
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				overflow: "hidden",
			}}
		>
			{/* Top Bar */}
			<Box p="lg" bg="white" style={{ borderBottom: "1px solid #eee" }}>
				<UrlBar
					method={route.method}
					path={route.path}
					rightSection={
						<Tooltip label="Route is disabled" disabled={route.active}>
							<Box style={{ display: 'inline-block' }}>
								<Button
									color="violet.6"
									size="md"
									px="xl"
									leftSection={
										loading ? (
											<Loader size="xs" color="white" />
										) : (
											<TbPlayerPlayFilled size={16} />
										)
									}
									onClick={handleSend}
									disabled={loading || !route.active}
									style={{ fontWeight: 700 }}
									variant="filled"
									radius={"sm"}
									h={44}
								>
									Send
								</Button>
							</Box>
						</Tooltip>
					}
				/>
				<Box mt="xs" px={4}>
					<Text
						size="11px"
						c="dimmed"
						fw={500}
						style={{ fontFamily: "monospace", wordBreak: "break-all" }}
					>
						Preview: <span style={{ color: "#7950F2" }}>{resolvedUrl}</span>
					</Text>
				</Box>
			</Box>

			{/* Main Content Side-by-Side */}
			<Box style={{ flex: 1, display: "flex", overflow: "hidden" }}>
				{/* Left Side: Request Config */}
				<Box
					style={{
						flex: 1,
						borderRight: "1px solid #eee",
						display: "flex",
						flexDirection: "column",
						minWidth: 0,
					}}
				>
					<RequestConfig
						method={route.method}
						pathParams={pathParams}
						onPathParamsChange={setPathParams}
						queryParams={queryParams}
						onQueryParamsChange={setQueryParams}
						querySchema={route.querySchema as ValidationSchema | undefined}
						headers={headers}
						onHeadersChange={setHeaders}
						body={body}
						onBodyChange={setBody}
					/>
				</Box>

				{/* Right Side: Response Section */}
				<Box
					style={{
						flex: 1,
						display: "flex",
						flexDirection: "column",
						minWidth: 0,
					}}
				>
					{response ? (
						<ResponseSection
							status={response.status}
							statusText={response.statusText}
							time={response.time}
							size={response.size}
							data={response.data}
							headers={response.headers}
						/>
					) : (
						<Box
							h="100%"
							style={{
								display: "flex",
								alignItems: "center",
								justifyContent: "center",
								backgroundColor: "#F9FAFB",
							}}
						>
							<Stack align="center" gap="sm">
								<Box style={{ color: "#E5E7EB" }}>
									<TbPlayerPlayFilled size={64} />
								</Box>
								<Text c="gray.4" size="sm" fw={500}>
									Enter parameters and click Send to get a response
								</Text>
							</Stack>
						</Box>
					)}
				</Box>
			</Box>
		</Box>
	);
};

const formatBytes = (bytes: number) => {
	if (bytes === 0) return "0 B";
	const k = 1024;
	const sizes = ["B", "KB", "MB", "GB"];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

export default Playground;
