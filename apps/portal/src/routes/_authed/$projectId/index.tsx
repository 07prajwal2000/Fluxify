import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/$projectId/")({
	beforeLoad: ({ params }) => {
		throw redirect({ to: "/$projectId/routes", params });
	},
});
