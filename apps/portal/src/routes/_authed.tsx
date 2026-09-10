import { useEffect } from "react";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { authClient } from "@/lib/auth";
import { useAuthStoreActions } from "@/store/auth";
import { createRouteHead } from "@/lib/seo";
import { publicSettingsQuery } from "@/query/publicSettingsQuery";

// Guard for every authenticated route. Bounces to /login (remembering where the
// user was) when there is no session; child routes render through <Outlet />.
export const Route = createFileRoute("/_authed")({
	head: createRouteHead("Portal", "Fluxify automation portal"),
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

	return (
		<>
			<LicenseBanner />
			<Outlet />
		</>
	);
}

/** Shown only once a license has expired, so nobody learns of it when connectors stop. */
function LicenseBanner() {
	const { data } = publicSettingsQuery.get.useQuery();
	const license = data?.license;
	if (license?.status !== "expired") return null;
	return (
		<div role="alert" className="border-b border-warning/40 bg-warning/10 px-4 py-2 text-sm text-foreground">
			{license.canRun
				? `Your Enterprise license has expired. Existing connectors keep running for ${license.daysRemaining} more day(s), but new ones cannot be created. Renew it to avoid interruption.`
				: "Your Enterprise license has expired and its grace period has ended. Connectors are stopped until it is renewed."}
		</div>
	);
}
