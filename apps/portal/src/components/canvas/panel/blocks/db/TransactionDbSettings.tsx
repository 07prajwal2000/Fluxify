import { TbInfoCircle } from "react-icons/tb";
import type { BlockNode } from "../../../types";
import { BlockSettings } from "../../BlockSettings";
import { BlockIntegrationField } from "../../fields";

/** General tab: Connection selection and transaction information */
export function TransactionDbGeneralSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockIntegrationField
				blockId={block.id}
				data={block.data}
				name="connection"
				group="database"
				label="Choose Database Connection"
				description="Select the database connection to start a transaction."
			/>
			<div className="flex items-start gap-2.5 p-3 rounded-lg bg-[var(--background-secondary,#18181b)] border border-[var(--border,#27272a)] text-xs text-muted leading-relaxed">
				<TbInfoCircle className="size-4 shrink-0 text-primary mt-0.5" />
				<div>
					Connect blocks to the <strong>executor port</strong> to execute operations inside this
					transaction. If all succeed, it commits and the <strong>success</strong> path gets the
					executor chain's last output. If an error occurs or a Rollback block runs, it is rolled
					back and the <strong>failure</strong> path gets <code>{"{ reason, message }"}</code>. With
					no failure path, an error fails the run and a rollback ends it.
				</div>
			</div>
		</div>
	);
}

export function transactionDbSettings(block: BlockNode) {
	return (
		<BlockSettings.TabHead key="general" name="General">
			<TransactionDbGeneralSettings block={block} />
		</BlockSettings.TabHead>
	);
}
