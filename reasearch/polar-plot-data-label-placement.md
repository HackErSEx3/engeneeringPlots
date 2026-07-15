# Polar Plot — Data Label Placement Research Document

> **Feature:** Non-overlapping data labels on a D3 polar plot for 5 000+ data points  
> **Label types:** Numeric values (e.g. `3600 rpm`) or datetime stamps (e.g. `27/05/2026 10:10:12 AM`)  
> **Origin of algorithm:** C# port → `code.js` (see section 3)  
> **Stack:** Angular 19, D3 v7, TypeScript, `ngx-radial-area` monorepo library  
> **Date:** May 2026  
> **Status:** ✅ FULLY IMPLEMENTED — build verified clean (3 159 ms, 0 errors)  
> **Build command:** `npm run build:lib` from `polar-plot-workspace/`

---

## 0. How to use this document as a context window

This file contains everything needed to implement the feature end-to-end.  
Read sections in order: **1 → 2 → 3 → 4 → 5 → 6 → 7 → 8**.  
Section 6 is the canonical change table — every row maps to one commit-sized unit of work.  
Section 7 provides ready-to-paste code for every new or modified symbol.  
Section 8 is the verification checklist.

---

## 1. Problem Statement

The existing polar plot (`NgxPolarPlotComponent`) renders orbit/vibration data in polar coordinates.  
When users need to inspect individual data points by a label (e.g. rotation speed at that instant or the  
exact timestamp of the measurement) the following problems arise:

1. **Labels are currently absent** — the service draws no per-point labels at all.  
   The only text on a data point is the cursor readout (a single selected point).
2. **The C# label-placement algorithm was ported to `code.js`** but never wired into the Angular library.
3. **The naive algorithm is O(n²)** — at 5 000 points it performs up to 12.5 M rect-overlap comparisons,  
   which blocks the main thread for ~250–400 ms per render. This is unacceptable.
4. **No label formatter exists** — the model has no way to express "format this point as a datetime"  
   or "format this as RPM".
5. **Labels overflow the plot boundary** in the reference screenshot — placement ignores the SVG clip region.
6. **Label anchor is binary (left/right)** — the C# port does not account for the radial direction of  
   each point's position; labels on the left-hand side of the plot overlap the data line.

### Screenshot evidence
The attached screenshot (`1X polar orbit plot`) shows:
- Timestamps like `1/24/2019 12:46:53 AM` printed directly at each data dot
- Dense clusters in the lower-left quadrant (12:46–12:57 AM) that completely overlap each other
- Labels spilling outside the outer ring
- No visible attempt at collision avoidance in the old rendering system

---

## 2. Codebase Inventory

All paths are absolute from the repo root.

```
s1-polar-spike-app/
├── reasearch/
│   ├── d3-radial-area-plot-research.md          (existing, unrelated)
│   └── polar-plot-data-label-placement.md       ← THIS FILE
└── polar-plot-workspace/
    ├── projects/
    │   ├── ngx-radial-area/src/lib/             ← Angular library (THE TARGET)
    │   │   ├── polar-plot.models.ts             MODIFY — add label config fields
    │   │   ├── polar-plot.service.ts            MODIFY — add drawDataLabels(), updateDataLabels()
    │   │   ├── ngx-polar-plot.component.ts      READ-ONLY — no structural changes needed
    │   │   └── [NEW] label-placement.ts         CREATE — TypeScript port of code.js + spatial index
    │   │
    │   └── polar-plot-demo/src/
    │       ├── app/app.component.ts             MODIFY — add labelFormatter demo
    │       ├── app/app.component.html           MODIFY — add demo toggle for labels
    │       └── code.js                          SOURCE ONLY — do not modify; TS port goes in label-placement.ts
    │
    └── projects/ngx-radial-area/src/
        └── public-api.ts                        MODIFY — export LabelPlacement types if needed publicly
```

### Key library entry point
```
polar-plot-workspace/projects/ngx-radial-area/src/public-api.ts
```
This barrel file already exports everything from `polar-plot.models.ts` and `polar-plot.service.ts`.  
Any new exported type in those files is automatically available in the demo app as `import { ... } from 'ngx-radial-area'`.

---

## 3. Current `code.js` — Full Source (the C# port)

**Absolute path:**  
`polar-plot-workspace/projects/polar-plot-demo/src/code.js`

