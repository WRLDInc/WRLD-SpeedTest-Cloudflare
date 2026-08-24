import { describe, expect, it } from 'vitest';
import {
	buildSpeedTestSnapshot,
	formatMbps,
	formatMs,
	gaugeFraction,
	locationLabel,
	providerLabel,
	readingFromSummary,
	recognizeIsp,
	toMbps,
} from './index';

describe('gaugeFraction', () => {
	it('pins the ends of the dial', () => {
		expect(gaugeFraction(0)).toBe(0);
		expect(gaugeFraction(-5)).toBe(0);
		expect(gaugeFraction(2000)).toBe(1);
		expect(gaugeFraction(99999)).toBe(1); // clamped past the dial max
		expect(gaugeFraction(NaN)).toBe(0);
	});

	it('grows monotonically on the log scale', () => {
		const samples = [0.5, 1, 5, 10, 50, 100, 500, 1000, 2000].map(gaugeFraction);
		for (let i = 1; i < samples.length; i++) {
			expect(samples[i]).toBeGreaterThan(samples[i - 1]);
		}
	});
});

describe('formatting', () => {
	it('formats throughput with one decimal below 100 Mbps and none above', () => {
		expect(formatMbps(7.4321)).toBe('7.4');
		expect(formatMbps(62.34)).toBe('62.3');
		expect(formatMbps(101.4)).toBe('101');
		expect(formatMbps(942.6)).toBe('943');
	});

	it('formats latency the same way', () => {
		expect(formatMs(23.46)).toBe('23.5');
		expect(formatMs(112.6)).toBe('113');
	});

	it('converts bits per second to Mbps', () => {
		expect(toMbps(62_400_000)).toBeCloseTo(62.4);
		expect(toMbps(undefined)).toBeUndefined();
	});
});

describe('readingFromSummary', () => {
	it('converts an engine summary into Mbps/ms', () => {
		expect(readingFromSummary({ download: 62_400_000, upload: 11_200_000, latency: 23.5, jitter: 3.1 })).toEqual({
			downloadMbps: 62.4,
			uploadMbps: 11.2,
			latencyMs: 23.5,
			jitterMs: 3.1,
		});
	});

	it('keeps unmeasured metrics undefined', () => {
		expect(readingFromSummary({ download: 62_400_000 })).toEqual({
			downloadMbps: 62.4,
			uploadMbps: undefined,
			latencyMs: undefined,
			jitterMs: undefined,
		});
	});
});

describe('recognizeIsp / labels', () => {
	it.each([
		['Private Customer - AT&T Internet Services', 'AT&T', 'att'],
		['ATT Mobility LLC', 'AT&T', 'att'],
		['Charter Communications Inc', 'Spectrum', 'spectrum'],
		['Comcast Cable Communications, LLC', 'Comcast Xfinity', 'comcast'],
		['SpaceX Services, Inc.', 'Starlink', 'starlink'],
		['T-Mobile USA, Inc.', 'T-Mobile', 'tmobile'],
		['Cellco Partnership DBA Verizon Wireless', 'Verizon', 'verizon'],
		['Cloudflare, Inc.', 'Cloudflare', 'cloudflare'],
	])('recognizes %s', (asOrg, name, slug) => {
		expect(recognizeIsp(asOrg)).toEqual({ name, slug });
	});

	it('returns null for unknown or missing orgs', () => {
		expect(recognizeIsp('Some Rural Coop Fiber LLC')).toBeNull();
		expect(recognizeIsp(undefined)).toBeNull();
	});

	it('falls back to the raw AS organization in the provider label', () => {
		expect(providerLabel({ asOrganization: 'Some Rural Coop Fiber LLC' })).toBe('Some Rural Coop Fiber LLC');
		expect(providerLabel({ asOrganization: 'Charter Communications Inc' })).toBe('Spectrum');
		expect(providerLabel(null)).toBeUndefined();
	});

	it('builds a location label from whatever detection returned', () => {
		expect(locationLabel({ city: 'Richardson', region: 'Texas' })).toBe('Richardson, Texas');
		expect(locationLabel({ city: 'Richardson', country: 'US' })).toBe('Richardson, US');
		expect(locationLabel({})).toBeUndefined();
		expect(locationLabel(null)).toBeUndefined();
	});
});

describe('buildSpeedTestSnapshot', () => {
	it('builds the lead-payload block with the edge attribution', () => {
		expect(buildSpeedTestSnapshot({ downloadMbps: 62.4, uploadMbps: 11.2, latencyMs: 23.5, jitterMs: 3.1 })).toBe(
			[
				'Download: 62.4 Mbps',
				'Upload: 11.2 Mbps',
				'Latency: 23.5 ms',
				'Jitter: 3.1 ms',
				"Measured in-browser against Cloudflare's global edge",
			].join('\n'),
		);
	});

	it('marks unmeasured metrics instead of dropping the lines', () => {
		const snapshot = buildSpeedTestSnapshot({ downloadMbps: 62.4 });
		expect(snapshot).toContain('Download: 62.4 Mbps');
		expect(snapshot).toContain('Upload: not measured');
		expect(snapshot).toContain('Latency: not measured');
	});

	it('appends detected provider and estimated location when meta is present', () => {
		const snapshot = buildSpeedTestSnapshot(
			{ downloadMbps: 448, uploadMbps: 140, latencyMs: 7.6, jitterMs: 0.9 },
			{
				asn: 7018,
				asOrganization: 'Private Customer - AT&T Internet Services',
				city: 'Richardson',
				region: 'Texas',
				postalCode: '75080',
			},
		);
		expect(snapshot).toContain('Detected provider: AT&T (AS7018)');
		expect(snapshot).toContain('Estimated location: Richardson, Texas 75080');
		expect(snapshot.endsWith("Measured in-browser against Cloudflare's global edge")).toBe(true);
	});
});
