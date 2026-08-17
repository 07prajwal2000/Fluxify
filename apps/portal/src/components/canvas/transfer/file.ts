import {
	decodeTransfer,
	TRANSFER_FILE_EXTENSION,
	TRANSFER_MIME,
	type CanvasTransferDoc,
} from "./format";

/** `fluxify-canvas-3-blocks-2026-08-17.fluxcanvas` */
export function transferFilename(blockCount: number): string {
	const day = new Date().toISOString().slice(0, 10);
	return `fluxify-canvas-${blockCount}-blocks-${day}${TRANSFER_FILE_EXTENSION}`;
}

/** Hands the encoded payload to the browser as a download. */
export function downloadTransfer(encoded: string, filename: string): void {
	const url = URL.createObjectURL(new Blob([encoded], { type: TRANSFER_MIME }));
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	// Revoking synchronously can beat the download in some browsers.
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Opens the system file picker. Resolves `null` when the user cancels. */
export function pickTransferFile(): Promise<File | null> {
	return new Promise((resolve) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = `${TRANSFER_FILE_EXTENSION},${TRANSFER_MIME},application/json,text/plain`;
		input.addEventListener("change", () => resolve(input.files?.[0] ?? null));
		input.addEventListener("cancel", () => resolve(null));
		input.click();
	});
}

/** Reads and validates an exported file. Throws `CanvasTransferError`. */
export async function readTransferFile(file: File): Promise<CanvasTransferDoc> {
	return decodeTransfer(await file.text());
}
