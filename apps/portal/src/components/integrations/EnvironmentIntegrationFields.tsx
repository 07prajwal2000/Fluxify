import { Checkbox, Chip, Label, Tabs } from "@fluxify/components";
import { useState } from "react";
import { TbAlertTriangle } from "react-icons/tb";
import { ConnectorFields } from "./ConnectorFields";
import type { McpOAuthTarget } from "./connectors/types";

export type EnvironmentIntegrationFieldsProps = {
	projectId: string;
	group: string;
	variant: string;
	name: string;
	onName: (v: string) => void;
	config: Record<string, unknown>;
	setField: (path: string, value: unknown) => void;
	devConfig: Record<string, unknown> | null;
	setDevField: (path: string, value: unknown) => void;
	syncDev: boolean;
	onSyncDevChange: (sync: boolean) => void;
	readOnly?: boolean;
	formError?: string | null;
	tools?: { name: string; description: string }[];
	/**
	 * Production and Development as tabs, for a saved integration's page (#933). The page's
	 * header holds Same as prod; Development is then disabled and says so.
	 */
	tabs?: boolean;
	/** mcp, once the integration is saved: what Connect needs, per environment */
	oauth?: {
		integrationId: string;
		canConnect: boolean;
		saved: { production: boolean; development: boolean };
	};
};

export function isConfigEmpty(config: Record<string, unknown> | null | undefined): boolean {
	if (!config) return true;
	const meaningfulEntries = Object.entries(config).filter(([k]) => k !== "source");
	if (meaningfulEntries.length === 0) return true;
	return meaningfulEntries.every(([, v]) => v === "" || v === null || v === undefined);
}

export function EnvironmentIntegrationFields({
	projectId,
	group,
	variant,
	name,
	onName,
	config,
	setField,
	devConfig,
	setDevField,
	syncDev,
	onSyncDevChange,
	readOnly = false,
	formError,
	tools,
	oauth,
	tabs = false,
}: EnvironmentIntegrationFieldsProps) {
	const [envTab, setEnvTab] = useState<"production" | "development">("production");
	const devEmpty = isConfigEmpty(devConfig);
	const target = (env: McpOAuthTarget["env"]): McpOAuthTarget | undefined =>
		oauth && {
			integrationId: oauth.integrationId,
			canConnect: oauth.canConnect,
			env,
			saved: oauth.saved[env],
		};

	const errorBox = formError && (
		<div
			role="alert"
			className="rounded-xl border border-danger/40 bg-danger/10 p-4 text-sm text-danger"
		>
			{formError}
		</div>
	);
	const productionFields = (
		<ConnectorFields
			projectId={projectId}
			group={group}
			variant={variant}
			name={name}
			onName={onName}
			config={config}
			setField={setField}
			readOnly={readOnly}
			tools={tools}
			oauth={target("production")}
		/>
	);
	const syncWarning = (
		<div
			role="alert"
			className="rounded-xl border border-warning/30 bg-warning/10 p-4 text-warning"
		>
			<div className="flex items-start gap-3">
				<TbAlertTriangle size={20} className="shrink-0 mt-0.5 text-warning" />
				<div className="text-sm">
					<p className="font-semibold text-warning">Same as production</p>
					<p className="mt-1 text-xs text-warning/90">
						Dev runs, dev triggers and AI agents will read and write production — same database,
						same queues, same consumer groups. Use separate dev instances instead.
					</p>
				</div>
			</div>
		</div>
	);
	const devHint = devEmpty && (
		<p className="text-xs text-warning">
			Dev workers will fail until you set a development value or turn on Same as production.
		</p>
	);
	const developmentFields = (
		<ConnectorFields
			projectId={projectId}
			group={group}
			variant={variant}
			name={name}
			onName={onName}
			config={devConfig ?? {}}
			setField={setDevField}
			hideName
			readOnly={readOnly}
			tools={tools}
			oauth={target("development")}
		/>
	);

	if (tabs) {
		// a disabled tab can't stay open: Same as prod sends it back to Production
		const selected = syncDev ? "production" : envTab;
		return (
			<div className="flex flex-col gap-4">
				{errorBox}
				{syncDev && syncWarning}
				<Tabs
					variant="secondary"
					selectedKey={selected}
					onSelectionChange={(key) => setEnvTab(key as typeof envTab)}
					disabledKeys={syncDev ? ["development"] : []}
				>
					<Tabs.ListContainer>
						<Tabs.List aria-label="Environment">
							<Tabs.Tab id="production">
								Production
								<Tabs.Indicator />
							</Tabs.Tab>
							<Tabs.Tab id="development">
								<span className="flex items-center gap-2">
									Development
									{syncDev && (
										<Chip size="sm" color="warning" title="Uses the production settings">
											Same as prod
										</Chip>
									)}
								</span>
								<Tabs.Indicator />
							</Tabs.Tab>
						</Tabs.List>
					</Tabs.ListContainer>
					<Tabs.Panel id="production" className="pt-4">
						{productionFields}
					</Tabs.Panel>
					<Tabs.Panel id="development" className="flex flex-col gap-4 pt-4">
						{devHint}
						{developmentFields}
					</Tabs.Panel>
				</Tabs>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6">
			{errorBox}
			{/* Production Section */}
			<div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
				<div className="flex items-center justify-between border-b border-border pb-2">
					<div>
						<h3 className="text-sm font-semibold text-foreground">Production</h3>
						<p className="text-xs text-muted">Configuration for production runs and workers.</p>
					</div>
					<span className="rounded-full bg-surface-secondary px-2.5 py-0.5 text-[11px] font-semibold text-muted">
						Production
					</span>
				</div>
				{productionFields}
			</div>

			{/* Toggle & Warning / Development Section */}
			<div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">
				<div className="flex items-center justify-between">
					<Checkbox
						isSelected={syncDev}
						onChange={onSyncDevChange}
						isDisabled={readOnly}
						aria-label="Same as production"
					>
						<Checkbox.Content>
							<Checkbox.Control>
								<Checkbox.Indicator />
							</Checkbox.Control>
							<Label className="text-sm font-medium text-foreground cursor-pointer">
								Same as production
							</Label>
						</Checkbox.Content>
					</Checkbox>
				</div>

				{syncDev ? (
					syncWarning
				) : (
					<div className="flex flex-col gap-4 pt-1">
						<div className="flex items-center justify-between border-b border-border pb-2">
							<div>
								<h3 className="text-sm font-semibold text-foreground">Development</h3>
								<p className="text-xs text-muted">Configuration for local and development runs.</p>
							</div>
							<span className="rounded-full bg-surface-secondary px-2.5 py-0.5 text-[11px] font-semibold text-muted">
								Development
							</span>
						</div>
						{devHint}
						{developmentFields}
					</div>
				)}
			</div>
		</div>
	);
}
