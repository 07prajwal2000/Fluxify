import { Button, CloseButton, cn, Input, Modal, Spinner } from "@fluxify/components";
import { useEffect, useMemo, useRef, useState } from "react";
import { TbCheck, TbCpu, TbRefresh, TbSearch } from "react-icons/tb";
import { integrationService } from "@/services/integrations";

/** rows drawn at once: OpenRouter lists thousands, and a search narrows them anyway */
const MAX_ROWS = 100;

type ModelRow = Awaited<ReturnType<typeof integrationService.listModels>>["models"][number];

export type ModelSelectorModalProps = {
	projectId: string;
	variant: string;
	/** the form's config as typed so far; the server resolves `cfg:` references and holds the key */
	config: Record<string, unknown>;
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	selectedValue?: string;
	onSelect: (modelId: string) => void;
};

const compact = (n: number) =>
	n >= 1_000_000
		? `${+(n / 1_000_000).toFixed(1)}M`
		: n >= 1000
			? `${Math.round(n / 1000)}k`
			: `${n}`;
const usd = (n: number) => `$${+n.toFixed(n < 1 ? 3 : 2)}`;

export function ModelSelectorModal({
	projectId,
	variant,
	config,
	isOpen,
	onOpenChange,
	selectedValue = "",
	onSelect,
}: ModelSelectorModalProps) {
	const [search, setSearch] = useState("");
	const [data, setData] = useState<{ models: ModelRow[]; error?: string }>();
	const [isPending, setPending] = useState(false);
	const latest = useRef(0);

	// `refresh` makes the server skip its cached copy; a slow older answer never overwrites a newer one
	const load = (refresh: boolean) => {
		const call = ++latest.current;
		setPending(true);
		integrationService
			.listModels(projectId, variant, config, refresh || undefined)
			.then((res) => call === latest.current && setData(res))
			.catch((e: Error) => call === latest.current && setData({ models: [], error: e.message }))
			.finally(() => call === latest.current && setPending(false));
	};

	// loaded when the modal opens, not when the page does
	// biome-ignore lint/correctness/useExhaustiveDependencies: load on open only, not on every keystroke in the form
	useEffect(() => {
		if (!isOpen) return;
		setSearch("");
		load(false);
	}, [isOpen]);

	const models = data?.models ?? [];
	const q = search.trim().toLowerCase();
	const matches = useMemo(
		() =>
			q
				? models.filter((m) => m.id.toLowerCase().includes(q) || m.name?.toLowerCase().includes(q))
				: models,
		[models, q],
	);
	const typed = search.trim();
	const reason = data?.error;

	const pick = (id: string) => {
		onSelect(id);
		onOpenChange(false);
	};

	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" scroll="inside" size="lg">
					<Modal.Dialog className="w-full !max-w-2xl">
						<Modal.Header className="flex flex-col gap-3 px-6 pb-2 pt-5">
							<div className="flex items-start justify-between gap-3">
								<div className="flex min-w-0 flex-1 items-center gap-3">
									<span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
										<TbCpu size={20} />
									</span>
									<div className="min-w-0 flex-1">
										<Modal.Heading className="text-base font-semibold text-foreground">
											Select Model
										</Modal.Heading>
										<p className="mt-0.5 text-xs text-muted">
											Models your provider lists. Any model id works, listed or not.
										</p>
									</div>
								</div>
								<CloseButton />
							</div>
							<div className="flex items-center gap-2 pt-1">
								<div className="relative flex-1">
									<TbSearch
										className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
										size={15}
									/>
									<Input
										aria-label="Search models"
										placeholder="Search by model id or name…"
										value={search}
										onChange={(e) => setSearch(e.currentTarget.value)}
										className="h-8 w-full pl-8 text-xs"
									/>
								</div>
								<Button
									isIconOnly
									variant="outline"
									size="sm"
									isDisabled={isPending}
									onPress={() => load(true)}
									aria-label="Refresh models"
									className="size-8"
								>
									{isPending ? <Spinner size="sm" /> : <TbRefresh size={14} />}
								</Button>
							</div>
						</Modal.Header>

						<Modal.Body className="px-6 pb-4 pt-2">
							{reason && (
								<p
									role="alert"
									className="mb-2 rounded-lg bg-danger/10 px-3 py-2 text-xs text-danger"
								>
									Could not load models: {reason}. You can still type any model id.
								</p>
							)}
							{isPending && models.length === 0 ? (
								<div className="flex flex-col items-center justify-center py-16">
									<Spinner />
									<span className="mt-2 text-xs text-muted">Loading models…</span>
								</div>
							) : (
								<div className="flex max-h-[440px] min-h-[200px] flex-col gap-2 overflow-y-auto pr-1">
									{typed && !models.some((m) => m.id === typed) && (
										<button
											type="button"
											onClick={() => pick(typed)}
											className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border bg-surface px-3.5 py-2.5 text-left text-xs hover:border-accent hover:bg-surface-secondary"
										>
											Use{" "}
											<span className="truncate font-mono font-semibold text-foreground">
												{typed}
											</span>
										</button>
									)}
									{matches.slice(0, MAX_ROWS).map((m) => {
										const selected = m.id === selectedValue;
										const detail = [
											m.contextLength ? `${compact(m.contextLength)} context` : "",
											m.pricing
												? `${usd(m.pricing.input)} in / ${usd(m.pricing.output)} out per 1M tokens`
												: "",
										]
											.filter(Boolean)
											.join(" · ");
										return (
											<button
												key={m.id}
												type="button"
												aria-pressed={selected}
												onClick={() => pick(m.id)}
												className={cn(
													"flex w-full items-center justify-between gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-all duration-150",
													selected
														? "border-accent bg-accent/10 ring-1 ring-accent"
														: "border-border bg-surface hover:border-accent hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
												)}
											>
												<span className="flex min-w-0 flex-col">
													<span className="truncate font-mono text-xs font-semibold text-foreground">
														{m.id}
													</span>
													{m.name && (
														<span className="truncate text-[11px] text-foreground">{m.name}</span>
													)}
													{detail && (
														<span className="truncate text-[11px] text-muted">{detail}</span>
													)}
												</span>
												{selected && (
													<span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
														<TbCheck size={13} strokeWidth={3} />
													</span>
												)}
											</button>
										);
									})}
									{matches.length > MAX_ROWS && (
										<p className="py-1 text-center text-[11px] text-muted">
											{matches.length - MAX_ROWS} more. Keep typing to narrow the list.
										</p>
									)}
									{!isPending && !reason && models.length === 0 && (
										<p className="py-8 text-center text-xs text-muted">
											The provider lists no models.
										</p>
									)}
								</div>
							)}
						</Modal.Body>

						<Modal.Footer className="flex items-center justify-end border-t border-border px-6 pb-5 pt-3">
							<Button
								variant="outline"
								size="sm"
								onPress={() => onOpenChange(false)}
								className="text-xs"
							>
								Close
							</Button>
						</Modal.Footer>
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}
