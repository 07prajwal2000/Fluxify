import { Button, JsonEditor, Select } from "@fluxify/components";
import { useState } from "react";
import { TbSearch } from "react-icons/tb";
import { integrationsQuery } from "@/query/integrationsQuery";

export type IntegrationInspectPanelProps = {
	projectId: string;
	integrationId: string;
	readOnly?: boolean;
};

export function IntegrationInspectPanel({
	projectId,
	integrationId,
	readOnly = false,
}: IntegrationInspectPanelProps) {
	const inspectMutation = integrationsQuery.inspect.mutation(projectId);
	const [env, setEnv] = useState<"development" | "production">("development");
	const [requestBody, setRequestBody] = useState<Record<string, unknown>>({});
	const [inspectResult, setInspectResult] = useState<unknown>();
	const [inspectError, setInspectError] = useState<string | null>(null);

	const runInspect = () => {
		setInspectError(null);
		inspectMutation.mutate(
			{ id: integrationId, body: requestBody, env },
			{
				onSuccess: (data) => {
					setInspectResult(data);
					setInspectError(null);
				},
				onError: (err: any) => {
					const msg = err?.response?.data?.message ?? err?.message ?? "Inspect failed";
					setInspectError(msg);
				},
			},
		);
	};

	return (
		<div
			className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4"
			data-testid="integration-inspect-panel"
		>
			<div className="flex items-center justify-between border-b border-border pb-2">
				<div>
					<h3 className="text-sm font-semibold text-foreground">Inspect</h3>
					<p className="text-xs text-muted">
						Query metadata or test inspection hooks on this integration.
					</p>
				</div>
				<div className="flex items-center gap-2">
					<span className="text-xs text-muted">Environment:</span>
					<select
						aria-label="Inspect environment"
						value={env}
						onChange={(e) => setEnv(e.target.value as "development" | "production")}
						className="rounded-md border border-border bg-surface-secondary px-2 py-1 text-xs text-foreground outline-none"
					>
						<option value="development">Development</option>
						<option value="production">Production</option>
					</select>
				</div>
			</div>

			<div className="flex flex-col gap-2">
				<JsonEditor
					label="Inspect Request (JSON)"
					value={requestBody as never}
					onChange={(val) => setRequestBody((val as Record<string, unknown>) ?? {})}
				/>
				<div className="flex items-center justify-end">
					<Button
						variant="outline"
						size="sm"
						isPending={inspectMutation.isPending}
						onPress={runInspect}
					>
						<TbSearch size={14} className="text-accent" />
						<span>Inspect</span>
					</Button>
				</div>
			</div>

			{inspectError && (
				<div
					role="alert"
					className="rounded-lg border border-danger/40 bg-danger/10 p-3 text-xs text-danger"
				>
					{inspectError}
				</div>
			)}

			{inspectResult !== undefined && (
				<div className="flex flex-col gap-1.5 border-t border-border pt-3">
					<h4 className="text-xs font-semibold text-muted uppercase tracking-wider">
						Inspect Result
					</h4>
					<div
						className="max-h-60 overflow-auto rounded-lg border border-border bg-background-secondary p-3 font-mono text-xs text-foreground"
						data-testid="inspect-result"
					>
						<pre className="whitespace-pre-wrap">{JSON.stringify(inspectResult, null, 2)}</pre>
					</div>
				</div>
			)}
		</div>
	);
}
