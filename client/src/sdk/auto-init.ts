import { Pathfinder } from './index';

declare global { interface Window { Pathfinder: typeof Pathfinder } }
window.Pathfinder = Pathfinder;

const script = document.currentScript as HTMLScriptElement | null;
const siteId = script?.dataset.pathfinderSite;
if (siteId) {
  const initialize = () => Pathfinder.init({ siteId, apiBaseUrl: script?.dataset.pathfinderApi });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initialize, { once: true });
  else initialize();
}
