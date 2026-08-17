import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Button, cn, Input, Label, TextField, toast } from "@fluxify/components";
import { TbArrowLeft, TbArrowRight, TbCheck } from "react-icons/tb";
import type { inputParamSchema } from "@fluxify/server/src/api/v1/custom-blocks/create/dto";
import type { z } from "zod";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { createRouteHead } from "@/lib/seo";
import type { CustomBlockInputParam } from "@/components/canvas/panel/blocks/CustomBlockSettings";
import {
	InputParamsEditor,
	validateInputParams,
} from "@/components/customBlocks/InputParamsEditor";
import {
	ICON_URL_MAX,
	IconPicker,
	type IconValue,
} from "@/components/customBlocks/IconPicker";

export const Route = createFileRoute("/_authed/$projectId/custom-blocks_/new")({
	head: createRouteHead(
		"New Custom Block",
		"Create a reusable custom block: identity, icon and input parameters.",
	),
	component: CreateCustomBlockPage,
});

const NAME_REGEX = /^[a-z0-9_]+$/;

/** `Send Slack message` → `send_slack_message`, the shape the API accepts. */
function slugify(value: string) {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "");
}

const STEPS = [
	{ key: "basics", label: "Basics" },
	{ key: "icon", label: "Icon" },
	{ key: "inputs", label: "Inputs" },
	{ key: "review", label: "Review" },
] as const;

