import type { FluxifyManifest, ManifestEntry } from "@fluxify/sdk/blocks";
import { diffIntegrations, type IntegrationDiff, integrationBlockers } from "./integrationDiff";
import type { IntegrationUser } from "./integrationUsage";
import { requestedPermissions } from "./meta";
import { rangeChange } from "./paramRange";
import { diffTriggers, type TriggerDiff, triggerBlockers } from "./triggerDiff";
import type { TriggerUser } from "./triggerUsage";
import type { PluginUser } from "./usage";
import { type IntegrationKinds, variantsChange } from "./variantDiff";

/**
 * What an upgrade changes for this project (#860), as data for the upgrade
 * dialog (U1) and the approval guard. Pure: the caller brings the usage.
 *
 * Blocking is anything removed that a node uses: a block, a param it sets, a
 * handle it is wired to, or the invoke mode it calls with; and an integration
 * variant changed in a way the project's integrations of it may not survive
 * (I6). Everything else is listed for the creator to read, deprecations included.
 */

/** who uses a removed or deprecated thing; empty when nothing does */
export type UsedBy = { kind: PluginUser["kind"]; id: string; name: string }[];

export type ManifestDiff = IntegrationDiff &
	TriggerDiff & {
		addedBlocks: string[];
		removedBlocks: { block: string; usedBy: UsedBy }[];
		removedParams: { block: string; param: string; usedBy: UsedBy }[];
		removedHandles: { block: string; handle: string; usedBy: UsedBy }[];
		changedInvoke: { block: string; removed: string[]; added: string[]; usedBy: UsedBy }[];
		/** an integration param's `variants` changed; it breaks the nodes set to a variant it dropped */
		changedVariants: { block: string; param: string; change: string; usedBy: UsedBy }[];
		/** a number param's bounds changed; it breaks the nodes whose saved value no longer fits */
		changedRanges: { block: string; param: string; change: string; usedBy: UsedBy }[];
		changedHandlesOrShape: {
			block: string;
			before: Pick<ManifestEntry, "handles" | "shape">;
			after: Pick<ManifestEntry, "handles" | "shape">;
		}[];
		/** what the new version asks for that the old did not */
		addedPermissions: { integrations: string[]; appconfig: boolean };
		deprecations: {
			block: string;
			param?: string;
			handle?: string;
			message: string;
			inUse: boolean;
		}[];
		blocking: boolean;
		/** one line per blocking change, for the 409 */
		blockers: string[];
	};

type Entry = ManifestEntry;
const handlesOf = (e: Entry) => [
	...e.handles.in,
	...e.handles.out,
	...e.handles.body.map((b) => b.name),
];

