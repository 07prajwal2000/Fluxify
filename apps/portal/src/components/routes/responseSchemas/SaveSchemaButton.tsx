import { type ApiPlaygroundResponse, Button, toast } from "@fluxify/components";
import { useState } from "react";
import { TbDeviceFloppy } from "react-icons/tb";
import { ConfirmDialog } from "@/components/common/ConfirmDialog";
import { showErrorNotification } from "@/lib/errorNotifier";
import { responseSchemasQuery } from "@/query/responseSchemasQuery";
import { sampleFrom } from "./sample";

/**
 * "Save response as schema": the server infers the schema from what the
 * playground just received and keeps it for that status code. Only types are
 * stored, never the values, so a sample holding personal data leaves none behind.
 */
export function SaveSchemaButton({
	routeId,
	response,
}: {
	routeId: string;
	response: ApiPlaygroundResponse;
}) {
	const { data: saved = [] } = responseSchemasQuery.list.useQuery(routeId);
	const put = responseSchemasQuery.put.mutation(routeId);
	const [confirming, setConfirming] = useState(false);
	const result = sampleFrom(response);
	const exists = saved.some((s) => s.statusCode === response.status);

	const save = () => {
		if (!result.ok) return;
		put.mutate(
			{ statusCode: response.status, body: { sample: result.sample } },
			{
				onSuccess: () => toast.success(`Saved the ${response.status} response schema`),
				onError: (e) => showErrorNotification(e as Error),
				onSettled: () => setConfirming(false),
			},
		);
	};

	return (
		<>
			{/* a disabled button shows no tooltip of its own, so the reason rides on the wrapper */}
			<span title={result.ok ? undefined : result.reason}>
				<Button
					size="sm"
					variant="secondary"
					isDisabled={!result.ok}
					isPending={put.isPending}
					onPress={() => (exists ? setConfirming(true) : save())}
				>
					<TbDeviceFloppy size={14} />
					Save as schema
				</Button>
			</span>
			<ConfirmDialog
				open={confirming}
				onOpenChange={setConfirming}
				title={`Replace the ${response.status} schema?`}
				confirmText="Replace"
				pending={put.isPending}
				onConfirm={save}
			>
				A schema is already saved for <b className="text-foreground">{response.status}</b>. Saving
				this response replaces it, including any rules you added by hand.
			</ConfirmDialog>
		</>
	);
}
