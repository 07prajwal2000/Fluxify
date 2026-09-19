import { cn } from "@fluxify/components";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { useEffect } from "react";
import { authClient } from "@/lib/auth";
import { createRouteHead } from "@/lib/seo";
import { publicSettingsQuery } from "@/query/publicSettingsQuery";
import { useAuthStoreActions } from "@/store/auth";

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

/**
 * Shown only once a license has expired, so nobody learns of it when enterprise
 * features stop. Never dismissible, in either state (#390).
 *
 * It hangs above the viewport with only a tab visible and slides down on
 * hover, which is what keeps it from being in the way. In the flow it pushed
 * down a shell that is `h-screen w-screen`, so every page overflowed by the
 * height of the banner; parked out of flow and mostly off-screen, it obscures
 * nothing until someone reaches for it. Centred and narrow, it also clears the
 * sidebar and the home header — both `z-50` — horizontally as well as in the
 * stacking order.
 *
 * Non-dismissible either way (#390): reaching for it is not the same as
 * closing it, and it comes back the moment the pointer leaves.
 *
 * The wrapper is click-through so it never steals a press from the header
 * underneath it; only the tab itself takes pointer events. `tabIndex` so it
 * can be opened from the keyboard — `role="alert"` already reads out to a
 * screen reader whatever the transform is doing.
 */
function LicenseBanner() {
	const { data } = publicSettingsQuery.get.useQuery();
	const license = data?.license;
	if (license?.status !== "expired") return null;
	const inGrace = license.canRun;
	return (
		<div className="pointer-events-none fixed inset-x-0 top-0 z-[10000] flex justify-center">
			<p
				role="alert"
				// biome-ignore lint/a11y/noNoninteractiveTabindex: the banner is parked off-screen and must be reachable by keyboard to slide into view
				tabIndex={0}
				className={cn(
					// Parked above the viewport with only a tab showing, so it covers
					// nothing until it is asked for. The strip is the hover target;
					// once it slides down the cursor is on the pill, which holds it open.
					"pointer-events-auto max-w-[min(92vw,44rem)] -translate-y-[calc(100%-0.6rem)]",
					"rounded-b-xl border border-t-0 px-4 pt-1.5 pb-2.5 text-center text-xs font-medium shadow-lg",
					"transition-transform duration-300 ease-out",
					"hover:translate-y-0 focus-visible:translate-y-0 focus-visible:outline-none",
					// Opaque surface, not a tint: at 20% the page showed straight
					// through the message. The colour lives in the border and text.
					"bg-surface",
					inGrace ? "border-warning/60 text-warning" : "border-danger/60 text-danger",
				)}
			>
				{inGrace
					? `Enterprise license expired — ${license.daysRemaining} day(s) of grace left. Existing features keep running, but new ones cannot be created.`
					: "Enterprise license expired and the grace period has ended. Enterprise features stay off until it is renewed."}
			</p>
		</div>
	);
}
