/*
 * Public API Surface of ngx-radial-area
 */

export * from './lib/radial-area.models';
export * from './lib/radial-area.service';
export * from './lib/ngx-radial-area.component';

export * from './lib/polar-plot.models';
export * from './lib/polar-plot.service';
export * from './lib/ngx-polar-plot.component';

// ── Label placement utilities ─────────────────────────────────────────────────
// Consumers can import LabelPoint / PlaceLabelOptions if building custom
// label arrays outside the component (e.g. server-rendered label positions).
export type { LabelPoint, LabelRect, PlaceLabelOptions, DrawLabelFn } from './lib/label-placement';

// ── NX Vector data adapter ────────────────────────────────────────────────────
// Interfaces, sample data, and O(1) transformer for real NX Vector API responses.
export type {
  NxVectorApiResponse,
  NxVectorMeasurement,
  NxVectorMeasurementInfo,
  NxVectorPrimaryData,
  NxVectorSample,
  NxVectorLabelMode,
  PolarDataPointWithLabel,
} from './lib/nx-vector-polar-mock';
export {
  sampleNxVectorResponse,
  transformNxVectorToPolarPoints,
} from './lib/nx-vector-polar-mock';

// ── CSV polar data adapter ────────────────────────────────────────────────────
// Real compressor data from polarData1.csv (3713 valid points, degrees).
export type { CsvPolarPoint, CsvLabelMode } from './lib/csv-polar-data';
export { csvPolarData, transformCsvToPolarPoints } from './lib/csv-polar-data';
