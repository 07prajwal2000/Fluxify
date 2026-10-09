import { useState } from "react";
import type { ToolRequest } from "./agentApproval";
import { ToolBody } from "./preview/ToolBody";

/** What one waiting call would do, folded under its row; it loads only once opened. */
export function RowPreview({ call }: { call: ToolRequest }) {
	const [open, setOpen] = useState(false);
	return (
		<details className="group text-xs" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
			<summary className="cursor-pointer list-none text-muted hover:text-foreground">
				<span className="mr-1 inline-block transition-transform group-open:rotate-90">›</span>
				Details
				<span className="sr-only"> of {call.title}</span>
			</summary>
			{open && (
				<div className="mt-2">
					<ToolBody
						asking
						tool={{ type: "tool", id: call.id ?? "", name: call.name, input: call.input }}
					/>
				</div>
			)}
		</details>
	);
}
