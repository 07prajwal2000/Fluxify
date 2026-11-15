import type { BundleOf, ResourceType } from "@/services/transfer";
import { TRANSFER_RESOURCES } from "./resources";

export const FILE_EXTENSIONS = { route: ".fluxroute", workflow: ".fluxworkflow" } as const;
const FILE_MIME = "application/json";

/** `fluxify-route-list-users-2026-10-29.fluxroute` */
export function bundleFilename(type: ResourceType, name: string): string {
	const slug =
		name
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-|-$/g, "") || type;
	return `fluxify-${type}-${slug}-${new Date().toISOString().slice(0, 10)}${FILE_EXTENSIONS[type]}`;
}

/** Hands the bundle to the browser as a download. */
export function downloadBundle(bundle: unknown, filename: string): void {
	const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: FILE_MIME }));
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	// Revoking synchronously can beat the download in some browsers.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Opens the file picker. Resolves `null` when the user cancels. */
export function pickBundleFile(type: ResourceType): Promise<File | null> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = `${FILE_EXTENSIONS[type]},${FILE_MIME}`;
		input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
		input.addEventListener("cancel", () => resolve(null));
		input.click();
	});
}

/** Reads a picked file. The server checks the contents in full; this only refuses what the confirmation could not show. */
export async function readBundleFile<T extends ResourceType>(
	file: File,
	type: T,
): Promise<BundleOf<T>> {
	let raw: unknown;
	try {
		raw = JSON.parse(await file.text());
	} catch {}
	const resource = TRANSFER_RESOURCES[type];
	if (!resource.isBundle(raw)) {
		throw new Error(`That file isn't a Fluxify ${resource.label} export.`);
	}
	return raw as BundleOf<T>;
}
