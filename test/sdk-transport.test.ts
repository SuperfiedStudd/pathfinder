import { describe, expect, it } from 'vitest';
import { createTransport } from '../client/src/sdk/transport';
import { getSite, originAllowed, publicSite } from '../server/sites';

describe('SDK transport', () => {
  it('creates all endpoints from a remote HTTP base', () => {
    const t = createTransport('http://localhost:8788');
    expect(t.site('sdk-demo')).toBe('http://localhost:8788/api/sites/sdk-demo');
    expect(t.decide).toBe('http://localhost:8788/api/decide');
    expect(t.live('sdk-demo')).toBe('ws://localhost:8788/api/live?siteId=sdk-demo');
    expect(t.transcribe).toBe('http://localhost:8788/api/voice/transcribe');
    expect(t.speak).toBe('http://localhost:8788/api/voice/speak');
    expect(t.worklet).toBe('http://localhost:8788/live-pcm-worklet.js');
  });
  it('upgrades HTTPS to WSS and respects API paths', () => {
    const t = createTransport('https://example.com/pathfinder');
    expect(t.live('acme')).toBe('wss://example.com/pathfinder/api/live?siteId=acme');
  });
});

describe('site registry', () => {
  it('returns public configuration without allowed origins', () => {
    expect(publicSite('sdk-demo')?.goals[0].id).toBe('workspace');
    expect(publicSite('sdk-demo')).not.toHaveProperty('allowedOrigins');
    expect(publicSite('unknown')).toBeUndefined();
    expect(getSite('sdk-demo')?.allowedOrigins).toContain('http://localhost:9090');
  });
  it('binds external origins to the site', () => {
    expect(originAllowed('sdk-demo', 'http://localhost:9090', 'localhost:8788')).toBe(true);
    expect(originAllowed('canopy', 'http://localhost:9090', 'localhost:8788')).toBe(false);
    expect(originAllowed('sdk-demo', 'http://evil.test', 'localhost:8788')).toBe(false);
    expect(originAllowed('sdk-demo', 'http://localhost:8788', 'localhost:8788')).toBe(true);
  });
});
