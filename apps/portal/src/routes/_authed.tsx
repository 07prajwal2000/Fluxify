import { useEffect } from "react";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";
import { useAuthStoreActions } from "@/store/auth";

// Guard for every authenticated route. Bounces to /login (remembering where the
// user was) when there is no session; child routes render through <Outlet />.
export const Route = createFileRoute("/_authed")({
	beforeLoad: async ({ location }) => {
		const session = await authClient.getSession();
		if (!session.data?.user) {
			throw redirect({ to: "/login", search: { next: location.pathname } });
		}
	},
	component: AuthedLayout,
});

function AuthedLayout() {
	const { data: session } = authClient.useSession();
	const actions = useAuthStoreActions();

	useEffect(() => {
		if (!session) return;
		actions.setUserData({
			id: session.user.id || "",
			name: session.user.name || "",
			email: session.user.email || "",
			image: session.user.image || "",
			isSystemAdmin: (session.user as { isSystemAdmin?: boolean }).isSystemAdmin,
		});
		actions.setACL((session as { acl?: [] }).acl ?? []);
	}, [session, actions]);

	return <Outlet />;
}
