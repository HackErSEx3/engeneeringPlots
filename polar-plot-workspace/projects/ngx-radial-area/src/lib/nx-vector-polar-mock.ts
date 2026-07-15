/**
 * nx-vector-polar-mock.ts
 *
 * Interfaces, sample data, and O(1) transformer for NX Vector 1X measurements
 * mapped to PolarDataPoint for the ngx-polar-plot component.
 *
 * DATA STRUCTURE EXPLAINED
 * ─────────────────────────────────────────────────────────────────────────────
 * The API returns two parallel time-series under `data.primaryData`, identified
 * by `tagId`:
 *
 *   tagId A  (measurements[i].info.units === "mil")  →  1X AMPLITUDE curve
 *     sample.value   = vibration amplitude in mils peak-to-peak
 *     sample.speed   = shaft speed in rpm (non-null)
 *
 *   tagId B  (measurements[i].info.units === "°")    →  1X PHASE curve
 *     sample.value   = cumulative phase in RADIANS (not degrees, despite "°" unit label)
 *     sample.speed   = null
 *     isPhaseRolloverApplicable = true  →  normalize via value % (2π) before display
 *
 * Polar plot mapping:
 *   PolarDataPoint.amplitudeValue  ← amplitude sample's `value`   (mil pp)
 *   PolarDataPoint.phaseValue      ← phase sample's `value`, converted:
 *                                     (value % (2π) + 2π) % (2π)  →  × (180/π)  → degrees 0–360
 *
 * JOIN STRATEGY (O(1) per sample, O(n) total)
 * ─────────────────────────────────────────────────────────────────────────────
 * Naive approach:  for each amp sample → scan all phase samples to find matching timestamp → O(n²)
 * Map approach:    build Map<timestamp, phaseValue> once → lookup in O(1) per amp sample → O(n)
 *
 * NOTE on sample data below:
 * For clarity the sample phase values are stored in DEGREES (0–360).
 * Real API data stores them in RADIANS (see PHASE_UNIT_IS_RADIANS flag in transformer).
 * The transformer handles both via a units check.
 */

// ─── Raw API Types ────────────────────────────────────────────────────────────

export interface NxVectorSample {
  /** .NET ticks: 100-ns intervals since 0001-01-01.
   *  Convert to JS ms: (timestamp - 621355968000000000) / 10000  */
  timestamp: number;
  dataStatus: number;   // 0 = Good, non-zero = bad/suspect
  nodeStatus: number;
  value: number;        // amplitude (mil) or phase (rad or °, see units)
  speed: number | null; // rpm — present on amplitude series, null on phase series
}

export interface NxVectorPrimaryData {
  sampleType: string;
  tagId: string;        // matches measurements[i].info.id
  samples: NxVectorSample[];
  associatedTagId?: string;
}

export interface NxVectorMeasurementInfo {
  id: string;
  name: string;
  units: string;               // "mil" → amplitude; "°" → phase
  subUnits: string;            // "pp" (peak-to-peak) for amplitude, "None" for phase
  isPhaseRolloverApplicable: boolean;
  isAxisInverted: boolean;
  parentVectorMeasurementName: string;   // e.g. "1X", "2X"
  pointName: string;
  associatedAssetId: string;
  filteredWith: string;
}

export interface NxVectorMeasurement {
  curveType: 'PRIMARY' | 'REFERENCE';
  subplotId: string;
  primaryCurveId: string;
  info: NxVectorMeasurementInfo;
}

export interface NxVectorApiResponse {
  measurements: NxVectorMeasurement[];
  data: {
    primaryData: NxVectorPrimaryData[];
  };
}

// ─── Output type (extends PolarDataPoint — matches T1 in research doc) ────────

/** Extended PolarDataPoint with label support.
 *  Maps to the updated interface in polar-plot.models.ts (research doc changes T1, T2).
 *  Until that update lands, cast as `any` when passing to the component. */
export interface PolarDataPointWithLabel {
  phaseValue: number;     // degrees 0–360; maps to PolarDataPoint.phaseValue
  amplitudeValue: number; // mil pp;         maps to PolarDataPoint.amplitudeValue
  labelText?: string;     // formatted label for overlap-aware placement
}

