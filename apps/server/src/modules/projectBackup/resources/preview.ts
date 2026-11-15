import type { BackupHistory } from "../../versions/backup";
import type { BackupMode, PreviewCanvas } from "../types";

/** What the modules' `preview` hooks share (#1104). */

export const onOff = (on: boolean) => (on ? "On" : "Off");

/** a production switch as it will be restored: a template's are off */
export const production = (active: boolean, mode: BackupMode) =>
	mode === "template" ? "Off (templates restore switched off)" : onOff(active);

/** the working copy, as the read-only canvas draws it */
export const canvasOf = ({ working }: BackupHistory): PreviewCanvas => ({
	blocks: working.blocks.map(({ id, type, position, data }) => ({ id, type, position, data })),
	edges: working.edges,
});

/** versions kept, and which one production runs */
export const versionDetails = (history: BackupHistory) => ({
	Versions: history.versions.length,
	"Production version": history.prod === null ? "None" : `v${history.prod}`,
});

/** a list as one line, or "None" */
export const listOf = (items: string[]) => (items.length ? items.join(", ") : "None");
