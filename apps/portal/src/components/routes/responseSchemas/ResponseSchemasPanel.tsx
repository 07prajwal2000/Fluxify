import { Accordion, Button, Label, NumberField, Spinner } from "@fluxify/components";
import { useState } from "react";
import { TbBraces, TbChevronDown, TbPlus } from "react-icons/tb";
import { EmptyState } from "@/components/common/EmptyState";
import { responseSchemasQuery } from "@/query/responseSchemasQuery";
import { useCanEditProject } from "@/store/auth";
import { ResponseSchemaBody } from "./ResponseSchemaBody";

const validCode = (n: number | undefined): n is number =>
	n !== undefined && Number.isInteger(n) && n >= 100 && n <= 599;

/**
 * The route's saved response schemas as a stack of accordions, one per status
 * code, lowest first. A schema shows here as soon as it is saved, from the
 * playground's "Save as schema" or by hand.
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
	const [newCode, setNewCode] = useState<number | undefined>();
	// a status code added by hand, kept until it is saved and arrives in the list
	const [pending, setPending] = useState<number[]>([]);

	if (isLoading) return <Spinner />;
	const saved = new Map((data ?? []).map((s) => [s.statusCode, s]));
	const codes = [...new Set([...saved.keys(), ...pending])].sort((a, b) => a - b);

	const add = () => {
		if (!validCode(newCode)) return;
		if (!saved.has(newCode)) setPending((p) => [...new Set([...p, newCode])]);
		setNewCode(undefined);
	};

	return (
		<div className="flex flex-col gap-3">
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
			{codes.length === 0 ? (
				<EmptyState
					icon={<TbBraces size={28} />}
					title="No response schemas yet"
					description={
						canEdit
							? "Send a request, then use Save as schema in the response body. Or add a status code above."
							: "Nobody has saved a response schema for this route."
					}
				/>
			) : (
				<Accordion
					allowsMultipleExpanded
					hideSeparator
					className="flex flex-col gap-2"
					aria-label="Status codes"
				>
					{codes.map((code) => (
						<Accordion.Item
							key={code}
							id={String(code)}
							className="rounded-md border border-border bg-surface px-3"
						>
							<Accordion.Trigger className="flex w-full items-center justify-between gap-2 py-2">
								<span className="font-mono text-sm font-semibold text-foreground">{code}</span>
								<TbChevronDown size={16} className="text-muted" />
							</Accordion.Trigger>
							<Accordion.Panel>
								<Accordion.Body className="border-t border-border pb-3 pt-3">
									<ResponseSchemaBody
										// a save changes `updatedAt`, so the editor restarts from what was stored
										key={`${code}-${saved.get(code)?.updatedAt}`}
										routeId={routeId}
										statusCode={code}
										stored={saved.get(code)?.schema}
										canEdit={canEdit}
									/>
								</Accordion.Body>
							</Accordion.Panel>
						</Accordion.Item>
					))}
				</Accordion>
			)}
		</div>
	);
}
