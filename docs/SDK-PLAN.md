# SDK integration plan

Historical implementation plan. The SDK described below is implemented; see [SDK.md](SDK.md) for current integration instructions.

1. Fetch a public site manifest from the backend before mounting the existing widget. Keep customer registrations and full manifests on the server.
2. Build a small transport from `apiBaseUrl` and route text, Live, Chirp, and the audio worklet through it.
3. Bundle a standalone auto-initializing script and an ESM entry with scoped CSS injected by the bundle. Reuse the same entry in Canopy and Ledgerly.
4. Enforce registered origins for HTTP and WebSocket requests, including the site ID on each call. Keep same-origin demo traffic valid.
5. Prove the contract on a separate static HTML origin, then run focused tests and the full baseline.
