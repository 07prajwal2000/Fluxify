import type { Metadata } from "next";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/nprogress/styles.css";
import "../index.css";

import {
	ColorSchemeScript,
	MantineProvider,
	mantineHtmlProps,
	createTheme,
} from "@mantine/core";
import QueryProvider from "../query/queryProvider";
import { Notifications } from "@mantine/notifications";
import { NavigationProgress } from "@mantine/nprogress";
import { AuthProvider } from "@/components/auth/authProvider";

export const metadata: Metadata = {
	title: "Fluxify",
	description: "Fluxify Console",
};

const theme = createTheme({
	components: {
		TextInput: { classNames: { root: "modern-input" } },
		PasswordInput: { classNames: { root: "modern-input" } },
		Textarea: { classNames: { root: "modern-input" } },
		Select: { classNames: { root: "modern-input" } },
	},
});

export default async function RootLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" {...mantineHtmlProps}>
			<head>
				<ColorSchemeScript />
			</head>
			<body>
				<MantineProvider theme={theme}>
					<Notifications />
					<QueryProvider>
						<NavigationProgress color="violet" size={2} />
						<AuthProvider>{children}</AuthProvider>
					</QueryProvider>
				</MantineProvider>
			</body>
		</html>
	);
}
