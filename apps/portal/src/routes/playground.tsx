import { useState, type ReactNode } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
	Card,
	ConditionsBuilder,
	type Condition,
	FieldMapEditor,
	IntegrationSelector,
	type Integration,
	JsTextField,
	Label,
	ListBox,
	Select,
} from "@fluxify/components";

/**
 * Component playground. Sits outside `_authed` on purpose — no session needed,
 * so shared components can be poked at without a project or a login.
 *
 * To add a component: write a demo below and add one entry to DEMOS.
 */
export const Route = createFileRoute("/playground")({
	component: PlaygroundPage,
});

/** Each field prints the value it stores, so the `js:` prefix is visible. */
function JsTextFieldCase({
	title,
	initial,
	isDisabled,
}: {
	title: string;
	initial: string;
	isDisabled?: boolean;
}) {
	const [value, setValue] = useState(initial);

	return (
		<div className="flex flex-col gap-2">
			<JsTextField
				description="Type a literal, or hit the JS button to write an expression."
				fullWidth
				isDisabled={isDisabled}
				label={title}
				onChange={setValue}
				placeholder="Enter a value"
				value={value}
			/>
			<pre className="rounded-[var(--radius)] bg-surface p-2 font-mono text-xs text-muted">
				{JSON.stringify(value)}
			</pre>
		</div>
	);
}

function JsTextFieldDemo() {
	return (
		<>
			<JsTextFieldCase initial="" title="Empty" />
			<JsTextFieldCase initial="hello world" title="Literal value" />
			<JsTextFieldCase initial="js:input.userId" title="Expression value" />
			<JsTextFieldCase initial="js:input.userId" isDisabled title="Disabled" />
		</>
	);
}

function ConditionsBuilderDemo() {
	const [conditions, setConditions] = useState<Condition[]>([
		{ lhs: "status", operator: "eq", rhs: "active", chain: "and" },
		{ lhs: "role", operator: "eq", rhs: "admin", chain: "or" },
		{ lhs: "", operator: "js", rhs: "", js: "context.user.score > 80", chain: "and" },
		{ lhs: "deletedAt", operator: "is_empty", rhs: "", chain: "and" },
	]);

	return (
		<div className="flex flex-col gap-4">
			<ConditionsBuilder
				label="Filter Rules"
				description="Click header to expand/collapse. When collapsed, a pre-tagged expression preview is shown."
				conditions={conditions}
				onChange={setConditions}
			/>
			<pre className="rounded-[var(--radius)] bg-surface p-3 font-mono text-xs text-muted overflow-auto max-h-60 border border-border">
				{JSON.stringify(conditions, null, 2)}
			</pre>
		</div>
	);
}

function FieldMapEditorDemo() {
	const [fieldMap, setFieldMap] = useState<Record<string, string>>({
		userId: "user_id",
		emailAddress: "email",
		createdAt: "created_at",
	});

	return (
		<div className="flex flex-col gap-4">
			<FieldMapEditor
				description="Map source payload keys to target database columns."
				fieldMap={fieldMap}
				label="Field Mapping Configuration"
				onKeyValueChange={setFieldMap}
			/>
			<pre className="rounded-[var(--radius)] bg-surface p-3 font-mono text-xs text-muted overflow-auto max-h-60 border border-border">
				{JSON.stringify(fieldMap, null, 2)}
			</pre>
		</div>
	);
}

// ── Mock data for IntegrationSelector playground demo ────────────────────────
const MOCK_DB_INTEGRATIONS: Integration[] = [
	{ id: "int-1", name: "Production Postgres", group: "database", variant: "PostgreSQL", config: {} },
	{ id: "int-2", name: "Analytics Mongo", group: "database", variant: "MongoDB", config: {} },
	{ id: "int-3", name: "Session Redis", group: "database", variant: "Redis", config: {} },
	{ id: "int-4", name: "Legacy MySQL", group: "database", variant: "MySQL", config: {}, tags: ["legacy"] },
	{ id: "int-5", name: "Supabase Dev", group: "database", variant: "Supabase", config: {} },
];

function sleep(ms: number) {
	return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function mockLoadIntegrations(): Promise<Integration[]> {
	await sleep(800);
	return MOCK_DB_INTEGRATIONS;
}

async function mockTestConnection(id: string): Promise<void> {
	await sleep(1200);
	// Simulate an occasional failure on the Redis integration.
	if (id === "int-3") throw new Error("Connection refused — Redis port 6379 unreachable");
}

function IntegrationSelectorDemo() {
	const [selectedId, setSelectedId] = useState("");

	return (
		<div className="flex flex-col gap-4">
			<IntegrationSelector
				selectedId={selectedId}
				loadIntegrations={mockLoadIntegrations}
				onSelect={setSelectedId}
				onTestConnection={mockTestConnection}
				openInNewTabUrl={selectedId ? `#/integrations?open=${selectedId}&group=database` : undefined}
				createIntegrationUrl="#/integrations"
				label="Database Integration"
				description="Select a database integration for this block. Use 'Test Connection' to verify it's reachable."
			/>
			<pre className="rounded-[var(--radius)] bg-surface p-3 font-mono text-xs text-muted overflow-auto border border-border">
				{JSON.stringify({ selectedId }, null, 2)}
			</pre>
			<p className="text-xs text-muted-foreground">
				<strong>Note:</strong> "Session Redis" will intentionally fail the test connection to demo the error state.
			</p>
		</div>
	);
}

const DEMOS: { name: string; render: () => ReactNode }[] = [
	{ name: "JsTextField", render: () => <JsTextFieldDemo /> },
	{ name: "ConditionsBuilder", render: () => <ConditionsBuilderDemo /> },
	{ name: "FieldMapEditor", render: () => <FieldMapEditorDemo /> },
	{ name: "IntegrationSelector", render: () => <IntegrationSelectorDemo /> },
];

function PlaygroundPage() {
	// One component at a time — the list grows, and mounting every demo at once
	// makes the page noisy and slow (each editor is a real Monaco instance).
	const [selected, setSelected] = useState(DEMOS[0]!.name);
	const demo = DEMOS.find((entry) => entry.name === selected);

	return (
		<div className="min-h-screen w-screen bg-background p-8 text-foreground">
			<div className="mx-auto flex max-w-5xl flex-col gap-6">
				<div>
					<h1 className="text-xl font-semibold">Component playground</h1>
					<p className="text-sm text-muted">
						Unauthenticated scratch page for @fluxify/components.
					</p>
				</div>

				<Select
					fullWidth
					onChange={(next) => setSelected(String(next))}
					value={selected}
					variant="secondary"
				>
					<Label>Component</Label>
					<Select.Trigger>
						<Select.Value />
						<Select.Indicator />
					</Select.Trigger>
					<Select.Popover>
						<ListBox>
							{DEMOS.map((entry) => (
								<ListBox.Item
									key={entry.name}
									id={entry.name}
									textValue={entry.name}
								>
									{entry.name}
									<ListBox.ItemIndicator />
								</ListBox.Item>
							))}
						</ListBox>
					</Select.Popover>
				</Select>

				<Card className="flex flex-col gap-6 border border-border p-6">
					{/* Keyed so switching components remounts rather than reusing state. */}
					<div key={selected} className="flex flex-col gap-6">
						{demo?.render()}
					</div>
				</Card>
			</div>
		</div>
	);
}
