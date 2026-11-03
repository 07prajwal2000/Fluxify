import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";

// DOM only for this file; RTL reads `document` on import, so load it after.
try {
	GlobalRegistrator.register();
} catch {}

// not `screen`: it stays bound to the document of whichever test file loaded RTL first
const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const { TriggerReview } = await import("./TriggerReview");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

function setup(switches: { active: boolean; devActive: boolean }, disabledReason?: string) {
	const onSwitchesChange = mock();
	render(
		<TriggerReview
			sections={[]}
			switches={switches}
			onSwitchesChange={onSwitchesChange}
			isEdit
			isConnector={false}
			disabledReason={disabledReason}
			error={null}
		/>,
	);
	return onSwitchesChange;
}

const box = (label: string) =>
	within(document.body).getByRole("checkbox", { name: new RegExp(label) }) as HTMLInputElement;

// #1072: each environment has its own switch, and changing one leaves the other
test("turning development off keeps production as it was", () => {
	const onSwitchesChange = setup({ active: true, devActive: true });
	expect(box("On in production").checked).toBe(true);
	fireEvent.click(box("On in development"));
	expect(onSwitchesChange).toHaveBeenCalledWith({ active: true, devActive: false });
});

test("turning production on keeps development as it was", () => {
	const onSwitchesChange = setup({ active: false, devActive: true });
	fireEvent.click(box("On in production"));
	expect(onSwitchesChange).toHaveBeenCalledWith({ active: true, devActive: true });
});

test("the reason Fluxify turned it off shows only while both switches are off", () => {
	setup({ active: false, devActive: false }, "its integration was deleted");
	expect(document.body.textContent).toContain("its integration was deleted");
	cleanup();
	setup({ active: false, devActive: true }, "its integration was deleted");
	expect(document.body.textContent).not.toContain("its integration was deleted");
});
