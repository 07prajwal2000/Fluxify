import { useParams } from "@tanstack/react-router";
import { TbInfoCircle } from "react-icons/tb";
import { integrationsQuery } from "@/query/integrationsQuery";
import type { BlockNode } from "../../../types";
import { BlockSettings } from "../../BlockSettings";
import { BlockIntegrationField, BlockSelectField, BlockTextField } from "../../fields";

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
			<div className="flex items-start gap-2.5 p-3 rounded-lg bg-background-secondary border border-border text-xs text-muted leading-relaxed">
				<TbInfoCircle className="size-4 shrink-0 text-accent mt-0.5" />
				<div>
					Connect blocks to the <strong>executor port</strong> to execute operations inside this
					transaction. If all succeed, it commits and the <strong>success</strong> path gets the
					executor chain's last output. If an error occurs, the timeout passes or a Rollback block
					runs, it is rolled back and the <strong>failure</strong> path gets{" "}
					<code>{"{ reason, message }"}</code>, where reason is <code>error</code>,{" "}
					<code>timeout</code> or <code>rollback</code>. With no failure path, an error or timeout
					fails the run and a rollback ends it.
				</div>
			</div>
		</div>
	);
}

/** Advanced tab: timeout, retries and isolation level */
export function TransactionDbAdvancedSettings({ block }: { block: BlockNode }) {
	const { projectId = "" } = useParams({ strict: false }) as { projectId?: string };
	const { data: integrations } = integrationsQuery.getAll.useQuery(projectId, "database");
	const isMongo =
		integrations?.find((item) => item.id === block.data.connection)?.variant === "MongoDB";

	return (
		<div className="flex flex-col gap-4 w-full">
			<div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
				<BlockTextField
					blockId={block.id}
					data={block.data}
					name="timeoutMs"
					label="Timeout (ms)"
					placeholder="30000"
					hint="Whole transaction, retries included. Default: 30000 (30 seconds)."
				/>
				<BlockTextField
					blockId={block.id}
					data={block.data}
					name="retries"
					label="Retries"
					placeholder="0"
					hint="Extra attempts after a deadlock or conflict. Default: 0. A retry runs the whole executor chain again, including any HTTP calls in it."
				/>
			</div>
			<BlockSelectField
				blockId={block.id}
				data={block.data}
				name="isolation"
				label="Isolation level"
				placeholder="Database default"
				hint={isMongo ? "MongoDB has no isolation levels; keep the database default." : undefined}
				options={[
					{ value: "default", label: "Database default" },
					{ value: "read_committed", label: "Read committed" },
					{ value: "repeatable_read", label: "Repeatable read" },
					{ value: "serializable", label: "Serializable" },
				]}
			/>
		</div>
	);
}

export function transactionDbSettings(block: BlockNode) {
	return [
		<BlockSettings.TabHead key="general" name="General">
			<TransactionDbGeneralSettings block={block} />
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead key="advanced" name="Advanced">
			<TransactionDbAdvancedSettings block={block} />
		</BlockSettings.TabHead>,
	];
}
