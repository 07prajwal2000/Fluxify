import {
	Button,
	Input,
	Label,
	Modal,
	Spinner,
	Table,
	TextField,
	toast,
} from "@heroui/react";
import clsx from "clsx";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ReactNode } from "react";
import {
	TbCloudCog,
	TbDatabase,
	TbExternalLink,
	TbPlugConnected,
	TbPlus,
	TbRefresh,
	TbSearch,
} from "react-icons/tb";
import { CloseButton } from "../CloseButton";
import { integrationIcons } from "./integrationIcons";
import type {
	Integration,
	IntegrationSelectorProps,
	LoadStatus,
	ModalSize,
	TestStatus,
} from "./types";

// ─── constants ────────────────────────────────────────────────────────────────

const TEST_RESET_MS = 5_000;

type HeroUIModalContainerSize = "cover" | "full" | "lg" | "md" | "sm" | "xs";

const MODAL_SIZE_CONFIG: Record<
	ModalSize,
	{
		container: HeroUIModalContainerSize;
		dialog: string;
		minHeight: string;
		height: string;
	}
> = {
	xs: { container: "xs", dialog: "max-w-xs", minHeight: "40vh", height: "45vh" },
	sm: { container: "sm", dialog: "max-w-md", minHeight: "50vh", height: "55vh" },
	md: { container: "md", dialog: "max-w-xl", minHeight: "60vh", height: "65vh" },
	lg: { container: "lg", dialog: "max-w-4xl", minHeight: "68vh", height: "72vh" },
	xl: { container: "lg", dialog: "max-w-5xl", minHeight: "72vh", height: "78vh" },
	"2xl": { container: "full", dialog: "max-w-6xl", minHeight: "75vh", height: "82vh" },
	full: { container: "full", dialog: "max-w-[95vw]", minHeight: "90vh", height: "92vh" },
};

// ─── sub-components ───────────────────────────────────────────────────────────

function IntegrationIcon({ variant }: { variant: string }) {
	const icon = integrationIcons[variant];
	return (
		<span className="inline-flex shrink-0 items-center justify-center text-foreground/70">
			{icon ?? <TbDatabase size={20} />}
		</span>
	);
}

function FieldLabel({ label }: { label: string | ReactNode }) {
	if (typeof label === "string") {
		return (
			<span className="text-sm font-semibold text-foreground">{label}</span>
		);
	}
	return <>{label}</>;
}

// ─── Picker Modal ─────────────────────────────────────────────────────────────

interface PickerModalProps {
	isOpen: boolean;
	onClose: () => void;
	integrations: Integration[];
	selectedId: string;
	onSelect: (id: string) => void;
	createIntegrationUrl?: string;
	modalSize?: ModalSize;
	modalHeight?: string;
}

