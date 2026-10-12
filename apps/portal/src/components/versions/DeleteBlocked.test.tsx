import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { ReactNode } from "react";

// DOM only for this file; RTL reads `document` on import, so load it after.
GlobalRegistrator.register();

// the rows link to the resources they name
const router = await import("@tanstack/react-router");
mock.module("@tanstack/react-router", () => ({
	...router,
	Link: ({ children, ...rest }: { children: ReactNode }) => <a {...rest}>{children}</a>,
}));

const { cleanup, render } = await import("@testing-library/react");
const { referencesFromDeleteError } = await import("@/services/references");
const { DeleteBlocked } = await import("./DeleteBlocked");

afterEach(cleanup);
afterAll(() => GlobalRegistrator.unregister());

test("the refused delete shows the message and the same rows as Used by", () => {
	const view = render(
		<DeleteBlocked
			message="This custom block is still used by GET /orders."
			references={
				[
					{
						kind: "route",
						id: "r1",
						name: "GET /orders",
						inProduction: true,
						inWorkingCopy: false,
					},
				] as never
			}
			projectId="p1"
		/>,
	);
	expect(view.getByText("This custom block is still used by GET /orders.")).toBeTruthy();
	const list = view.getByLabelText("Used by");
	expect(list.textContent).toContain("GET /orders");
	expect(list.textContent).toContain("In production");
});

test("referencesFromDeleteError reads the 409 body and ignores other failures", () => {
	const conflict = referencesFromDeleteError({
		response: {
			data: {
				type: "conflict",
				message: "Still used",
				references: [
					{
						kind: "route",
						id: "r1",
						name: "GET /orders",
						inProduction: true,
						inWorkingCopy: false,
					},
				],
			},
		},
	});
	expect(conflict?.message).toBe("Still used");
	expect(conflict?.references.length).toBe(1);
	expect(referencesFromDeleteError(new Error("boom"))).toBeUndefined();
	expect(referencesFromDeleteError({ response: { data: { message: "no list" } } })).toBeUndefined();
});