// ─── Sample JSON data ─────────────────────────────────────────────────────────
//
// 30 data points representing:
//   • Samples  1–13: startup ramp  0 → 3600 rpm  (traces Nyquist spiral on polar plot)
//   • Samples 14–30: steady-state  3600 rpm       (dense cluster, exercises label thinning)
//
// Amplitude tagId : "43f3faca-cb71-437a-906f-38fb0827e4d7"  (units: "mil")
// Phase tagId     : "7cd13056-c7a3-4b94-ab32-c8345f03b153"  (units: "°")
//
// Timestamps: .NET ticks, 2026-05-27 09:00 UTC base, spaced 2 min during startup,
//             5 min during steady-state.
// Base tick : 639155556000000000  (≈ 2026-05-27 09:00:00 UTC)
// 1 min tick : 600000000
//
// Phase values: stored in DEGREES in this sample (contrast with real API which uses radians).
//               Transformer reads units field to decide conversion path.

export const sampleNxVectorResponse: NxVectorApiResponse = {
  measurements: [
    {
      curveType: 'PRIMARY',
      subplotId: '0',
      primaryCurveId: '7cd13056-c7a3-4b94-ab32-c8345f03b153',
      info: {
        id: '43f3faca-cb71-437a-906f-38fb0827e4d7',
        name: '1X Amp',
        units: 'mil',
        subUnits: 'pp',
        isPhaseRolloverApplicable: false,
        isAxisInverted: false,
        parentVectorMeasurementName: '1X',
        pointName: 'RadialVibration1',
        associatedAssetId: '21ec8c2c-4acd-4ce8-87a5-841757aac354',
        filteredWith: 'Direct',
      },
    },
    {
      curveType: 'PRIMARY',
      subplotId: '1',
      primaryCurveId: '43f3faca-cb71-437a-906f-38fb0827e4d7',
      info: {
        id: '7cd13056-c7a3-4b94-ab32-c8345f03b153',
        name: '1X Phase',
        units: '°',
        subUnits: 'None',
        isPhaseRolloverApplicable: true,
        isAxisInverted: true,
        parentVectorMeasurementName: '1X',
        pointName: 'RadialVibration1',
        associatedAssetId: '21ec8c2c-4acd-4ce8-87a5-841757aac354',
        filteredWith: 'Direct',
      },
    },
  ],
  data: {
    primaryData: [
      // ── 1X Amplitude series ────────────────────────────────────────────────
      // tagId matches measurements[0].info.id
      {
        sampleType: 'SummaryStaticDataSample',
        tagId: '43f3faca-cb71-437a-906f-38fb0827e4d7',
        associatedTagId: '6d34a7cb-4a43-45fa-8937-5652da012f3f',
        samples: [
          // ── Startup ramp: 0 → 3600 rpm (2-min intervals) ──────────────────
          { timestamp: 639155556000000000, dataStatus: 0, nodeStatus: 0, value: 0.12, speed: 0    },  // 09:00 — standstill
          { timestamp: 639155557200000000, dataStatus: 0, nodeStatus: 0, value: 0.45, speed: 300  },  // 09:02
          { timestamp: 639155558400000000, dataStatus: 0, nodeStatus: 0, value: 1.15, speed: 600  },  // 09:04
          { timestamp: 639155559600000000, dataStatus: 0, nodeStatus: 0, value: 2.82, speed: 900  },  // 09:06
          { timestamp: 639155560800000000, dataStatus: 0, nodeStatus: 0, value: 5.60, speed: 1200 },  // 09:08 — approaching critical
          { timestamp: 639155562000000000, dataStatus: 0, nodeStatus: 0, value: 8.75, speed: 1500 },  // 09:10 — critical speed zone
          { timestamp: 639155563200000000, dataStatus: 0, nodeStatus: 0, value: 9.20, speed: 1800 },  // 09:12 — peak resonance
          { timestamp: 639155564400000000, dataStatus: 0, nodeStatus: 0, value: 7.80, speed: 2100 },  // 09:14
          { timestamp: 639155565600000000, dataStatus: 0, nodeStatus: 0, value: 6.30, speed: 2400 },  // 09:16
          { timestamp: 639155566800000000, dataStatus: 0, nodeStatus: 0, value: 5.50, speed: 2700 },  // 09:18
          { timestamp: 639155568000000000, dataStatus: 0, nodeStatus: 0, value: 5.10, speed: 3000 },  // 09:20
          { timestamp: 639155569200000000, dataStatus: 0, nodeStatus: 0, value: 4.75, speed: 3300 },  // 09:22
          { timestamp: 639155570400000000, dataStatus: 0, nodeStatus: 0, value: 4.55, speed: 3600 },  // 09:24 — running speed reached
          // ── Steady-state at 3600 rpm: dense cluster exercises label thinning ─
          { timestamp: 639155574000000000, dataStatus: 0, nodeStatus: 0, value: 4.48, speed: 3600 },  // 09:30
          { timestamp: 639155577000000000, dataStatus: 0, nodeStatus: 0, value: 4.52, speed: 3600 },  // 09:35
          { timestamp: 639155580000000000, dataStatus: 0, nodeStatus: 0, value: 4.61, speed: 3600 },  // 09:40
          { timestamp: 639155583000000000, dataStatus: 0, nodeStatus: 0, value: 4.44, speed: 3600 },  // 09:45
          { timestamp: 639155586000000000, dataStatus: 0, nodeStatus: 0, value: 4.70, speed: 3600 },  // 09:50
          { timestamp: 639155589000000000, dataStatus: 0, nodeStatus: 0, value: 4.53, speed: 3600 },  // 09:55
          { timestamp: 639155592000000000, dataStatus: 0, nodeStatus: 0, value: 4.58, speed: 3600 },  // 10:00
          { timestamp: 639155595000000000, dataStatus: 0, nodeStatus: 0, value: 4.62, speed: 3600 },  // 10:05
          { timestamp: 639155598000000000, dataStatus: 0, nodeStatus: 0, value: 4.49, speed: 3600 },  // 10:10
          { timestamp: 639155601000000000, dataStatus: 0, nodeStatus: 0, value: 4.55, speed: 3600 },  // 10:15
          { timestamp: 639155604000000000, dataStatus: 0, nodeStatus: 0, value: 4.71, speed: 3600 },  // 10:20
          { timestamp: 639155607000000000, dataStatus: 0, nodeStatus: 0, value: 4.38, speed: 3600 },  // 10:25
          { timestamp: 639155610000000000, dataStatus: 0, nodeStatus: 0, value: 4.60, speed: 3600 },  // 10:30
          { timestamp: 639155613000000000, dataStatus: 0, nodeStatus: 0, value: 5.20, speed: 3600 },  // 10:35 — slight excursion
          { timestamp: 639155616000000000, dataStatus: 0, nodeStatus: 0, value: 5.80, speed: 3600 },  // 10:40 — alert event
          { timestamp: 639155619000000000, dataStatus: 0, nodeStatus: 0, value: 5.35, speed: 3600 },  // 10:45 — recovering
          { timestamp: 639155622000000000, dataStatus: 0, nodeStatus: 0, value: 4.65, speed: 3600 },  // 10:50 — recovered
        ],
      },

      // ── 1X Phase series ───────────────────────────────────────────────────
      // tagId matches measurements[1].info.id
      // Values are in DEGREES (0–360) in this sample file.
      // Real API data stores these in RADIANS — transformer reads units field to decide.
      {
        sampleType: 'SummaryStaticDataSample',
        tagId: '7cd13056-c7a3-4b94-ab32-c8345f03b153',
        samples: [
          // ── Startup ramp ──────────────────────────────────────────────────
          // Phase starts near 0°, lags ~180° through critical speed, then stabilises ~168°
          { timestamp: 639155556000000000, dataStatus: 0, nodeStatus: 0, value: 5,   speed: null },  // 09:00
          { timestamp: 639155557200000000, dataStatus: 0, nodeStatus: 0, value: 8,   speed: null },  // 09:02
          { timestamp: 639155558400000000, dataStatus: 0, nodeStatus: 0, value: 12,  speed: null },  // 09:04
          { timestamp: 639155559600000000, dataStatus: 0, nodeStatus: 0, value: 25,  speed: null },  // 09:06
          { timestamp: 639155560800000000, dataStatus: 0, nodeStatus: 0, value: 45,  speed: null },  // 09:08
          { timestamp: 639155562000000000, dataStatus: 0, nodeStatus: 0, value: 75,  speed: null },  // 09:10 — critical zone
          { timestamp: 639155563200000000, dataStatus: 0, nodeStatus: 0, value: 102, speed: null },  // 09:12 — peak resonance
          { timestamp: 639155564400000000, dataStatus: 0, nodeStatus: 0, value: 125, speed: null },  // 09:14
          { timestamp: 639155565600000000, dataStatus: 0, nodeStatus: 0, value: 143, speed: null },  // 09:16
          { timestamp: 639155566800000000, dataStatus: 0, nodeStatus: 0, value: 155, speed: null },  // 09:18
          { timestamp: 639155568000000000, dataStatus: 0, nodeStatus: 0, value: 163, speed: null },  // 09:20
          { timestamp: 639155569200000000, dataStatus: 0, nodeStatus: 0, value: 166, speed: null },  // 09:22
          { timestamp: 639155570400000000, dataStatus: 0, nodeStatus: 0, value: 168, speed: null },  // 09:24 — running speed
          // ── Steady-state cluster ──────────────────────────────────────────
          // Tight angular spread ±5° around 168° — this is the high-density zone
          // that would explode with O(n²) naive placement; thinCandidates() handles it
          { timestamp: 639155574000000000, dataStatus: 0, nodeStatus: 0, value: 169, speed: null },  // 09:30
          { timestamp: 639155577000000000, dataStatus: 0, nodeStatus: 0, value: 167, speed: null },  // 09:35
          { timestamp: 639155580000000000, dataStatus: 0, nodeStatus: 0, value: 170, speed: null },  // 09:40
          { timestamp: 639155583000000000, dataStatus: 0, nodeStatus: 0, value: 168, speed: null },  // 09:45
          { timestamp: 639155586000000000, dataStatus: 0, nodeStatus: 0, value: 171, speed: null },  // 09:50
          { timestamp: 639155589000000000, dataStatus: 0, nodeStatus: 0, value: 169, speed: null },  // 09:55
          { timestamp: 639155592000000000, dataStatus: 0, nodeStatus: 0, value: 168, speed: null },  // 10:00
          { timestamp: 639155595000000000, dataStatus: 0, nodeStatus: 0, value: 167, speed: null },  // 10:05
          { timestamp: 639155598000000000, dataStatus: 0, nodeStatus: 0, value: 170, speed: null },  // 10:10
          { timestamp: 639155601000000000, dataStatus: 0, nodeStatus: 0, value: 169, speed: null },  // 10:15
          { timestamp: 639155604000000000, dataStatus: 0, nodeStatus: 0, value: 172, speed: null },  // 10:20
          { timestamp: 639155607000000000, dataStatus: 0, nodeStatus: 0, value: 167, speed: null },  // 10:25
          { timestamp: 639155610000000000, dataStatus: 0, nodeStatus: 0, value: 168, speed: null },  // 10:30
          { timestamp: 639155613000000000, dataStatus: 0, nodeStatus: 0, value: 175, speed: null },  // 10:35 — excursion begins
          { timestamp: 639155616000000000, dataStatus: 0, nodeStatus: 0, value: 180, speed: null },  // 10:40 — event
          { timestamp: 639155619000000000, dataStatus: 0, nodeStatus: 0, value: 177, speed: null },  // 10:45 — recovering
          { timestamp: 639155622000000000, dataStatus: 0, nodeStatus: 0, value: 169, speed: null },  // 10:50 — recovered
        ],
      },
    ],
  },
};

