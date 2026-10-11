import { Checkbox, Tabs } from "@fluxify/components";
import { useState } from "react";
import type { Observability } from "./observability";

export const PROD_RECORDING_HINT =
	"Recording is heavy at scale. Prefer tracing, or open the route in a sandbox.";

type Env = "development" | "production";

/**
 * The route and workflow settings: a Development and a Production tab with the
 * same two switches. They are settings, not definition — they apply live and are
 * saved with the rest of the form.
 */
export function ObservabilityTabs({
	value,
	onChange,
	readOnly,
	noun,
}: {
	value: Observability;
	onChange: (next: Observability) => void;
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
		<Tabs selectedKey={tab} onSelectionChange={(key) => setTab(key as Env)}>
			<Tabs.List aria-label="Environment">
				<Tabs.Tab id="development">Development</Tabs.Tab>
				<Tabs.Tab id="production">Production</Tabs.Tab>
			</Tabs.List>
			{(["development", "production"] as const).map((env) => (
				<Tabs.Panel key={env} id={env} className="flex flex-col gap-4 pt-4">
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
