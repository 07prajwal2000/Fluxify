import { toast } from "@fluxify/components";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { showErrorNotification } from "@/lib/errorNotifier";
import type { CanvasItems } from "@/services/canvas";
import { customBlocksService } from "@/services/customBlocks";
import type { CompileTarget } from "../diagnostics/useCompileDiagnostics";
import { ExtractCustomBlockModal, type ExtractInput } from "./ExtractCustomBlockModal";

type Options = {
	target: CompileTarget;
	enabled: boolean;
	hasUnsavedChanges: boolean;
	/** saves the pending edits; true once they are saved */
	save: () => Promise<boolean>;
	/** the server's canvas, for the keys a save just handed out */
	reload: () => Promise<CanvasItems>;
	/** take the server's canvas over the open one (the selection was replaced) */
	reloadCanvas: () => Promise<void>;
};

/**
 * "Extract to custom block…" (#753). The server reads the selection from the
 * saved canvas, by block key, so pending edits are saved first. Afterwards the
 * project's custom block list is refetched, so the new block (and the instance
 * that replaced the selection) resolve without a page reload.
 */
export function useExtractCustomBlock(o: Options) {
	const qc = useQueryClient();
	const [ids, setIds] = useState<string[] | null>(null);
	const [pending, setPending] = useState(false);

	async function submit(input: ExtractInput) {
		if (!ids) return;
		setPending(true);
		try {
			if (o.hasUnsavedChanges && !(await o.save())) return;
			const saved = await o.reload();
			const keys = ids.map((id) => saved.blocks.find((b) => b.id === id)?.key);
			if (keys.some((k) => !k)) {
				toast.danger("Save the canvas first: some selected blocks are not saved yet.");
				return;
			}
			await customBlocksService.extract({
				projectId: o.target.projectId,
				source: { kind: o.target.resourceType, id: o.target.resourceId },
				keys: keys as string[],
				...input,
			});
			await qc.invalidateQueries({ queryKey: ["custom-blocks", o.target.projectId] });
			if (input.replace) await o.reloadCanvas();
			toast.success(`Created custom block "${input.label}"`);
			setIds(null);
		} catch (error) {
			// the server words an untidy selection so the user knows what to clean up
			showErrorNotification((error as Error).message || "Could not extract the selection");
		} finally {
			setPending(false);
		}
	}

	return {
		open: o.enabled ? setIds : undefined,
		modal: (
			<ExtractCustomBlockModal
				open={ids !== null}
				onOpenChange={(open) => !open && setIds(null)}
				blockCount={ids?.length ?? 0}
				isPending={pending}
				onSubmit={(input) => void submit(input)}
			/>
		),
	};
}
