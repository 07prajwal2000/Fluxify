import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
	Button,
	CloseButton,
	DeleteButton,
	Input,
	Label,
	Modal,
	Spinner,
	Tabs,
	TextField,
	toast,
} from "@fluxify/components";
import type { inputParamSchema } from "@fluxify/server/src/api/v1/custom-blocks/create/dto";
import type { z } from "zod";
import { customBlocksQuery } from "@/query/customBlocksQuery";
import { showErrorNotification } from "@/lib/errorNotifier";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import type { CustomBlockInputParam } from "@/components/canvas/panel/blocks/CustomBlockSettings";
import { InputParamsEditor, validateInputParams } from "./InputParamsEditor";
import { ICON_URL_MAX, IconPicker, type IconValue } from "./IconPicker";

/**
 * Same shape as the route canvas' settings modal: everything editable about the
 * block, reachable from the canvas it belongs to, one save for the lot.
 */
export function CustomBlockSettingsModal({
	projectId,
	blockId,
	isOpen,
	onOpenChange,
}: {
	projectId: string;
	blockId: string;
	isOpen: boolean;
	onOpenChange: (open: boolean) => void;
}) {
	const { data: blocks, isLoading } = customBlocksQuery.getAll.useQuery(projectId);
	const block = blocks?.find((b) => b.id === blockId);

	return (
		<Modal isOpen={isOpen} onOpenChange={onOpenChange}>
			<Modal.Backdrop>
				<Modal.Container placement="center" size="cover" className="p-0">
					<Modal.Dialog className="flex h-[92vh] w-[94vw] !max-w-none flex-col overflow-hidden border border-border bg-background p-0 shadow-2xl shadow-black/50">
						{isLoading || !block ? (
							<div className="flex h-full items-center justify-center">
								{isLoading ? <Spinner /> : <p className="text-sm text-muted">Custom block not found.</p>}
							</div>
						) : (
							<CustomBlockSettingsForm
								key={block.id}
								projectId={projectId}
								block={block}
								onSaved={() => onOpenChange(false)}
								onClose={() => onOpenChange(false)}
							/>
						)}
					</Modal.Dialog>
				</Modal.Container>
			</Modal.Backdrop>
		</Modal>
	);
}

type BlockData = NonNullable<
	ReturnType<typeof customBlocksQuery.getAll.useQuery>["data"]
>[number];