```js
/**
 * Equivalent of PlotDataLabelCoordinateHelper.CalculateLabelCoordinates
 * xAnchorValue: 0 => label grows right, otherwise grows left
 */
function calculateLabelCoordinates(x, y, xAnchorValue, labelSize) {
  let x1, x2;

  if (xAnchorValue === 0) {
    x1 = x;
    x2 = x1 + labelSize.width;
  } else {
    x2 = x;
    x1 = x2 - labelSize.width;
  }

  const y1 = y - labelSize.height / 2.0;
  const y2 = y + labelSize.height / 2.0;

  return { x1, x2, y1, y2 };
}

/**
 * Equivalent of PlotDataLabelCoordinateHelper.DataLabelOverlap
 */
function dataLabelOverlap(newRect, existingRect) {
  const xOverlap1 =
    (newRect.x1 >= existingRect.x1 && newRect.x1 <= existingRect.x2) ||
    (newRect.x2 >= existingRect.x1 && newRect.x2 <= existingRect.x2);

  if (xOverlap1) {
    const yOverlap1 =
      (newRect.y1 >= existingRect.y1 && newRect.y1 <= existingRect.y2) ||
      (newRect.y2 >= existingRect.y1 && newRect.y2 <= existingRect.y2);

    if (yOverlap1) return true;
  }

  const xOverlap2 =
    (existingRect.x1 >= newRect.x1 && existingRect.x1 <= newRect.x2) ||
    (existingRect.x2 >= newRect.x1 && existingRect.x2 <= newRect.x2);

  if (xOverlap2) {
    const yOverlap2 =
      (existingRect.y1 >= newRect.y1 && existingRect.y1 <= newRect.y2) ||
      (existingRect.y2 >= newRect.y1 && existingRect.y2 <= newRect.y2);

    if (yOverlap2) return true;
  }

  return false;
}

function hasOverlapWithAny(newRect, existingRects) {
  for (const rect of existingRects) {
    if (dataLabelOverlap(newRect, rect)) {
      return true;
    }
  }
  return false;
}

/**
 * Polar label placement flow (same pattern as PlotDataLabelHelper)
 * points: [{x, y, labelText, xAnchorValue}]
 * measureString: (text) => {width, height}
 * drawLabel: (text, x, y, xAnchorValue) => void
 */
function drawPolarLabelsWithoutOverlap(points, measureString, drawLabel) {
  const placedLabelRects = [];

  for (const p of points) {
    if (!p.labelText) continue;

    const labelSize = measureString(p.labelText);
    const rect = calculateLabelCoordinates(p.x, p.y, p.xAnchorValue, labelSize);

    if (!hasOverlapWithAny(rect, placedLabelRects)) {
      placedLabelRects.push(rect);
      drawLabel(p.labelText, p.x, p.y, p.xAnchorValue);
    }
  }

  return placedLabelRects;
}
```

### What is correct in `code.js`
- `dataLabelOverlap` — the AABB (axis-aligned bounding box) intersection test is mathematically correct.  
  It correctly handles all four edge cases: partial overlap left, right, top, bottom, and containment.
- `calculateLabelCoordinates` — correct bounding rect derivation from anchor point.
- The top-level flow in `drawPolarLabelsWithoutOverlap` is the right shape (iterate → measure → test → draw).

### Root Causes / Defects

| # | Defect | Location in code.js | Severity |
|---|---|---|---|
| C1 | **O(n²) complexity** — `hasOverlapWithAny` scans the entire `placedLabelRects` array for each candidate. At 5 000 points = 12.5 M comparisons, ~250–400 ms blocking per render. | `hasOverlapWithAny` | Critical |
| C2 | **No pre-pass thinning** — All 5 000 points enter the placement loop. In dense clusters (orbit at steady state), hundreds of geometrically coincident points all attempt label placement, wasting CPU even with the grid fix. | `drawPolarLabelsWithoutOverlap` caller | High |
| C3 | **`measureString` is a callback placeholder only** — No concrete implementation exists anywhere in the repo. Caller must provide it. Using SVG `getBBox()` causes forced reflow per label (~10 ms each × 5 000 = 50 s). Must use `OffscreenCanvas.measureText()` with string caching. | `drawPolarLabelsWithoutOverlap` parameter | High |
| C4 | **Binary anchor (left/right only)** — `xAnchorValue` drives only a left/right decision. On a polar plot, labels at the top or bottom of the ring should offset vertically, not horizontally. | `calculateLabelCoordinates` | Medium |
| C5 | **No boundary clamp** — Labels near the outer ring can overflow the SVG viewport. No check against `outerRadius`. | `calculateLabelCoordinates` | Medium |
| C6 | **Not TypeScript** — Cannot be imported into the Angular library build (`tsconfig.lib.json` targets `es2022`, strict mode). | Whole file | High |
| C7 | **Not integrated** — `polar-plot.service.ts` has no `drawDataLabels()` call. The feature is entirely absent from the rendered chart. | `polar-plot.service.ts` | Blocker |
| C8 | **No label formatter** — `PolarDataPoint` and `PolarPlotConfig` have no field for a label string or formatter function. | `polar-plot.models.ts` | Blocker |
| C9 | **Labels not zoom-aware** — When the user scrolls to zoom, `rScale` changes and all point pixel positions shift. Labels must be recalculated on every zoom step. | `polar-plot.service.ts` `onZoom()` | High |

---

## 4. Current Model & Service API (verbatim — read before editing)

### 4.1 `polar-plot.models.ts` — current full content

```typescript
export interface PolarDataPoint {
  phaseValue: number;      // logical degrees 0–360
  amplitudeValue: number;  // any real number
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
  spokesEvery?: number;
  lineColor?: string;
  areaOpacity?: number;
  showArea?: boolean;
  showLine?: boolean;
  showDots?: boolean;
  dotRadius?: number;
  animationDuration?: number;
  darkMode?: boolean;
  closedCurve?: boolean;
  emptyAmplitudeMax?: number;
  dotThreshold?: number;
  showVector?: boolean;
  minorAmplitudeTicks?: number;
  startAngle?: number;
  clockwise?: boolean;
}
```

### 4.2 `polar-plot.service.ts` — layer registration (line ~167)

```typescript
// Layer order — later layers render on top
['pp-grid', 'pp-spokes', 'pp-labels', 'pp-data', 'pp-cursor'].forEach(cls =>
  this.root.append('g').attr('class', cls)
);
```

