import { afterAll, beforeEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file, for document.visibilityState
GlobalRegistrator.register();
afterAll(() => GlobalRegistrator.unregister());

const { pollCanvasRevision } = await import("./useCanvasPoll");

let visibility = "visible";
beforeEach(() => {
	visibility = "visible";
	Object.defineProperty(document, "visibilityState", {
		configurable: true,
		get: () => visibility,
	});
});

function state(over: { isDirty?: boolean; isSaving?: boolean; remote?: number } = {}) {
	return {
		revision: 3,
		isDirty: over.isDirty ?? false,
		isSaving: over.isSaving ?? false,
		getRevision: mock(async () => over.remote ?? 4),
		reload: mock(() => {}),
	};
}

test("newer revision and no unsaved edits reloads quietly", async () => {
	const s = state();
	expect(await pollCanvasRevision(() => s)).toBeUndefined();
	expect(s.reload).toHaveBeenCalledTimes(1);
});

test("newer revision with unsaved edits asks instead of reloading", async () => {
	const s = state({ isDirty: true });
	expect(await pollCanvasRevision(() => s)).toBe("stale");
	expect(s.reload).not.toHaveBeenCalled();
});

test("same revision does nothing", async () => {
	const s = state({ remote: 3 });
	expect(await pollCanvasRevision(() => s)).toBeUndefined();
	expect(s.reload).not.toHaveBeenCalled();
});

test("skips the poll while a save is in progress", async () => {
	const s = state({ isSaving: true });
	await pollCanvasRevision(() => s);
	expect(s.getRevision).not.toHaveBeenCalled();
	expect(s.reload).not.toHaveBeenCalled();
});

test("a hidden tab does not poll", async () => {
	visibility = "hidden";
	const s = state();
	await pollCanvasRevision(() => s);
	expect(s.getRevision).not.toHaveBeenCalled();
});

test("a save started mid-request wins over the reload", async () => {
	const s = state();
	let saving = false;
	s.getRevision.mockImplementation(async () => {
		saving = true;
		return 4;
	});
	await pollCanvasRevision(() => ({ ...s, isSaving: saving }));
	expect(s.reload).not.toHaveBeenCalled();
});
