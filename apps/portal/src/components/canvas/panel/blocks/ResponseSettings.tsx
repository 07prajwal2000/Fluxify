// Deep import: the lib barrel pulls in pino/axios, which has no business in the
// browser bundle. The code list is plain data.
import { BlockSettings } from "../BlockSettings";
import { BlockSelectField } from "../fields";
import type { BlockNode } from "../../types";
import { httpcodes } from "@/lib/httpcode";

const HTTP_CODE_OPTIONS = httpcodes.map((code) => ({
	value: code.code,
	label: `${code.code} — ${code.name}`,
}));

/** Response block: the status code it replies with. Body is whatever flows in. */
export function responseSettings(block: BlockNode) {
	return (
		<BlockSettings.TabHead name="General">
			<BlockSelectField
				blockId={block.id}
				data={block.data}
				name="httpCode"
				label="Status code"
				placeholder="Select HTTP code"
				hint="Sent with whatever the previous block produced as the body."
				options={HTTP_CODE_OPTIONS}
			/>
		</BlockSettings.TabHead>
	);
}
