import {
	Alert,
	ConditionsBuilder,
	type JoinItem,
	JoinsEditor,
	type JoinType,
} from "@fluxify/components";
import { useParams } from "@tanstack/react-router";
import { useReactFlow } from "@xyflow/react";
import { TbAlertTriangle } from "react-icons/tb";
import { useDbMetadata } from "@/query/findResourceQuery";
import { useCanvasChanges } from "../../../changes/ChangesContext";
import type { BlockNode } from "../../../types";
import {
	normalizeJoin,
	parseDbConditionList,
	readDbBinding,
	serializeDbConditions,
} from "./conditions";

// MySQL has no full join; the server refuses one on save
const MYSQL_JOIN_TYPES: JoinType[] = ["inner", "left", "right"];

/** Joins tab of the db read blocks: each join's type, table and ON conditions */
export function DbJoinsSettings({ block }: { block: BlockNode }) {
	const { updateNodeData } = useReactFlow();
	const { enabled: editable } = useCanvasChanges();
	const params = useParams({ strict: false }) as { projectId?: string };
	const { connectionId, tableName } = readDbBinding(block);
	const { tableNames, getColumnsForTable, variant, conditionEditor } = useDbMetadata(
		params?.projectId ?? "",
		connectionId,
	);
	const joins = Array.isArray(block.data.joins)
		? (block.data.joins as Parameters<typeof normalizeJoin>[0][]).map(normalizeJoin)
		: [];
	const qualified = (qualifier: string, table: string) =>
		qualifier && !qualifier.startsWith("js:")
			? getColumnsForTable(table).map((column) => `${qualifier}.${column}`)
			: [];

	const mongo = variant === "MongoDB";

	return (
		<div className="flex flex-col gap-4 w-full">
			{mongo && (
				<Alert status="warning">
					<Alert.Indicator>
						<TbAlertTriangle size={16} />
					</Alert.Indicator>
					<Alert.Content>
						<Alert.Title>MongoDB has no joins yet</Alert.Title>
						<Alert.Description>
							Joins work on PostgreSQL and MySQL only. A MongoDB block with joins cannot be saved,
							so remove any joins listed below.
						</Alert.Description>
					</Alert.Content>
				</Alert>
			)}
			<JoinsEditor
				label="Table Joins"
				description="Each join matches rows on its conditions, built like the WHERE conditions."
				emptyMessage="No table joins configured."
				isDisabled={!editable}
				locked={mongo}
				joins={joins}
				tableSuggestions={tableNames}
				joinTypes={variant === "MySQL" ? MYSQL_JOIN_TYPES : undefined}
				onChange={(next: JoinItem[]) => updateNodeData(block.id, { joins: next })}
				renderConditions={(join, onChange) => {
					const columns = [
						...qualified(tableName, tableName),
						...qualified(join.alias || join.table, join.table),
					];
					return (
						<ConditionsBuilder
							collapsible={false}
							hasBorder={false}
							disableJsConditions
							ignoreOperators={["is_empty", "is_not_empty"]}
							label="On"
							isDisabled={!editable || mongo}
							conditions={parseDbConditionList(join.on)}
							lhsSuggestions={columns}
							rhsSuggestions={columns}
							allowColumnRefs
							customConditionEditor={conditionEditor}
							allowGroups
							onChange={(next) => onChange(serializeDbConditions(next))}
						/>
					);
				}}
			/>
		</div>
	);
}
