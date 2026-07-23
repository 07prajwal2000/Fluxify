import React, { useState, useEffect, useMemo } from "react";
import {
	Box,
	Button,
	Group,
	Stack,
	Text,
	Badge,
	Loader,
	Paper,
	Divider,
	TextInput,
	Textarea,
} from "@mantine/core";
import {
	TbCheck,
	TbPlus,
	TbTerminal2,
	TbPlayerPlayFilled,
	TbDeviceFloppy,
} from "react-icons/tb";
import Editor from "@monaco-editor/react";
import UrlBar from "./components/UrlBar";
import RequestConfig from "./components/RequestConfig";
import AssertionsList from "./components/AssertionsList";
import MockDataEditor from "./components/MockDataEditor";
import TestSuiteHeader from "./components/TestSuiteHeader";
import OverridesEditor from "./components/OverridesEditor";
import { notifications } from "@mantine/notifications";
import { testSuitesQueries } from "@/query/testSuitesQuery";
import { appConfigQuery } from "@/query/appConfigQuery";
import { integrationsQuery } from "@/query/integrationsQuery";
import { useQueryClient } from "@tanstack/react-query";
import FormDialog from "../../../dialog/formDialog";
import ConfirmDialog from "../../../dialog/confirmDialog";
import z from "zod";
import { responseSchema as getByIdResponseSchema } from "@fluxify/server/src/api/v1/routes/get-by-id/dto";
import { getInitialRequestData } from "./utils";

interface TestSuiteEditorProps {
	suiteId: string;
	route: z.infer<typeof getByIdResponseSchema>;
	onDeleted: () => void;
}