function CreateCustomBlockPage() {
	const { projectId } = Route.useParams();
	const navigate = useNavigate();
	const create = customBlocksQuery.create.mutation(projectId);

	const [label, setLabel] = useState("");
	const [name, setName] = useState("");
	// until the user edits `name` by hand it tracks the label
	const [nameTouched, setNameTouched] = useState(false);
	const [description, setDescription] = useState("");
	const [iconValue, setIconValue] = useState<IconValue>({});
	const [params, setParams] = useState<CustomBlockInputParam[]>([]);
	const [step, setStep] = useState(0);

	const nameIsValid = NAME_REGEX.test(name);
	const basicsValid = label.trim().length >= 2 && nameIsValid;
	const iconTooLong = (iconValue.iconUrl?.length ?? 0) > ICON_URL_MAX;
	const paramsError = useMemo(() => validateInputParams(params), [params]);

	const current = Math.min(step, STEPS.length - 1);
	const currentKey = STEPS[current].key;
	const isLast = current === STEPS.length - 1;

	function submit() {
		if (iconTooLong) {
			toast.danger("Icon image is too large");
			setStep(1);
			return;
		}
		if (paramsError) {
			toast.danger(paramsError);
			setStep(2);
			return;
		}
		create.mutate(
			{
				projectId,
				name,
				label: label.trim(),
				description,
				icon: iconValue.icon,
				iconUrl: iconValue.iconUrl,
				inputParams: params as unknown as z.infer<typeof inputParamSchema>[],
			},
			{
				onSuccess: (created) => {
					toast.success("Custom block created");
					navigate({
						to: "/$projectId/custom-block-canvas/$blockId",
						params: { projectId, blockId: created.id },
					});
				},
				onError: (error) => showErrorNotification(error as Error),
			},
		);
	}

	return (
		// full height of the scroll container so only the step body scrolls and the
		// Back/Next bar stays pinned
		<div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-5">
			<div className="flex shrink-0 items-center gap-3">
				<Button
					isIconOnly
					variant="ghost"
					aria-label="Back to custom blocks"
					onPress={() =>
						navigate({ to: "/$projectId/custom-blocks", params: { projectId } })
					}
				>
					<TbArrowLeft size={18} />
				</Button>
				<div>
					<h1 className="text-xl font-semibold tracking-tight">
						Create a custom block
					</h1>
					<p className="text-xs text-muted">
						A reusable piece of flow you can drop onto any route canvas.
					</p>
				</div>
			</div>

			<nav
				aria-label="Custom block setup steps"
				className="shrink-0 border-b border-border pb-3"
			>
				<ol className="flex flex-wrap gap-2">
					{STEPS.map((item, index) => {
						const reachable = index === 0 || basicsValid;
						const complete = index < current;
						return (
							<li key={item.key} className="flex-1">
								<button
									type="button"
									disabled={!reachable}
									onClick={() => setStep(index)}
									aria-current={index === current ? "step" : undefined}
									className={cn(
										"flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs font-medium transition-colors",
										reachable
											? index === current
												? "text-foreground"
												: "text-muted hover:bg-surface-secondary hover:text-foreground"
											: "cursor-not-allowed text-muted/50",
									)}
								>
									<span
										className={cn(
											"flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold transition-all",
											complete || index === current
												? "border-accent bg-accent text-accent-foreground"
												: "border-border bg-surface-secondary text-muted",
										)}
									>
										{complete ? <TbCheck size={12} strokeWidth={3} /> : index + 1}
									</span>
									<span className="hidden truncate sm:inline">{item.label}</span>
								</button>
							</li>
						);
					})}
				</ol>
			</nav>

			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
				<StepHeading
					current={current}
					total={STEPS.length}
					title={
						{
							basics: "Name the block",
							icon: "Give it a face",
							inputs: "Describe its input parameters",
							review: "Review and create",
						}[currentKey]
					}
					description={
						{
							basics:
								"The label is what people see; the identifier is fixed and used in flows.",
							icon: "Pick a premade icon or point at your own image. Optional.",
							inputs:
								"Optional. The fields this block asks for when it is placed on a route canvas.",
							review: "Last look before the block and its canvas are created.",
						}[currentKey]
					}
				/>

				<div className="mt-4 flex min-h-0 flex-1 flex-col overflow-hidden">
					{currentKey === "basics" && (
						<div className="flex max-w-xl flex-col gap-5 overflow-y-auto pr-1">
							<TextField
								isRequired
								value={label}
								onChange={(next) => {
									setLabel(next);
									if (!nameTouched) setName(slugify(next));
								}}
							>
								<Label>Label</Label>
								<Input placeholder="Send Slack message" />
							</TextField>

							<TextField
								isRequired
								value={name}
								onChange={(next) => {
									setNameTouched(true);
									setName(next);
								}}
								isInvalid={name.length > 0 && !nameIsValid}
							>
								<Label>Identifier</Label>
								<Input placeholder="send_slack_message" className="font-mono" />
								<p className="text-xs text-muted">
									How flows refer to this block. Lowercase letters, digits and
									underscores. Can't be changed later.
								</p>
							</TextField>

							<TextField value={description} onChange={setDescription}>
								<Label>Description</Label>
								<Input placeholder="What this block does" />
							</TextField>
						</div>
					)}

					{currentKey === "icon" && (
						<div className="min-h-0 flex-1 overflow-hidden">
							<IconPicker
								value={iconValue}
								onChange={setIconValue}
								previewName={label}
								previewDescription={description}
							/>
						</div>
					)}

					{currentKey === "inputs" && (
						<div className="min-h-0 flex-1 overflow-y-auto pr-1">
							<InputParamsEditor params={params} onChange={setParams} />
						</div>
					)}

					{currentKey === "review" && (
						<dl className="grid gap-px overflow-y-auto rounded-xl border border-border bg-border sm:grid-cols-2">
							<SummaryItem label="Label" value={label} />
							<SummaryItem label="Identifier" value={name} mono />
							<SummaryItem label="Description" value={description || "None"} />
							<SummaryItem
								label="Icon"
								value={
									iconValue.icon === "custom"
										? "Custom image"
										: (iconValue.iconUrl ?? "Default")
								}
							/>
							<SummaryItem
								label="Input parameters"
								value={params.length === 0 ? "None" : String(params.length)}
							/>
						</dl>
					)}
				</div>
			</div>

			<div className="flex shrink-0 items-center justify-between border-t border-border pt-3.5">
				<Button
					variant="ghost"
					size="sm"
					isDisabled={current === 0}
					onPress={() => setStep(current - 1)}
				>
					<TbArrowLeft size={16} /> Back
				</Button>
				{isLast ? (
					<Button
						variant="primary"
						size="sm"
						isPending={create.isPending}
						isDisabled={!basicsValid || iconTooLong || Boolean(paramsError)}
						onPress={submit}
					>
						Create block
					</Button>
				) : (
					<Button
						variant="primary"
						size="sm"
						isDisabled={!basicsValid}
						onPress={() => setStep(current + 1)}
					>
						Next <TbArrowRight size={16} />
					</Button>
				)}
			</div>
		</div>
	);
}

function StepHeading({
	current,
	total,
	title,
	description,
}: {
	current: number;
	total: number;
	title: string;
	description: string;
}) {
	return (
		<div>
			<p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">
				Step {current + 1} of {total}
			</p>
			<h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">
				{title}
			</h2>
			<p className="mt-0.5 text-xs text-muted">{description}</p>
		</div>
	);
}

function SummaryItem({
	label,
	value,
	mono,
}: {
	label: string;
	value: string;
	mono?: boolean;
}) {
	return (
		<div className="bg-surface px-3 py-2">
			<dt className="text-[11px] uppercase tracking-wide text-muted">{label}</dt>
			<dd className={cn("mt-0.5 text-sm text-foreground", mono && "font-mono")}>
				{value || "—"}
			</dd>
		</div>
	);
}