function PickerModal({
	isOpen,
	onClose,
	integrations,
	selectedId,
	onSelect,
	createIntegrationUrl,
	modalSize = "lg",
	modalHeight,
}: PickerModalProps) {
	const [search, setSearch] = useState("");

	// Reset search whenever modal re-opens
	useEffect(() => {
		if (isOpen) setSearch("");
	}, [isOpen]);

	const filtered = useMemo(() => {
		const q = search.trim().toLowerCase();
		if (!q) return integrations;
		return integrations.filter(
			(i) =>
				i.name.toLowerCase().includes(q) ||
				i.variant.toLowerCase().includes(q) ||
				i.group.toLowerCase().includes(q),
		);
	}, [integrations, search]);

	function handleSelect(id: string) {
		onSelect(id);
		onClose();
	}

	const hasIntegrations = integrations.length > 0;
	const hasResults = filtered.length > 0;
	const sizeConfig = MODAL_SIZE_CONFIG[modalSize] ?? MODAL_SIZE_CONFIG.lg;

	return (
		<Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size={sizeConfig.container}>
					<Modal.Dialog
						className={clsx(
							"w-full flex flex-col max-h-[90vh]",
							sizeConfig.dialog,
						)}
						style={{
							minHeight: modalHeight ? undefined : sizeConfig.minHeight,
							height: modalHeight || sizeConfig.height,
						}}
					>
						{/* ── Header — title with sidebar integration icon ───────── */}
						<Modal.Header className="px-5 py-3.5 pb-2 shrink-0 border-b border-border/50">
							<div className="flex w-full items-center justify-between">
								<div className="flex items-center gap-2.5">
									<div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-foreground">
										<TbCloudCog className="size-4 text-foreground/80" />
									</div>
									<Modal.Heading className="text-sm font-semibold text-foreground">
										Choose Integration
									</Modal.Heading>
								</div>
								<CloseButton onPress={onClose} />
							</div>
						</Modal.Header>

						{/* ── Search — full-width HeroUI Input ─────────────────── */}
						<div className="px-5 py-3 shrink-0">
							<TextField value={search} onChange={setSearch} className="w-full">
								<Label className="sr-only">Search integrations</Label>
								<Input placeholder="Search by name, variant or group…" />
							</TextField>
						</div>

						{/* ── Body: table or empty states (exact height container) ── */}
						<Modal.Body className="p-0 flex-1 min-h-0 overflow-y-auto">
							{!hasIntegrations ? (
								/* No integrations exist at all */
								<div className="flex flex-col items-center justify-center gap-5 px-8 h-full text-center">
									<span className="flex h-16 w-16 items-center justify-center rounded-full border border-border bg-surface-secondary text-muted-foreground">
										<TbDatabase size={32} />
									</span>
									<div className="flex flex-col gap-1.5">
										<p className="text-sm font-semibold text-foreground">
											No integrations found
										</p>
										<p className="max-w-[280px] text-xs leading-relaxed text-muted-foreground">
											You haven't connected any integrations yet. Create one to
											get started.
										</p>
									</div>
									{createIntegrationUrl && (
										<Button
											variant="primary"
											size="sm"
											onPress={() => {
												window.open(createIntegrationUrl, "_blank", "noopener,noreferrer");
											}}
										>
											<TbPlus size={14} className="mr-1" />
											Create Integration
										</Button>
									)}
								</div>
							) : !hasResults ? (
								/* Search produced no results */
								<div className="flex flex-col items-center justify-center gap-2 px-8 h-full text-center">
									<TbSearch size={28} className="text-muted-foreground" />
									<p className="text-sm text-muted-foreground">
										No integrations match{" "}
										<strong className="text-foreground">"{search}"</strong>
									</p>
								</div>
							) : (
								/* ── Table — matches AppConfigTable pattern exactly ── */
								<Table>
									<Table.Content aria-label="Integrations">
										<Table.Header className="bg-surface-secondary">
											<Table.Column id="icon" aria-label="Icon">{""}</Table.Column>
											<Table.Column id="name" isRowHeader>Name</Table.Column>
											<Table.Column id="variant">Variant</Table.Column>
											<Table.Column id="group">Group</Table.Column>
											<Table.Column id="action" aria-label="Action">{""}</Table.Column>
										</Table.Header>
										<Table.Body items={filtered}>
											{(integration: Integration) => (
												<Table.Row
													id={integration.id}
													className={clsx(
														"cursor-pointer transition-colors",
														integration.id === selectedId && "bg-accent/10",
													)}
												>
													<Table.Cell>
														<IntegrationIcon variant={integration.variant} />
													</Table.Cell>
													<Table.Cell>
														<div className="flex flex-col">
															<span className="flex items-center gap-2 text-sm font-medium text-foreground">
																{integration.name}
																{integration.external && (
																	<span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
																		From caller
																	</span>
																)}
															</span>
															{integration.external && integration.hint && (
																<span className="text-xs text-muted-foreground">
																	{integration.hint}
																</span>
															)}
														</div>
													</Table.Cell>
													<Table.Cell>
														<span className="font-mono text-xs text-muted-foreground">
															{integration.variant}
														</span>
													</Table.Cell>
													<Table.Cell>
														<span className="inline-flex items-center rounded-full border border-border bg-surface-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
															{integration.group}
														</span>
													</Table.Cell>
													<Table.Cell>
														<div className="flex justify-end">
															<Button
																size="sm"
																variant={
																	integration.id === selectedId
																		? "primary"
																		: "outline"
																}
																onPress={() => handleSelect(integration.id)}
															>
																{integration.id === selectedId
																	? "Selected"
																	: "Select"}
															</Button>
														</div>
													</Table.Cell>
												</Table.Row>
											)}
										</Table.Body>
									</Table.Content>
								</Table>
							)}
						</Modal.Body>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}

// ─── Main component ────────────────────────────────────────────────────────────

export function IntegrationSelector({
	selectedId,
	loadIntegrations,
	injectedIntegrations,
	onSelect,
	onTestConnection,
	openInNewTabUrl,
	createIntegrationUrl,
	group,
	selectBtnLabel = "Choose",
	modalSize = "lg",
	modalHeight,
	label,
	description,
	className,
}: IntegrationSelectorProps) {
	const [loaded, setLoaded] = useState<Integration[]>([]);
	// injected entries need no fetch and always come first
	const integrations = useMemo(
		() => [...(injectedIntegrations ?? []), ...loaded],
		[injectedIntegrations, loaded],
	);
	const [loadStatus, setLoadStatus] = useState<LoadStatus>("idle");
	const [loadError, setLoadError] = useState<string | null>(null);

	const resolvedCreateUrl = useMemo(() => {
		if (!createIntegrationUrl) return undefined;
		if (group && !createIntegrationUrl.includes("group=")) {
			const separator = createIntegrationUrl.includes("?") ? "&" : "?";
			return `${createIntegrationUrl}${separator}group=${encodeURIComponent(group)}`;
		}
		return createIntegrationUrl;
	}, [createIntegrationUrl, group]);

	const [testStatus, setTestStatus] = useState<TestStatus>("idle");
	const testResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const [pickerOpen, setPickerOpen] = useState(false);

	// ── Fetch ─────────────────────────────────────────────────────────────────
	const fetchIntegrations = useCallback(async () => {
		setLoadStatus("loading");
		setLoadError(null);
		try {
			const data = await loadIntegrations();
			setLoaded(data);
			setLoadStatus("success");
		} catch (err) {
			const msg =
				err instanceof Error ? err.message : "Failed to load integrations";
			setLoadError(msg);
			setLoadStatus("error");
		}
	}, [loadIntegrations]);

	useEffect(() => {
		void fetchIntegrations();
	}, [fetchIntegrations]);

	// ── Derived ───────────────────────────────────────────────────────────────
	const selectedIntegration = useMemo(
		() => integrations.find((i) => i.id === selectedId) ?? null,
		[integrations, selectedId],
	);

	// Reset test status whenever the selection changes
	useEffect(() => {
		setTestStatus("idle");
		if (testResetTimer.current) clearTimeout(testResetTimer.current);
	}, [selectedId]);

	// ── Handlers ──────────────────────────────────────────────────────────────
	function handleClear() {
		onSelect?.("");
	}

	async function handleTestConnection() {
		if (!selectedIntegration || !onTestConnection) return;
		setTestStatus("testing");
		try {
			await onTestConnection(selectedIntegration.id);
			setTestStatus("success");
			toast.success("Connection successful");
		} catch (err) {
			setTestStatus("error");
			const msg =
				err instanceof Error ? err.message : "Connection test failed";
			toast.danger(msg);
		} finally {
			if (testResetTimer.current) clearTimeout(testResetTimer.current);
			testResetTimer.current = setTimeout(() => {
				setTestStatus("idle");
			}, TEST_RESET_MS);
		}
	}

	// ── Icon-button shared class ───────────────────────────────────────────────
	const iconBtnBase =
		"inline-flex shrink-0 items-center justify-center rounded-[var(--radius)] p-2 transition-colors";

	const testBtnClass = clsx(
		iconBtnBase,
		testStatus === "success" && "bg-success/15 text-success",
		testStatus === "error" && "bg-danger/15 text-danger",
		(testStatus === "testing" || testStatus === "idle") &&
			"text-muted-foreground hover:bg-surface-secondary hover:text-foreground",
	);

	const iconBtnClass = clsx(
		iconBtnBase,
		"text-muted-foreground hover:bg-surface-secondary hover:text-foreground",
	);

	// ── Single render — no early returns, stable height always ───────────────
	return (
		<>
			<div className={clsx("flex flex-col gap-1.5 py-2", className)}>
				{/* Label + Description */}
				{label && <FieldLabel label={label} />}
				{description && (
					<p className="text-xs leading-normal text-muted-foreground">
						{description}
					</p>
				)}

				{/* Selector row — fixed height regardless of load state */}
				<div className="flex h-10 w-full items-center justify-between gap-3 rounded-[var(--radius)] border border-border bg-surface px-3 shadow-sm">
					{/* Left: spinner | error+retry | icon+name+badge | placeholder */}
					<div className="flex min-w-0 flex-1 items-center gap-2.5">
						{loadStatus === "loading" ? (
							<>
								<Spinner size="sm" />
								<span className="text-xs text-muted-foreground">
									Loading integrations…
								</span>
							</>
						) : loadStatus === "error" ? (
							<>
								<span className="text-xs text-danger truncate">
									{loadError ?? "Failed to load integrations"}
								</span>
								<Button
									variant="ghost"
									size="sm"
									className="ml-1"
									onPress={() => void fetchIntegrations()}
								>
									<TbRefresh size={12} />
									Retry
								</Button>
							</>
						) : selectedIntegration ? (
							<>
								<IntegrationIcon variant={selectedIntegration.variant} />
								<span className="truncate text-sm font-medium text-foreground">
									{selectedIntegration.name}
								</span>
								<span className="shrink-0 rounded-full border border-border bg-surface-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
									{selectedIntegration.variant}
								</span>
							</>
						) : (
							<span className="text-sm text-muted-foreground">
								None selected
							</span>
						)}
					</div>

					{/* Right: action buttons — hidden while loading/errored */}
					<div className="flex shrink-0 items-center gap-1.5">
						{loadStatus === "success" && (
							<>
								{/* Test Connection — an external entry has nothing to test
								    here; the real integration lives on the caller's side */}
								{selectedIntegration && !selectedIntegration.external && onTestConnection && (
									<Button
										aria-label="Test Connection"
										size="sm"
										variant="ghost"
										isDisabled={testStatus === "testing"}
										onPress={() => void handleTestConnection()}
										className={testBtnClass}
									>
										{testStatus === "testing" ? (
											<Spinner size="sm" />
										) : (
											<TbPlugConnected size={18} />
										)}
									</Button>
								)}

								{/* Open in new tab */}
								{selectedIntegration && !selectedIntegration.external && openInNewTabUrl && (
									<Button
										aria-label="Open Integration Settings"
										size="sm"
										variant="ghost"
										className={iconBtnClass}
										onPress={() => {
											window.open(openInNewTabUrl, "_blank", "noopener,noreferrer");
										}}
									>
										<TbExternalLink size={18} />
									</Button>
								)}

								{/* Clear */}
								{selectedIntegration && (
									<CloseButton
										aria-label="Clear Integration"
										onPress={handleClear}
										className={iconBtnClass}
									/>
								)}

								{/* Divider — only when action buttons are showing */}
								{selectedIntegration && (
									<span className="mx-1 h-5 w-px shrink-0 bg-border" />
								)}
							</>
						)}

						{/* Choose — always visible, disabled while loading */}
						<Button
							variant="primary"
							size="sm"
							isDisabled={loadStatus === "loading" || loadStatus === "error"}
							onPress={() => setPickerOpen(true)}
						>
							{selectBtnLabel}
						</Button>
					</div>
				</div>

				{selectedIntegration?.external && selectedIntegration.hint && (
					<p className="text-xs leading-normal text-accent">
						{selectedIntegration.hint}
					</p>
				)}
			</div>

			{/* Picker Modal */}
			<PickerModal
				isOpen={pickerOpen}
				onClose={() => setPickerOpen(false)}
				integrations={integrations}
				selectedId={selectedId}
				onSelect={(id) => {
					onSelect?.(id);
					setTestStatus("idle");
				}}
				createIntegrationUrl={resolvedCreateUrl}
				modalSize={modalSize}
				modalHeight={modalHeight}
			/>
		</>
	);
}
