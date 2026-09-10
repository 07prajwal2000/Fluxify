import { entitlement, type License } from "./index";

const EDITION: Record<License["kind"], string> = {
	community: "Community",
	non_commercial: "Enterprise (non-commercial)",
	signed: "Enterprise (license key)",
};

const day = (iso: string) => iso.slice(0, 10);

/**
 * A boxed summary of the running license, for the console. `ok` is false when
 * the key was rejected or the license no longer runs enterprise features —
 * the caller prints those in red.
 */
export function licenseBanner(
	license: License,
	rejected: string | null = null,
	now = Date.now(),
): { ok: boolean; text: string } {
	const e = entitlement(license, now);
	const rows: [string, string][] = [
		["Edition", EDITION[license.kind]],
		["Status", rejected ? "invalid key, running as community" : e.status],
	];
	if (rejected) rows.push(["Reason", rejected]);
	if (license.kind === "signed") {
		rows.push(["Licensee", license.licensee]);
		rows.push(["Expires", license.expiresAt ? day(license.expiresAt) : "never"]);
	}
	if (e.graceEndsAt) rows.push(["Grace ends", `${day(e.graceEndsAt)} (${e.daysRemaining} day(s) left)`]);
	rows.push(["Features", e.features.length === 0 ? "none" : e.features.includes("*") ? "* (all)" : e.features.join(", ")]);

	const lines = ["FLUXIFY LICENSE", "", ...rows.map(([k, v]) => `${k.padEnd(10)} : ${v}`)];
	const width = Math.max(...lines.map((l) => l.length));
	const text = [
		`╔${"═".repeat(width + 4)}╗`,
		...lines.map((l) => `║  ${l.padEnd(width)}  ║`),
		`╚${"═".repeat(width + 4)}╝`,
	].join("\n");
	return { ok: !rejected && (e.status !== "expired" || e.canRun), text };
}
