import { createRoot, type Root } from 'react-dom/client';
import type { SiteManifest } from '@shared/manifests';
import { OnboardingLoop } from '../widget/loop';
import { Overlay } from '../widget/overlay';
import { Widget } from '../widget/Widget';
import { createTransport } from './transport';
import css from '../widget/widget.css?inline';
import packageInfo from '../../../package.json';

export interface PathfinderOptions { siteId: string; apiBaseUrl?: string; container?: HTMLElement }
export interface PathfinderInstance { destroy(): void }

let current: { siteId: string; apiBaseUrl: string; container?: HTMLElement; instance: PathfinderInstance } | null = null;
let style: HTMLStyleElement | null = null;
function ensureStyles(): void {
  if (style?.isConnected) return;
  style = document.createElement('style');
  style.setAttribute('data-pf-styles', '');
  style.textContent = css;
  document.head.appendChild(style);
}

export const Pathfinder = {
  version: packageInfo.version,
  init(options: PathfinderOptions): PathfinderInstance {
    if (!options?.siteId?.trim()) throw new Error('Pathfinder siteId is required');
    const siteId = options.siteId.trim();
    const transport = createTransport(options.apiBaseUrl);
    const apiBaseUrl = options.apiBaseUrl ?? window.location.origin;
    if (current?.siteId === siteId && current.apiBaseUrl === apiBaseUrl && current.container === options.container) return current.instance;
    current?.instance.destroy();
    const abort = new AbortController();
    let root: Root | null = null;
    let loop: OnboardingLoop | null = null;
    let widget: HTMLElement | null = null;
    let destroyed = false;
    const instance: PathfinderInstance = {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        abort.abort();
        loop?.destroy();
        root?.unmount();
        widget?.remove();
        if (current?.instance === instance) current = null;
        if (!current) { style?.remove(); style = null; }
      },
    };
    current = { siteId, apiBaseUrl, container: options.container, instance };
    void (async () => {
      try {
        const response = await fetch(transport.site(siteId), { signal: abort.signal });
        if (!response.ok) throw new Error(`Site configuration failed (${response.status})`);
        const manifest = await response.json() as SiteManifest & { siteId: string };
        if (destroyed || manifest.siteId !== siteId) return;
        ensureStyles();
        widget = document.createElement('div');
        widget.className = 'pf-root';
        widget.setAttribute('data-pf-widget', '');
        (options.container ?? document.body).appendChild(widget);
        const overlay = new Overlay(widget);
        loop = new OnboardingLoop(siteId, manifest, overlay, widget, transport);
        root = createRoot(widget.appendChild(document.createElement('div')));
        root.render(<Widget loop={loop} />);
      } catch (error) {
        if (!destroyed) {
          console.error('[pathfinder]', error);
          if (current?.instance === instance) current = null;
        }
      }
    })();
    return instance;
  },
};
