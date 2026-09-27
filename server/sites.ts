import { manifests, type SiteManifest } from '../shared/manifests';

export interface SiteRegistration {
  siteId: string;
  manifest: SiteManifest;
  allowedOrigins: string[];
}
const registry = new Map<string, SiteRegistration>();
export function registerSite(site: SiteRegistration): void {
  if (!/^[a-z0-9-]{1,50}$/.test(site.siteId)) throw new Error('Invalid site ID');
  registry.set(site.siteId, site);
}
export function getSite(siteId: string): SiteRegistration | undefined { return registry.get(siteId); }
export function getManifest(siteId: string): SiteManifest | undefined { return registry.get(siteId)?.manifest; }
export function publicSite(siteId: string): (SiteManifest & { siteId: string }) | undefined {
  const site = registry.get(siteId);
  if (!site) return undefined;
  const { siteName, about, goals, clarify, policy } = site.manifest;
  return { siteId, siteName, about, goals, clarify, policy };
}
export function originAllowed(siteId: string, origin: string | undefined, host: string | undefined): boolean {
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    if (parsed.origin !== origin) return false;
    if (parsed.host === host) return true;
    return !!registry.get(siteId)?.allowedOrigins.includes(origin);
  } catch { return false; }
}
export function registeredOrigin(origin: string): boolean {
  return [...registry.values()].some(site => site.allowedOrigins.includes(origin));
}

registerSite({ siteId: 'canopy', manifest: manifests.canopy, allowedOrigins: [] });
registerSite({ siteId: 'ledgerly', manifest: manifests.ledgerly, allowedOrigins: [] });
registerSite({ siteId: 'sdk-demo', manifest: manifests['sdk-demo'], allowedOrigins: ['http://localhost:9090', 'http://127.0.0.1:9090'] });
