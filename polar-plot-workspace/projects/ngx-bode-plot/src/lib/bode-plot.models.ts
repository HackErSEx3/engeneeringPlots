// ── Status per sample ─────────────────────────────────────────────────────────
export type StatusPoint = 'Valid' | 'Invalid' | 'Overrange' | 'Underrange';

// ── Style ─────────────────────────────────────────────────────────────────────
export interface CurveStyle {
  color: string;
  lineWidth?: number;
  dashArray?: string;
  activeOpacity?: number;
  inactiveOpacity?: number;
}

// ── A single trace (amplitude or phase) ───────────────────────────────────────
export interface BodeCurve {
  curveNumber: number;
  xValues: number[];
  yValues: number[];
  xStatus?: StatusPoint[];
  yStatus?: StatusPoint[];
  timestampsUtc?: number[];
  style: CurveStyle;
}

// ── Composite curve — the primary user-facing unit ────────────────────────────
export interface BodeCompositeCurve {
  primaryCurveNumber: number;
  amplitude: BodeCurve;
  phase?: BodeCurve;
  curveType: 'primary' | 'comparison';
  isActive: boolean;
  label?: string;
  comparisonReferenceSetId?: string;
}

// ── Axis state ────────────────────────────────────────────────────────────────
export type XUnit = 'RPM' | 'Hz' | 'RadPerSec';
export type PhaseMode = 'rollover' | 'clamped-360';

export interface BodeAxisState {
  xRange: [number, number];
  yAmpRange: [number, number];
  yPhaseRange: [number, number];
  xUnit: XUnit;
  yAmpUnit: string;
  yAmpSubUnit?: string;
  phaseRolloverEnabled: boolean;
}

// ── Cursor state ──────────────────────────────────────────────────────────────
export interface BodeCursorState {
  cursorIndex: 0 | 1;
  xValue: number;
  timestampUtc?: number;
  ampValue: number;
  phaseValue?: number;
  isInvalid: boolean;
}

// ── Zoom history entry ────────────────────────────────────────────────────────
export interface BodeZoomState {
  xRange: [number, number];
  yAmpRange: [number, number];
  yPhaseRange: [number, number];
}

// ── Config (Angular @Input) ───────────────────────────────────────────────────
export interface BodePlotConfig {
  width: number;
  height: number;
  padding: { top: number; right: number; bottom: number; left: number };
  ampRegionRatio: number;
  gutter: number;
  gridTicksX: number;
  gridTicksY: number;
  animationDuration: number;
  darkMode: boolean;
  enableCursorA: boolean;
  enableCursorB: boolean;
  showComparison: boolean;
  invalidGapPolicy: 'break-line' | 'skip-point';
}

export const DEFAULT_BODE_CONFIG: BodePlotConfig = {
  width: 900,
  height: 560,
  padding: { top: 24, right: 40, bottom: 40, left: 60 },
  ampRegionRatio: 0.55,
  gutter: 24,
  gridTicksX: 8,
  gridTicksY: 5,
  animationDuration: 250,
  darkMode: false,
  enableCursorA: true,
  enableCursorB: false,
  showComparison: true,
  invalidGapPolicy: 'break-line',
};

// ── Service callbacks ─────────────────────────────────────────────────────────
export interface BodePlotCallbacks {
  onAxisChange?: (s: BodeAxisState) => void;
  onCursorChange?: (c: BodeCursorState[]) => void;
  onActiveChange?: (n: number) => void;
}