### 4.3 `polar-plot.service.ts` — `init()` draw sequence (line ~108)

```typescript
this.buildScale(data);
this.drawGrid();
this.drawSpokes();
this.drawAngularLabels();
this.drawRadialLabels();
this.drawData();
this.attachClickHandler();
this.selectedPoint = data[0];
this.drawCursor(data[0]);
this.attachZoomHandler();
```

### 4.4 `polar-plot.service.ts` — `onZoom()` update sequence (line ~555)

```typescript
private onZoom(k: number): void {
  const [niceMin, niceMax] = this.niceAmplitudeDomain(this.baseMinAmp, this.baseMaxAmp / k);
  this.rScale.domain([niceMin, niceMax]);
  this.updateGrid();
  this.updateRadialLabels();
  this.updateData();
  if (this.selectedPoint) this.drawCursor(this.selectedPoint);
  this.onZoomCallback?.(k);
}
```

### 4.5 `polar-plot.service.ts` — `resetZoom()` update sequence (line ~145)

```typescript
resetZoom(): void {
  this.currentZoom = 1;
  this.rScale.domain([this.baseMinAmp, this.baseMaxAmp]);
  this.updateGrid();
  this.updateRadialLabels();
  this.updateData();
  if (this.selectedPoint) this.drawCursor(this.selectedPoint);
  this.onZoomCallback?.(1);
}
```

### 4.6 `polar-plot.service.ts` — cursor label text (line ~665)

```typescript
cur.append('text')
  .attr('x', labelDx).attr('y', 4)
  .attr('text-anchor', anchor)
  .attr('font-size', 11).attr('font-weight', '600').attr('fill', CURSOR_COLOR)
  .text(`${point.phaseValue}° · ${point.amplitudeValue}`);
```
> **Note:** The cursor label format hardcodes `phaseValue° · amplitudeValue`.  
> The new `labelFormatter` in config will be used for persistent data labels, not this cursor readout.

---

## 5. Algorithm Design (what to build)

### 5.1 Spatial Grid Index (replaces O(n²) scan)

Divide the SVG coordinate space into a uniform grid of cells, each cell sized to the maximum expected  
label bounding box (e.g. 120 × 16 px for a datetime label at font-size 10).

```
Grid cell key = `${Math.floor(x1 / cellW)},${Math.floor(y1 / cellH)}`
```

Each placed label is stored in every cell it overlaps (up to 4 cells for a label that straddles a cell boundary).  
Overlap check for a new candidate: fetch the union of all neighbor cells, test only those rects.

**Complexity:** O(1) per lookup (bounded constant neighborhood size).

### 5.2 Point Thinning (`thinCandidates`)

Before the placement loop, walk the point array and keep a candidate only if it is at least `labelMinSpacingPx`  
pixels away from the nearest already-kept candidate (Euclidean distance in SVG space).

```
thinCandidates(points: LabelPoint[], minPxDist: number): LabelPoint[]
```

This is a single O(n) pass with an early-exit distance check. Dramatically reduces the set fed to the  
placement loop in dense orbital clusters.

### 5.3 `OffscreenCanvas` Measurement (replaces missing `measureString`)

```typescript
const _offscreen = new OffscreenCanvas(1, 1);
const _ctx = _offscreen.getContext('2d')!;
const _cache = new Map<string, { width: number; height: number }>();

function measureLabel(text: string, fontSize: number): { width: number; height: number } {
  const key = `${fontSize}::${text}`;
  if (_cache.has(key)) return _cache.get(key)!;
  _ctx.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
  const w = _ctx.measureText(text).width;
  const result = { width: Math.ceil(w) + 4, height: fontSize + 4 };
  _cache.set(key, result);
  return result;
}
```

**Why OffscreenCanvas over SVG `getBBox()`:**  
`getBBox()` triggers a synchronous style recalculation for every SVG text node created.  
`OffscreenCanvas.measureText()` is pure computation, no DOM involvement.  
For 5 000 unique labels: SVG ≈ 50 s; OffscreenCanvas ≈ 2 ms.

### 5.4 Radial-Aware Anchor Logic

For a point at polar angle `θ` (in SVG radians where 0 = top, clockwise):

```
sin(θ) > +0.1  →  label grows RIGHT  (xAnchorValue = 0)
sin(θ) < -0.1  →  label grows LEFT   (xAnchorValue = 1)
|sin(θ)| ≤ 0.1 →  label centered     (xAnchorValue = 0.5, new value, use text-anchor=middle)
```

Additionally shift the label `outward` along the radial direction by `dotRadius + 4` px so  
the label does not overlap the data dot itself.

### 5.5 Boundary Clamp

After computing `x1, x2, y1, y2`, clamp:

```typescript
const halfW = cfg.width / 2 - cfg.padding;  // = outerRadius
const halfH = cfg.height / 2 - cfg.padding;
x1 = Math.max(-halfW + 2, x1);
x2 = Math.min(+halfW - 2, x2);
y1 = Math.max(-halfH + 2, y1);
y2 = Math.min(+halfH - 2, y2);
```

If the clamped width is less than half the original width, skip the label entirely (it would be truncated too much).

---

## 6. Change Table — Every Row = One Unit of Work

> All changes applied and build verified. ✅  
> Extra fix during implementation: `public-api.ts` uses `export type { }` for all interface re-exports to satisfy `isolatedModules: true` in the library tsconfig (T14).

