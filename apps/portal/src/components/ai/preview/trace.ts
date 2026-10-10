export type TraceRow =
	| { kind: "block"; key: string; type: string; ok: boolean; ms: number; detail: string }
	| { kind: "more"; text: string };

const LINE = /^(\S+) \(([^)]*)\) (ok|ERROR) (\d+)ms(.*)$/s;

/** One line of call_route's trace, e.g. `response_1 (response) ok 12ms → {"id":1}`; anything else shows as text. */
export function parseTrace(line: string): TraceRow {
	const m = LINE.exec(line);
	if (!m) return { kind: "more", text: line };
	return {
		kind: "block",
		key: m[1],
		type: m[2],
		ok: m[3] === "ok",
		ms: Number(m[4]),
		detail: m[5].replace(/^( → |: )/, ""),
	};
}
