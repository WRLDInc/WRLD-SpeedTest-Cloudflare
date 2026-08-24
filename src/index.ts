// WRLD SpeedTest — typed helpers around @cloudflare/speedtest (the engine
// behind speed.cloudflare.com). The engine module is its own chunk, so it
// loads lazily: prefetch it when the module scrolls into view, await it on
// the first "Test my connection" click.
import type { MeasurementConfig, MeasurementSummary } from '@cloudflare/speedtest';

type SpeedTestModule = typeof import('@cloudflare/speedtest');
type SpeedTestCtor = SpeedTestModule['default'];
export type SpeedTestEngine = InstanceType<SpeedTestCtor>;

/** Everything a consumer needs from a finished test. All in Mbps / ms. */
export interface SpeedTestReading {
	downloadMbps?: number;
	uploadMbps?: number;
	latencyMs?: number;
	jitterMs?: number;
}

/**
 * Connection metadata as served by a same-origin endpoint that reflects the
 * Cloudflare Worker `request.cf` fields (see README — `/api/connection`).
 * Everything is optional: detection is best-effort and the UI must degrade.
 */
export interface ConnectionMeta {
	/** Autonomous system number of the visitor's network. */
	asn?: number;
	/** AS organization — effectively the ISP name, e.g. "AT&T Internet Services". */
	asOrganization?: string;
	city?: string;
	region?: string;
	postalCode?: string;
	country?: string;
	latitude?: number;
	longitude?: number;
	timezone?: string;
	/** Cloudflare colo (edge location) that served the request. */
	colo?: string;
}

/** The `wt:speedtest:complete` CustomEvent detail. */
export interface SpeedTestResultDetail extends SpeedTestReading {
	/** Text block for lead payloads / emails (see buildSpeedTestSnapshot). */
	snapshot: string;
	/** Best-effort provider/location detection; null when unavailable. */
	meta: ConnectionMeta | null;
}

// Trimmed measurement plan (~15–25s vs the ~40s speed.cloudflare.com default):
// no WebRTC packet-loss phase, fewer rounds per payload size, capped at 25MB
// down / 10MB up. `bandwidthFinishRequestDuration` (default 1000ms) still
// skips the larger rounds entirely on slow connections.
export const SPEEDTEST_MEASUREMENTS: MeasurementConfig[] = [
	{ type: 'latency', numPackets: 1 }, // connection warm-up
	{ type: 'download', bytes: 1e5, count: 1, bypassMinDuration: true },
	{ type: 'latency', numPackets: 20 },
	{ type: 'download', bytes: 1e5, count: 8 },
	{ type: 'download', bytes: 1e6, count: 6 },
	{ type: 'upload', bytes: 1e5, count: 8 },
	{ type: 'upload', bytes: 1e6, count: 6 },
	{ type: 'download', bytes: 1e7, count: 4 },
	{ type: 'upload', bytes: 1e7, count: 4 },
	{ type: 'download', bytes: 2.5e7, count: 4 },
];

let ctorPromise: Promise<SpeedTestCtor> | null = null;

/** Lazily import the engine chunk. Safe to call early as a prefetch. */
export function loadSpeedTestEngine(): Promise<SpeedTestCtor> {
	if (!ctorPromise) {
		ctorPromise = import('@cloudflare/speedtest').then((m) => m.default);
		// A failed chunk load (offline blip, content blocker) must not poison
		// every later attempt — drop the cached rejection so callers retry.
		ctorPromise.catch(() => {
			ctorPromise = null;
		});
	}
	return ctorPromise;
}

/** One configured, not-yet-started engine per test run. */
export async function createSpeedTest(): Promise<SpeedTestEngine> {
	const SpeedTest = await loadSpeedTestEngine();
	return new SpeedTest({
		autoStart: false,
		measurements: SPEEDTEST_MEASUREMENTS,
		// Never report visitor measurements to Cloudflare's AIM results store —
		// the numbers stay between the browser and whatever the visitor sends.
		logAimApiUrl: null,
		// Loaded latency isn't surfaced anywhere; skip the extra pings.
		measureDownloadLoadedLatency: false,
		measureUploadLoadedLatency: false,
	});
}

/**
 * Fetch provider/location metadata from a same-origin endpoint backed by the
 * Cloudflare Worker `request.cf` object (speed.cloudflare.com's own /meta is
 * not CORS-open, so each host serves its own — see README). Returns null on
 * any failure; detection is strictly best-effort.
 */
export async function detectConnectionMeta(metaUrl: string): Promise<ConnectionMeta | null> {
	try {
		const response = await fetch(metaUrl, { headers: { Accept: 'application/json' } });
		if (!response.ok) return null;
		const raw = (await response.json()) as Record<string, unknown>;
		const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
		const num = (v: unknown) => {
			const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
			return Number.isFinite(n) ? n : undefined;
		};
		const meta: ConnectionMeta = {
			asn: num(raw.asn),
			asOrganization: str(raw.asOrganization),
			city: str(raw.city),
			region: str(raw.region),
			postalCode: str(raw.postalCode),
			country: str(raw.country),
			latitude: num(raw.latitude),
			longitude: num(raw.longitude),
			timezone: str(raw.timezone),
			colo: str(raw.colo),
		};
		return Object.values(meta).some((v) => v !== undefined) ? meta : null;
	} catch {
		return null;
	}
}