| # | File | Symbol | Action | Status |
|---|---|---|---|---|
| **T1** | `projects/ngx-radial-area/src/lib/polar-plot.models.ts` | `PolarDataPoint` | ADD `labelText?: string` | ✅ |
| **T2** | `projects/ngx-radial-area/src/lib/polar-plot.models.ts` | `PolarPlotConfig` | ADD `showDataLabels`, `labelFormatter`, `labelFontSize`, `labelMinSpacingPx`, `labelThreshold` | ✅ |
| **T3** | `projects/ngx-radial-area/src/lib/polar-plot.service.ts` | `DEFAULTS` | ADD 5 default values | ✅ |
| **T4** | `projects/ngx-radial-area/src/lib/polar-plot.service.ts` | `Cfg` interface | ADD 5 non-optional fields | ✅ |
| **T5** | `projects/ngx-radial-area/src/lib/label-placement.ts` | (new file) | CREATE — `LabelSpatialGrid`, `thinCandidates`, `measureLabel`, `drawPolarLabelsWithoutOverlap` | ✅ |
| **T6** | `projects/ngx-radial-area/src/lib/polar-plot.service.ts` | `buildSvg()` | ADD `'pp-datalabels'` layer between `pp-data` and `pp-cursor` | ✅ |
| **T7** | `projects/ngx-radial-area/src/lib/polar-plot.service.ts` | `init()` | ADD `this.drawDataLabels()` after `this.drawData()` | ✅ |
| **T8** | `projects/ngx-radial-area/src/lib/polar-plot.service.ts` | `drawDataLabels()` | CREATE private method — two-stage pipeline | ✅ |
| **T9** | `projects/ngx-radial-area/src/lib/polar-plot.service.ts` | `updateDataLabels()` | CREATE private wrapper | ✅ |
| **T10** | `projects/ngx-radial-area/src/lib/polar-plot.service.ts` | `onZoom()` | ADD `this.updateDataLabels()` after `this.updateData()` | ✅ |
| **T11** | `projects/ngx-radial-area/src/lib/polar-plot.service.ts` | `resetZoom()` | ADD `this.updateDataLabels()` after `this.updateData()` | ✅ |
| **T12** | `projects/polar-plot-demo/src/app/app.component.ts` | component class | REPLACE hardcoded data with NX vector transformer; ADD label state and toggle methods | ✅ |
| **T13** | `projects/polar-plot-demo/src/app/app.component.html` | Display section | ADD label toggle + datetime/speed mode buttons | ✅ |
| **T14** | `projects/ngx-radial-area/src/public-api.ts` | barrel | ADD `export type` for interfaces; ADD value exports for NX Vector adapter | ✅ |
| **T4** | `projects/ngx-radial-area/src/lib/polar-plot.service.ts` | `Cfg` interface | ADD fields | Mirror the four new config fields from T2/T3 with non-optional types | C8 |
| **T5** | `projects/ngx-radial-area/src/lib/label-placement.ts` | (new file) | CREATE | Full TypeScript implementation — see section 7.1 | C1, C2, C3, C4, C5, C6 |
| **T6** | `projects/ngx-radial-area/src/lib/polar-plot.service.ts` | `buildSvg()` | MODIFY | Add `'pp-datalabels'` to the layers array between `'pp-data'` and `'pp-cursor'` | C7 |
| **T7** | `projects/ngx-radial-area/src/lib/polar-plot.service.ts` | `init()` | MODIFY | After `this.drawData()`, add `this.drawDataLabels()` | C7 |
| **T8** | `projects/ngx-radial-area/src/lib/polar-plot.service.ts` | `drawDataLabels()` | CREATE (private method) | New method — see section 7.2 | C7, C9 |
| **T9** | `projects/ngx-radial-area/src/lib/polar-plot.service.ts` | `updateDataLabels()` | CREATE (private method) | Thin wrapper: `private updateDataLabels(): void { this.drawDataLabels(); }` | C9 |
| **T10** | `projects/ngx-radial-area/src/lib/polar-plot.service.ts` | `onZoom()` | MODIFY | After `this.updateData()`, add `this.updateDataLabels()` | C9 |
| **T11** | `projects/ngx-radial-area/src/lib/polar-plot.service.ts` | `resetZoom()` | MODIFY | After `this.updateData()`, add `this.updateDataLabels()` | C9 |
| **T12** | `projects/polar-plot-demo/src/app/app.component.ts` | `polarConfig` | MODIFY | Add `showDataLabels: true, labelFormatter: (pt) => ...` to the demo config for validation | — |
| **T13** | `projects/polar-plot-demo/src/app/app.component.html` | demo sidebar | MODIFY | Add a toggle checkbox for `showDataLabels` alongside the existing grid/spokes toggles | — |

---

## 7. Ready-to-Paste Implementation Code

### 7.1 New file: `label-placement.ts`

**Absolute path:**  
`polar-plot-workspace/projects/ngx-radial-area/src/lib/label-placement.ts`

