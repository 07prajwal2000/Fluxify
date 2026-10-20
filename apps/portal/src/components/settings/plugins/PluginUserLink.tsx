import { Link } from "@tanstack/react-router";
import { KindIcon, referenceLink } from "@/components/versions/ReferenceList";
import type { Reference } from "@/services/references";

export type PluginUser = Pick<Reference, "kind" | "id" | "name">;

/** A route, workflow or custom block that uses the plugin, linked to its canvas. */
export function PluginUserLink({ user, projectId }: { user: PluginUser; projectId: string }) {
	const link = referenceLink(user as Reference, projectId);
	return (
		<span className="inline-flex items-center gap-1.5">
			<KindIcon kind={user.kind} />
			<Link
				to={link.to as never}
				params={link.params as never}
				className="font-medium text-accent hover:underline"
			>
				{user.name}
			</Link>
		</span>
	);
}

export function PluginUserLinks({ users, projectId }: { users: PluginUser[]; projectId: string }) {
	if (!users.length) return null;
	return (
		<span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
			{users.map((u) => (
				<PluginUserLink key={`${u.kind}-${u.id}`} user={u} projectId={projectId} />
			))}
		</span>
	);
}
