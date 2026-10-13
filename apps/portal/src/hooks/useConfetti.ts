import confetti from "canvas-confetti";
import { useCallback, useEffect, useRef } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Fires a confetti burst when a production promote succeeds.
 *
 * Returns a `fire` function that launches a single ~1s burst from the center
 * of the given element, or from the viewport center when no element is
 * provided. Bursts are skipped when the user prefers reduced motion.
 */
export function useConfetti() {
	const prefersReducedMotionRef = useRef(false);

	useEffect(() => {
		const mediaQueryList = window.matchMedia(REDUCED_MOTION_QUERY);
		prefersReducedMotionRef.current = mediaQueryList.matches;

		const handleChange = (event: MediaQueryListEvent) => {
			prefersReducedMotionRef.current = event.matches;
		};

		mediaQueryList.addEventListener("change", handleChange);
		return () => {
			mediaQueryList.removeEventListener("change", handleChange);
		};
	}, []);

	const fire = useCallback((element?: HTMLElement | null) => {
		if (prefersReducedMotionRef.current) {
			return;
		}

		let origin = { x: 0.5, y: 0.5 };
		if (element) {
			const rect = element.getBoundingClientRect();
			origin = {
				x: (rect.left + rect.width / 2) / window.innerWidth,
				y: (rect.top + rect.height / 2) / window.innerHeight,
			};
		}

		confetti({
			particleCount: 100,
			spread: 70,
			origin,
			ticks: 100,
		});
	}, []);

	return fire;
}
