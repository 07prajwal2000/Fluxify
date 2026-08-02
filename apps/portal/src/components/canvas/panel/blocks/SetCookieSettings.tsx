import { BlockSettings } from "../BlockSettings";
import {
	BlockCheckboxField,
	BlockJsTextField,
	BlockSelectField,
} from "../fields";
import type { BlockNode } from "../../types";

const SAME_SITE_OPTIONS = [
	{ value: "Lax", label: "Lax" },
	{ value: "Strict", label: "Strict" },
	{ value: "None", label: "None" },
];

/** General tab: Name and Value */
export function SetCookieGeneralSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="name"
				label="Name"
				placeholder="session_id"
				hint="Name of the cookie to set (supports js: expression)."
			/>
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="value"
				label="Value"
				placeholder="token-12345"
				hint="Value of the cookie (supports string, number, or js: expression)."
			/>
		</div>
	);
}

/** Scope tab: Domain, Path, Expiry */
export function SetCookieScopeSettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="domain"
				label="Domain"
				placeholder="example.com"
				hint="Domain where the cookie is valid (supports js: expression)."
			/>
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="path"
				label="Path"
				placeholder="/"
				hint="URL path where the cookie is accessible (supports js: expression)."
			/>
			<BlockJsTextField
				blockId={block.id}
				data={block.data}
				name="expiry"
				label="Expiry"
				placeholder="2026-12-31T23:59:59Z or js:libs.dayjs().add(7, 'day')"
				hint={
					<span>
						Expiration date in ISO format or js: expression. dayjs is built in and can be accessed with{" "}
						<code className="px-1.5 py-0.5 rounded bg-default-100 dark:bg-default-50/20 text-foreground border border-border/50 font-mono text-[11px] font-medium">
							libs.dayjs()
						</code>
						.
					</span>
				}
			/>
		</div>
	);
}

/** Security tab: SameSite, HttpOnly, Secure */
export function SetCookieSecuritySettings({ block }: { block: BlockNode }) {
	return (
		<div className="flex flex-col gap-4 w-full">
			<BlockSelectField
				blockId={block.id}
				data={block.data}
				name="samesite"
				label="SameSite"
				options={SAME_SITE_OPTIONS}
				placeholder="Select SameSite policy"
				hint="Controls whether the cookie is sent on cross-site requests."
			/>
			<BlockCheckboxField
				blockId={block.id}
				data={block.data}
				name="httpOnly"
				label="HttpOnly"
				description="Prevents client-side scripts from accessing the cookie."
			/>
			<BlockCheckboxField
				blockId={block.id}
				data={block.data}
				name="secure"
				label="Secure"
				description="Ensures the cookie is only transmitted over HTTPS connections."
			/>
		</div>
	);
}

export function setCookieSettings(block: BlockNode) {
	return [
		<BlockSettings.TabHead key="general" name="General">
			<SetCookieGeneralSettings block={block} />
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead key="scope" name="Scope">
			<SetCookieScopeSettings block={block} />
		</BlockSettings.TabHead>,
		<BlockSettings.TabHead key="security" name="Security">
			<SetCookieSecuritySettings block={block} />
		</BlockSettings.TabHead>,
	];
}
