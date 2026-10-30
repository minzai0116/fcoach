"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

export function PlayerAnalysisLayout({ active, children }: { active: boolean; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const section = ref.current;
    if (!active || !section) return;
    const update = () => {
      const top = section.getBoundingClientRect().top + window.scrollY;
      section.style.setProperty("--player-panel-height", `${Math.max(420, window.innerHeight - top - 16)}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    for (const element of section.parentElement?.querySelectorAll(":scope > .app-header, :scope > .app-navigation") ?? []) observer.observe(element);
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, [active]);
  return <section ref={ref} className={`grid player-analysis-section${active ? " analysis-focus" : ""}`}>{children}</section>;
}
