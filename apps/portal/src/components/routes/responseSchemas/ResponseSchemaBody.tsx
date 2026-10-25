import {
	Button,
	DeleteIconButton,
	SchemaEditor,
	toast,
	type ValidationSchema,
} from "@fluxify/components";
import { useState } from "react";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { showErrorNotification } from "@/lib/errorNotifier";
import { responseSchemasQuery } from "@/query/responseSchemasQuery";

export const NEW_SCHEMA: ValidationSchema = { dataType: "object", properties: [] };

/**
 * One status code's schema, exactly as stored, in the schema editor. Edits are
 * explicit: every save moves the route's revision, so nothing saves while you type.
 * `stored` is undefined for a code the user just added and has not saved yet.
 */
export function ResponseSchemaBody({
	routeId,
	statusCode,
	stored,
	canEdit,
}: {
	routeId: string;
	statusCode: number;
	stored?: ValidationSchema;
	canEdit: boolean;
}) {
	const put = responseSchemasQuery.put.mutation(routeId);
	const remove = responseSchemasQuery.remove.mutation(routeId);
	const [draft, setDraft] = useState<ValidationSchema>(stored ?? NEW_SCHEMA);
	const [deleting, setDeleting] = useState(false);
	const dirty = !stored || JSON.stringify(stored) !== JSON.stringify(draft);

	const save = () =>
		put.mutate(
			{ statusCode, body: { schema: draft } },
			{
				onSuccess: () => toast.success(`Saved the ${statusCode} schema`),
				onError: (e) => showErrorNotification(e as Error),
			},
		);
	const confirmDelete = () =>
		remove.mutate(statusCode, {
			onSuccess: () => toast.success("Schema deleted"),
			onError: (e) => showErrorNotification(e as Error),
			onSettled: () => setDeleting(false),
		});

	return (
		<div className="flex flex-col gap-3">
			<SchemaEditor value={draft} onChange={setDraft} isReadOnly={!canEdit} />
			{canEdit && (
				<div className="flex items-center gap-2">
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
						isDisabled={!dirty || !stored}
						onPress={() => setDraft(stored ?? NEW_SCHEMA)}
					>
						Discard
					</Button>
					{stored && (
						<DeleteIconButton
							size="sm"
							className="ml-auto"
							aria-label={`Delete the ${statusCode} schema`}
							onPress={() => setDeleting(true)}
						/>
					)}
				</div>
			)}
			<ConfirmDialog
				open={deleting}
				onOpenChange={setDeleting}
				title="Delete response schema?"
				danger
				confirmText="Delete"
				pending={remove.isPending}
				onConfirm={confirmDelete}
			>
				Delete the <b className="text-foreground">{statusCode}</b> schema? This can't be undone.
			</ConfirmDialog>
		</div>
	);
}