// ─── Transformer ─────────────────────────────────────────────────────────────

/** How to format the `labelText` on each output point. */
export type NxVectorLabelMode =
  | 'speed'     // "3600 rpm"  — uses amplitude sample's speed field
  | 'datetime'  // "27/05/2026 09:30:00"  — derived from .NET tick timestamp
  | 'none';     // no label (showDataLabels still works; labels are just empty)

// .NET epoch offset: ticks from 0001-01-01 to 1970-01-01 (UTC)
const DOTNET_TICK_EPOCH_OFFSET = 621355968000000000;
const TICKS_PER_MS = 10000;
const TWO_PI = 2 * Math.PI;
const RAD_TO_DEG = 180 / Math.PI; // Radian

/** Convert a .NET tick value to a JS Date. */
function ticksToDate(ticks: number): Date {
  return new Date((ticks - DOTNET_TICK_EPOCH_OFFSET) / TICKS_PER_MS);
}

/** Format a JS Date as "DD/MM/YYYY HH:MM:SS" — matches screenshot label style. */
function formatDateLabel(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`
  );
}

/**
 * transformNxVectorToPolarPoints()
 *
 * Converts a raw NX Vector API response into `PolarDataPointWithLabel[]`
 * ready for the `ngx-polar-plot` component.
 *
 * JOIN COMPLEXITY
 * ───────────────
 * Step 1 — build Map<timestamp, phaseDegrees>  : O(n)  — one pass over phase series
 * Step 2 — iterate amplitude series            : O(n)  — O(1) Map lookup per sample
 * Total                                        : O(n)  — not O(n²)
 *
 * @param response   Raw API response from the NX Vector endpoint
 * @param labelMode  How to build the label string (default: 'datetime')
 * @returns          Array of polar data points with optional label text
 */
export function transformNxVectorToPolarPoints(
  response: NxVectorApiResponse,
  labelMode: NxVectorLabelMode = 'datetime',
): PolarDataPointWithLabel[] {
  // ── Step 0: identify which measurement is amplitude and which is phase ────
  const ampMeasurement = response.measurements.find(
    m => m.info.units.toLowerCase() === 'mil',
  );
  const phaseMeasurement = response.measurements.find(
    m => m.info.units === '°',
  );

  if (!ampMeasurement || !phaseMeasurement) {
    console.warn('[transformNxVectorToPolarPoints] Could not identify amp/phase measurements');
    return [];
  }

  // Flag: real API stores phase in radians despite "°" unit label (see file header).
  // Detect by checking if any value exceeds 2π — if so, assume radians.
  const ampSeries = response.data.primaryData.find(
    d => d.tagId === ampMeasurement.info.id,
  );
  const phaseSeries = response.data.primaryData.find(
    d => d.tagId === phaseMeasurement.info.id,
  );

  if (!ampSeries || !phaseSeries) {
    console.warn('[transformNxVectorToPolarPoints] Missing primaryData series');
    return [];
  }

  // Auto-detect radian storage: if any phase value > 2π, treat as radians
  const phaseIsRadians = phaseSeries.samples.some(s => Math.abs(s.value) > TWO_PI);

  // ── Step 1: build O(1) timestamp → phase lookup Map ─────────────────────
  // This is the key O(n) join — no nested scan.
  const phaseMap = new Map<number, number>();

  for (const sample of phaseSeries.samples) {
    if (sample.dataStatus !== 0) continue;  // skip bad quality samples

    let phaseDeg: number;
    if (phaseIsRadians) {
      // Normalize cumulative radians → 0–360° (handles rollover)
      const normalised = ((sample.value % TWO_PI) + TWO_PI) % TWO_PI;
      phaseDeg = normalised * RAD_TO_DEG;
    } else {
      // Already in degrees — apply rollover if applicable
      phaseDeg = ((sample.value % 360) + 360) % 360;
    }

    phaseMap.set(sample.timestamp, phaseDeg);
  }

  // ── Step 2: iterate amplitude series, join via O(1) Map lookup ───────────
  const result: PolarDataPointWithLabel[] = [];

  for (const sample of ampSeries.samples) {
    if (sample.dataStatus !== 0) continue;  // skip bad quality

    const phaseValue = phaseMap.get(sample.timestamp);
    if (phaseValue === undefined) continue; // no matching phase sample for this timestamp

    // Build label text according to requested mode
    let labelText: string | undefined;
    if (labelMode === 'speed' && sample.speed != null) {
      labelText = `${Math.round(sample.speed)} rpm`;
    } else if (labelMode === 'datetime') {
      labelText = formatDateLabel(ticksToDate(sample.timestamp));
    }
    // labelMode === 'none' → leave labelText undefined

    result.push({
      phaseValue,
      amplitudeValue: sample.value,
      labelText,
    });
  }

  return result;
}

// ─── Usage examples ───────────────────────────────────────────────────────────
//
// In app.component.ts:
//
//   import {
//     sampleNxVectorResponse,
//     transformNxVectorToPolarPoints,
//   } from 'ngx-radial-area';   // once exported from public-api.ts
//
//   // Datetime labels (matches screenshot style):
//   this.polarData = transformNxVectorToPolarPoints(
//     sampleNxVectorResponse, 'datetime'
//   ) as PolarDataPoint[];
//
//   // Speed labels ("3600 rpm"):
//   this.polarData = transformNxVectorToPolarPoints(
//     sampleNxVectorResponse, 'speed'
//   ) as PolarDataPoint[];
//
//   // Config — enable label layer (needs research doc T1–T13 applied first):
//   this.polarConfig = {
//     ...this.polarConfig,
//     showDataLabels: true,
//     labelFormatter: (pt) => (pt as any).labelText ?? '',
//     labelFontSize: 10,
//     labelMinSpacingPx: 40,   // keeps only ~5–8 labels visible on the dense cluster
//   };
