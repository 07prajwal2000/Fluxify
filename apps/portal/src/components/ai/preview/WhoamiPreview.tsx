import { TbUser } from "react-icons/tb";
import type { ToolPart } from "../agentMessages";
import { rec, str } from "./data";

/** Previews whoami: current authenticated user, system admin status, and project roles. */
export function WhoamiPreview({ tool }: { tool: ToolPart }) {
	const out = rec(tool.output);
	const email = str(out.email);
	const id = str(out.id);
	const isAdmin = out.isSystemAdmin === true;
	const acl = Array.isArray(out.acl) ? (out.acl as { projectId: string; role: string }[]) : [];

	return (
		<div className="flex flex-col gap-2 text-xs">
			<header className="flex items-center gap-2 text-sm">
				<TbUser size={16} className="shrink-0 text-muted" />
				<span className="font-medium text-foreground">{email || id}</span>
				{isAdmin && (
					<span className="rounded-full border border-warning/50 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
						Admin
					</span>
				)}
			</header>
			{id && email && (
				<p className="text-muted">
					User ID: <span className="font-mono text-foreground">{id}</span>
				</p>
			)}
			{acl.length > 0 && (
				<section aria-label="Project roles" className="flex flex-col gap-1">
					<h4 className="font-medium text-muted">Project roles ({acl.length})</h4>
					<div className="overflow-x-auto rounded-md border border-border">
						<table className="w-full text-left text-xs">
							<thead className="bg-surface-secondary text-muted">
								<tr>
									<th className="px-2 py-1 font-medium">Project</th>
									<th className="px-2 py-1 font-medium">Role</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border">
								{acl.map((a, i) => (
									<tr key={i}>
										<td className="truncate px-2 py-1 font-mono text-foreground/80">
											{a.projectId}
										</td>
										<td className="px-2 py-1 capitalize text-muted">{a.role}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			)}
		</div>
	);
}
