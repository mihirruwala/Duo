import { ViewTransition } from "react";

/**
 * iOS-style push and pop between screens. Links into a room carry the "nav-forward" type, the back
 * chevron "nav-back"; anything else (tab switches, refreshes, the browser's own back) doesn't
 * animate. The slide itself only runs on phones (see globals.css).
 */
export function PageSlide({ children }: { children: React.ReactNode }) {
  const map = { "nav-forward": "nav-forward", "nav-back": "nav-back", default: "none" };
  return (
    <ViewTransition enter={map} exit={map} default="none">
      {children}
    </ViewTransition>
  );
}
