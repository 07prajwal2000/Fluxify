import { Button, Label, NumberField, toast } from "@fluxify/components";
import { useEffect, useState } from "react";
import { showErrorNotification } from "@/lib/errorNotifier";
import { instanceSettingsQuery } from "@/query/instanceSettingsQuery";
import type { OrchestrationStatus } from "@/services/orchestration";

/**
 * The operator's only provisioning knob: how many nodes this instance may run
 * at once. What each node may use is its claim's own setting.
 *
 * It is a **ceiling, not a target**. Claims past it are recorded and left
 * pending rather than refused, which is what tells an operator to grow the pool
 * — so raising this number is what starts the containers that are waiting, and
 * lowering it drains the ones that no longer fit.
 *
 * Written through the normal instance-settings endpoint, which already fans the
 * value out to every process over the message bus, so no restart is involved.
 */
export function PoolForm({ pool }: { pool: OrchestrationStatus["pool"] }) {
	const upsert = instanceSettingsQuery.upsert.mutation();
	const [maxNodes, setMaxNodes] = useState(pool.ceiling);

	useEffect(() => {
		setMaxNodes(pool.ceiling);
	}, [pool.ceiling]);

	const shrinking = maxNodes < pool.placed;
	const growing = maxNodes > pool.ceiling && pool.requested > pool.placed;

	function save() {
		upsert.mutate(
			{
				key: "orchestration_pool",
				category: "orchestration",
				value: { maxNodes },
			},
			{
				onSuccess: () => toast.success("Pool saved"),
				onError: (error) => showErrorNotification(error as Error),
			},
		);
	}

	return (
		<section className="flex flex-col gap-4 rounded-xl border border-border bg-background p-5">
			<div>
				<h3 className="text-sm font-bold text-foreground">Node pool</h3>
				<p className="mt-0.5 text-xs text-muted">
					How much this instance is willing to run. The licence is a separate limit — whichever is
					smaller wins.
				</p>
			</div>

			<div className="flex flex-wrap gap-5">
				<NumberField
					value={maxNodes}
					minValue={0}
					maxValue={100}
					onChange={setMaxNodes}
					className="w-40"
				>
					<Label>Node ceiling</Label>
					<NumberField.Group>
						<NumberField.DecrementButton />
						<NumberField.Input />
						<NumberField.IncrementButton />
					</NumberField.Group>
				</NumberField>
			</div>

			<p className="text-xs text-muted">
				{maxNodes === 0
					? "A ceiling of zero runs nothing at all: every claim sits pending."
					: "Each claim sets how much CPU and memory its nodes may use."}
			</p>

			{shrinking && (
				<p className="text-xs text-warning">
					{pool.placed - maxNodes} running node(s) no longer fit. They will be drained and stopped —
					each finishes what it is running first.
				</p>
			)}
			{growing && (
				<p className="text-xs text-success">
					Nodes that are waiting for room will start on the next check.
				</p>
			)}

			<div>
				<Button variant="primary" isPending={upsert.isPending} onPress={save}>
					Save pool
				</Button>
			</div>
		</section>
	);
}
