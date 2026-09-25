import { createRoot, type Root } from "react-dom/client";
import { getManifest } from "@shared/manifests";
import { Overlay } from "./overlay";
import { OnboardingLoop } from "./loop";
import { Widget } from "./Widget";
import { snapshot } from "./extract";
import "./widget.css";

interface Mounted {
  siteId: string;
  root: Root;
  container: HTMLElement;
  loop: OnboardingLoop;
}

let mounted: Mounted | null = null;

// The public entry point. On a real third-party site this is what the
// script tag calls; here the demo sites call it from a layout effect.
export function mountOnboarding(siteId: string): OnboardingLoop | null {
  const manifest = getManifest(siteId);
  if (!manifest) {
    console.warn(`[pathfinder] no manifest for site "${siteId}"`);
    return null;
  }
  if (mounted && mounted.siteId === siteId) return mounted.loop;
  if (mounted) unmountOnboarding();

  const container = document.createElement("div");
  container.setAttribute("data-pf-widget", "");
  container.className = "pf-root";
  document.body.appendChild(container);

  const overlay = new Overlay(container);
  const loop = new OnboardingLoop(siteId, manifest, overlay, container);
  const root = createRoot(container.appendChild(document.createElement("div")));
  root.render(<Widget loop={loop} />);

  mounted = { siteId, root, container, loop };

  if (import.meta.env.DEV) {
    (window as Window & { __pf?: unknown }).__pf = { snapshot, loop };
  }
  return loop;
}

export function unmountOnboarding(): void {
  if (!mounted) return;
  mounted.loop.destroy();
  mounted.root.unmount();
  mounted.container.remove();
  mounted = null;
}
