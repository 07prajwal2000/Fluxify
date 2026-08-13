import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import "./sidebar.css";

export type SidebarPlacement = "left" | "right";

export type SidebarProps = {
	children: ReactNode;
	isOpen: boolean;
	onOpenChange: (isOpen: boolean) => void;
	placement?: SidebarPlacement;
	className?: string;
	"aria-label"?: string;
};

/** Portal-backed sidebar with backdrop, Escape, and outside-click dismissal. */
export function Sidebar({
	children,
	isOpen,
	onOpenChange,
	placement = "right",
	className,
	"aria-label": ariaLabel = "Sidebar",
}: SidebarProps) {
	const [mounted, setMounted] = useState(false);

	useEffect(() => setMounted(true), []);

	useEffect(() => {
		if (!isOpen) return;

		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") onOpenChange(false);
		};
		const previousOverflow = document.body.style.overflow;
		document.addEventListener("keydown", closeOnEscape);
		document.body.style.overflow = "hidden";

		return () => {
			document.removeEventListener("keydown", closeOnEscape);
			document.body.style.overflow = previousOverflow;
		};
	}, [isOpen, onOpenChange]);

	if (!mounted || !isOpen) return null;

	return createPortal(
		<div
			className="fx-sidebar-backdrop"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onOpenChange(false);
			}}
		>
			<aside
				aria-label={ariaLabel}
				aria-modal="true"
				className={["fx-sidebar", `fx-sidebar--${placement}`, className]
					.filter(Boolean)
					.join(" ")}
				role="dialog"
			>
				{children}
			</aside>
		</div>,
		document.body,
	);
}
