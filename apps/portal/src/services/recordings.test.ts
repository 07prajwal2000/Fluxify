import { afterEach, expect, spyOn, test } from "bun:test";
import { httpClient } from "@/lib/http";
import { recordingsService } from "./recordings";

afterEach(() => {
	(httpClient.get as { mockRestore?: () => void }).mockRestore?.();
});

test("the env filter goes out as ?env, and no filter leaves it off", async () => {
	const get = spyOn(httpClient, "get").mockResolvedValue({ data: { data: [] } });
	const target = { type: "route", id: "r1" } as const;
	await recordingsService.getRuns("p1", target, { env: "development" });
	await recordingsService.getRuns("p1", target, {});
	const [filtered, all] = get.mock.calls.map((call) => String(call[0]));
	expect(new URL(filtered ?? "", "http://x").searchParams.get("env")).toBe("development");
	expect(new URL(all ?? "", "http://x").searchParams.has("env")).toBe(false);
});
