import { Description, JavaScriptTextArea, Label, usePackageTypes } from "@fluxify/components";
import { useParams } from "@tanstack/react-router";
import { useReactFlow } from "@xyflow/react";
import { TbCode } from "react-icons/tb";
import { integrationsQuery } from "@/query/integrationsQuery";
import { useCanvasChanges } from "../../../changes/ChangesContext";
import type { BlockNode } from "../../../types";
import { BlockSettings } from "../../BlockSettings";
import { BlockIntegrationField } from "../../fields";

/** General tab: Connection selection */
export function NativeDbGeneralSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockIntegrationField
				blockId={block.id}
				data={block.data}
				name="connection"
				group="database"
				label="Choose Database Connection"
				description="Select the database connection to perform a native database operation."
			/>
		</div>
	);
}

/** the server's driver version (packages/adapters/package.json), so the editor's types match what runs */
const MONGODB_VERSION = "7.2.0";
const MONGO_GLOBALS = `declare const db: import("mongodb").Db;
declare const ObjectId: typeof import("mongodb").ObjectId;`;

/** Loads the MongoDB driver's types from jsDelivr into the editor. */
function MongoTypes() {
	usePackageTypes("mongodb", MONGODB_VERSION);
	return null;
}

const codeClass =
	"font-mono text-foreground font-semibold px-1 py-0.5 rounded bg-surface-secondary";

/** Code tab: JavaScript code editor with what the selected database hands the code */
export function NativeDbCodeSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const params = useParams({ strict: false }) as { projectId?: string };
	const connection = typeof block.data.connection === "string" ? block.data.connection : "";
	const { data } = integrationsQuery.getById.useQuery(params?.projectId ?? "", connection);
	const mongo = data?.variant === "MongoDB";

	const jsCode =
		typeof block.data.js === "string"
			? block.data.js
			: typeof block.data.value === "string"
				? block.data.value
				: "";

	return (
		<div className="flex flex-col gap-4 w-full">
			{mongo && <MongoTypes />}
			<div className="flex items-start gap-2.5 p-3 rounded-lg bg-background-secondary border border-border text-xs text-muted leading-relaxed">
				<TbCode className="size-4 shrink-0 text-accent mt-0.5" />
				{mongo ? (
					<div>
						<code className={codeClass}>db</code> is the MongoDB driver's database, already
						connected, e.g.{" "}
						<code className={codeClass}>await db.collection("users").find().toArray()</code>.{" "}
						<code className={codeClass}>ObjectId</code> builds ids. Inside a transaction, every
						collection call joins it.
					</div>
				) : (
					<div>
						You have access to the async function{" "}
						<code className={codeClass}>await dbQuery(query, params)</code> to execute raw queries
						on the selected database adapter. It returns the rows. Pass values in params with $1, $2
						placeholders (MySQL also takes ?).
					</div>
				)}
			</div>

			<div className="flex flex-col gap-1.5 w-full">
				<Label className="text-sm font-medium">JavaScript Code</Label>
				<Description className="text-xs text-muted">
					Write JavaScript code to run queries and return output.
				</Description>
				<JavaScriptTextArea
					expandable
					expandTitle="Native Query - Code Editor"
					rows={14}
					showLineNumbers={true}
					readOnly={!editable}
					value={jsCode}
					typeDefinitions={mongo ? MONGO_GLOBALS : undefined}
					onChange={(next) => updateNodeData(block.id, { js: next })}
				/>
			</div>
		</div>
	);
}

export function nativeDbSettings(block: BlockNode) {
	return [
		<BlockSettings.TabHead key="general" name="General">
			<NativeDbGeneralSettings block={block} />
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead key="code" name="Code">
			<NativeDbCodeSettings block={block} />
		</BlockSettings.TabHead>,
	];
}
