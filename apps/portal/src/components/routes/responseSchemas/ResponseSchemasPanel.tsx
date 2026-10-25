import {
	Button,
	DeleteIconButton,
	Label,
	NumberField,
	SchemaEditor,
	Spinner,
	toast,
	type ValidationSchema,
} from "@fluxify/components";
import { useState } from "react";
import { TbBraces, TbPlus } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { EmptyState } from "@/components/common/EmptyState";
import { showErrorNotification } from "@/lib/errorNotifier";
import { responseSchemasQuery } from "@/query/responseSchemasQuery";
import { useCanEditProject } from "@/store/auth";

const NEW_SCHEMA: ValidationSchema = { dataType: "object", properties: [] };
const validCode = (n: number | undefined): n is number =>
	n !== undefined && Number.isInteger(n) && n >= 100 && n <= 599;

/**
 * The route's saved response schemas, one per status code, edited with the same
 * schema editor as the request body. Edits are explicit: every save moves the
 * route's revision, so nothing saves while you type.
 */
export function ResponseSchemasPanel({
	routeId,
	projectId,
}: {
	routeId: string;
	projectId: string;
}) {
	const canEdit = useCanEditProject(projectId);
	const { data, isLoading } = responseSchemasQuery.list.useQuery(routeId);
	const put = responseSchemasQuery.put.mutation(routeId);
	const remove = responseSchemasQuery.remove.mutation(routeId);
	const [selected, setSelected] = useState<number | null>(null);
	// the editor's working copy, and the status code it belongs to
	const [draft, setDraft] = useState<ValidationSchema>(NEW_SCHEMA);
	const [newCode, setNewCode] = useState<number | undefined>();
	const [deleting, setDeleting] = useState<number | null>(null);

	if (isLoading) return <Spinner />;
	const saved = data ?? [];
	const stored = saved.find((s) => s.statusCode === selected)?.schema;
	const isNew = selected !== null && !stored;
	const dirty = isNew || JSON.stringify(stored) !== JSON.stringify(draft);

	const open = (code: number, schema: ValidationSchema) => {
		setSelected(code);
		setDraft(schema);
	};
	const add = () => {
		if (!validCode(newCode)) return;
		const existing = saved.find((s) => s.statusCode === newCode);
		open(newCode, existing?.schema ?? NEW_SCHEMA);
		setNewCode(undefined);
	};
	const save = () =>
		selected !== null &&
		put.mutate(
			{ statusCode: selected, body: { schema: draft } },
			{
				onSuccess: () => toast.success(`Saved the ${selected} schema`),
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	const confirmDelete = () =>
		deleting !== null &&
		remove.mutate(deleting, {
			onSuccess: () => {
				toast.success("Schema deleted");
				if (selected === deleting) setSelected(null);
			},
			onError: (e) => showErrorNotification(e as Error),
			onSettled: () => setDeleting(null),
		});

	return (
		<div className="flex h-full min-h-0 flex-col gap-3 p-3">
			{canEdit && (
				<div className="flex items-end gap-2">
					<NumberField
						aria-label="Status code"
						value={newCode ?? Number.NaN}
						onChange={(n) => setNewCode(Number.isNaN(n) ? undefined : n)}
						minValue={100}
						maxValue={599}
					>
						<Label>New status code</Label>
						<NumberField.Group>
							<NumberField.Input placeholder="200" />
						</NumberField.Group>
					</NumberField>
					<Button size="sm" variant="secondary" isDisabled={!validCode(newCode)} onPress={add}>
						<TbPlus size={14} />
						Add
					</Button>
				</div>
			)}
			{saved.length === 0 && selected === null ? (
				<EmptyState
					icon={<TbBraces size={28} />}
					title="No response schemas yet"
					description={
						canEdit
							? "Send a request, then use Save as schema on its response. Or add a status code above."
							: "Nobody has saved a response schema for this route."
					}
				/>
			) : (
				<div className="grid min-h-0 flex-1 grid-cols-[9rem_1fr] gap-3">
					<ul className="flex flex-col gap-1 overflow-y-auto" aria-label="Status codes">
						{[...new Set([...saved.map((s) => s.statusCode), ...(isNew ? [selected] : [])])].map(
							(code) => (
								<li key={code} className="flex items-center gap-1">
									<Button
										size="sm"
										variant={code === selected ? "secondary" : "ghost"}
										className="flex-1 justify-start font-mono"
										onPress={() =>
											open(code, saved.find((s) => s.statusCode === code)?.schema ?? NEW_SCHEMA)
										}
									>
										{code}
									</Button>
									{canEdit && saved.some((s) => s.statusCode === code) && (
										<DeleteIconButton
											size="sm"
											aria-label={`Delete the ${code} schema`}
											onPress={() => setDeleting(code)}
										/>
									)}
								</li>
							),
						)}
					</ul>
					<div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
						{selected === null ? (
							<p className="text-xs text-muted">Pick a status code to see its schema.</p>
						) : (
							<>
								<SchemaEditor
									key={selected}
									value={draft}
									onChange={setDraft}
									isReadOnly={!canEdit}
								/>
								{canEdit && (
									<div className="flex gap-2">
										<Button
											size="sm"
											variant="primary"
											isDisabled={!dirty}
											isPending={put.isPending}
											onPress={save}
										>
											Save
										</Button>
										<Button
											size="sm"
											variant="ghost"
											isDisabled={!dirty}
											onPress={() => (isNew ? setSelected(null) : setDraft(stored ?? NEW_SCHEMA))}
										>
											Discard
										</Button>
									</div>
								)}
							</>
						)}
					</div>
				</div>
			)}
			<ConfirmDialog
				open={deleting !== null}
				onOpenChange={(o) => !o && setDeleting(null)}
				title="Delete response schema?"
				danger
				confirmText="Delete"
				pending={remove.isPending}
				onConfirm={confirmDelete}
			>
				Delete the <b className="text-foreground">{deleting}</b> schema? This can't be undone.
			</ConfirmDialog>
		</div>
	);
}
