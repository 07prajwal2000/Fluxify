import { ToastProvider } from "@heroui/react";
import type { ReactNode } from "react";

// Mounts the toast region and wraps the app. HeroUI v3 has no root provider —
// theming is handled by the `useTheme` hook + CSS classes, so this only needs
// to render the toast outlet alongside the tree.
export function Providers({ children }: { children: ReactNode }) {
	return (
		<>
			{/* expanded: several results at once (a failed test and its reason, then the retry)
			    stay readable side by side instead of folding behind the newest (#690) */}
			<ToastProvider isExpanded placement="bottom end" width="min(24rem, calc(100vw - 2rem))" />
			{children}
		</>
	);
}
