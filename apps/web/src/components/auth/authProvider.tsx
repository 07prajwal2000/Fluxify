"use client";
import { authClient } from "@/lib/auth";
import { useAuthStoreActions } from "@/store/auth";
import { redirect } from "next/navigation";
import { createContext, useEffect } from "react";

type Props = {
	children: React.ReactNode;
};

export const AuthProvider = (props: Props) => {
	const {
		data: session,
		error,
		isPending,
		isRefetching,
	} = authClient.useSession();
	const actions = useAuthStoreActions();
	if (
		!session &&
		!isPending &&
		!isRefetching &&
		!window.location.pathname.includes("/login") &&
		!window.location.pathname.includes("/sso-test")
	) {
		redirect("/login");
	}
	useEffect(() => {
		if (!session) return;
		actions.setUserData({
			id: session.user.id || "",
			name: session.user.name || "",
			email: session.user.email || "",
			image: session.user.image || "",
			isSystemAdmin: (session.user as any).isSystemAdmin || false,
		});
		actions.setACL((session as any)!.acl);
	}, [session, error]);

	if (isPending || isRefetching || error) {
		return <></>;
	}
	return <>{props.children}</>;
};