function CustomBlockSettingsForm({
	projectId,
	block,
	onSaved,
	onClose,
}: {
	projectId: string;
	block: BlockData;
	onSaved: () => void;
	onClose: () => void;
}) {
	const update = customBlocksQuery.update.mutation(projectId, block.id);
	const readOnly = Boolean(block.sourceType && block.sourceType !== "user-defined");

	const [label, setLabel] = useState(block.label);
	const [description, setDescription] = useState(block.description ?? "");
	const [params, setParams] = useState<CustomBlockInputParam[]>(
		Array.isArray(block.inputParams) ? (block.inputParams as CustomBlockInputParam[]) : [],
	);
	const [iconValue, setIconValue] = useState<IconValue>({
		icon: (block.icon as IconValue["icon"]) ?? undefined,
		iconUrl: block.iconUrl ?? undefined,
	});
	const [tab, setTab] = useState("general");
	const [confirmDelete, setConfirmDelete] = useState(false);
	const remove = customBlocksQuery.remove.mutation(projectId);
	const navigate = useNavigate();
	// a plugin block is owned by its plugin; the API refuses to delete it
	const canDelete = block.sourceType !== "plugin";

	function deleteBlock() {
		remove.mutate(block.id, {
			onSuccess: () => {
				toast.success("Custom block deleted");
				setConfirmDelete(false);
				onClose();
				navigate({ to: "/$projectId/custom-blocks", params: { projectId } });
			},
			onError: (error) => showErrorNotification(error as Error),
		});
	}

	const payload = useMemo(
		() => ({
			label: label.trim(),
			description,
			icon: iconValue.icon,
			iconUrl: iconValue.iconUrl,
			inputParams: params as unknown as z.infer<typeof inputParamSchema>[],
		}),
		[label, description, params, iconValue],
	);
	const [baseline] = useState(() => JSON.stringify(payload));
	const isDirty = JSON.stringify(payload) !== baseline;
	const labelIsValid = label.trim().length > 0;

	function save() {
		if ((iconValue.iconUrl?.length ?? 0) > ICON_URL_MAX) {
			toast.danger("Icon image is too large");
			setTab("general");
			return;
		}
		const error = validateInputParams(params);
		if (error) {
			toast.danger(error);
			setTab("inputs");
			return;
		}
		update.mutate(payload, {
			onSuccess: () => {
				toast.success("Custom block settings saved");
				onSaved();
			},
			onError: (error) => showErrorNotification(error as Error),
		});
	}

	return (
		<>
			<Modal.Header className="flex shrink-0 flex-row items-center gap-3 border-b border-border px-5 py-3">
				<div className="min-w-0">
					<Modal.Heading className="text-sm font-semibold">
						Custom block settings
					</Modal.Heading>
					<p className="truncate font-mono text-xs text-muted">{block.name}</p>
				</div>
				<CloseButton aria-label="Close custom block settings" className="ml-auto" />
			</Modal.Header>

			<Modal.Body className="min-h-0 flex-1 p-0">
				<Tabs
					orientation="vertical"
					selectedKey={tab}
					onSelectionChange={(key) => setTab(String(key))}
					className="flex h-full min-h-0 flex-row"
				>
					<Tabs.List
						aria-label="Custom block settings sections"
						className="w-44 shrink-0 border-r border-border p-3"
					>
						<Tabs.Tab id="general">General</Tabs.Tab>
						<Tabs.Tab id="inputs">Input parameters</Tabs.Tab>
						{canDelete && <Tabs.Tab id="danger">Danger zone</Tabs.Tab>}
					</Tabs.List>

					{/* the icon grid inside scrolls, the panel itself never does */}
					<Tabs.Panel
						id="general"
						className="flex min-h-0 flex-1 flex-col overflow-hidden p-5"
					>
						<IconPicker
							value={iconValue}
							onChange={setIconValue}
							isDisabled={readOnly}
							previewName={label || block.label}
							previewDescription={description}
							header={
								<div className="flex flex-col gap-4">
									<div>
										<h3 className="text-sm font-semibold text-foreground">Identity</h3>
										<p className="mt-0.5 text-xs text-muted">
											How this block shows up in the block picker and on a route canvas.
											The name is fixed once created.
										</p>
									</div>
									<TextField
										isRequired
										isDisabled={readOnly}
										value={label}
										onChange={setLabel}
										isInvalid={!labelIsValid}
									>
										<Label>Label</Label>
										<Input placeholder="Send Slack message" />
									</TextField>
									<TextField
										isDisabled={readOnly}
										value={description}
										onChange={setDescription}
									>
										<Label>Description</Label>
										<Input placeholder="What this block does" />
									</TextField>
								</div>
							}
						/>
					</Tabs.Panel>

					<Tabs.Panel id="inputs" className="min-h-0 flex-1 overflow-y-auto p-5">
						<Section
							title="Input parameters"
							description="The fields this block asks for when it is placed on a route canvas."
						>
							<InputParamsEditor
								params={params}
								isDisabled={readOnly}
								onChange={setParams}
							/>
						</Section>
					</Tabs.Panel>

					{canDelete && (
						<Tabs.Panel id="danger" className="min-h-0 flex-1 overflow-y-auto p-5">
							<Section
								title="Delete this custom block"
								description="The block and its canvas go with it. Routes already using it will fail until they are edited. This can't be undone."
							>
								<div className="flex items-center justify-between rounded-md border border-danger/40 bg-danger/5 px-4 py-3">
									<div className="min-w-0">
										<p className="truncate text-xs">{block.label}</p>
										<p className="truncate font-mono text-xs text-muted">{block.name}</p>
									</div>
									<DeleteButton onPress={() => setConfirmDelete(true)}>
										Delete block
									</DeleteButton>
								</div>
							</Section>
						</Tabs.Panel>
					)}
				</Tabs>
			</Modal.Body>

			<ConfirmDialog
				open={confirmDelete}
				onOpenChange={setConfirmDelete}
				title="Delete custom block?"
				danger
				confirmText="Delete"
				pending={remove.isPending}
				onConfirm={deleteBlock}
			>
				Delete <b className="text-foreground">{block.label}</b>? This can't be undone.
			</ConfirmDialog>

			<Modal.Footer className="flex shrink-0 flex-row items-center gap-3 border-t border-border px-5 py-3">
				<span className="text-xs text-muted">
					{readOnly
						? `This block comes from a ${block.sourceType} source and isn't editable here.`
						: isDirty
							? "Unsaved changes"
							: "All changes saved"}
				</span>
				<div className="ml-auto flex items-center gap-2">
					<Button variant="ghost" onPress={onClose}>
						Cancel
					</Button>
					{!readOnly && (
						<Button
							variant="primary"
							isDisabled={!isDirty || !labelIsValid}
							isPending={update.isPending}
							onPress={save}
						>
							Save changes
						</Button>
					)}
				</div>
			</Modal.Footer>
		</>
	);
}

function Section({
	title,
	description,
	children,
}: {
	title: string;
	description: string;
	children: React.ReactNode;
}) {
	return (
		<section className="mb-6 flex flex-col gap-4 last:mb-0">
			<div>
				<h3 className="text-sm font-semibold text-foreground">{title}</h3>
				<p className="mt-0.5 text-xs text-muted">{description}</p>
			</div>
			{children}
		</section>
	);
}