const TestSuiteEditor = ({
	suiteId,
	route,
	onDeleted,
}: TestSuiteEditorProps) => {
	const queryClient = useQueryClient();
	const { data: suite, isLoading: isSuiteLoading } =
		testSuitesQueries.getById.useQuery(suiteId);
	const updateSuite = testSuitesQueries.update.useMutation();
	const deleteSuite = testSuitesQueries.delete.useMutation();
	const runSuiteAction = testSuitesQueries.run.useMutation();

	const { data: appConfigsData } = appConfigQuery.getKeysList.useQuery(
		route.projectId!,
		"",
	);
	const { data: integrationsData } = integrationsQuery.getBasicList.query(
		route.projectId!,
	);

	const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
	const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
	const [editingSuiteName, setEditingSuiteName] = useState("");
	const [editingSuiteDesc, setEditingSuiteDesc] = useState("");

	const [running, setRunning] = useState(false);
	const [ran, setRan] = useState(false);
	const [pathParams, setPathParams] = useState<Record<string, string>>({});
	const [queryParams, setQueryParams] = useState<Record<string, string>>({});
	const [headers, setHeaders] = useState<Record<string, string>>({
		"Content-Type": "application/json",
	});
	const [body, setBody] = useState<string>("{\n  \n}");
	const [assertions, setAssertions] = useState<any[]>([]);
	const [appConfigOverrides, setAppConfigOverrides] = useState<any[]>([]);
	const [integrationOverrides, setIntegrationOverrides] = useState<any[]>([]);

	const [actualResponseData, setActualResponseData] = useState<unknown>(null);
	const responseDataRef = React.useRef<HTMLDivElement>(null);
	const scrollAreaRef = React.useRef<HTMLDivElement>(null);

	// Initialize with schema defaults
	useEffect(() => {
		const initialData = getInitialRequestData(route);
		setPathParams(initialData.pathParams);
		setQueryParams(initialData.queryParams);
		setBody(initialData.body);
	}, [route]);

	useEffect(() => {
		if (!suite) {
			return;
		}
		if (suite.routeParams && Object.keys(suite.routeParams).length > 0) {
			setPathParams(suite.routeParams);
		}
		if (suite.queryParams && Object.keys(suite.queryParams).length > 0) {
			setQueryParams(suite.queryParams);
		}
		setHeaders(suite.headers || { "Content-Type": "application/json" });

		const suiteBody = suite.body;
		if (suiteBody) {
			if (
				typeof suiteBody === "string" &&
				(suiteBody as string).trim() !== "" &&
				suiteBody !== "{}" &&
				suiteBody !== "{\n  \n}"
			) {
				setBody(suiteBody);
			} else if (
				typeof suiteBody === "object" &&
				Object.keys(suiteBody).length > 0
			) {
				setBody(JSON.stringify(suiteBody, null, 2));
			}
		}

		const mappedAssertions = (suite.assertions || []).map((a: any) => ({
			id: a.id || Math.random().toString(),
			target: a.target,
			path: a.propertyPath,
			operator: a.operator,
			expected: a.expectedValue,
			customJs: a.customJs,
			message: a.message,
			success: a.success,
		}));
		setAssertions(mappedAssertions.length > 0 ? mappedAssertions : []);

		setAppConfigOverrides(
			Array.isArray((suite as any).appConfigOverrides)
				? (suite as any).appConfigOverrides
				: [],
		);
		setIntegrationOverrides(
			Array.isArray((suite as any).integrationOverrides)
				? (suite as any).integrationOverrides
				: [],
		);

		setRan(false);
	}, [suite]);

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

	const handleSaveData = async (showNotification = true) => {
		let parsedBody;
		try {
			parsedBody = JSON.parse(body);
		} catch {
			parsedBody = body;
		}
		await updateSuite.mutateAsync({
			id: suiteId,
			data: {
				routeParams: pathParams,
				queryParams,
				headers,
				body: parsedBody,
				assertions: assertions.map((a) => ({
					target: a.target,
					propertyPath: a.path,
					operator: a.target === "customJs" ? undefined : a.operator,
					expectedValue:
						a.target === "customJs" ? undefined : String(a.expected),
					customJs: a.customJs,
				})),
				appConfigOverrides,
				integrationOverrides,
			} as any, // Bypass TS error if type is not updated everywhere yet
		});
		testSuitesQueries.getAll.invalidate(queryClient, route.id);

		if (showNotification) {
			notifications.show({
				title: "Success",
				id: "test-suite-saved",
				message: "Test suite saved successfully!",
				color: "green",
			});
		}
	};

	const handleRun = async () => {
		setRunning(true);
		setRan(false);
		try {
			await handleSaveData(false);
			const res = await runSuiteAction.mutateAsync(suiteId);

			setActualResponseData((res as any).actualData);

			const updatedAssertions = assertions.map((a, i) => ({
				...a,
				success: res.result?.[i]?.success,
				message: res.result?.[i]?.message,
			}));
			setAssertions(updatedAssertions);

			setRan(true);
			setTimeout(() => {
				if (scrollAreaRef.current && responseDataRef.current) {
					const top = responseDataRef.current.offsetTop;
					scrollAreaRef.current.scrollTo({ top: top - 20, behavior: "smooth" });
				}
			}, 100);
			if (res.success) {
				notifications.show({
					id: "test-suite-run",
					title: "Success",
					message: "All assertions passed!",
					color: "green",
				});
			} else {
				notifications.show({
					id: "test-suite-run",
					title: "Failed",
					message: "Some assertions failed.",
					color: "red",
				});
			}
		} catch (e: any) {
			notifications.show({
				id: "test-suite-run",
				title: "Error",
				message: "Failed to run test suite.",
				color: "red",
			});
		} finally {
			setRunning(false);
		}
	};

	const addAssertion = () => {
		setAssertions([
			...assertions,
			{
				id: Math.random().toString(),
				target: "body",
				operator: "equals",
				expected: "",
			},
		]);
	};

	const isMockDataDisabled = ["GET", "DELETE"].includes(
		route.method.toUpperCase(),
	);

	return (
		<Box
			style={{
				display: "flex",
				flexDirection: "column",
				height: "100%",
				backgroundColor: "white",
				overflow: "hidden",
			}}
		>
			{isSuiteLoading && (
				<Box
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						backgroundColor: "rgba(255, 255, 255, 0.7)",
						zIndex: 10,
					}}
				>
					<Loader color="violet" />
				</Box>
			)}

			<TestSuiteHeader
				status={
					ran
						? assertions.every((a) => a.success !== false)
							? "passed"
							: "failed"
						: null
				}
				onEdit={() => {
					setEditingSuiteName(suite?.name || "");
					setEditingSuiteDesc(suite?.description || "");
					setIsEditDialogOpen(true);
				}}
				onDelete={() => setIsDeleteDialogOpen(true)}
				actions={
					<Group gap="xs">
						<Button
							color="green.8"
							size="sm"
							leftSection={<TbPlayerPlayFilled size={14} />}
							onClick={handleRun}
							loading={running}
							style={{ fontWeight: 700 }}
						>
							Run Suite
						</Button>
						<Button
							color="violet"
							size="sm"
							onClick={() => handleSaveData(true)}
							loading={updateSuite.isPending}
							variant="light"
							leftSection={<TbDeviceFloppy size={16} />}
						>
							Save
						</Button>
					</Group>
				}
				urlBar={
					<Box>
						<UrlBar method={route.method} path={route.path} />
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
				}
			/>

			{/* Content - Scrollable area */}
			<Box
				style={{
					flex: 1,
					position: "relative",
					minHeight: 0,
					overflow: "hidden",
				}}
			>
				<Box
					ref={scrollAreaRef}
					style={{
						position: "absolute",
						top: 0,
						left: 0,
						right: 0,
						bottom: 0,
						overflowY: "auto",
					}}
				>
					<Box p="xl" maw={1000} mx="auto">
						<Stack gap={40} pb={80}>
							{" "}
							{/* Added significant bottom padding */}
							{/* Added significant bottom padding */}
							{/* Request Config Section */}
							<Box>
								<Text size="sm" fw={700} mb="lg" c="gray.8">
									Request Configuration
								</Text>
								<Paper withBorder radius="md" style={{ overflow: "hidden" }}>
									<RequestConfig
										method={route.method}
										pathParams={pathParams}
										onPathParamsChange={setPathParams}
										queryParams={queryParams}
										onQueryParamsChange={setQueryParams}
										headers={headers}
										onHeadersChange={setHeaders}
										body={body}
										onBodyChange={setBody}
										hideBodyTab={true}
									/>
								</Paper>
							</Box>
							<Divider color="gray.1" />
							{/* Overrides Section */}
							<Box>
								<Paper
									withBorder
									radius="md"
									style={{ overflow: "hidden" }}
									p="md"
								>
									<OverridesEditor
										appConfigOverrides={appConfigOverrides}
										onAppConfigOverridesChange={setAppConfigOverrides}
										integrationOverrides={integrationOverrides}
										onIntegrationOverridesChange={setIntegrationOverrides}
										availableAppConfigs={appConfigsData || []}
										availableIntegrations={integrationsData || []}
									/>
								</Paper>
							</Box>
							{!isMockDataDisabled && (
								<MockDataEditor mockData={body} onChange={setBody} />
							)}
							{ran && (
								<>
									<Divider color="gray.1" />
									<Box ref={responseDataRef}>
										<Group justify="space-between" mb="sm">
											<Group gap="sm">
												<TbTerminal2 size={18} color="#7950F2" />
												<Text size="sm" fw={700} c="gray.8">
													Response Output
												</Text>
											</Group>
											<Button
												variant="subtle"
												color="gray"
												size="xs"
												onClick={() => setRan(false)}
											>
												Clear
											</Button>
										</Group>
										<Paper withBorder radius="md" bg="#F9FAFB" p="md">
											<Text size="xs" c="gray.5" mb="md">
												This is the actual JSON payload returned by the server
												during the last test suite execution. It is read-only
												and provided for your reference to debug assertions.
											</Text>
											<Paper
												withBorder
												radius="md"
												style={{ overflow: "hidden", position: "relative" }}
											>
												<Box
													pos="absolute"
													top={10}
													right={10}
													style={{ zIndex: 5 }}
												>
													<Badge
														variant="light"
														color="gray"
														size="sm"
														radius="sm"
													>
														JSON
													</Badge>
												</Box>
												<Editor
													height="200px"
													defaultLanguage="json"
													theme="vs-light"
													value={JSON.stringify(actualResponseData, null, 2)}
													options={{
														readOnly: true,
														minimap: { enabled: false },
														fontSize: 13,
														scrollBeyondLastLine: false,
														padding: { top: 10, bottom: 10 },
													}}
												/>
											</Paper>
										</Paper>
									</Box>
								</>
							)}
							{/* Assertions Section */}
							<Box>
								<Group justify="space-between" mb="sm">
									<Group gap="sm">
										<TbCheck size={18} color="#10B981" />
										<Text size="sm" fw={700} c="gray.8">
											Assertions
										</Text>
									</Group>
									<Button
										variant="subtle"
										color="violet"
										size="xs"
										leftSection={<TbPlus size={14} />}
										onClick={addAssertion}
									>
										Add Assertion
									</Button>
								</Group>
								<AssertionsList
									assertions={assertions}
									onChange={setAssertions}
									ran={ran}
								/>
							</Box>
						</Stack>
					</Box>
				</Box>
			</Box>

			{/* Edit Dialog */}
			<FormDialog
				title="Edit Test Suite"
				open={isEditDialogOpen}
				onClose={() => setIsEditDialogOpen(false)}
			>
				<Stack>
					<TextInput
						label="Name"
						required
						value={editingSuiteName}
						onChange={(e) => setEditingSuiteName(e.currentTarget.value)}
					/>
					<Textarea
						label="Description"
						value={editingSuiteDesc}
						onChange={(e) => setEditingSuiteDesc(e.currentTarget.value)}
					/>
					<Button
						color="violet"
						fullWidth
						onClick={async () => {
							if (!editingSuiteName) return;
							await updateSuite.mutateAsync({
								id: suiteId,
								data: { name: editingSuiteName, description: editingSuiteDesc },
							});
							testSuitesQueries.getAll.invalidate(queryClient, route.id);
							testSuitesQueries.getById.invalidate(queryClient, suiteId);
							setIsEditDialogOpen(false);
						}}
						disabled={!editingSuiteName}
						loading={updateSuite.isPending}
					>
						Save Changes
					</Button>
				</Stack>
			</FormDialog>

			{/* Delete Dialog */}
			<ConfirmDialog
				title="Delete Test Suite"
				open={isDeleteDialogOpen}
				onClose={() => setIsDeleteDialogOpen(false)}
				onConfirm={async () => {
					await deleteSuite.mutateAsync(suiteId);
					testSuitesQueries.getAll.invalidate(queryClient, route.id);
					setIsDeleteDialogOpen(false);
					onDeleted();
				}}
				confirmColor="red"
				confirmText="Delete"
			>
				<Box p="xs">
					Are you sure you want to delete <b>{suite?.name}</b>? This action
					cannot be undone.
				</Box>
			</ConfirmDialog>
		</Box>
	);
};

export default TestSuiteEditor;
