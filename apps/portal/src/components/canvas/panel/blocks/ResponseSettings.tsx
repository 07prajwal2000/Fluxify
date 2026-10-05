// Deep import: the lib barrel pulls in pino/axios, which has no business in the
// browser bundle. The code list is plain data.

import { httpcodes } from "@/lib/httpcode";
import type { BlockNode } from "../../types";
import { BlockSettings } from "../BlockSettings";
import { BlockCheckboxField, BlockJsTextField } from "../fields";
import { JsRunnerSettings } from "./JsRunnerSettings";

// type `404` or `not found` to filter
const HTTP_CODE_SUGGESTIONS = httpcodes.map((code) => ({
	value: code.code,
	label: `${code.code} — ${code.name}`,
}));

/** Response block: the status code it replies with, plus an optional script shaping the body. */
export function responseSettings(block: BlockNode) {
	const tabs = [
		<BlockSettings.TabHead key="general" name="General">
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="httpCode"
				label="Status code"
				placeholder="200"
				hint="Sent with whatever the previous block produced as the body. Pick a code, or use JS to compute it at run time."
				suggestions={HTTP_CODE_SUGGESTIONS}
				info={{
					content:
						"A JS expression must return a known HTTP code, as a number or a string. Any other value fails the block.",
					example: "return input.created ? 201 : 200;",
				}}
			/>
			<BlockCheckboxField
				blockId={block.id}
				data={block.data}
				name="transformEnabled"
				label="Transform response"
				hint="Run a script on the body before it is sent."
			/>
		</BlockSettings.TabHead>,
	];

	if (block.data.transformEnabled) {
		tabs.push(
			<BlockSettings.TabHead key="transform" name="Transform">
				<JsRunnerSettings
					block={block}
					field="transformScript"
					label="Transform script (body is `input`, return the new body)"
				/>
			</BlockSettings.TabHead>,
		);
	}

	return tabs;
}
