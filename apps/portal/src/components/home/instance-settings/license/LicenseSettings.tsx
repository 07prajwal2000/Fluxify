import type { ReactNode } from "react";
import { Chip, Spinner } from "@fluxify/components";
import { TbCheck, TbInfoCircle, TbMinus } from "react-icons/tb";
import { instanceSettingsQuery } from "@/query/instanceSettingsQuery";
import type { LicenseView } from "@/services/instanceSettings";
import { EditionForm } from "./EditionForm";

const EDITION_LABEL: Record<LicenseView["edition"], string> = {
	community: "Community",
	non_commercial: "Enterprise (non-commercial)",
	enterprise: "Enterprise (license key)",
};

type ChipColor = "default" | "success" | "warning" | "danger";

function statusChip(view: LicenseView): { label: string; color: ChipColor } {
	if (view.status === "invalid") return { label: "Invalid key", color: "danger" };
	if (view.status !== "expired") return { label: "Active", color: "success" };
	return view.daysRemaining
		? { label: `Expired · ${view.daysRemaining} day(s) of grace left`, color: "warning" }
		: { label: "Expired · grace period over", color: "danger" };
}

const FEATURE_ROWS: { label: string; feature?: string }[] = [
	{ label: "Routes, blocks and the visual editor" },
	{ label: "Workflows" },
	{ label: "Schedules (cron, intervals, one-shot)" },
	{ label: "Batching" },
	{ label: "The Trigger Workflow block" },
	{ label: "External connectors (Kafka)", feature: "connectors" },
];

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

export function LicenseSettings() {
	const { data: view, isLoading, isError } = instanceSettingsQuery.license.useQuery();

	if (isLoading) {
		return (
			<div className="flex justify-center py-16">
				<Spinner />
			</div>
		);
	}
	if (isError || !view) {
		return <p className="py-16 text-center text-muted-foreground">Couldn't load the license.</p>;
	}

	const chip = statusChip(view);
	const running = view.status !== "invalid" && (view.status !== "expired" || !!view.daysRemaining);
	const unlocks = (feature?: string) =>
		!feature || (running && (view.features.includes("*") || view.features.includes(feature)));

	return (
		<div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
			<div>
				<h2 className="text-xl font-bold tracking-tight">License</h2>
				<p className="mt-0.5 text-sm text-muted-foreground">
					Which edition this instance runs and what it unlocks. Changes reach every worker within
					seconds — no restart needed.
				</p>
			</div>

			<section className="flex flex-col gap-4 rounded-xl border border-border bg-background p-5">
				<div className="flex flex-wrap items-center justify-between gap-2">
					<div>
						<p className="text-[10px] font-bold uppercase tracking-widest text-muted">Current edition</p>
						<p className="text-base font-bold text-foreground">{EDITION_LABEL[view.edition]}</p>
					</div>
					<Chip size="sm" color={chip.color}>
						{chip.label}
					</Chip>
				</div>
				{view.invalidReason && (
					<p className="text-xs text-danger">
						The key was rejected ({view.invalidReason}), so this instance runs as Community.
					</p>
				)}
				<Details view={view} />
				{view.source === "env" && (
					<p className="flex items-start gap-2 rounded-lg bg-surface-secondary p-3 text-xs text-muted">
						<TbInfoCircle size={16} className="shrink-0" />
						Managed by the environment. The LICENSE_KEY variable on the admin container sets the
						license, so it can't be changed here. Remove it and restart to manage the license from
						this page.
					</p>
				)}
			</section>

			<section className="flex flex-col gap-2">
				<h3 className="text-sm font-semibold text-foreground">What this edition includes</h3>
				<ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
					{FEATURE_ROWS.map((row) => (
						<li key={row.label} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
							<span className="text-foreground">{row.label}</span>
							<FeatureState on={unlocks(row.feature)} off={row.feature && view.connectorsSwitchedOff} />
						</li>
					))}
				</ul>
			</section>

			{/* Remount on change so the selected card follows the saved edition. */}
			<EditionForm key={view.edition} view={view} />
		</div>
	);
}

function FeatureState({ on, off }: { on: boolean; off: boolean | string | undefined }) {
	if (!on) return <TbMinus size={16} className="text-muted" aria-label="Not included" />;
	if (off) return <span className="text-xs text-warning">Included · switched off on this instance</span>;
	return <TbCheck size={16} className="text-success" aria-label="Included" />;
}

function Details({ view }: { view: LicenseView }) {
	const rows: [string, ReactNode][] = [];
	if (view.licensee) rows.push(["Licensed to", view.licensee]);
	if (view.edition === "enterprise" && view.status !== "invalid")
		rows.push(["Expires", view.expiresAt ? date(view.expiresAt) : "Never"]);
	if (view.graceEndsAt) rows.push(["Grace period ends", date(view.graceEndsAt)]);
	if (view.fingerprint) rows.push(["Key fingerprint", <code className="font-mono">{view.fingerprint}</code>]);
	if (view.confirmedBy)
		rows.push([
			"Non-commercial use confirmed by",
			`${view.confirmedBy.name ?? view.confirmedBy.email} on ${date(view.confirmedAt)}`,
		]);
	if (rows.length === 0) return null;
	return (
		<dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-xs">
			{rows.map(([label, value]) => (
				<div key={label} className="contents">
					<dt className="text-muted">{label}</dt>
					<dd className="text-foreground">{value}</dd>
				</div>
			))}
		</dl>
	);
}