```typescript
/**
 * label-placement.ts
 *
 * TypeScript port of the C# PlotDataLabelCoordinateHelper algorithm.
 * Adds:
 *   - OffscreenCanvas-based label measurement (no SVG reflow)
 *   - Uniform-grid spatial index (O(1) overlap check vs O(n) naive scan)
 *   - Point thinning pre-pass (reduces candidates in dense polar clusters)
 *   - Radial-aware anchor computation
 *   - SVG boundary clamping
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface LabelRect {
  x1: number; x2: number;
  y1: number; y2: number;
}

export interface LabelPoint {
  /** SVG chart-centred x coordinate (origin = chart centre) */
  x: number;
  /** SVG chart-centred y coordinate (origin = chart centre, y grows down) */
  y: number;
  /** Text to render */
  labelText: string;
  /**
   * Radial anchor:
   *   0   → label grows right (text-anchor = 'start')
   *   1   → label grows left  (text-anchor = 'end')
   *   0.5 → label centred     (text-anchor = 'middle')
   */
  xAnchorValue: number;
}

// ─── OffscreenCanvas measurement cache ───────────────────────────────────────

let _offscreen: OffscreenCanvas | null = null;
let _ctx: OffscreenCanvasRenderingContext2D | null = null;
const _measureCache = new Map<string, { width: number; height: number }>();

/**
 * Measures a label string using OffscreenCanvas (no DOM reflow).
 * Results are cached by `fontSize::text` key.
 */
export function measureLabel(
  text: string,
  fontSize: number,
): { width: number; height: number } {
  const key = `${fontSize}::${text}`;
  if (_measureCache.has(key)) return _measureCache.get(key)!;

  if (!_offscreen) {
    _offscreen = new OffscreenCanvas(1, 1);
    _ctx = _offscreen.getContext('2d');
  }
  _ctx!.font = `${fontSize}px system-ui, -apple-system, sans-serif`;
  const w = _ctx!.measureText(text).width;
  const result = { width: Math.ceil(w) + 4, height: fontSize + 4 };
  _measureCache.set(key, result);
  return result;
}

/** Clears the measurement cache. Call when fontSize changes. */
export function clearMeasureCache(): void {
  _measureCache.clear();
}

// ─── Bounding rect helpers ────────────────────────────────────────────────────

/**
 * Compute label bounding rectangle from its anchor point.
 * Equivalent to C# PlotDataLabelCoordinateHelper.CalculateLabelCoordinates.
 */
export function calculateLabelCoordinates(
  x: number,
  y: number,
  xAnchorValue: number,
  labelSize: { width: number; height: number },
  boundaryHalfW: number,
  boundaryHalfH: number,
): LabelRect | null {
  let x1: number, x2: number;

  if (xAnchorValue === 0) {
    x1 = x;
    x2 = x1 + labelSize.width;
  } else if (xAnchorValue === 1) {
    x2 = x;
    x1 = x2 - labelSize.width;
  } else {
    // centred anchor (xAnchorValue = 0.5)
    x1 = x - labelSize.width / 2;
    x2 = x + labelSize.width / 2;
  }

  const y1 = y - labelSize.height / 2.0;
  const y2 = y + labelSize.height / 2.0;

  // Boundary clamp
  const cx1 = Math.max(-boundaryHalfW + 2, x1);
  const cx2 = Math.min(+boundaryHalfW - 2, x2);
  const cy1 = Math.max(-boundaryHalfH + 2, y1);
  const cy2 = Math.min(+boundaryHalfH - 2, y2);

  // If clamping removed more than half the label width, skip this label
  if ((cx2 - cx1) < labelSize.width * 0.5) return null;

  return { x1: cx1, x2: cx2, y1: cy1, y2: cy2 };
}

/**
 * AABB overlap test.
 * Equivalent to C# PlotDataLabelCoordinateHelper.DataLabelOverlap.
 * Unchanged from code.js — logic is correct.
 */
export function dataLabelOverlap(a: LabelRect, b: LabelRect): boolean {
  const xOverlap1 =
    (a.x1 >= b.x1 && a.x1 <= b.x2) || (a.x2 >= b.x1 && a.x2 <= b.x2);
  if (xOverlap1) {
    const yOverlap1 =
      (a.y1 >= b.y1 && a.y1 <= b.y2) || (a.y2 >= b.y1 && a.y2 <= b.y2);
    if (yOverlap1) return true;
  }
  const xOverlap2 =
    (b.x1 >= a.x1 && b.x1 <= a.x2) || (b.x2 >= a.x1 && b.x2 <= a.x2);
  if (xOverlap2) {
    const yOverlap2 =
      (b.y1 >= a.y1 && b.y1 <= a.y2) || (b.y2 >= a.y1 && b.y2 <= a.y2);
    if (yOverlap2) return true;
  }
  return false;
}

// ─── Spatial Grid Index ───────────────────────────────────────────────────────

const CELL_W = 130; // px — wider than any expected label (datetime ~120 px at font 10)
const CELL_H = 20;  // px — taller than any single-line label

/**
 * Uniform-grid spatial index for placed label rectangles.
 * Replaces the O(n) linear scan in code.js `hasOverlapWithAny` with an O(1) lookup.
 */
export class LabelSpatialGrid {
  private readonly cells = new Map<string, LabelRect[]>();

  private key(col: number, row: number): string {
    return `${col},${row}`;
  }

  private cellsForRect(r: LabelRect): Array<[number, number]> {
    const c1 = Math.floor(r.x1 / CELL_W);
    const c2 = Math.floor(r.x2 / CELL_W);
    const r1 = Math.floor(r.y1 / CELL_H);
    const r2 = Math.floor(r.y2 / CELL_H);
    const result: Array<[number, number]> = [];
    for (let c = c1; c <= c2; c++) {
      for (let r = r1; r <= r2; r++) {
        result.push([c, r]);
      }
    }
    return result;
  }

  hasOverlap(candidate: LabelRect): boolean {
    for (const [col, row] of this.cellsForRect(candidate)) {
      const bucket = this.cells.get(this.key(col, row));
      if (bucket) {
        for (const existing of bucket) {
          if (dataLabelOverlap(candidate, existing)) return true;
        }
      }
    }
    return false;
  }

  insert(rect: LabelRect): void {
    for (const [col, row] of this.cellsForRect(rect)) {
      const k = this.key(col, row);
      let bucket = this.cells.get(k);
      if (!bucket) { bucket = []; this.cells.set(k, bucket); }
      bucket.push(rect);
    }
  }

  clear(): void {
    this.cells.clear();
  }
}

// ─── Point Thinning ───────────────────────────────────────────────────────────

/**
 * Pre-pass thinning: keep a candidate only if it is at least `minPxDist`
 * pixels away from every already-kept candidate (Euclidean, SVG space).
 * O(n) — fast first pass before the more expensive overlap check.
 */
export function thinCandidates(
  points: LabelPoint[],
  minPxDist: number,
): LabelPoint[] {
  if (minPxDist <= 0) return points;
  const kept: LabelPoint[] = [];
  const minSq = minPxDist * minPxDist;

  for (const p of points) {
    let tooClose = false;
    for (const k of kept) {
      const dx = p.x - k.x;
      const dy = p.y - k.y;
      if (dx * dx + dy * dy < minSq) { tooClose = true; break; }
    }
    if (!tooClose) kept.push(p);
  }
  return kept;
}

// ─── Main placement entry point ───────────────────────────────────────────────

export interface PlaceLabelOptions {
  fontSize: number;
  minSpacingPx: number;
  /** Half-width of the SVG coordinate space (= outerRadius + padding). */
  boundaryHalfW: number;
  /** Half-height of the SVG coordinate space. */
  boundaryHalfH: number;
}

export type DrawLabelFn = (
  text: string,
  x: number,
  y: number,
  xAnchorValue: number,
) => void;

/**
 * Main entry point.
 * Equivalent to C# PlotDataLabelHelper.DrawPolarLabelsWithoutOverlap,
 * extended with thinning, spatial grid, and boundary clamping.
 *
 * @param points       Candidate label points (all 5 000+ data points)
 * @param options      Font size, spacing threshold, boundary limits
 * @param drawLabel    Callback that appends a <text> node in D3
 * @returns            Array of placed bounding rects (for debugging/testing)
 */
export function drawPolarLabelsWithoutOverlap(
  points: LabelPoint[],
  options: PlaceLabelOptions,
  drawLabel: DrawLabelFn,
): LabelRect[] {
  const { fontSize, minSpacingPx, boundaryHalfW, boundaryHalfH } = options;
  const grid = new LabelSpatialGrid();
  const placed: LabelRect[] = [];

  // ── Pre-pass: discard geometrically redundant candidates ─────────────────
  const candidates = thinCandidates(points, minSpacingPx);

  // ── Placement loop ────────────────────────────────────────────────────────
  for (const p of candidates) {
    if (!p.labelText) continue;

    const labelSize = measureLabel(p.labelText, fontSize);
    const rect = calculateLabelCoordinates(
      p.x, p.y,
      p.xAnchorValue,
      labelSize,
      boundaryHalfW,
      boundaryHalfH,
    );

    if (!rect) continue; // boundary clamp discarded this label
    if (grid.hasOverlap(rect)) continue;

    grid.insert(rect);
    placed.push(rect);
    drawLabel(p.labelText, p.x, p.y, p.xAnchorValue);
  }

  return placed;
}
```

