import { Button } from "@heroui/react";
import { useState } from "react";
import { TbChevronDown, TbChevronRight } from "react-icons/tb";
import type { Rule, SchemaNode, SchemaProperty, ValidationSchema } from "./types";

/** `minLength: 3, regex: ^a+$` — the rules, inline, in authoring order. */
function summariseRules(rules?: Rule[]): string {
	if (!rules?.length) return "";
	const parts = rules
		.filter((rule) => rule.value !== undefined && rule.value !== "")
		.map((rule) => {
			const value = Array.isArray(rule.value)
				? rule.value.join(" | ")
				: String(rule.value);
			return `${rule.type}: ${value}`;
		});
	return parts.length ? ` (${parts.join(", ")})` : "";
}

function PreviewNode({
	label,
	node,
	isRequired,
}: {
	label: string;
	node: SchemaNode;
	isRequired?: boolean;
}) {
	const [isOpen, setIsOpen] = useState(true);
	const children = node.dataType === "object" ? (node.properties ?? []) : [];
	const items = node.dataType === "arr" ? node.items : undefined;
	const hasChildren = children.length > 0 || Boolean(items);

	return (
		<div className="ml-3 mt-1">
			<div className="flex items-start gap-1">
				{hasChildren ? (
					<Button
						aria-label={isOpen ? `Collapse ${label}` : `Expand ${label}`}
						className="mt-0.5 h-4 w-4 min-w-4 p-0"
						isIconOnly
						onPress={() => setIsOpen((prev) => !prev)}
						size="sm"
						variant="ghost"
					>
						{isOpen ? (
							<TbChevronDown className="size-3.5" />
						) : (
							<TbChevronRight className="size-3.5" />
						)}
					</Button>
				) : (
					<span aria-hidden className="inline-block w-4" />
				)}

				<div className="min-w-0 flex-1">
					<p className="font-mono text-xs">
						<span className="font-semibold text-accent">{label}</span>
						<span className="text-muted-foreground">
							{": "}
							{node.dataType}
							{isRequired && <span className="text-danger"> *</span>}
							{summariseRules(node.rules)}
							{node.dataType === "js" && !node.js && " (no code)"}
						</span>
					</p>

					{hasChildren && isOpen && (
						<div className="border-l border-border">
							{children.map((child, index) => (
								<PreviewNode
									isRequired={child.required ?? true}
									key={child.id ?? `${index}-${child.key}`}
									label={child.key || "<unnamed>"}
									node={child}
								/>
							))}
							{items && <PreviewNode label="[item]" node={items} />}
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

/** Read-only outline of the whole schema — the shape, not the form. */
export function SchemaPreview({ schema }: { schema: ValidationSchema }) {
	if (schema.dataType === "js") {
		return (
			<p className="text-sm text-muted">
				This schema is validated entirely by custom JavaScript.
			</p>
		);
	}

	const properties: SchemaProperty[] = schema.properties ?? [];
	const isEmpty =
		schema.dataType === "object"
			? properties.length === 0
			: schema.dataType === "arr" && !schema.items;

	if (isEmpty) {
		return <p className="text-sm italic text-muted">Nothing defined yet.</p>;
	}

	return (
		<div className="rounded-[var(--radius)] border border-border bg-surface py-3">
			{schema.dataType === "object" ? (
				properties.map((property, index) => (
					<PreviewNode
						isRequired={property.required ?? true}
						key={property.id ?? `${index}-${property.key}`}
						label={property.key || "<unnamed>"}
						node={property}
					/>
				))
			) : (
				<PreviewNode label="<root>" node={schema} />
			)}
		</div>
	);
}
