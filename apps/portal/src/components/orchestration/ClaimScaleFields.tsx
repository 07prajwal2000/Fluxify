import { Label, NumberField } from "@fluxify/components";

/**
 * How big one node of a claim is, and how far the claim may grow (#431).
 *
 * The maximum only shows where something reads it: Docker never autoscales, so
 * a maximum there would be a control that does nothing. A maximum equal to the
 * minimum means "never grows" and is sent as null, so there is no separate
 * on/off switch to get out of step with the number.
 */
export interface ClaimScale {
	replicas: number;
	maxReplicas: number;
	cpu: number;
	memoryMb: number;
}

export function ClaimScaleFields({
	value,
	onChange,
	autoscales,
	node,
	poolRoom,
}: {
	value: ClaimScale;
	onChange: (next: ClaimScale) => void;
	/** True when the platform grows claims on its own (Kubernetes). */
	autoscales: boolean;
	/** The provider's word for one node: container or pod. */
	node: string;
	/** The most this claim can ever reach: the pool less every other claim's minimum. */
	poolRoom: number;
}) {
	const set = (patch: Partial<ClaimScale>) => {
		const next = { ...value, ...patch };
		// Raising the floor past the ceiling drags the ceiling with it; the API
		// refuses a maximum below the minimum.
		next.maxReplicas = Math.max(next.maxReplicas, next.replicas);
		onChange(next);
	};
	const grows = autoscales && value.maxReplicas > value.replicas;
	// The API takes a maximum past the pool on purpose (the pool is a soft limit),
	// but the orchestrator never scales past it, so say where it really stops.
	const capped = grows && value.maxReplicas > poolRoom;

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap gap-5">
				<Field
					label={autoscales ? "Minimum copies" : "Identical copies"}
					value={value.replicas}
					min={1}
					max={50}
					onChange={(replicas) => set({ replicas })}
				/>
				{autoscales && (
					<Field
						label="Maximum copies"
						value={value.maxReplicas}
						min={value.replicas}
						max={50}
						onChange={(maxReplicas) => set({ maxReplicas })}
					/>
				)}
			</div>
			{autoscales && (
				<p className="text-xs text-muted">
					{grows
						? `Always runs at least ${value.replicas}, and adds ${node}s under load up to ${value.maxReplicas}. The pool and licence can hold it lower.`
						: "Same as the minimum: it runs exactly that many and never grows."}
				</p>
			)}
			{capped && (
				<p className="text-xs text-warning">
					The node pool only has room for {Math.max(poolRoom, 0)} of this claim's {node}s, so it
					stops there until the pool grows.
				</p>
			)}

			<div className="flex flex-wrap gap-5">
				<Field
					label={`CPU per ${node}`}
					value={value.cpu}
					min={0.5}
					max={16}
					step={0.5}
					onChange={(cpu) => set({ cpu })}
				/>
				<Field
					label={`Memory per ${node} (MB)`}
					value={value.memoryMb}
					min={256}
					max={65_536}
					step={256}
					onChange={(memoryMb) => set({ memoryMb })}
				/>
			</div>
			<p className="text-xs text-muted">
				Every copy gets this much and no more. Changing it replaces the running {node}s.
			</p>
		</div>
	);
}

function Field({
	label,
	value,
	min,
	max,
	step = 1,
	onChange,
}: {
	label: string;
	value: number;
	min: number;
	max: number;
	step?: number;
	onChange: (next: number) => void;
}) {
	return (
		<NumberField
			value={value}
			minValue={min}
			maxValue={max}
			step={step}
			onChange={(next) => onChange(Math.max(min, Math.min(max, next || min)))}
			className="w-44"
		>
			<Label>{label}</Label>
			<NumberField.Group>
				<NumberField.DecrementButton />
				<NumberField.Input />
				<NumberField.IncrementButton />
			</NumberField.Group>
		</NumberField>
	);
}