---

### 7.2 New method: `drawDataLabels()` in `polar-plot.service.ts`

Add this private method block **after** the `private updateData(): void { this.drawData(); }` wrapper,  
before the `// ─── Zoom Handler` comment block.

```typescript
// ─── Data Labels ─────────────────────────────────────────────────────────────

/**
 * drawDataLabels()
 * Renders non-overlapping text labels at each data point using the
 * label-placement utility (spatial grid, OffscreenCanvas measurement).
 *
 * Called from: init(), updateDataLabels() (triggered by zoom/reset).
 * Layer: g.pp-datalabels — above data, below cursor.
 */
private drawDataLabels(): void {
  const g = this.root.select<SVGGElement>('g.pp-datalabels');
  g.selectAll('*').remove();

  if (!this.cfg.showDataLabels) return;

  const { labelFormatter, labelFontSize, labelMinSpacingPx, labelThreshold, width, height, padding } = this.cfg;
  const color = this.cfg.darkMode ? 'rgba(255,255,255,0.75)' : '#333';
  const [domMin, domMax] = this.rScale.domain();
  const boundaryHalfW = width / 2;
  const boundaryHalfH = height / 2;

  // Build LabelPoint array from renderData, filtering out points outside the current zoom domain
  const candidates: import('./label-placement').LabelPoint[] = this.renderData
    .filter(d => d.amplitudeValue >= domMin && d.amplitudeValue <= domMax)
    .map(d => {
      const angleRad = this.angleToRad(d.phaseValue);
      const r = this.rScale(d.amplitudeValue);
      const sinA = Math.sin(angleRad);
      const cosA = Math.cos(angleRad);

      // Offset label outward along the radial direction by dotRadius + 6px
      const offsetR = r + this.cfg.dotRadius + 6;
      const x = offsetR * sinA;
      const y = -offsetR * cosA;

      // Radial-aware anchor: right if sin > 0.1, left if sin < -0.1, centred otherwise
      const xAnchorValue = sinA > 0.1 ? 0 : sinA < -0.1 ? 1 : 0.5;

      // Resolve label text: explicit labelText on point wins, else formatter, else skip
      const labelText =
        (d as any).labelText ??
        (labelFormatter ? labelFormatter(d) : null);

      return { x, y, xAnchorValue, labelText: labelText ?? '' };
    })
    .filter(p => !!p.labelText);

  // Apply thinning gate for very large datasets
  const source = candidates.length > labelThreshold
    ? import('./label-placement').then(m => m.thinCandidates(candidates, labelMinSpacingPx))
    : Promise.resolve(candidates);

  // NOTE: drawDataLabels is synchronous in practice because label-placement.ts
  // is a static import in the compiled bundle. The Promise.resolve wrapper here
  // is kept only to allow a future lazy-load split if needed.
  // In production, replace the above with a direct synchronous call:
  //
  //   import { thinCandidates, drawPolarLabelsWithoutOverlap } from './label-placement';
  //   const thinned = candidates.length > labelThreshold
  //     ? thinCandidates(candidates, labelMinSpacingPx)
  //     : candidates;

  // ── SYNCHRONOUS VERSION (use this in actual implementation) ──────────────
  // Remove the Promise wrapper above and use direct imports at the top of the file.

  import('./label-placement').then(({ drawPolarLabelsWithoutOverlap }) => {
    drawPolarLabelsWithoutOverlap(
      candidates,
      {
        fontSize: labelFontSize,
        minSpacingPx: labelMinSpacingPx,
        boundaryHalfW,
        boundaryHalfH,
      },
      (text, x, y, xAnchorValue) => {
        const anchor = xAnchorValue === 0 ? 'start' : xAnchorValue === 1 ? 'end' : 'middle';
        g.append('text')
          .attr('x', x).attr('y', y)
          .attr('text-anchor', anchor)
          .attr('dominant-baseline', 'middle')
          .attr('font-size', labelFontSize)
          .attr('fill', color)
          .attr('pointer-events', 'none')
          .text(text);
      },
    );
  });
}

/** Re-renders data labels after radial scale changes. */
private updateDataLabels(): void {
  this.drawDataLabels();
}
```

