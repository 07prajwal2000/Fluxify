import { Checkbox, Tabs } from "@fluxify/components";
import { useState } from "react";
import type { Observability } from "./observability";

export const PROD_ENABLED_HINT =
	"Turn off to stop serving this in production while you keep working in development.";

export const PROD_RECORDING_HINT =
	"Recording is heavy at scale. Prefer tracing, or open the route in a sandbox.";

type Env = "development" | "production";

/** Whether the route or workflow is served in each environment (#738): `active` is production's. */
export type EnabledSwitches = { active: boolean; devActive: boolean };

/**
 * The route and workflow settings: a Development and a Production tab, each
 * with an Enabled switch and the recording and tracing switches. They are
 * settings, not definition — they apply live and are saved with the rest of
 * the form.
 */
export function ObservabilityTabs({
	value,
	onChange,
	enabled,
	onEnabledChange,
	readOnly,
	noun,
}: {
	value: Observability;
	onChange: (next: Observability) => void;
	enabled: EnabledSwitches;
	onEnabledChange: (next: EnabledSwitches) => void;
	readOnly: boolean;
	/** "route" or "workflow", for the labels */
	noun: string;
}) {
	const [tab, setTab] = useState<Env>("development");
	const keys = {
		development: { record: "devRecordExecution", trace: "devTracingEnabled" },
		production: { record: "recordExecution", trace: "tracingEnabled" },
	} as const;

	return (
		<Tabs selectedKey={tab} onSelectionChange={(key) => setTab(key as Env)} variant="secondary">
			{/* the secondary variant draws the underline through the container and one
			    indicator inside each tab; without them the tabs are plain text */}
			<Tabs.ListContainer>
				<Tabs.List aria-label="Environment">
					<Tabs.Tab id="development">
						Development
						<Tabs.Indicator />
					</Tabs.Tab>
					<Tabs.Tab id="production">
						Production
						<Tabs.Indicator />
					</Tabs.Tab>
				</Tabs.List>
			</Tabs.ListContainer>
			{(["development", "production"] as const).map((env) => (
				<Tabs.Panel key={env} id={env} className="flex flex-col gap-4 pt-4">
					<div className="flex flex-col gap-1">
						<Checkbox
							isSelected={env === "development" ? enabled.devActive : enabled.active}
							onChange={(on) =>
								onEnabledChange({
									...enabled,
									[env === "development" ? "devActive" : "active"]: on,
								})
							}
							isDisabled={readOnly}
							label="Enabled"
							description={`Serve this ${noun} in ${env}. When off, it is not served there.`}
						/>
						{env === "production" && <p className="pl-7 text-xs text-muted">{PROD_ENABLED_HINT}</p>}
					</div>
					<div className="flex flex-col gap-1">
						<Checkbox
							isSelected={value[keys[env].record]}
							onChange={(on) => onChange({ ...value, [keys[env].record]: on })}
							isDisabled={readOnly}
							label="Recording"
							description={`Keep each ${env} run of this ${noun} in Fluxify, inputs and outputs included, to replay it from the Executions tab.`}
						/>
						{env === "production" && (
							<p className="pl-7 text-xs text-warning">{PROD_RECORDING_HINT}</p>
						)}
					</div>
					<Checkbox
						isSelected={value[keys[env].trace]}
						onChange={(on) => onChange({ ...value, [keys[env].trace]: on })}
						isDisabled={readOnly}
						label="Tracing (OTel)"
						description={`Send spans of each ${env} run to your project's tracing destination.`}
					/>
				</Tabs.Panel>
			))}
		</Tabs>
	);
}
