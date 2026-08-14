import { Breadcrumbs, Button } from "@heroui/react";
import { useMemo } from "react";
import { TbPlus, TbSettings } from "react-icons/tb";
import { CONTAINER_TYPES } from "./constants";
import { useSchemaEditorContext } from "./context";
import { DataTypeSelect } from "./DataTypeSelect";
import { InfoNote } from "./InfoNote";
import { PropertyRow } from "./PropertyRow";
import type { SchemaNode, SchemaPath, SchemaProperty } from "./types";
import { buildBreadcrumbs, findDuplicateKeys, getAtPath } from "./utils";

/**
 * The one level of the schema currently in view. Objects list their properties,
 * arrays configure their item schema, and a primitive just points at the rules
 * drawer. Nesting is navigation rather than indentation, so a deep schema stays
 * readable at any depth.
 */
export function SchemaNavigator({
	showRootTypeSelector = true,
}: {
	showRootTypeSelector?: boolean;
}) {
	const {
		schema,
		path,
		goToLevel,
		updateProperty,
		openDrawer,
		isReadOnly,
		typeOptionsFor,
		ruleEditors,
	} = useSchemaEditorContext();

	// A path can outlive the node it pointed at (the property was deleted); fall
	// back to the root rather than rendering nothing.
	const node = (getAtPath(schema, path) ?? schema) as SchemaNode;
	const crumbs = useMemo(() => buildBreadcrumbs(schema, path), [schema, path]);

	const rootTypeOptions = typeOptionsFor([], true);
	const showRootTypes =
		showRootTypeSelector &&
		!isReadOnly &&
		path.length === 0 &&
		rootTypeOptions.length > 1;

	return (
		<div className="flex flex-col gap-4">
			<Breadcrumbs>
				{crumbs.map((crumb) => (
					<Breadcrumbs.Item
						key={crumb.level}
						onPress={() => goToLevel(crumb.level)}
					>
						{crumb.title}
					</Breadcrumbs.Item>
				))}
			</Breadcrumbs>

			{showRootTypes && (
				<div className="flex items-center gap-3">
					<span className="shrink-0 text-sm font-medium text-foreground">
						Root schema type
					</span>
					<DataTypeSelect
						label="Root schema type"
						onChange={(dataType) => updateProperty([], { dataType })}
						options={rootTypeOptions}
						value={schema.dataType}
					/>
				</div>
			)}

			{node.dataType === "arr" ? (
				<ArrayLevel node={node} path={path} />
			) : node.dataType === "object" ? (
				<ObjectLevel node={node} path={path} />
			) : (
				<div className="flex flex-col items-start gap-3">
					<p className="text-sm text-muted-foreground">
						{ruleEditors[node.dataType]
							? "This level is a primitive. Configure its validation rules below."
							: "This level is a primitive with no rules to configure."}
					</p>
					{ruleEditors[node.dataType] && (
						<Button
							onPress={() => openDrawer(path)}
							size="sm"
							variant="secondary"
						>
							<TbSettings className="mr-1 size-4" />
							Configure rules
						</Button>
					)}
				</div>
			)}
		</div>
	);
}

function ObjectLevel({ node, path }: { node: SchemaNode; path: SchemaPath }) {
	const { addProperty, isReadOnly, lockKeys } = useSchemaEditorContext();
	const properties = node.properties ?? [];
	const duplicateKeys = useMemo(
		() => findDuplicateKeys(properties),
		[properties],
	);

	return (
		<div className="flex flex-col gap-3">
			{!isReadOnly && (
				<InfoNote>
					Recursive schemas are not expressible in this UI. For a cyclic shape,
					set the field's type to{" "}
					<span className="font-medium">Write JavaScript</span> and validate it
					in code.
				</InfoNote>
			)}

			{properties.length === 0 ? (
				<p className="py-1 text-sm italic text-muted">
					No properties added yet.
				</p>
			) : (
				<div className="flex flex-col gap-2">
					{properties.map((property, index) => (
						<PropertyRow
							isDuplicateKey={duplicateKeys.has(property.key.trim())}
							key={property.id ?? `${index}-${property.key}`}
							path={[...path, index]}
							property={property}
						/>
					))}
				</div>
			)}

			{!isReadOnly && !lockKeys && (
				<div>
					<Button
						onPress={() => addProperty(path)}
						size="sm"
						variant="secondary"
					>
						<TbPlus className="mr-1 size-4" />
						Add property
					</Button>
				</div>
			)}
		</div>
	);
}

const DEFAULT_ITEMS: SchemaProperty = { key: "", dataType: "str", rules: [] };

function ArrayLevel({ node, path }: { node: SchemaNode; path: SchemaPath }) {
	const {
		goToPath,
		openDrawer,
		updateProperty,
		isReadOnly,
		typeOptionsFor,
		ruleEditors,
	} = useSchemaEditorContext();

	const items = node.items ?? DEFAULT_ITEMS;
	const itemsPath: SchemaPath = [...path, "items"];
	const ArrayRuleEditor = ruleEditors.arr;
	const itemsAreContainer = CONTAINER_TYPES.includes(items.dataType);
	const itemsAreConfigurable =
		itemsAreContainer || Boolean(ruleEditors[items.dataType]);

	return (
		<div className="flex flex-col gap-4">
			{ArrayRuleEditor && (
				<ArrayRuleEditor
					isReadOnly={isReadOnly}
					node={node}
					onUpdate={(updates) => updateProperty(path, updates)}
				/>
			)}

			<div className="h-px w-full bg-border" />

			<div className="flex flex-col gap-2">
				<span className="text-sm font-medium text-foreground">
					Array items data type
				</span>
				<div className="flex items-center gap-2">
					<DataTypeSelect
						isDisabled={isReadOnly}
						label="Array items data type"
						onChange={(dataType) => updateProperty(itemsPath, { dataType })}
						options={typeOptionsFor(itemsPath)}
						value={items.dataType}
					/>
					{itemsAreConfigurable && (
						<Button
							aria-label="Configure array items"
							isIconOnly
							onPress={() =>
								itemsAreContainer ? goToPath(itemsPath) : openDrawer(itemsPath)
							}
							size="sm"
							variant="ghost"
						>
							<TbSettings className="size-4 text-accent" />
						</Button>
					)}
				</div>
			</div>
		</div>
	);
}
