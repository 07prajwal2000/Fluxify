import type { Metadata } from "next";
import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "@mantine/nprogress/styles.css";
import "../index.css";

import {
  ColorSchemeScript,
  MantineProvider,
  mantineHtmlProps,
} from "@mantine/core";
import RootAppShell from "@/components/rootAppShell";
import QueryProvider from "../query/queryProvider";
import { Notifications } from "@mantine/notifications";
import { NavigationProgress } from "@mantine/nprogress";

export const metadata: Metadata = {
  title: "Configurable Backend Engine",
  description: "CBE Console",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" {...mantineHtmlProps}>
      <head>
        <ColorSchemeScript />
      </head>
      <body>
        <MantineProvider>
          <Notifications />
          <QueryProvider>
            <NavigationProgress color="violet" size={2} />
            <RootAppShell>{children}</RootAppShell>
          </QueryProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
