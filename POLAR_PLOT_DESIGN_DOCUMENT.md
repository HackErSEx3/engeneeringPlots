# ngx-polar-plot — Conceptual Design & Execution Summary

> **Project:** Angular 19 + D3 v7 Polar & Radial Area Chart Library  
> **Library Package:** `ngx-radial-area` (monorepo, `ng-packagr`)  
> **Author:** Staff Software Engineer  
> **Date:** June 2026  
> **Status:** Feature-complete · All tests passing (21 / 21 specs)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Architecture Overview](#2-architecture-overview)
3. [Chart Types Delivered](#3-chart-types-delivered)
4. [Feature Coverage Matrix](#4-feature-coverage-matrix)
5. [D3.js Integration — APIs Used & Why](#5-d3js-integration--apis-used--why)
6. [Data Model Design](#6-data-model-design)
7. [Rendering Pipeline](#7-rendering-pipeline)
8. [Zoom Architecture (Semantic Zoom)](#8-zoom-architecture-semantic-zoom)
9. [Non-Overlapping Label Placement Engine](#9-non-overlapping-label-placement-engine)
10. [Data Adapters — NX Vector & CSV](#10-data-adapters--nx-vector--csv)
11. [Angular Integration Strategy](#11-angular-integration-strategy)
12. [Public API Surface](#12-public-api-surface)
13. [Demo Application](#13-demo-application)
14. [Test Coverage](#14-test-coverage)
15. [Build & Tooling](#15-build--tooling)
16. [Known Constraints & Future Roadmap](#16-known-constraints--future-roadmap)

---

## 1. Executive Summary

This spike delivers a production-ready, reusable Angular library — **`ngx-radial-area`** — that renders vibration and process data in polar/radial coordinate space. The library was designed to solve a specific industrial-monitoring problem: how to display **1X orbit / vibration data** from compressor machinery in a polar (phase vs. amplitude) coordinate system with high point density (3 000–5 000+ points), interactive zoom, and readable per-point labels.

Two chart primitives are exported:

| Component | Use case | Data volume tested |
|---|---|---|
| `NgxPolarPlotComponent` | Phase vs. amplitude — orbit / 1X vibration | 3 713 real compressor points |
| `NgxRadialAreaComponent` | Multi-series radial area — weather, KPI, capacity | 7–12 categorical points per series |

Both components share an Angular-agnostic D3 service layer so the rendering engine can be reused in plain TypeScript or other frameworks without modification.

---

## 2. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         ngx-radial-area library                             │
│  ┌───────────────────────────────┐   ┌──────────────────────────────────┐   │
│  │   NgxPolarPlotComponent       │   │   NgxRadialAreaComponent         │   │
│  │  (selector: ngx-polar-plot)   │   │  (selector: ngx-radial-area)     │   │
│  │                               │   │                                  │   │
│  │  @Input  data[]               │   │  @Input  data[]                  │   │
│  │  @Input  config               │   │  @Input  series[]                │   │
│  │  @Output pointSelected        │   │  @Input  config                  │   │
│  │  @Output zoomChange           │   │  @Output zoomChange (ZoomEvent)  │   │
│  │                               │   │  @Output zoomReset               │   │
│  │  selectPoint(pt)              │   │  showControls / showHint         │   │
│  │  setVector(bool)              │   │                                  │   │
│  │  resetZoom()                  │   │                                  │   │
│  └──────────────┬────────────────┘   └────────────────┬─────────────────┘   │
│                 │ delegates all D3   │ delegates all D3│                     │
│                 ▼                   ▼                                        │
│  ┌────────────────────────┐   ┌────────────────────────┐                    │
│  │   PolarPlotService     │   │   RadialAreaService     │                    │
│  │  (pure D3 engine)      │   │  (pure D3 engine)       │                    │
│  └────────────────────────┘   └────────────────────────┘                    │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  label-placement.ts — O(n) non-overlapping label engine             │    │
│  │  csv-polar-data.ts  — CSV adapter (real compressor data)            │    │
│  │  nx-vector-polar-mock.ts — NX Vector API adapter + mock data        │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
          ▲                                       ▲
          │ consumes                              │ consumes
┌─────────────────────┐               ┌──────────────────────┐
│  polar-plot-demo    │               │  Host application    │
│  (Angular 19 app)   │               │  (any Angular 14+)   │
└─────────────────────┘               └──────────────────────┘
```

### Monorepo Layout

```
polar-plot-workspace/
├── angular.json
├── package.json
├── tsconfig.json            ← paths: "ngx-radial-area" → library source (dev)
└── projects/
    ├── ngx-radial-area/     ← publishable library (ng-packagr)
    │   └── src/lib/
    │       ├── polar-plot.models.ts
    │       ├── polar-plot.service.ts
    │       ├── ngx-polar-plot.component.ts
    │       ├── radial-area.models.ts
    │       ├── radial-area.service.ts
    │       ├── ngx-radial-area.component.ts
    │       ├── label-placement.ts
    │       ├── csv-polar-data.ts
    │       └── nx-vector-polar-mock.ts
    └── polar-plot-demo/     ← consumer demo app (esbuild)
```

---

## 3. Chart Types Delivered

### 3.1 `NgxPolarPlotComponent` — Polar Orbit Plot

Designed for vibration / orbit analysis. Phase is mapped to angle; amplitude to radius. Intended for industrial machinery data such as compressor 1X measurements.

**Visual layers rendered:**

```
SVG
 ├─ <defs><clipPath>       — prevents data overflow outside outerRadius on zoom-in
 └─ <g> (chart root, centred)
     ├─ pp-grid            — concentric rings (zoom-aware), outer boundary, center dot
     ├─ pp-spokes          — radial lines at spokesEvery° intervals (static)
     ├─ pp-labels          — angular labels (0°, 30°…) + amplitude ruler on 0° axis
     ├─ pp-data            — the polar line (+ optional filled area + dots) [clipped]
     ├─ pp-datalabels      — sparse non-overlapping text labels (Stage 2)
     └─ pp-cursor          — interactive crosshair: orange dot, angle arm, projection lines
```

**Key capabilities:**

- Phase in degrees; `startAngle` and `clockwise` controls orientation
- Cursor click → nearest-point selection with orange crosshair + projection lines
- Configurable dot auto-hide threshold (`dotThreshold`) for dense datasets
- Closed or open curve (`closedCurve`)
- Empty-state chart (renders grid with configurable amplitude range when `data = []`)
- Vector line from origin to selected point (toggleable without re-init)

### 3.2 `NgxRadialAreaComponent` — Multi-Series Radial Area

Designed for KPI / process data comparisons. Each category is a spoke; each series is a filled area.

**Key capabilities:**

- N independent series, each with its own `d3.scaleLinear` domain
- Dual-scale: two series can have different units and ranges on the same chart
- Built-in legend, zoom indicator, and reset button rendered in the component template
- `showControls` and `showHint` flags for embed flexibility

---

## 4. Feature Coverage Matrix

| Feature | Component | Status |
|---|---|---|
| Polar line (phase vs. amplitude) | `NgxPolarPlotComponent` | ✅ Implemented |
| Filled area under polar curve | `NgxPolarPlotComponent` | ✅ Implemented |
| Per-point dots with auto-hide threshold | `NgxPolarPlotComponent` | ✅ Implemented |
| Concentric amplitude grid rings | Both | ✅ Implemented |
| Radial spoke lines at configurable intervals | Both | ✅ Implemented |
| Angular degree labels (0°, 30°, 60°...) | Both | ✅ Implemented |
| Amplitude ruler ticks on 0° axis | `NgxPolarPlotComponent` | ✅ Implemented |
| Minor (unlabelled) amplitude ticks | `NgxPolarPlotComponent` | ✅ Implemented |
| Mouse-wheel semantic zoom on amplitude axis | Both | ✅ Implemented |
| rAF throttle for zoom (1 DOM update per frame) | Both | ✅ Implemented |
| Double-click zoom reset | `NgxRadialAreaComponent` | ✅ Implemented |
| Programmatic zoom reset (`resetZoom()`) | `NgxPolarPlotComponent` | ✅ Implemented |
| Click-to-select nearest data point | `NgxPolarPlotComponent` | ✅ Implemented |
| Orange cursor crosshair with vector line | `NgxPolarPlotComponent` | ✅ Implemented |
| Angular + radial projection lines on cursor | `NgxPolarPlotComponent` | ✅ Implemented |
| Non-overlapping data label overlay (Stage 2) | `NgxPolarPlotComponent` | ✅ Implemented |
| Label formatter callback (`labelFormatter`) | `NgxPolarPlotComponent` | ✅ Implemented |
| Per-point label override (`labelText`) | `NgxPolarPlotComponent` | ✅ Implemented |
| Label format modes: datetime / speed (rpm) | `NgxPolarPlotComponent` | ✅ Implemented |
| O(1) spatial-grid overlap check per label candidate | `NgxPolarPlotComponent` | ✅ Implemented |
| OffscreenCanvas text measurement (zero DOM reflow) | `NgxPolarPlotComponent` | ✅ Implemented |
| Candidate thinning pre-pass (`thinCandidates`) | `NgxPolarPlotComponent` | ⚙️ Available in library, not called in current render path |
| SVG boundary clamping for labels | `NgxPolarPlotComponent` | ✅ Implemented |
| Multi-series radial area (dual independent scales) | `NgxRadialAreaComponent` | ✅ Implemented |
| `d3.curveCatmullRomClosed` smooth curves | Both | ✅ Implemented |
| `niceAmplitudeDomain` — equal ring spacing guarantee | Both | ✅ Implemented |
| SVG clip path (no overflow at high zoom) | Both | ✅ Implemented |
| Dark mode support | Both | ✅ Implemented |
| `startAngle` + `clockwise` orientation config | `NgxPolarPlotComponent` | ✅ Implemented |
| Empty state chart (data = []) | `NgxPolarPlotComponent` | ✅ Implemented |
| NX Vector API adapter (radians→degrees, timestamp join) | Adapter | ✅ Implemented |
| CSV adapter (real 3 713-point compressor data) | Adapter | ✅ Implemented |
| `NgZone.runOutsideAngular` for all D3 rendering | Both | ✅ Implemented |
| OnPush change detection | Both | ✅ Implemented |
| `ng-packagr` publishable library build | Library | ✅ Implemented |
| 21 unit-test specs (Jasmine + Karma headless) | Both | ✅ All passing |

---

## 5. D3.js Integration — APIs Used & Why

D3 v7.9 (`@types/d3` 7.4) is the sole rendering dependency. The table below lists every D3 module used, the specific function, and the design decision behind choosing it.

### 5.1 Scales

| D3 API | Location | Purpose | Design rationale |
|---|---|---|---|
| `d3.scaleLinear()` | `PolarPlotService` | Maps amplitude values → pixel radius | Linear gives equal pixel spacing per equal amplitude step — critical for readable concentric rings |
| `d3.scaleLinear()` | `RadialAreaService` | Per-series radius scale (dual-axis) | Each series gets an independent domain so temperature (°C) and rainfall (mm) don't interfere |
| `d3.scaleBand()` | `RadialAreaService` | Maps categorical labels → angle (0–2π) | Band scale automatically distributes N categories uniformly; `bandwidth()/2` centres each label at its midpoint |
| `d3.tickStep()` | `PolarPlotService.niceAmplitudeDomain()` | Compute "nice" tick interval | Used to snap domain endpoints to exact multiples of the tick step — guarantees the outer ring is at an amplitude value, not an arbitrary pixel offset. D3's built-in `.nice()` does not ensure this. |
| `d3.max()` / `d3.min()` | `PolarPlotService` | Auto-range amplitude from data | Standard D3 extent utilities; `d3.min` clamped to `0` so origin is always visible |
| `d3.range()` | `PolarPlotService` | Generate spoke angles (0, 30, 60…°) | Arithmetic range — cleaner than a manual for-loop |

### 5.2 Curve & Path Generators

| D3 API | Location | Purpose | Design rationale |
|---|---|---|---|
| `d3.lineRadial()` | `PolarPlotService.drawData()` | Polar line path (the orbit curve) | Radial equivalent of `d3.line()` — `.angle()` and `.radius()` replace `.x()` and `.y()` |
| `d3.areaRadial()` | Both services | Filled area under the polar curve | Defines inner radius (0 or `innerRadius`) and outer radius (data-driven), producing closed filled shape |
| `d3.curveCatmullRomClosed.alpha(0.5)` | Both services | Smooth interpolation between points | `CatmullRom` provides C¹-continuous smooth curves suitable for circular layouts. **`curveMonotoneX/Y` deliberately avoided** — monotonic curves assume X is monotonically increasing, which is false in polar space (angle wraps at 360°). `CatmullRomClosed` ensures the curve closes cleanly. |

### 5.3 Zoom

| D3 API | Location | Purpose | Design rationale |
|---|---|---|---|
| `d3.zoom()` | `RadialAreaService` | Rubber-band wheel zoom | Provides built-in `WheelEvent` normalisation across browsers and trackpads |
| `.scaleExtent([zoomMin, zoomMax])` | Both services | Clamp zoom level | Prevents infinite zoom out (data becomes invisible) or infinite zoom in (axis becomes unreadable) |
| `.wheelDelta(fn)` | `RadialAreaService` | Custom scroll sensitivity | Default D3 wheel delta is tuned for geographic maps; the custom formula gives finer 10%-per-100px steps for vibration data |
| `d3.zoomIdentity` | `RadialAreaService` | Programmatic zoom reset | Transitions back to scale=1 via `transition().duration()` for smooth UX |
| `event.transform.k` | Both services | Extract current zoom scale | `k` is the D3 scale factor; used to compute `zoomedOuterRadius = innerRadius + (baseOuter − innerRadius) × k` — this is **semantic zoom**, not geometric zoom |

> **Semantic zoom vs. geometric zoom**: Standard `d3.zoom` applies a CSS/SVG transform to the entire chart, scaling all elements uniformly. This implementation instead uses the zoom scale factor to **recompute the radius scale's domain**, so only the amplitude axis zooms while all angular labels, spokes, and the outer ring boundary stay fixed. This matches the expected mental model for vibration engineers.

### 5.4 Selection & DOM

| D3 API | Location | Purpose |
|---|---|---|
| `d3.select(host)` | Both services | Select the Angular host `<div>` and append `<svg>` |
| `.append()` / `.attr()` / `.style()` | Throughout | Standard D3 DOM manipulation |
| `.selectAll().data().join()` | Grid, dots, labels | D3 data-join pattern — updates existing elements rather than recreating them |
| `.transition().duration()` | Zoom reset | Animated smooth transition back to default scale |
| `d3.Selection<T, …>` | Service types | TypeScript generics for fully-typed SVG element references |

### 5.5 Utilities

| D3 API | Usage |
|---|---|
| `d3.ticks()` | Generate the amplitude ring values matching the scale |
| `d3.tickStep()` | Used in `niceAmplitudeDomain` to compute a "nice" tick interval |
| `d3.max()` / `d3.min()` | Amplitude domain derivation from raw data |
| `d3.range(0, 360, spokesEvery)` | Spoke / angular label angle generation |

---

## 6. Data Model Design

### 6.1 `PolarDataPoint` (single-series polar plot)

```typescript
interface PolarDataPoint {
  phaseValue: number;       // Logical angle in degrees [0, 360)
  amplitudeValue: number;   // Vibration magnitude — any real number
  labelText?: string;       // Optional per-point label (overrides labelFormatter)
}
```

Design decisions:
- `phaseValue` is always logical degrees. The rendering transformation (`startAngle` + `clockwise`) is applied inside the service, not by the caller. This keeps the data model clean for re-use.
- `labelText` is a Stage 2 optional field — adding it never changes curve geometry. The curve always renders all points regardless of label presence.

### 6.2 `PolarPlotConfig` (25 configurable options)

Key groups:

| Group | Options |
|---|---|
| Sizing | `width`, `height`, `innerRadius`, `padding` |
| Grid | `showGrid`, `gridTicks`, `showSpokes`, `spokesEvery` |
| Labels | `showAngularLabels`, `showRadialLabels`, `minorAmplitudeTicks` |
| Curve | `showLine`, `showArea`, `showDots`, `dotRadius`, `dotThreshold`, `closedCurve`, `lineColor`, `areaOpacity` |
| Interaction | `showVector`, `animationDuration` |
| Orientation | `startAngle`, `clockwise` |
| Appearance | `darkMode`, `emptyAmplitudeMax` |
| Data labels (Stage 2) | `showDataLabels`, `labelFormatter`, `labelFontSize`, `labelMinSpacingPx`, `labelThreshold` |

### 6.3 `RadialDataPoint` (multi-series radial area)

```typescript
interface RadialDataPoint {
  label: string;                   // Category name (e.g. 'Jan', 'Mon')
  [key: string]: number | string;  // One field per series key (flat structure)
}
```

Flat model keeps the dataset shape generic — a single array supports any number of series without schema changes.

### 6.4 `RadialSeries`

```typescript
interface RadialSeries {
  key: string;              // Matches the field name in RadialDataPoint
  label: string;            // Display label in legend
  color: string;            // CSS color string
  domain?: [number, number]; // Explicit domain (e.g. [0, 100]); auto-derived if omitted
}
```

The optional `domain` makes the dual-scale pattern explicit at the call site:

```typescript
weatherSeries = [
  { key: 'temp', label: 'Temperature (°C)', color: '#378ADD', domain: [0, 40] },
  { key: 'rain', label: 'Rainfall (mm)',     color: '#1D9E75', domain: [0, 100] },
];
```

---

## 7. Rendering Pipeline

### 7.1 SVG Layer Stack (`PolarPlotService`)

```
<svg width height viewBox>
  <defs>
    <clipPath id="pp-clip-{random}">      ← random ID prevents multi-instance collisions
      <circle r="outerRadius"/>
    </clipPath>
  </defs>
  <g transform="translate(cx, cy)">       ← chart origin at centre
    <g class="pp-grid"/>                  ← concentric rings (redrawn on every zoom step)
    <g class="pp-spokes"/>               ← spoke lines (drawn once at init)
    <g class="pp-labels"/>               ← angular + radial ruler labels
    <g class="pp-data"
       clip-path="url(#pp-clip-…)"/>     ← polar line/area/dots (clipped)
    <g class="pp-datalabels"/>           ← sparse label overlay (Stage 2)
    <g class="pp-cursor"/>               ← interactive crosshair on top
  </g>
  <rect width height                     ← transparent zoom / click overlay
       pointer-events="all"/>
</svg>
```

Layer ordering is intentional:
- `pp-datalabels` sits **between** data and cursor so labels are visible above the curve but the cursor crosshair is always on top for clarity.
- `pp-data` receives the clip path; `pp-datalabels` and `pp-cursor` do not, so cursor elements can extend slightly outside the outer ring for readability.

### 7.2 Coordinate System

Angular conversion from logical degrees to SVG radians:

```
renderedDeg = startAngle + direction × logicalAngleDeg
renderedRad = renderedDeg × (π / 180)

SVG x = rScale(amplitude) × sin(renderedRad)
SVG y = −rScale(amplitude) × cos(renderedRad)    ← negative because SVG y grows downward
```

The negated cosine ensures `0°` renders at 12 o'clock (top of chart), matching the industrial vibration convention.

### 7.3 Static vs. Zoom-Aware Layers

| Layer | Redrawn on zoom? | Rationale |
|---|---|---|
| Spokes | No | Spoke angles are purely angular — zoom only affects radius |
| Angular labels | No | Labels are at fixed outer boundary position |
| Grid rings | Yes | Ring radii map to amplitude values; zoom changes the scale domain |
| Radial labels | Yes | Tick values and positions change with scale domain |
| Data (line / area / dots) | Yes | Point positions in polar coords depend on `rScale` |
| Data labels | Yes | Label positions are derived from data point pixel coords |
| Cursor | Yes | Cursor tracks its point at the current zoom level |

### 7.4 `niceAmplitudeDomain` — Equal Ring Spacing

D3's built-in `.nice()` rounds domain endpoints to friendly numbers but does **not** guarantee that `domain[1]` is an exact multiple of the tick step. This causes the outer ring gap to differ from all inner ring gaps.

Custom solution:

```typescript
private niceAmplitudeDomain(rawMin: number, rawMax: number): [number, number] {
  const step = d3.tickStep(rawMin, rawMax, this.cfg.gridTicks);
  const snap = (v: number) => parseFloat(v.toPrecision(12));  // eliminate floating-point noise
  return [
    snap(Math.floor(rawMin / step) * step),
    snap(Math.ceil(rawMax / step)  * step),
  ];
}
```

This guarantees all rings — including the outer boundary — sit at exact amplitude values with equal pixel spacing. `toPrecision(12)` eliminates IEEE 754 noise (e.g. `199.99999999996` → `200`).

### 7.5 Rendering Initialization Flow (`init()`)

The `init()` method in `PolarPlotService` is the single entry point that orchestrates every rendering step in a fixed, dependency-ordered sequence. The Angular component calls it once in `ngAfterViewInit`, and again (via `destroy()` + `init()`) whenever an `@Input` changes.

#### 7.5.1 Why 1X Vibration Data Maps to Polar Coordinates

A compressor's 1X vibration measurement consists of two scalar values per observation:

| Measurement | Physical meaning | Polar coordinate |
|---|---|---|
| **Amplitude** (µm pk-pk) | How much the shaft is deflecting | **Radius** — distance from chart centre |
| **Phase** (degrees) | Where the deflection is in the rotation cycle | **Angle** — position around the circle |

By mapping amplitude → radius and phase → angle, every data point becomes a polar coordinate. A set of readings taken over time traces a curved track around the chart; the shape of that track encodes changes in operating condition (speed changes, load shifts, imbalance events). This is the same view machinery analysts call an "orbit track" or "1X polar plot".

The library preserves the industrial convention: `0°` appears at the **12 o'clock** position and angles increase **clockwise** (configurable via `startAngle` and `clockwise`).

#### 7.5.2 Step-by-Step `init()` Sequence

```
init(host, data, config, onSelect, onZoom)
│
├─ 1. Merge config with DEFAULTS  →  this.cfg
│     outerRadius = min(width, height) / 2 − padding
│
├─ 2. buildSvg(host)
│     │
│     ├─ Append <svg> with width / height / viewBox
│     ├─ Append <defs> → <clipPath id="pp-clip-{random}">
│     │     └─ <circle r="outerRadius"/>   ← clips data to the chart disc
│     │
│     └─ Append <g transform="translate(cx, cy)">   ← chart root; origin = centre
│           ├─ <g class="pp-grid"/>
│           ├─ <g class="pp-spokes"/>
│           ├─ <g class="pp-labels"/>
│           ├─ <g class="pp-data"  clip-path="url(#pp-clip-{id})"/>
│           ├─ <g class="pp-datalabels"/>
│           └─ <g class="pp-cursor"/>
│
├─ 3. [BRANCH] data is empty?
│     │
│     ├─ YES → drawEmptyPlot()            (grid + spokes + labels at emptyAmplitudeMax)
│     │         attachZoomHandler()        (zoom works on the empty grid)
│     │         RETURN
│     │
│     └─ NO  → continue below
│
├─ 4. buildScale(data)
│     │
│     ├─ d3.max(data, d.amplitudeValue)  → rawMax
│     ├─ min(0, d3.min(…))              → rawMin  (origin always visible)
│     ├─ niceAmplitudeDomain(rawMin, rawMax)
│     │     └─ snaps both endpoints to exact multiples of d3.tickStep()
│     │        so all grid rings have equal pixel spacing
│     │
│     └─ d3.scaleLinear()
│           .domain([niceMin, niceMax])
│           .range([innerRadius, outerRadius])
│
├─ 5. drawGrid()            →  pp-grid   : concentric dashed rings + outer ring + centre dot
│
├─ 6. drawSpokes()          →  pp-spokes : radial lines at spokesEvery° intervals
│                                          (drawn once — purely angular, no zoom dependency)
│
├─ 7. drawAngularLabels()   →  pp-labels : "0°", "30°" … text + spoke-end tick marks
│                                          placed at (outerRadius + 18) px from centre
│                                          (drawn once — no zoom dependency)
│
├─ 8. drawRadialLabels()    →  pp-labels : amplitude ruler ticks + values on the 0° axis
│                                          major ticks (labelled) + minor ticks (unlabelled)
│                                          (zoom-aware — redrawn on every zoom step)
│
├─ 9. drawData()            →  pp-data   : Stage 1 — the complete polar curve
│     │
│     ├─ d3.lineRadial()
│     │     .angle(d  → angleToRad(d.phaseValue))
│     │     .radius(d → rScale(d.amplitudeValue))
│     │     .curve(closedCurve ? curveLinearClosed : curveLinear)
│     │
│     └─ dots (SVGCircleElement per point)
│           auto-suppressed when data.length > dotThreshold (default 500)
│           to avoid linear DOM cost on dense datasets
│
├─ 10. drawDataLabels()     →  pp-datalabels : Stage 2 — sparse label overlay
│       (skipped when showDataLabels = false)
│       full description in Section 9
│
├─ 11. attachClickHandler()
│       click on SVG → find nearest point (Euclidean distance in polar-to-SVG coords)
│       → drawCursor(nearestPoint) + emit pointSelected output
│
├─ 12. drawCursor(data[0])
│       default cursor at the first data point on load
│
└─ 13. attachZoomHandler()
        wheel event → rAF-throttled semantic zoom
        full description in Section 8
```

#### 7.5.3 Two-Stage Rendering Concept

The rendering is intentionally split into two independent passes that share the same `rScale` but write to different SVG layer groups:

| Stage | Layer | What renders | Re-renders on zoom? |
|---|---|---|---|
| **Stage 1** | `pp-data` | The complete polar path — every data point, connected in order | Yes — `rScale` positions change |
| **Stage 2** | `pp-datalabels` | A sparse readable subset of text labels | Yes — label anchors are derived from `rScale` positions |

Stage 1 always renders all `renderData` points regardless of label configuration. Stage 2 is entirely optional (`showDataLabels: false` skips it) and runs as a separate pass over the same dataset after Stage 1 completes. Neither stage depends on the other's output — they can be toggled independently at any time via `ngOnChanges`.

#### 7.5.4 Empty State

When `data = []`, `init()` short-circuits after `buildSvg()`:

```
buildScale(data)   ← SKIPPED
drawData()         ← SKIPPED
drawCursor()       ← SKIPPED

drawEmptyPlot():
  rScale = scaleLinear([0, emptyAmplitudeMax], [innerRadius, outerRadius])
  drawGrid()          ← uses emptyAmplitudeMax for ring values
  drawSpokes()
  drawAngularLabels()
  drawRadialLabels()
```

The result is a fully-rendered grid (rings, spokes, labels) with no data plotted. Zoom still works on the empty grid. When data is later provided via `ngOnChanges`, `destroy() + init()` re-runs the full path.

---

## 8. Zoom Architecture (Semantic Zoom)

### 8.1 Strategy

Standard `d3.zoom()` applies a geometric SVG transform (`scale(k) translate(x,y)`) to the entire chart. This would scale the outer ring, spokes, and labels — wrong for vibration analysis.

The library implements **semantic zoom**: `d3.zoom` is used only to track the `transform.k` scale factor. The scale factor is then applied to recompute the amplitude axis domain, not to transform SVG elements.

```
Zoom step:
  k = event.transform.k               // from d3.zoom
  zoomedOuter = innerRadius + (baseOuter − innerRadius) × k
  rScale.range([innerRadius, zoomedOuter])
  → redraw grid, labels, data, cursor
```

Effect: zooming in compresses the amplitude axis range (shows finer detail near origin); zooming out expands the range (shows wider amplitude window). Angular position of every point stays unchanged.

### 8.2 rAF Throttle

Fast trackpads and mice fire multiple `WheelEvent`s per rendered frame (typically 3–8 events at 60 Hz). Without throttling, the DOM would receive 3–8 full redraws per frame.

Solution: accumulate the zoom level in `pendingZoom`; schedule one `requestAnimationFrame` per frame; apply one redraw per rendered frame regardless of event rate.

```typescript
private rafId: number | null = null;
private pendingZoom: number | null = null;

// wheel handler:
this.pendingZoom = newZoom;
if (this.rafId === null) {
  this.rafId = requestAnimationFrame(() => {
    this.applyZoom(this.pendingZoom!);
    this.rafId = null;
  });
}
```

Result: zero jank at 60 fps even on high-resolution trackpads.

### 8.3 Zoom Configuration

| Parameter | Default | Range | Effect |
|---|---|---|---|
| `ZOOM_MIN` | `0.2` | — | Zoom out to 5× the amplitude range |
| `ZOOM_MAX` | `20` | — | Zoom in to 1/20th of the amplitude range |
| `ZOOM_SENSITIVITY` | `100` px / step | — | Each 100 px of `deltaY` = one 10% zoom step |
| `zoomMin` (radial area) | `0.35` | — | Less aggressive zoom-out for categorical data |
| `zoomMax` (radial area) | `5` | — | More conservative zoom-in for categorical data |

### 8.4 Reset

- `NgxPolarPlotComponent.resetZoom()` — programmatic reset from Angular template or parent component.
- `NgxRadialAreaComponent` — double-click on chart or "Reset" button in the built-in controls bar.
- Both animate back to `currentZoom = 1` and restore `rScale.domain([baseMinAmp, baseMaxAmp])`.

---

## 9. Non-Overlapping Label Placement Engine

### 9.1 Problem

With 3 713 real compressor data points plotted in polar space, naively rendering a label at every point produces an unreadable mass. The challenge is to select a readable sparse subset at render time with zero perceived overlap — and to do this fast enough to not block the UI.

The original C# algorithm (`code.js`) performs an **O(n²)** all-pairs AABB intersection test — for every new candidate it scans all previously placed labels linearly. At 5 000 points this results in up to 12.5 million comparisons, blocking the main thread for 250–400 ms per render. The implementation replaces this with an O(1)-per-candidate spatial index.

### 9.2 Actual Pipeline (`drawDataLabels()` in `PolarPlotService`)

The label rendering pass runs independently of the curve — all data points always render; labels are a sparse overlay on top.

```
1. Zoom filter
   Each renderData point is checked against the current rScale domain.
   Points outside the visible amplitude window are skipped — no label
   is generated for a point that isn't currently on screen.

2. Label text resolution (per point)
   Priority order:
     a. point.labelText      — per-point static string (highest priority)
     b. cfg.labelFormatter   — callback: (pt: PolarDataPoint) => string
     c. Skip                 — neither present; point has no label

3. Anchor position
   The label anchor is placed radially outward from the dot by
   (dotRadius + 6) px so the text never occludes the data point itself.
   xAnchorValue is set from the point's angular position:
     sinθ > 0.1  → 0 (label grows rightward)
     sinθ < -0.1 → 1 (label grows leftward)
     otherwise   → 0.5 (centred, for points near 0° / 180°)

4. Overlap check via LabelSpatialGrid  [O(1) per candidate]
   All candidates are passed directly to drawPolarLabelsWithoutOverlap()
   with minSpacingPx = 0 — no pre-thinning step is applied.
   Inside that function each candidate goes through:
     a. measureLabel()                — OffscreenCanvas pixel measurement
     b. calculateLabelCoordinates()  — compute AABB + clamp to SVG boundary
     c. LabelSpatialGrid.hasOverlap() — O(1) spatial-hash check
   If the AABB is accepted (no overlap, within boundary), the label
   is inserted into the grid and drawn; otherwise it is silently skipped.
```

> **Note:** `thinCandidates()` is implemented in `label-placement.ts` and is available as a utility, but it is **not invoked** in the current `drawDataLabels()` path. All zoom-visible candidates are submitted directly to the spatial grid. The grid's own overlap check is what produces the sparse readable output.

**Complexity comparison:**

| Implementation | Overlap check | Time (5 000 pts) |
|---|---|---|
| Original C# port (`code.js`) | O(n) linear scan per candidate → O(n²) total | ~250–400 ms blocking |
| `label-placement.ts` spatial grid | O(1) per candidate | < 5 ms |

### 9.3 OffscreenCanvas Text Measurement

Label AABB computation requires the pixel width of each label string. The naive approach — appending a `<text>` element and calling `getBBox()` — forces a DOM reflow for every measurement.

`measureLabel()` uses `OffscreenCanvas.getContext('2d').measureText()`, which runs entirely off the render tree (zero reflow). Results are cached in a `Map<fontSize::text, {width, height}>`, so repeated label strings (e.g. `"3600 rpm"` appearing on every steady-state point) pay the measurement cost only once per font size.

### 9.4 Directional Anchor

The `xAnchorValue` field on each `LabelPoint` drives the SVG `text-anchor` attribute and the AABB x-bounds computation:

- Points on the **right half** (`sinθ > 0.1`) → label grows rightward (`text-anchor: start`)
- Points on the **left half** (`sinθ < −0.1`) → label grows leftward (`text-anchor: end`)
- Points near the **top or bottom** (`|sinθ| ≤ 0.1`) → label centred (`text-anchor: middle`)

This ensures that labels always extend away from the polar curve rather than back across it, reducing the effective collision surface for points on both sides of the chart.

### 9.5 Pseudo-code — Label Overlap Algorithm

```
─────────────────────────────────────────────────────────────────
PHASE 1 — Build candidate list  (inside drawDataLabels)
─────────────────────────────────────────────────────────────────
candidates ← []

FOR EACH data point p IN renderData:

    IF p.amplitudeValue NOT IN [domMin, domMax]:
        SKIP  ← outside the current zoom window

    text ← p.labelText  OR  labelFormatter(p)  OR  ""
    IF text is empty:
        SKIP  ← nothing to draw

    angleRad ← toSvgRadians(p.phaseValue)          // applies startAngle + clockwise
    r        ← rScale(p.amplitudeValue)             // amplitude → pixel radius
    offsetR  ← r + dotRadius + 6                   // push label clear of the dot

    anchor.x ← offsetR × sin(angleRad)             // SVG x  (right = positive)
    anchor.y ← −offsetR × cos(angleRad)            // SVG y  (up = positive, hence −cos)

    xAnchor  ← LEFT  if sin < −0.1                 // label grows leftward
               RIGHT if sin >  0.1                 // label grows rightward
               CENTER otherwise                    // near top/bottom axis

    candidates.append({ x, y, text, xAnchor })

─────────────────────────────────────────────────────────────────
PHASE 2 — Place labels without overlap  (drawPolarLabelsWithoutOverlap)
─────────────────────────────────────────────────────────────────
grid   ← new LabelSpatialGrid()    // empty spatial hash
placed ← []

FOR EACH candidate c IN candidates:

    labelSize ← measureLabel(c.text, fontSize)
    //   uses OffscreenCanvas — zero DOM reflow; result cached by "fontSize::text"

    rect ← computeAABB(c.x, c.y, c.xAnchor, labelSize, chartBounds)
    //   axis-aligned bounding box of the label text
    //   clamped to SVG boundary (±halfWidth, ±halfHeight)
    //   IF clamped width < 50% of natural width → rect = NULL (too truncated)

    IF rect is NULL:
        SKIP  ← label would overflow the chart boundary

    IF grid.hasOverlap(rect):
        SKIP  ← collides with an already-placed label

    grid.insert(rect)               // reserve this space
    placed.append(rect)
    DRAW label at (c.x, c.y)

─────────────────────────────────────────────────────────────────
LabelSpatialGrid — how hasOverlap and insert work
─────────────────────────────────────────────────────────────────
The grid divides the SVG canvas into fixed-size cells (130 × 20 px).
Each cell is a bucket that holds the AABBs of labels already drawn there.

FUNCTION cellsForRect(rect):
    colStart ← floor(rect.x1 / CELL_W)
    colEnd   ← floor(rect.x2 / CELL_W)
    rowStart ← floor(rect.y1 / CELL_H)
    rowEnd   ← floor(rect.y2 / CELL_H)
    RETURN every (col, row) pair in that range
    // A label spanning two columns touches two column-buckets

FUNCTION hasOverlap(candidate):
    FOR EACH cell (col, row) that candidate touches:
        FOR EACH existing rect IN cell.bucket:
            IF aabbIntersects(candidate, existing):
                RETURN TRUE       // collision found
    RETURN FALSE                  // safe to place

FUNCTION insert(rect):
    FOR EACH cell (col, row) that rect touches:
        cell.bucket.append(rect)  // register in every touched cell

FUNCTION aabbIntersects(A, B):
    RETURN NOT (A.x2 ≤ B.x1  OR  B.x2 ≤ A.x1
             OR A.y2 ≤ B.y1  OR  B.y2 ≤ A.y1)
    // classic AABB separation-axis test (port of original C# algorithm)

─────────────────────────────────────────────────────────────────
Why O(1) per candidate?
─────────────────────────────────────────────────────────────────
A label (≈120 × 14 px) touches at most 2 columns × 2 rows = 4 cells.
Each cell bucket holds only labels near that region, so the inner
FOR EACH loop over existing rects is bounded by a small constant.
Overall: O(n) total for n candidates, vs. O(n²) for the naive all-pairs scan.
```

### 9.6 Code — Where It Lives & Key Snippets

All label placement code spans two files:

| File | Role |
|---|---|
| [projects/ngx-radial-area/src/lib/polar-plot.service.ts](polar-plot-workspace/projects/ngx-radial-area/src/lib/polar-plot.service.ts) | Caller — builds the candidate list and invokes the engine |
| [projects/ngx-radial-area/src/lib/label-placement.ts](polar-plot-workspace/projects/ngx-radial-area/src/lib/label-placement.ts) | Engine — measurement, AABB helpers, spatial grid, main entry point |

---

#### Step 1–3 — Candidate list builder (`polar-plot.service.ts`, `drawDataLabels()`)

```typescript
// polar-plot.service.ts  →  drawDataLabels()
private drawDataLabels(): void {
  const g = this.root.select<SVGGElement>('g.pp-datalabels');
  g.selectAll('*').remove();

  if (!this.cfg.showDataLabels) return;

  const { labelFormatter, labelFontSize, dotRadius, darkMode, width, height } = this.cfg;
  const color = darkMode ? 'rgba(255,255,255,0.75)' : '#333';
  const [domMin, domMax] = this.rScale.domain();
  const boundaryHalfW = width / 2;
  const boundaryHalfH = height / 2;

  const candidates: LabelPoint[] = [];

  for (const d of this.renderData) {
    // Step 1 — zoom filter: skip points outside the visible amplitude window
    if (d.amplitudeValue < domMin || d.amplitudeValue > domMax) continue;

    // Step 2 — label text: per-point string wins over formatter callback
    const labelText: string =
      (d as PolarDataPoint & { labelText?: string }).labelText ??
      (labelFormatter ? labelFormatter(d) : '');
    if (!labelText) continue;

    // Step 3 — anchor position: offset radially outward from the dot
    const angleRad     = this.angleToRad(d.phaseValue);
    const r            = this.rScale(d.amplitudeValue);
    const sinA         = Math.sin(angleRad);
    const cosA         = Math.cos(angleRad);
    const offsetR      = r + dotRadius + 6;            // dotRadius + 6 px gap
    const xAnchorValue = sinA > 0.1 ? 0 : sinA < -0.1 ? 1 : 0.5;

    candidates.push({ x: offsetR * sinA, y: -offsetR * cosA, labelText, xAnchorValue });
  }

  if (candidates.length === 0) return;

  // Step 4 — hand off to the placement engine (no pre-thinning, minSpacingPx = 0)
  const dotOffset = dotRadius + 6;
  const lineColor = this.cfg.lineColor;

  drawPolarLabelsWithoutOverlap(
    candidates,
    { fontSize: labelFontSize, minSpacingPx: 0, boundaryHalfW, boundaryHalfH },
    (text, x, y, xAnchorValue) => {
      // Draw a small dot at the data point position (scaled inward from label anchor)
      const anchorDist = Math.sqrt(x * x + y * y);
      if (anchorDist > 0) {
        const scale = (anchorDist - dotOffset) / anchorDist;
        g.append('circle')
          .attr('cx', x * scale).attr('cy', y * scale)
          .attr('r', 2).attr('fill', lineColor)
          .attr('pointer-events', 'none');
      }
      // Draw the label text at the anchor position
      g.append('text')
        .attr('x', x).attr('y', y)
        .attr('text-anchor', xAnchorValue === 0 ? 'start' : xAnchorValue === 1 ? 'end' : 'middle')
        .attr('dominant-baseline', 'middle')
        .attr('font-size', labelFontSize)
        .attr('fill', color)
        .attr('pointer-events', 'none')
        .text(text);
    },
  );
}
```

---

#### OffscreenCanvas Text Measurement (`label-placement.ts`, `measureLabel()`)

```typescript
// label-placement.ts
let _offscreen: OffscreenCanvas | null = null;
let _ctx: OffscreenCanvasRenderingContext2D | null = null;
const _measureCache = new Map<string, { width: number; height: number }>();

export function measureLabel(text: string, fontSize: number): { width: number; height: number } {
  const key = `${fontSize}::${text}`;
  const cached = _measureCache.get(key);
  if (cached) return cached;

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
```

---

#### AABB Computation & Boundary Clamping (`label-placement.ts`, `calculateLabelCoordinates()`)

```typescript
// label-placement.ts
export function calculateLabelCoordinates(
  x: number, y: number,
  xAnchorValue: number,
  labelSize: { width: number; height: number },
  boundaryHalfW: number,
  boundaryHalfH: number,
): LabelRect | null {
  let x1: number, x2: number;

  if (xAnchorValue <= 0.1)       { x1 = x;                      x2 = x + labelSize.width; }
  else if (xAnchorValue >= 0.9)  { x2 = x;                      x1 = x - labelSize.width; }
  else                           { x1 = x - labelSize.width / 2; x2 = x + labelSize.width / 2; }

  const y1 = y - labelSize.height / 2;
  const y2 = y + labelSize.height / 2;

  // Clamp to SVG boundary (chart-centred coords: boundary = ±half dimension)
  const cx1 = Math.max(-boundaryHalfW + 2, x1);
  const cx2 = Math.min(+boundaryHalfW - 2, x2);
  const cy1 = Math.max(-boundaryHalfH + 2, y1);
  const cy2 = Math.min(+boundaryHalfH - 2, y2);

  // Reject if clamping removed more than half the label width (unreadable)
  if (cx2 - cx1 < labelSize.width * 0.5) return null;

  return { x1: cx1, x2: cx2, y1: cy1, y2: cy2 };
}
```

---

#### Spatial Grid — O(1) Overlap Index (`label-placement.ts`, `LabelSpatialGrid`)

```typescript
// label-placement.ts
const CELL_W = 130;   // sized to max datetime label width (~120 px) + margin
const CELL_H = 20;    // sized to label line height at font-size 10

export class LabelSpatialGrid {
  private readonly cells = new Map<string, LabelRect[]>();

  private key(col: number, row: number): string { return `${col},${row}`; }

  private cellsForRect(r: LabelRect): Array<[number, number]> {
    const c1 = Math.floor(r.x1 / CELL_W), c2 = Math.floor(r.x2 / CELL_W);
    const r1 = Math.floor(r.y1 / CELL_H), r2 = Math.floor(r.y2 / CELL_H);
    const out: Array<[number, number]> = [];
    for (let c = c1; c <= c2; c++)
      for (let row = r1; row <= r2; row++)
        out.push([c, row]);
    return out;
  }

  /** Returns true if `candidate` overlaps any already-placed rect. O(1). */
  hasOverlap(candidate: LabelRect): boolean {
    for (const [col, row] of this.cellsForRect(candidate)) {
      const bucket = this.cells.get(this.key(col, row));
      if (!bucket) continue;
      for (const existing of bucket)
        if (dataLabelOverlap(candidate, existing)) return true;
    }
    return false;
  }

  /** Inserts a placed rect into all cells it touches. */
  insert(rect: LabelRect): void {
    for (const [col, row] of this.cellsForRect(rect)) {
      const k = this.key(col, row);
      let bucket = this.cells.get(k);
      if (!bucket) { bucket = []; this.cells.set(k, bucket); }
      bucket.push(rect);
    }
  }
}
```

---

#### Main Placement Entry Point (`label-placement.ts`, `drawPolarLabelsWithoutOverlap()`)

```typescript
// label-placement.ts
export function drawPolarLabelsWithoutOverlap(
  points: LabelPoint[],
  options: PlaceLabelOptions,
  drawLabel: DrawLabelFn,
): LabelRect[] {
  const { fontSize, boundaryHalfW, boundaryHalfH } = options;
  const grid = new LabelSpatialGrid();
  const placed: LabelRect[] = [];

  for (const p of points) {
    if (!p.labelText) continue;

    const labelSize = measureLabel(p.labelText, fontSize);
    const rect = calculateLabelCoordinates(
      p.x, p.y, p.xAnchorValue, labelSize, boundaryHalfW, boundaryHalfH,
    );

    if (!rect) continue;                    // boundary clamp rejected — label would overflow
    if (grid.hasOverlap(rect)) continue;    // spatial grid rejected — overlaps a placed label

    grid.insert(rect);
    placed.push(rect);
    drawLabel(p.labelText, p.x, p.y, p.xAnchorValue);
  }

  return placed;
}
```

---

## 10. Data Adapters — NX Vector & CSV

### 10.1 CSV Adapter (`csv-polar-data.ts`)

Ingests real compressor data from `polarData1.csv`:

- **Machine:** MTC_Compressor | **Point:** RK1_B1Y | **Variable:** 1X
- **Units:** µm peak-to-peak (amplitude), degrees (phase), rpm (speed)
- **Dataset:** 3 764 total rows; 3 713 valid rows (51 skipped — `Invalid` status)

Data is pre-compiled into a `readonly` tuple array `[amplitudeMicronsPP, phaseDegrees, speedRpm, timestamp]` at build time — no runtime CSV parse. The `transformCsvToPolarPoints()` function is O(n) with no join required.

Label modes:

| Mode | `labelText` value |
|---|---|
| `'datetime'` | `"1/24/2019 12:33:29 AM"` (raw timestamp string) |
| `'speed'` | `"213 rpm"` |
| `'none'` | `undefined` (no labels) |

### 10.2 NX Vector API Adapter (`nx-vector-polar-mock.ts`)

Maps the **real NX Vector REST API response structure** to `PolarDataPoint[]`. This adapter handles two non-trivial data issues:

**Issue 1 — Parallel time-series join.** The API returns amplitude and phase as two separate `primaryData` arrays keyed by `tagId`. Each array has timestamps that may not align one-to-one. A naive nested-loop join is O(n²). The adapter builds a `Map<timestamp, phaseValue>` in O(n), then looks up each amplitude sample in O(1).

**Issue 2 — Phase in radians despite `"°"` unit label.** When `isPhaseRolloverApplicable = true`, the phase value is cumulative radians. Conversion:

```
normalised = ((value % (2π)) + 2π) % (2π)
degrees    = normalised × (180 / π)
```

The adapter checks `measurements[i].info.units` at runtime to select the correct conversion path, supporting both real API data (radians) and mock data (degrees).

**NX Vector API types exported:**

| Type | Description |
|---|---|
| `NxVectorApiResponse` | Root API response wrapper |
| `NxVectorMeasurement` | Per-subplot measurement descriptor |
| `NxVectorMeasurementInfo` | Tag metadata (units, point name, rollover flag) |
| `NxVectorPrimaryData` | One time-series (samples array) |
| `NxVectorSample` | One data point (.NET ticks timestamp, value, speed) |
| `PolarDataPointWithLabel` | Mapped output type extending `PolarDataPoint` |

---

## 11. Angular Integration Strategy

### 11.1 OnPush Change Detection

Both components use `ChangeDetectionStrategy.OnPush`. Change detection only runs when:
- An `@Input` reference changes (Angular's default reference equality check)
- `MarkForCheck()` is called manually

This is critical for performance: D3 renders ~60 redraws per second during zoom. Without OnPush, Angular's change detection would run on every wheel event.

### 11.2 `NgZone.runOutsideAngular`

All D3 rendering — including the initial `init()`, `destroy()`, and every zoom callback — runs **outside Angular's zone**. D3 wheel events must not trigger Angular change detection on every scroll tick.

Angular's zone is re-entered only at the exact moment when:
- A `@Output` event needs to be emitted (`pointSelected`, `zoomChange`)
- A DOM check needs to be scheduled

```typescript
// Inside Angular component:
this.zone.runOutsideAngular(() => {
  this.service.init(
    this.hostRef.nativeElement,
    this.data,
    this.config,
    (pt) => this.zone.run(() => this.pointSelected.emit(pt)),   // re-enter for emit
    (k)  => this.zone.run(() => this.zoomChange.emit(k)),       // re-enter for emit
  );
});
```

### 11.3 Lifecycle Hooks

| Hook | Action |
|---|---|
| `ngAfterViewInit` | Call `service.init()` — host `<div>` is guaranteed in the DOM |
| `ngOnChanges` | `service.destroy()` + `service.init()` — full re-render on input change |
| `ngOnDestroy` | `service.destroy()` — cancels rAF, removes wheel listeners, removes SVG |

`ngOnChanges` triggers a full re-render (destroy + init) rather than a partial update because D3's data-join pattern makes partial updates complex to reason about when both data and config can change simultaneously. The performance cost is acceptable since D3 renders in < 16 ms for the tested data volumes.

### 11.4 Standalone Components

Both components use Angular 19 standalone APIs (`standalone: true`, no `NgModule` required). Consumers import them directly:

```typescript
imports: [NgxPolarPlotComponent]   // or NgxRadialAreaComponent
```

---

## 12. Public API Surface

The library barrel (`public-api.ts`) exports the following symbols:

### Components

| Symbol | Description |
|---|---|
| `NgxPolarPlotComponent` | Polar plot component (`<ngx-polar-plot>`) |
| `NgxRadialAreaComponent` | Radial area component (`<ngx-radial-area>`) |

### Models

| Symbol | Description |
|---|---|
| `PolarDataPoint` | Input data point: `phaseValue`, `amplitudeValue`, `labelText?` |
| `PolarPlotConfig` | 25-option configuration interface |
| `RadialDataPoint` | Categorical data point: `label` + arbitrary numeric keys |
| `RadialSeries` | Series descriptor: `key`, `label`, `color`, `domain?` |
| `RadialAreaConfig` | 13-option configuration interface |
| `ZoomEvent` | Zoom event payload: `scale`, `transform.{k, x, y}` |

### Services (advanced use)

| Symbol | Description |
|---|---|
| `PolarPlotService` | Raw D3 engine — instantiate directly for non-Angular usage |
| `RadialAreaService` | Raw D3 engine for radial area |

### Label Placement Utilities

| Symbol | Description |
|---|---|
| `LabelPoint` | Candidate label input: `x`, `y`, `labelText`, `xAnchorValue` |
| `LabelRect` | Placed label AABB: `x1`, `x2`, `y1`, `y2` |
| `PlaceLabelOptions` | Options for `drawPolarLabelsWithoutOverlap` |
| `DrawLabelFn` | Callback type for custom label rendering |

### Data Adapters

| Symbol | Description |
|---|---|
| `CsvPolarPoint` | Extended `PolarDataPoint` with `labelText` |
| `CsvLabelMode` | `'datetime' \| 'speed' \| 'none'` |
| `csvPolarData` | 3 713-point compressor dataset (compiled tuple array) |
| `transformCsvToPolarPoints()` | O(n) CSV→PolarDataPoint transformer |
| `NxVectorApiResponse` | Root NX Vector API response type |
| `NxVectorSample` | NX Vector time-series sample |
| `NxVectorMeasurementInfo` | Tag metadata |
| `PolarDataPointWithLabel` | Mapped NX Vector output |
| `sampleNxVectorResponse` | 30-point mock NX Vector payload (startup + steady-state) |
| `transformNxVectorToPolarPoints()` | O(n) NX API → PolarDataPoint transformer |

---

## 13. Demo Application

The `polar-plot-demo` Angular application (`polar-plot-demo`) demonstrates all library features in a single page.

### Features

**Chart type switcher** — toggle between Polar Plot and Radial Area modes.

**Polar Plot mode:**
- Loads real compressor data (3 713 points from `polarData1.csv`)
- Display toggles: grid rings, spokes, vector line, data labels
- Label format selector: `Datetime` / `Speed (rpm)`
- Live zoom level indicator
- Selected point readout (phase angle + amplitude)

**Radial Area mode:**
- Dataset switcher: Weather (12 months × temp + rain) and Server Load (7 days × CPU + memory)
- Display toggles: grid rings, spokes
- Live zoom state display (current scale, range)

### Demo Data

| Dataset | Points | Series | Demonstrates |
|---|---|---|---|
| CSV Compressor | 3 713 | 1 (amplitude vs. phase) | High-density polar, label placement, zoom |
| Weather | 12 | 2 (temp °C, rain mm) | Dual-scale categorical radial area |
| Server Load | 7 | 2 (CPU %, memory %) | Different domains on same chart |

---

## 14. Test Coverage

**Total: 21 specs — all passing**

### Library Tests (14 specs)

**`ngx-radial-area.component.spec.ts` (7 specs)**

| Test | What it validates |
|---|---|
| Creates the component | Angular DI and standalone component construction |
| Mounts `<svg>` with correct `viewBox` | Service `init()` is called in `ngAfterViewInit` |
| One area group per series | D3 renders `g.ngx-ra-area-{key}` for each series |
| Legend item count matches series count | Built-in template control rendering |
| OnPush input updates via `componentRef.setInput` | Angular OnPush + `MarkForCheck` path |
| Reset emission | `zoomReset` Output fires when reset button is clicked |
| SVG teardown on destroy | `service.destroy()` removes SVG from DOM |

**`radial-area.service.spec.ts` (7 specs)**

| Test | What it validates |
|---|---|
| SVG viewBox matches config dimensions | `buildSvg()` creates correct SVG attributes |
| Per-series linear scales — auto domain | `d3.scaleLinear` domain derived from data |
| Per-series linear scales — explicit domain | `series.domain` overrides auto-derived domain |
| Band scale domain and range | `d3.scaleBand` domain contains all labels; range is `[0, 2π]` |
| Grid, spokes, area+line paths all present | All rendering layers populated after `init()` |
| `update()` rebuilds scales for new series | New series array causes full re-render with new scales |
| Wheel zoom invokes callback with `scale > 1` | Zoom handler calls `onZoomCallback` with correct value |

### Demo App Tests (7 specs)

**`app.component.spec.ts`**

| Test | What it validates |
|---|---|
| Creates the app component | Angular DI |
| Page heading text | Template binding |
| `<ngx-radial-area>` in the DOM | Chart component rendered |
| Default dataset is 'weather' | `activeDataset` initial state |
| Dataset switching updates `activeData` | `switchDataset()` method |
| `toggleGrid()` updates `chartConfig` | Config immutable update pattern |
| `onZoomChange` / `onZoomReset` update `currentZoom` | Output event bridging |

### Running Tests

```bash
# From polar-plot-workspace/
npm run test:lib    # 14/14 (headless Chrome)
npm run test:app    #  7/7  (headless Chrome)
npm run test:ci     # both suites, CI-safe
```

---

## 15. Build & Tooling

### Versions

| Tool | Version |
|---|---|
| Angular | 19.2 |
| TypeScript | 5.7 |
| Node.js | 20.19.2 (required: `^18.19.1 \|\| ^20.11.1 \|\| ^22`) |
| D3 | 7.9.0 |
| `@types/d3` | 7.4.3 |
| `ng-packagr` | 19.2 |
| esbuild (app) | via `@angular-devkit/build-angular:application` |
| Karma | 6.4 |
| Jasmine | 5.6 |

### Build Commands

```bash
# Install (from polar-plot-workspace/)
npm install

# Library build (ng-packagr → dist/ngx-radial-area/)
npm run build:lib

# Demo app build (esbuild)
npm run build

# Both
npm run build:all

# Dev server (live reload)
npm start   # → http://localhost:4200

# Tests
npm run test:ci
```

### tsconfig Path Mapping (dev fast-iteration)

```json
// polar-plot-workspace/tsconfig.json
"paths": {
  "ngx-radial-area": ["./projects/ngx-radial-area/src/public-api.ts"]
}
```

The path alias points the demo app directly at library source during development — eliminates the build → install cycle. Switch to `./dist/ngx-radial-area` to validate the packaged output.

---

## 16. Known Constraints & Future Roadmap

### Current Constraints

| Area | Constraint |
|---|---|
| Label placement | Labels recomputed on every zoom step — acceptable at < 5 ms; could be cached for further optimisation |
| `ngOnChanges` strategy | Full destroy+init on any input change — no incremental D3 data-join update path |
| Angular version | Standalone component APIs require Angular 14+; OnPush + zone strategy tuned for Angular 19 |
| Phase rollover | NX Vector adapter handles `isPhaseRolloverApplicable` but multi-revolution unwrapping is not implemented |
| No animation on data update | The polar line re-renders immediately on `ngOnChanges` without a D3 transition (intentional to avoid visual artefacts when data changes significantly) |

### Roadmap Suggestions

| Feature | Priority | Notes |
|---|---|---|
| Incremental D3 update (no destroy on `ngOnChanges`) | High | Would enable smooth animated data transitions |
| Multiple polar series on one chart | High | Requires N `rScale` instances + series colour mapping |
| Tooltip on hover (not just click) | Medium | `mousemove` → nearest point → floating `<div>` |
| Configurable label anchor algorithm | Medium | Allow caller to supply a custom placement strategy |
| Canvas fallback for > 10 000 points | Medium | SVG DOM may become slow above ~10 K elements |
| Phase unwrap / orbit trace | Low | Show multi-revolution spiral from raw cumulative phase |
| Server-side rendering (SSR) | Low | `OffscreenCanvas` is browser-only; would need adapter |
| npm publish pipeline | Low | `ng-packagr` output is ready; CI publish workflow not wired |

---

*Document generated from the `ngx-radial-area` Angular monorepo at `polar-plot-workspace/`. All feature claims are verified against the committed source and passing test suite.*
