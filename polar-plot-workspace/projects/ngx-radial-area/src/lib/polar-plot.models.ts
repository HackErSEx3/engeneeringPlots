export interface PolarDataPoint {
  phaseValue: number;      // logical degrees from 0°; render start/direction comes from config
  amplitudeValue: number;  // any real number
  // ── Label support (Stage 2 data — does not affect the curve geometry) ──────
  // Set this on individual points to show a static label at that dot position.
  // When labelFormatter is also set on PolarPlotConfig, labelText takes priority.
  labelText?: string;      // e.g. "3600 rpm"  or  "27/05/2026 10:10:12"
}

export interface PolarPlotConfig {
  width?: number;
  height?: number;
  innerRadius?: number;
  padding?: number;
  showGrid?: boolean;
  showSpokes?: boolean;
  showAngularLabels?: boolean;
  showRadialLabels?: boolean;
  gridTicks?: number;
  spokesEvery?: number;          // degrees between spokes — default 30
  lineColor?: string;
  areaOpacity?: number;
  showArea?: boolean;
  showLine?: boolean;
  showDots?: boolean;
  dotRadius?: number;
  animationDuration?: number;
  darkMode?: boolean;
  closedCurve?: boolean;         // connect last point back to first — default false
  emptyAmplitudeMax?: number;    // amplitude range when data is empty — default 100
  dotThreshold?: number;         // auto-hide dots above this count — default 500
  showVector?: boolean;          // draw line from origin to cursor — default true
  minorAmplitudeTicks?: number;  // unlabelled ticks between major amplitude rings — default 4
  startAngle?: number;           // where 0° renders, degrees from 12 o'clock CW — default 0
  clockwise?: boolean;           // true = CW increasing angles — default true
  // ── Data label layer (Stage 2) ───────────────────────────────────────────
  // Labels are independent of the curve. The curve always renders all points.
  // Labels are a sparse overlay — only a readable subset is shown at once.
  showDataLabels?: boolean;      // master switch — default false
  /** Called once per candidate point to produce its label string.
   *  Overridden per-point by PolarDataPoint.labelText when present.
   *  Example: (pt) => `${pt.speed} rpm`  or  (pt) => formatDateTime(pt.timestamp) */
  labelFormatter?: (pt: PolarDataPoint) => string;
  labelFontSize?: number;        // px — default 10
  /** Minimum pixel distance between two labelled points (thinning pre-pass).
   *  Increase for denser datasets; reduce to show more labels. Default 40. */
  labelMinSpacingPx?: number;
  /** Apply thinning pre-pass only when candidate count exceeds this value.
   *  Below this threshold the spatial grid alone is used. Default 2000. */
  labelThreshold?: number;
}
