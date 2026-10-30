import { Description, Label, ListBox, Select } from "@fluxify/components";
import { integrationsQuery } from "@/query/integrationsQuery";

const NONE = "__none__";

/**
 * The route's SSE broker (#1024): the NATS or Redis integration `sse.connect`
 * streams through. There is no "SSE on" switch; calling `connect` is the switch.
 */
export function SseBrokerField({
	projectId,
	value,
	onChange,
	readOnly,
}: {
	projectId: string;
	value: string | null;
	onChange: (next: string | null) => void;
	readOnly?: boolean;
}) {
	const { data: queues } = integrationsQuery.getAll.useQuery(projectId, "queue");
	const { data: kvs } = integrationsQuery.getAll.useQuery(projectId, "kv");
	const brokers = [
		...(queues ?? []).filter((integration) => integration.variant === "NATS"),
		...(kvs ?? []).filter((integration) => integration.variant === "Redis"),
	];
	return (
		<Select
			fullWidth
			variant="secondary"
			value={value ?? NONE}
			isDisabled={readOnly}
			onChange={(next) => onChange(next === NONE ? null : String(next))}
		>
			<Label>SSE broker</Label>
			<Select.Trigger>
				<Select.Value />
				<Select.Indicator />
			</Select.Trigger>
			<Description>
				{queues && kvs && brokers.length === 0
					? "No NATS or Redis integration yet. Add one on the Integrations page to stream from this route."
					: "Where events travel when this route calls sse.connect, so a workflow or block on any node can send to the client. Without one, sse.connect fails."}
			</Description>
			<Select.Popover>
				<ListBox>
					<ListBox.Item id={NONE} textValue="None">
						None
						<ListBox.ItemIndicator />
					</ListBox.Item>
					{brokers.map((integration) => (
						<ListBox.Item key={integration.id} id={integration.id} textValue={integration.name}>
							{integration.name} ({integration.variant})
							<ListBox.ItemIndicator />
						</ListBox.Item>
					))}
				</ListBox>
			</Select.Popover>
		</Select>
	);
}