export function diffManifests(
	old: FluxifyManifest,
	next: FluxifyManifest,
	usage: PluginUser[],
	/** the project's integrations of the old version's kinds */
	integrationUsers: IntegrationUser[] = [],
	/** the project's triggers of the plugin's kinds (T2) */
	triggerUsers: TriggerUser[] = [],
	/** the project's integrations, for the variant a stored param value points at */
	kinds: IntegrationKinds = new Map(),
): ManifestDiff {
	const usedBy = (block: string, uses: (n: PluginUser["nodes"][number]) => boolean): UsedBy =>
		usage
			.filter((u) => u.nodes.some((n) => n.type === block && uses(n)))
			.map(({ kind, id, name }) => ({ kind, id, name }));

	const diff: ManifestDiff = {
		addedBlocks: Object.keys(next.blocks).filter((b) => !old.blocks[b]),
		removedBlocks: [],
		removedParams: [],
		removedHandles: [],
		changedInvoke: [],
		changedVariants: [],
		changedRanges: [],
		changedHandlesOrShape: [],
		addedPermissions: { integrations: [], appconfig: false },
		deprecations: [],
		blocking: false,
		blockers: [],
		...diffIntegrations(old, next, integrationUsers),
		...diffTriggers(old, next, triggerUsers, kinds),
	};

	for (const [block, before] of Object.entries(old.blocks) as [string, Entry][]) {
		const after = next.blocks[block] as Entry | undefined;
		if (!after) {
			diff.removedBlocks.push({ block, usedBy: usedBy(block, () => true) });
			continue;
		}
		for (const [param, p] of Object.entries(before.params)) {
			// a hint holds no value, so removing one breaks nothing
			if (!after.params[param] && p.type !== "hint")
				diff.removedParams.push({
					block,
					param,
					usedBy: usedBy(block, (n) => n.params.includes(param)),
				});
			const variants = variantsChange(param, p, after.params[param]);
			if (variants)
				diff.changedVariants.push({
					block,
					param,
					change: variants.change,
					usedBy: usedBy(block, (n) => variants.drops(n.values?.[param], kinds)),
				});
			const range = rangeChange(param, p, after.params[param]);
			if (range)
				diff.changedRanges.push({
					block,
					param,
					change: range.change,
					usedBy: usedBy(block, (n) => range.drops(n.values?.[param])),
				});
		}
		const kept = handlesOf(after);
		for (const handle of handlesOf(before))
			if (!kept.includes(handle))
				diff.removedHandles.push({
					block,
					handle,
					usedBy: usedBy(block, (n) => n.handles.includes(handle)),
				});
		const removed = before.invoke.filter((m) => !after.invoke.includes(m));
		const added = after.invoke.filter((m) => !before.invoke.includes(m));
		if (removed.length || added.length)
			diff.changedInvoke.push({
				block,
				removed,
				added,
				usedBy: usedBy(block, (n) => removed.includes(n.invoke as never)),
			});
		const shape = (e: Entry) => ({ handles: e.handles, shape: e.shape });
		if (JSON.stringify(shape(before)) !== JSON.stringify(shape(after)))
			diff.changedHandlesOrShape.push({ block, before: shape(before), after: shape(after) });
	}

	const had = requestedPermissions(old);
	const asks = requestedPermissions(next);
	diff.addedPermissions = {
		integrations: asks.integrations.filter((i) => !had.integrations.includes(i)),
		appconfig: asks.appconfig && !had.appconfig,
	};

	for (const [block, entry] of Object.entries(next.blocks) as [string, Entry][]) {
		const inUse = (uses: (n: PluginUser["nodes"][number]) => boolean) =>
			usedBy(block, uses).length > 0;
		if (entry.deprecated)
			diff.deprecations.push({ block, message: entry.deprecated, inUse: inUse(() => true) });
		for (const [param, p] of Object.entries(entry.params))
			if (p.type !== "hint" && p.deprecated)
				diff.deprecations.push({
					block,
					param,
					message: p.deprecated,
					inUse: inUse((n) => n.params.includes(param)),
				});
		for (const [handle, message] of Object.entries(entry.handles.deprecated ?? {}))
			diff.deprecations.push({
				block,
				handle,
				message,
				inUse: inUse((n) => n.handles.includes(handle)),
			});
	}

	const names = (u: UsedBy) => u.map((r) => `${r.kind.replace("_", " ")} "${r.name}"`).join(", ");
	for (const r of diff.removedBlocks)
		if (r.usedBy.length)
			diff.blockers.push(`block ${r.block} is removed but used by ${names(r.usedBy)}`);
	for (const r of diff.removedParams)
		if (r.usedBy.length)
			diff.blockers.push(`param ${r.param} of ${r.block} is removed but set by ${names(r.usedBy)}`);
	for (const r of diff.removedHandles)
		if (r.usedBy.length)
			diff.blockers.push(
				`handle ${r.handle} of ${r.block} is removed but wired in ${names(r.usedBy)}`,
			);
	for (const r of diff.changedInvoke)
		if (r.usedBy.length)
			diff.blockers.push(
				`invoke mode ${r.removed.join("/")} of ${r.block} is removed but used by ${names(r.usedBy)}`,
			);
	for (const r of diff.changedVariants)
		if (r.usedBy.length)
			diff.blockers.push(
				`block ${r.block}: ${r.change}, but ${names(r.usedBy)} set it to another variant`,
			);
	for (const r of diff.changedRanges)
		if (r.usedBy.length)
			diff.blockers.push(
				`block ${r.block}: ${r.change}, but ${names(r.usedBy)} set it outside the range`,
			);
	diff.blockers.push(...integrationBlockers(diff), ...triggerBlockers(diff));
	diff.blocking = diff.blockers.length > 0;
	return diff;
}