/** A recognized consumer/business ISP brand behind an AS organization name. */
export interface IspBrand {
	/** Friendly display name, e.g. "AT&T". */
	name: string;
	/** Stable slug for logo lookups, e.g. "att". */
	slug: string;
}

// Substring → brand table for the AS organizations of the major US ISPs.
// Deliberately small and curated: an unrecognized org is shown verbatim.
const ISP_BRANDS: ReadonlyArray<[RegExp, IspBrand]> = [
	[/at&t|\batt\b|sbc /i, { name: 'AT&T', slug: 'att' }],
	[/charter|spectrum|time warner/i, { name: 'Spectrum', slug: 'spectrum' }],
	[/comcast|xfinity/i, { name: 'Comcast Xfinity', slug: 'comcast' }],
	[/spacex|starlink/i, { name: 'Starlink', slug: 'starlink' }],
	[/t-mobile|tmobile|sprint/i, { name: 'T-Mobile', slug: 'tmobile' }],
	[/verizon|cellco|\bmci\b/i, { name: 'Verizon', slug: 'verizon' }],
	[/cloudflare/i, { name: 'Cloudflare', slug: 'cloudflare' }],
	[/cox comm/i, { name: 'Cox', slug: 'cox' }],
	[/frontier/i, { name: 'Frontier', slug: 'frontier' }],
	[/centurylink|lumen|qwest|level 3/i, { name: 'Lumen · CenturyLink', slug: 'lumen' }],
	[/google fiber/i, { name: 'Google Fiber', slug: 'googlefiber' }],
	[/altice|optimum|suddenlink|cablevision/i, { name: 'Optimum', slug: 'optimum' }],
	[/windstream/i, { name: 'Windstream', slug: 'windstream' }],
	[/brightspeed/i, { name: 'Brightspeed', slug: 'brightspeed' }],
	[/hughes/i, { name: 'Hughesnet', slug: 'hughesnet' }],
	[/viasat/i, { name: 'Viasat', slug: 'viasat' }],
	[/ziply/i, { name: 'Ziply Fiber', slug: 'ziply' }],
	[/metronet/i, { name: 'Metronet', slug: 'metronet' }],
];

/** Map an AS organization name to a known ISP brand, or null if unrecognized. */
export function recognizeIsp(asOrganization: string | undefined): IspBrand | null {
	if (!asOrganization) return null;
	for (const [pattern, brand] of ISP_BRANDS) {
		if (pattern.test(asOrganization)) return brand;
	}
	return null;
}

/** Friendly provider label: the recognized brand, else the raw AS org name. */
export function providerLabel(meta: ConnectionMeta | null): string | undefined {
	if (!meta) return undefined;
	return recognizeIsp(meta.asOrganization)?.name ?? meta.asOrganization;
}

/** "Richardson, Texas" — however much of the location detection returned. */
export function locationLabel(meta: ConnectionMeta | null): string | undefined {
	if (!meta) return undefined;
	const parts = [meta.city, meta.region ?? meta.country].filter(Boolean);
	return parts.length ? parts.join(', ') : undefined;
}

/** The gauge dial tops out here; log-scaled so small-business speeds read well. */
export const GAUGE_MAX_MBPS = 2000;

export function toMbps(bps: number | undefined): number | undefined {
	return bps === undefined ? undefined : bps / 1e6;
}

/** 0–1 position on the log-scaled dial for a throughput in Mbps. */
export function gaugeFraction(mbps: number): number {
	if (!Number.isFinite(mbps) || mbps <= 0) return 0;
	return Math.min(1, Math.log10(1 + mbps) / Math.log10(1 + GAUGE_MAX_MBPS));
}

export function formatMbps(mbps: number): string {
	return mbps >= 100 ? String(Math.round(mbps)) : mbps.toFixed(1);
}

export function formatMs(ms: number): string {
	return ms >= 100 ? String(Math.round(ms)) : ms.toFixed(1);
}

export function prefersReducedMotion(): boolean {
	return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function readingFromSummary(summary: MeasurementSummary): SpeedTestReading {
	return {
		downloadMbps: toMbps(summary.download),
		uploadMbps: toMbps(summary.upload),
		latencyMs: summary.latency,
		jitterMs: typeof summary.jitter === 'number' ? summary.jitter : undefined,
	};
}

/** Text block for lead payloads / emails. */
export function buildSpeedTestSnapshot(reading: SpeedTestReading, meta: ConnectionMeta | null = null): string {
	const metric = (value: number | undefined, format: (n: number) => string, unit: string) =>
		value === undefined ? 'not measured' : `${format(value)} ${unit}`;
	const lines = [
		`Download: ${metric(reading.downloadMbps, formatMbps, 'Mbps')}`,
		`Upload: ${metric(reading.uploadMbps, formatMbps, 'Mbps')}`,
		`Latency: ${metric(reading.latencyMs, formatMs, 'ms')}`,
		`Jitter: ${metric(reading.jitterMs, formatMs, 'ms')}`,
	];
	const provider = providerLabel(meta);
	if (provider) lines.push(`Detected provider: ${provider}${meta?.asn ? ` (AS${meta.asn})` : ''}`);
	const location = locationLabel(meta);
	if (location) lines.push(`Estimated location: ${location}${meta?.postalCode ? ` ${meta.postalCode}` : ''}`);
	lines.push("Measured in-browser against Cloudflare's global edge");
	return lines.join('\n');
}
