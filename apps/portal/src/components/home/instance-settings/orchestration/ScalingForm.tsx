import { Button, Label, NumberField, toast } from "@fluxify/components";
import { useEffect, useState } from "react";
import { showErrorNotification } from "@/lib/errorNotifier";
import { instanceSettingsQuery } from "@/query/instanceSettingsQuery";

type Policy = { queuedPerNode: number; pollIntervalSec: number; scaleDownWindowSec: number };

// Mirrors the server's defaults: an absent row means these.
const DEFAULTS: Policy = { queuedPerNode: 10, pollIntervalSec: 30, scaleDownWindowSec: 300 };

/**
 * How claims with a maximum decide to grow and shrink (#431). One policy for
 * the instance — these are the operator's tolerances, not a project's choice.
 * Only shown on Kubernetes, the one platform that autoscales.
 */
export function ScalingForm() {
	const { data } = instanceSettingsQuery.getAll.useQuery();
	const saved = data?.find((s) => s.key === "orchestration_scaling")?.value as
		| Partial<Policy>
		| undefined;
	const upsert = instanceSettingsQuery.upsert.mutation();
	const [policy, setPolicy] = useState<Policy>(DEFAULTS);

	useEffect(() => {
		setPolicy({ ...DEFAULTS, ...saved });
	}, [saved]);

	const set = (key: keyof Policy) => (next: number) =>
		setPolicy((p) => ({ ...p, [key]: Number.isFinite(next) ? next : DEFAULTS[key] }));

	function save() {
		upsert.mutate(
			{ key: "orchestration_scaling", category: "orchestration", value: policy },
			{
				onSuccess: () => toast.success("Scaling policy saved"),
				onError: (error) => showErrorNotification(error as Error),
			},
		);
	}

	return (
		<section className="flex flex-col gap-4 rounded-xl border border-border bg-background p-5">
			<div>
				<h3 className="text-sm font-bold text-foreground">Scaling policy</h3>
				<p className="mt-0.5 text-xs text-muted">
					How a claim with a maximum grows and shrinks. A claim without one runs a fixed number of
					pods and ignores this.
				</p>
			</div>

			<div className="flex flex-wrap gap-5">
				<Field
					label="Queued runs per pod"
					value={policy.queuedPerNode}
					min={1}
					max={100_000}
					onChange={set("queuedPerNode")}
				/>
				<Field
					label="Check every (seconds)"
					value={policy.pollIntervalSec}
					min={5}
					max={3600}
					onChange={set("pollIntervalSec")}
				/>
				<Field
					label="Scale-down wait (seconds)"
					value={policy.scaleDownWindowSec}
					min={0}
					max={3600}
					onChange={set("scaleDownWindowSec")}
				/>
			</div>

			<p className="text-xs text-muted">
				A workflow claim adds a pod each time this many runs are waiting on one of its triggers.
				Growing is never delayed; shrinking waits until the load has stayed low for the scale-down
				wait, so a short lull does not stop pods you are about to need. Queue-based growth needs
				KEDA in the cluster — without it, claims stay at their minimum.
			</p>

			<div>
				<Button variant="primary" isPending={upsert.isPending} onPress={save}>
					Save scaling policy
				</Button>
			</div>
		</section>
	);
}

function Field({
	label,
	value,
	min,
	max,
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	onChange: (next: number) => void;
}) {
	return (
		<NumberField value={value} minValue={min} maxValue={max} onChange={onChange} className="w-48">
			<Label>{label}</Label>
			<NumberField.Group>
				<NumberField.DecrementButton />
				<NumberField.Input />
				<NumberField.IncrementButton />
			</NumberField.Group>
		</NumberField>
	);
}
