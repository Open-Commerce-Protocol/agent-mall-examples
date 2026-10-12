import { useEffect, useRef, useState } from 'react';

/**
 * Animate a number from its previous value up to `target` once `active` is true.
 *
 * Returns the current animated value. Re-runs when `target` changes (so a later,
 * larger real value ticks up from the previous one rather than resetting to 0).
 * Respects prefers-reduced-motion: jumps straight to the target.
 */
export function useCountUp(target: number, active: boolean, durationMs = 1600): number {
  const [value, setValue] = useState(0);
  const fromRef = useRef(0);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!active) return;

    const prefersReduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const from = fromRef.current;
    const delta = target - from;
    let startTs = 0;

    // Both the animated path and the reduced-motion/instant path commit their
    // value inside the rAF callback, never synchronously in the effect body.
    const tick = (ts: number) => {
      if (startTs === 0) startTs = ts;
      const t = prefersReduced || target <= 0 ? 1 : Math.min((ts - startTs) / durationMs, 1);
      // easeOutExpo: fast start, gentle settle
      const eased = t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      setValue(from + delta * eased);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        fromRef.current = target;
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, active, durationMs]);

  return value;
}
