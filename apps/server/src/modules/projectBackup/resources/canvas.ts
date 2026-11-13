import { CUSTOM_BLOCK_NAME_PREFIX } from "@fluxify/lib";
import { BadRequestError } from "../../../errors/badRequestError";
import type { SuiteRefs } from "../../routeTransfer/suites";
import type { BackupHistory } from "../../versions/backup";
import type { IdMap } from "../types";

/**
 * What the canvas modules (routes #1097, workflows #1098) share on restore.
 * `owner` names the resource in a refusal, e.g. `Route "orders"`.
 */

/**
 * What runs now and in production must call only custom blocks the backup
 * restores. An older version is copied as it is: it only runs again if someone
 * checks it out, and the canvas save checks it then.
 */
export function assertCustomBlocks(ids: IdMap, owner: string, history: BackupHistory) {
	const prod = history.versions.find((v) => v.number === history.prod)?.snapshot;
	for (const snapshot of [history.working, ...(prod ? [prod] : [])]) {
		for (const { type } of snapshot.blocks) {
			if (type.startsWith(CUSTOM_BLOCK_NAME_PREFIX) && !ids.get("customBlocks", type))
				throw new BadRequestError(
					`${owner} calls the custom block "${type}", which isn't in this backup.`,
				);
		}
	}
}

/**
 * Suite references in a backup: setup, teardown and loader blocks by name, and
 * refused when missing; hooks on the restored working copy's (fresh) block ids.
 */
export function suiteRefs(ids: IdMap, owner: string, history: BackupHistory): SuiteRefs {
	const canvas = new Set(history.working.blocks.map((b) => b.id));
	return {
		block(name, role, suite) {
			const id = ids.get("customBlocks", name);
			if (!id)
				throw new BadRequestError(
					`${owner}, test "${suite}": the ${role} block "${name}" isn't in this backup.`,
				);
			return id;
		},
		// ids, until #1100
		integration: (o) => ({ existingId: o.existing, newId: o.replacement }),
		canvasBlock: (id) => (canvas.has(id) ? id : undefined),
		warn: () => {},
	};
}
