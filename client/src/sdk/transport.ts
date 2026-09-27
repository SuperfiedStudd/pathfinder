export interface PathfinderTransport {
  site(siteId: string): string;
  decide: string;
  live(siteId: string): string;
  transcribe: string;
  speak: string;
  worklet: string;
  siteHeaders(siteId: string): Record<string, string>;
}

export function createTransport(apiBaseUrl: string = window.location.origin): PathfinderTransport {
  const base = new URL(apiBaseUrl, window.location.href);
  if (!['http:', 'https:'].includes(base.protocol)) throw new Error('Pathfinder API URL must use HTTP or HTTPS');
  const endpoint = (name: string) => new URL(name, `${base.href.replace(/\/$/, '')}/`).href;
  return {
    site: siteId => endpoint(`api/sites/${encodeURIComponent(siteId)}`),
    decide: endpoint('api/decide'),
    live: siteId => {
      const url = new URL(endpoint('api/live'));
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.searchParams.set('siteId', siteId);
      return url.href;
    },
    transcribe: endpoint('api/voice/transcribe'),
    speak: endpoint('api/voice/speak'),
    worklet: endpoint('live-pcm-worklet.js'),
    siteHeaders: siteId => ({ 'X-Pathfinder-Site': siteId }),
  };
}
