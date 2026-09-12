import { Chip } from "@fluxify/components";
import { TbCloudOff, TbServer } from "react-icons/tb";
import type { OrchestrationStatus } from "@/services/orchestration";
import { ago, metaLabel, providerWords } from "./copy";

/**
 * What is actually running the infrastructure, and where.
 *
 * Shown on both surfaces because it changes how everything else on the page
 * should be read: on Kubernetes a node is a pod the scheduler places, on Docker
 * it is a container on one host. The facts under it are whatever the
 * orchestrator published about itself — an endpoint and an image here, a
 * cluster and a namespace there — rendered as they arrive so a new provider
 * needs no change in this component.
 *
 * Nothing reconciling at all is the important case: claims are still recorded,
 * but nothing will act on them, and a page that only showed pending nodes would
 * look like a capacity problem instead of a stopped process.
 */
export function InfraPanel({ status }: { status: OrchestrationStatus }) {
	const { orchestrator, pool } = status;
	const words = providerWords(orchestrator.provider);
	const meta = Object.entries(orchestrator.meta);

	return (
		<section className="flex flex-col gap-4 rounded-xl border border-border bg-background p-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex items-center gap-3">
					{orchestrator.alive ? (
						<TbServer className="h-5 w-5 text-accent" />
					) : (
						<TbCloudOff className="h-5 w-5 text-danger" />
					)}
					<div>
						<p className="text-[10px] font-bold uppercase tracking-widest text-muted">
							Infrastructure
						</p>
						<p className="text-base font-bold text-foreground">
							{orchestrator.alive ? words.label : "No orchestrator running"}
						</p>
					</div>
				</div>
				<Chip size="sm" color={orchestrator.alive ? "success" : "danger"}>
					{orchestrator.alive ? `Reconciling · renewed ${ago(orchestrator.at)}` : "Nothing is acting"}
				</Chip>
			</div>

			{!orchestrator.alive && (
				<p className="text-xs text-danger">
					Claims are still recorded, and nothing will start or stop until an orchestrator takes
					over. Nodes below stay as they are.
				</p>
			)}

			<dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
				<Fact label="Nodes running" value={`${pool.placed} of ${pool.ceiling} allowed`} />
				<Fact
					label="Nodes asked for"
					value={
						pool.requested > pool.placed
							? `${pool.requested} — ${pool.requested - pool.placed} waiting`
							: String(pool.requested)
					}
				/>
				<Fact
					label="Licence allows"
					value={
						status.entitlement.maxReplicas === null
							? "Unlimited nodes"
							: `${status.entitlement.maxReplicas} node(s)`
					}
				/>
				{orchestrator.reconcileIntervalMs && (
					<Fact label="Checks every" value={`${Math.round(orchestrator.reconcileIntervalMs / 1000)}s`} />
				)}
				{orchestrator.holder && <Fact label="Acting process" value={orchestrator.holder} mono />}
				{meta.map(([key, value]) => (
					<Fact key={key} label={metaLabel(key)} value={String(value)} mono />
				))}
			</dl>
		</section>
	);
}

function Fact({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
	return (
		<div className="min-w-0">
			<dt className="text-[10px] font-bold uppercase tracking-widest text-muted">{label}</dt>
			<dd
				className={`truncate text-sm text-foreground ${mono ? "font-mono text-xs" : ""}`}
				title={value}
			>
				{value}
			</dd>
		</div>
	);
}
