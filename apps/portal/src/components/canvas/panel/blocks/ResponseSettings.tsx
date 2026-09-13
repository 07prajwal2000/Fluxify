// Deep import: the lib barrel pulls in pino/axios, which has no business in the
// browser bundle. The code list is plain data.
import { BlockSettings } from "../BlockSettings";
import { BlockCheckboxField, BlockSelectField } from "../fields";
import type { BlockNode } from "../../types";
import { httpcodes } from "@/lib/httpcode";
import { JsRunnerSettings } from "./JsRunnerSettings";

const HTTP_CODE_OPTIONS = httpcodes.map((code) => ({
	value: code.code,
	label: `${code.code} — ${code.name}`,
}));

/** Response block: the status code it replies with, plus an optional script shaping the body. */
export function responseSettings(block: BlockNode) {
	const tabs = [
		<BlockSettings.TabHead key="general" name="General">
			<BlockSelectField
				blockId={block.id}
				data={block.data}
				name="httpCode"
				label="Status code"
				placeholder="Select HTTP code"
				hint="Sent with whatever the previous block produced as the body."
				options={HTTP_CODE_OPTIONS}
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
