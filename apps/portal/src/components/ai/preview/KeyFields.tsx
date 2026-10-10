import type { RefType } from "../agentRefs";
import { type Data, isSecretKey, MASK, mask, oneLine, str } from "./data";
import { META, secretFields } from "./resourceMeta";

/** The fields worth a glance for a resource, as `label  value` rows; secrets hidden. */
export function KeyFields({ type, data }: { type: RefType; data: Data }) {
	const hidden = secretFields(type, data);
	const rows = META[type].fields.filter((f) => data[f] !== undefined && data[f] !== "");
	if (!rows.length) return null;
	return (
		<dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
			{rows.map((f) => (
				<div key={f} className="contents">
					<dt className="text-muted">{f}</dt>
					<dd className="min-w-0 truncate font-mono text-foreground">
						{hidden.has(f) || isSecretKey(f)
							? MASK
							: oneLine(mask(data[f], f) ?? str(data[f]), 120)}
					</dd>
				</div>
			))}
		</dl>
	);
}