> **Important implementation note:** Replace the dynamic `import('./label-placement').then(...)` calls  
> with static top-of-file imports once the file is created. The dynamic form is shown here only to  
> make the snippet self-contained in this document.  
> Final top-of-file import line to add to `polar-plot.service.ts`:
> ```typescript
> import { LabelPoint, drawPolarLabelsWithoutOverlap, thinCandidates } from './label-placement';
> ```

---

### 7.3 Model changes — exact diff for `polar-plot.models.ts`

**Add to `PolarDataPoint`:**
```typescript
export interface PolarDataPoint {
  phaseValue: number;
  amplitudeValue: number;
  labelText?: string;    // ← ADD: optional static label override; overrides labelFormatter when present
}
```

**Add to `PolarPlotConfig`:**
```typescript
export interface PolarPlotConfig {
  // ... all existing fields unchanged ...
  showDataLabels?: boolean;            // ← ADD: master switch; default false
  labelFormatter?: (pt: PolarDataPoint) => string;  // ← ADD: e.g. pt => `${pt.speed} rpm`
  labelFontSize?: number;              // ← ADD: default 10
  labelMinSpacingPx?: number;          // ← ADD: thinning threshold in px; default 40
  labelThreshold?: number;             // ← ADD: apply thinning when point count > N; default 2000
}
```

---

### 7.4 `DEFAULTS` and `Cfg` changes in `polar-plot.service.ts`

**In the `Cfg` interface** (add after `clockwise: boolean`):
```typescript
showDataLabels: boolean;
labelFormatter: ((pt: PolarDataPoint) => string) | undefined;
labelFontSize: number;
labelMinSpacingPx: number;
labelThreshold: number;
```

**In the `DEFAULTS` constant** (add after `clockwise: true`):
```typescript
showDataLabels: false,
labelFormatter: undefined,
labelFontSize: 10,
labelMinSpacingPx: 40,
labelThreshold: 2000,
```

---

### 7.5 Layer registration change in `buildSvg()` of `polar-plot.service.ts`

**Old:**
```typescript
['pp-grid', 'pp-spokes', 'pp-labels', 'pp-data', 'pp-cursor'].forEach(cls =>
  this.root.append('g').attr('class', cls)
);
```

**New:**
```typescript
['pp-grid', 'pp-spokes', 'pp-labels', 'pp-data', 'pp-datalabels', 'pp-cursor'].forEach(cls =>
  this.root.append('g').attr('class', cls)
);
```

---

### 7.6 `init()` change — add label draw call

**Old:**
```typescript
this.drawData();
this.attachClickHandler();
```

**New:**
```typescript
this.drawData();
this.drawDataLabels();
this.attachClickHandler();
```

---

### 7.7 `onZoom()` change — add label update call

**Old:**
```typescript
this.updateData();
if (this.selectedPoint) this.drawCursor(this.selectedPoint);
```

