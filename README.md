# WRLD SpeedTest · Cloudflare

WRLD-branded live connection test — an [Astro](https://astro.build) gauge component and typed helpers around [`@cloudflare/speedtest`](https://github.com/cloudflare/speedtest) (MIT, the engine behind [speed.cloudflare.com](https://speed.cloudflare.com)), with optional provider/location detection served by your own Cloudflare Worker.

Built for wrld.tech's ISP savings calculator; packaged so any WRLD property behind Cloudflare can drop it in.

## What you get

- **`SpeedTest.astro`** — the "Test my connection" module: log-scaled SVG dial (0 → 2 Gbps), accent-primary progress arc, live Mbps readout through the download/upload phases, then a download / upload / latency / jitter results row and a best-effort `via <provider> · near <city>` line.
- **Lazy by construction** — the ~29KB engine chunk is referenced only via dynamic `import()`: prefetched when the module scrolls into view, awaited on the first click. Your static page graph never carries it.
- **Trimmed measurement plan** (~15–25s): no WebRTC packet-loss phase, capped at 25MB down / 10MB up; slow links short-circuit the big rounds. Result logging to Cloudflare's AIM store is disabled.
- **Reduced motion respected** — no rAF lerp, no glow loop; values simply appear.
- **Typed helpers** — engine loader/factory, `readingFromSummary`, `formatMbps`/`formatMs`, `gaugeFraction`, `buildSpeedTestSnapshot` (email/lead text block), `detectConnectionMeta`, and `recognizeIsp` (AS-organization → friendly ISP brand for the major US carriers).

## Install

```sh
npm install github:WRLDInc/WRLD-SpeedTest-Cloudflare#v0.1.0
```

The `prepare` script compiles `dist/` on install. Pin a tag; bump deliberately.

## Use

```astro
---
import SpeedTest from '@wrldinc/speedtest-cloudflare/SpeedTest.astro';
---
<SpeedTest />                          <!-- default: detection via /api/connection -->
<SpeedTest metaUrl="" />               <!-- detection disabled -->
<SpeedTest id="my-speedtest" metaUrl="/api/edge-meta" />
```

Listen for results anywhere up the tree (events bubble from the module root):

```ts
import type { SpeedTestResultDetail } from '@wrldinc/speedtest-cloudflare';

document.getElementById('wt-speedtest')?.addEventListener('wt:speedtest:complete', (e) => {
	const detail = (e as CustomEvent<SpeedTestResultDetail>).detail;
	// detail.downloadMbps / uploadMbps / latencyMs / jitterMs
	// detail.meta?.asOrganization / city / region / latitude / longitude
	// detail.snapshot — ready-made text block for a lead payload
});
// 'wt:speedtest:start' fires when a run begins — clear stale readings there.
```

## Provider & location detection (`metaUrl`)

`speed.cloudflare.com/meta` is not CORS-open, so each host serves its own tiny same-origin endpoint reflecting the Worker's [`request.cf`](https://developers.cloudflare.com/workers/runtime-apis/request/#incomingrequestcfproperties) fields. On an Astro + `@astrojs/cloudflare` site:

```ts
// src/pages/api/connection.ts
import type { APIRoute } from 'astro';
export const prerender = false;

export const GET: APIRoute = ({ locals }) => {
	const cf = (locals as { runtime?: { cf?: Record<string, unknown> } }).runtime?.cf ?? {};
	const pick = (...keys: string[]) => Object.fromEntries(keys.map((k) => [k, cf[k]]));
	return new Response(
		JSON.stringify(pick('asn', 'asOrganization', 'city', 'region', 'postalCode', 'country', 'latitude', 'longitude', 'timezone', 'colo')),
		{ headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } },
	);
};
```

Detection is strictly best-effort: any failure (endpoint missing, timeout, non-Cloudflare host) degrades to a plain speed test. Estimates come from the visitor's IP — surface them as estimates, never as facts.

## Host requirements

- The WRLD design-system tokens (`--wrld-*` custom properties) on the page — colors, type, radii, motion.
- `.wt-btn` / `.wt-btn-primary` / `.wt-btn-outline` button classes, and the `wt-cta-glow` / `wt-arrow` keyframes for the idle CTA loop (missing keyframes degrade silently).
- A container named `wt-root` for the responsive breakpoints (falls back to single-column layouts otherwise).

## Attribution copy

The module ships with the accurate line: *"Measured against Cloudflare's global edge — the same network that serves this site."* Keep it (or equivalent). Don't claim the test measures against WRLD servers — it doesn't.

## Develop

```sh
npm ci
npm run build   # tsc → dist/
npm test        # vitest
```

## License

MIT © WRLD Inc. Wraps [`@cloudflare/speedtest`](https://github.com/cloudflare/speedtest) (MIT © Cloudflare).
