import { ToastProvider } from "@heroui/react";
import type { ReactNode } from "react";

// Mounts the toast region and wraps the app. HeroUI v3 has no root provider —
// theming is handled by the `useTheme` hook + CSS classes, so this only needs
// to render the toast outlet alongside the tree.
export function Providers({ children }: { children: ReactNode }) {
	return (
		<>
			<ToastProvider placement="bottom end" />
			{children}
		</>
	);
}