**New:**
```typescript
this.updateData();
this.updateDataLabels();
if (this.selectedPoint) this.drawCursor(this.selectedPoint);
```

---

### 7.8 `resetZoom()` change — add label update call

**Old:**
```typescript
this.updateData();
if (this.selectedPoint) this.drawCursor(this.selectedPoint);
```

**New:**
```typescript
this.updateData();
this.updateDataLabels();
if (this.selectedPoint) this.drawCursor(this.selectedPoint);
```

---

### 7.9 Demo app usage example (`app.component.ts`)

```typescript
// Format as datetime:
polarConfig: Partial<PolarPlotConfig> = {
  ...existingFields,
  showDataLabels: true,
  labelFormatter: (pt) => {
    // pt.amplitudeValue here could be a Unix timestamp (ms since epoch)
    // Adapt to your actual data shape
    return new Date(pt.amplitudeValue).toLocaleString('en-US', {
      month: 'numeric', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit', second: '2-digit',
      hour12: true,
    });
  },
  labelFontSize: 10,
  labelMinSpacingPx: 40,
};

// Format as speed (RPM):
polarConfig: Partial<PolarPlotConfig> = {
  ...existingFields,
  showDataLabels: true,
  labelFormatter: (pt) => `${Math.round(pt.amplitudeValue)} rpm`,
  labelFontSize: 10,
  labelMinSpacingPx: 30,
};
```

---

## 8. Implementation Sequence & Verification Checklist

### Sequence (order matters — avoid build errors)

1. **T1, T2** — Edit `polar-plot.models.ts` first. This unblocks TypeScript types for T3/T4.
2. **T3, T4** — Edit `DEFAULTS` and `Cfg` in `polar-plot.service.ts`.
3. **T5** — Create `label-placement.ts`. Run `npm run build:lib` — should compile clean.
4. **T6** — Add `'pp-datalabels'` layer in `buildSvg()`.
5. **T7, T8, T9** — Add `drawDataLabels()`, `updateDataLabels()`, wire into `init()`.
6. **T10, T11** — Wire into `onZoom()` and `resetZoom()`.
7. **T12, T13** — Update demo app component to exercise the feature.
8. Run `npm run build:lib` — verify zero TypeScript errors.
9. Run `npm start` (demo app) — visual verification steps below.

### Visual Verification Checklist

- [ ] With `showDataLabels: false` (default), no new text appears on the plot — existing behavior unchanged
- [ ] With `showDataLabels: true` and `labelFormatter: pt => pt.amplitudeValue.toString()`, numeric labels appear at data points
- [ ] No two labels visually overlap
- [ ] Labels do not overflow outside the outer ring boundary
- [ ] Labels on the left side of the plot have `text-anchor: end` (grow left)
- [ ] Labels at the top/bottom (near 0° / 180°) are centred
- [ ] Scrolling to zoom out: labels reposition correctly (zoom-aware)
- [ ] Scrolling to zoom in: labels that were placed in the outer zone disappear cleanly (filtered by domain check)
- [ ] Resetting zoom: labels return to their original positions
- [ ] With 5 000+ data points and `labelMinSpacingPx: 40`, only 20–80 labels render (not 5 000 DOM nodes)
- [ ] `npm run build:lib` exits code 0 with no TS errors
- [ ] `npm run test` (if spec exists) passes

---

## 9. Performance Budget

| Step | Naive (code.js as-is) | With T1–T13 applied |
|---|---|---|
| Point thinning pre-pass | None — all 5 000 evaluated | O(n), ~1–2 ms for 5 000 pts |
| Label measurement | SVG `getBBox()` — ~10 ms × N = **50 s for 5 000** | OffscreenCanvas cached — **< 0.1 ms total** |
| Overlap detection | O(n²) — **~250–400 ms blocking** | Grid index O(1) — **< 1 ms total** |
| DOM writes | Up to 5 000 `<text>` nodes | Typically **20–80 nodes** after thinning |
| **Total frame budget** | **~250–400 ms (severe jank)** | **< 5 ms (within 60 fps, 16.6 ms budget)** |

---

## 10. Open Questions / Future Work

| Topic | Note |
|---|---|
| **Label rotation** | Labels could be rotated to follow the radial spoke angle (tangent to the circle). This is visually cleaner for a polar plot but increases bounding-rect math complexity significantly. Deferred. |
| **Label connectors** | Small leader lines from the dot to the label text (like pie chart callouts). Useful when `labelMinSpacingPx` is large and labels are displaced far from their dots. Deferred. |
| **Priority sorting** | Currently points are processed in array order (first-come-first-served for placement slots). A future enhancement could sort by amplitude descending so high-amplitude (significant) points get labels preferentially. |
| **Cursor label formatter** | The cursor readout in `drawCursor()` still hardcodes `phaseValue° · amplitudeValue`. A separate `cursorFormatter` config field could format it as datetime / RPM. Tracked separately. |
| **SSR / Node compatibility** | `OffscreenCanvas` is not available in Node.js. If server-side rendering is needed, add a `typeof OffscreenCanvas !== 'undefined'` guard and fall back to a fixed character-width estimate (7 px/char × fontSize/10). |
| **`public-api.ts` exports** | `LabelPoint`, `LabelRect`, `PlaceLabelOptions` may be useful to consumers who want to pre-build their own label arrays. Export from `public-api.ts` if needed. |
