# Bode Plot — Implementation Guide (Angular 19 + D3.js)

> **Audience:** an autonomous coding agent (or an engineer using an agent) who has read `reasearch/bode_plot_Guide.md` and `reasearch/d3-radial-area-plot-research.md` and now needs a deterministic step-by-step build plan.
>
> **Assumption:** we are past discovery/research and past "hello-world" scaffolding. The intermediate steps (workspace bring-up, tsconfig path mapping, ng-packagr wiring, Karma/Chrome headless, `runOutsideAngular` pattern) are already proven by the existing `ngx-radial-area` library in this repo. This guide reuses those patterns verbatim and layers Bode-specific work on top.
>
> **Deliverable at the end of this guide:** a new library `ngx-bode-plot` published from the same workspace with a component `<ngx-bode-plot>` that renders amplitude + phase subplots with region-aware zoom, cursor A/B, phase rollover, comparison overlays, and CSV/JSON export. Integrated into `polar-plot-demo` and covered by tests.

---

## 0. TL;DR (Read this first)

1. Add a new library at `polar-plot-workspace/projects/ngx-bode-plot/` — mirror the folder shape of `projects/ngx-radial-area/`.
2. Public surface: one standalone component (`NgxBodePlotComponent`) + one D3 engine service (`BodePlotService`) + a state store + a pure export service. No shared globals.
3. **Two vertically stacked plot regions inside one SVG**, sharing an X scale. Independent Y scales — one for amplitude, one for phase.
4. **Semantic zoom on axis-region hit-testing** — copy the pattern from `polar-plot.service.ts` (raw `wheel` listener + `requestAnimationFrame` coalescing + semantic rescale). Do **not** use `d3.zoom()` transforms directly, because we need per-region routing.
5. Cursors A/B are draggable vertical lines with per-region readouts. Nearest-sample lookup via `d3.bisector` (binary search).
6. Composite curve is the primary user unit (`amplitude` + optional `phase`). Every operation — add/remove/style/export/cursor — must respect this composite identity.
7. All heavy D3 work runs `NgZone.runOutsideAngular`; re-enter zone only to emit `@Output()` events. This is a hard rule from the existing codebase — keep it.
8. Tests: use `fixture.componentRef.setInput(...)` for OnPush inputs. Karma + Jasmine, ChromeHeadless.

---

## 1. Reference material to read before writing code

Read in this order. Do **not** skip — the design decisions are pinned to concrete sections.

| Document | What to extract |
|---|---|
| `reasearch/bode_plot_Guide.md` | The **behavioural contract**. Sections 3.1–3.10 are non-negotiable requirements; §5 is the domain model; §6 is the acceptance checklist. |
| `reasearch/d3-radial-area-plot-research.md` | Zoom/curve/overlay-rect idioms. Sections 4.2–4.5 (wheel handler + preventDefault + reset) and §5 (transparent `<rect>` for wheel capture) are directly reused. |
| `PROJECT_OVERVIEW.md` | Existing conventions for `ngx-radial-area` library — mirror the same layout for `ngx-bode-plot`. |
| `POLAR_PLOT_DESIGN_DOCUMENT.md` | Details on the sibling polar plot: label-placement algorithm, rAF throttling for zoom, and the SVG layer contract that this guide extends. |
| `polar-plot-workspace/projects/ngx-radial-area/src/lib/polar-plot.service.ts` | Reference implementation for the zoom hot path (see `wheelHandler`, `onZoom`, `rafId`). Copy the throttling structure. |
| `bode_plotData.csv` | Real dataset the demo must consume. Columns: `X-Axis Value` (RPM), `Y-Axis Value` (mil pp), `Y-Axis Status`, `Phase` (degrees), `Phase Status`, `Timestamp`. Rows 1–7 are metadata header lines, row 8 is the CSV header, data from row 9. |
| `bode_plot_reference.png` | Ground-truth layout: shared X (rpm) at bottom, top region = phase 0–360°, bottom region = amplitude (mil pp). Both regions have their own Y ticks and grid. Cursor is a single vertical line spanning both regions with two dots (one per curve). |

---

## 2. Workspace prerequisites

Everything runs from `polar-plot-workspace/`. Node 20+; the user's global `ng` is v7 — always use `npm run …` or `npx ng`.

```bash
cd polar-plot-workspace
nvm use 20.19.2      # if nvm is installed
npm install           # already run — only if node_modules is missing
```

Karma on macOS needs an explicit Chrome path:

```bash
export CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
```

---

## 3. Library scaffold — files to create, in this exact order

Create under `polar-plot-workspace/projects/ngx-bode-plot/`.

```
projects/ngx-bode-plot/
├── ng-package.json                         ← copy from ngx-radial-area, change "dest" to "../../dist/ngx-bode-plot"
├── package.json                            ← name: "ngx-bode-plot", peerDeps match ngx-radial-area
├── tsconfig.lib.json                       ← copy verbatim from ngx-radial-area
├── tsconfig.lib.prod.json                  ← copy verbatim
├── tsconfig.spec.json                      ← copy verbatim
├── README.md                               ← one paragraph — what the lib does + link to this file
└── src/
    ├── public-api.ts
    └── lib/
        ├── bode-plot.models.ts             ← §4
        ├── bode-plot.service.ts            ← §6 + §7 + §8 + §9 + §10 + §11
        ├── ngx-bode-plot.component.ts      ← §5
        ├── bode-cursor-readout.component.ts (optional)
        ├── bode-toolbar.component.ts       (optional)
        ├── bode-export.service.ts          ← §14
        ├── bode-csv-adapter.ts             ← §15
        ├── bode-plot.service.spec.ts
        ├── ngx-bode-plot.component.spec.ts
        └── bode-csv-adapter.spec.ts
```

Then wire it into the workspace:

1. **`angular.json`** — add a `ngx-bode-plot` project entry: copy the `ngx-radial-area` entry, change `root`, `sourceRoot`, `tsConfig` paths.
2. **Root `tsconfig.json`** — add path mapping:
   ```json
   "paths": {
     "ngx-radial-area": ["./projects/ngx-radial-area/src/public-api.ts"],
     "ngx-bode-plot": ["./projects/ngx-bode-plot/src/public-api.ts"]
   }
   ```
3. **Root `package.json`** — add npm scripts:
   ```jsonc
   "build:bode":     "ng build ngx-bode-plot",
   "test:bode":      "ng test ngx-bode-plot --watch=false --browsers=ChromeHeadless"
   ```
   Extend `test:ci` to include `test:bode`.

`public-api.ts` initial contents:

```ts
export * from './lib/bode-plot.models';
export * from './lib/bode-plot.service';
export * from './lib/ngx-bode-plot.component';
export * from './lib/bode-export.service';
export * from './lib/bode-csv-adapter';
```

---

## 4. Domain model — `bode-plot.models.ts`

Use these exact type names. They are referenced in every subsequent section.

```ts
// ── Status per sample ────────────────────────────────────────────────────────
export type StatusPoint = 'Valid' | 'Invalid' | 'Overrange' | 'Underrange';

// ── Style ────────────────────────────────────────────────────────────────────
export interface CurveStyle {
  color: string;                       // hex e.g. '#378ADD'
  lineWidth?: number;                  // default 1.5
  dashArray?: string;                  // '' = solid, '4 4' = dashed
  activeOpacity?: number;              // default 1
  inactiveOpacity?: number;            // default 0.35
}

// ── A single trace (amplitude or phase) ──────────────────────────────────────
export interface BodeCurve {
  curveNumber: number;                 // unique per composite
  xValues: number[];                   // parallel arrays — do NOT convert to {x,y}[]
  yValues: number[];
  xStatus?: StatusPoint[];             // if omitted, treat as all 'Valid'
  yStatus?: StatusPoint[];
  timestampsUtc?: number[];            // epoch ms; optional
  style: CurveStyle;
}

// ── Composite curve (primary user-facing unit) ───────────────────────────────
export interface BodeCompositeCurve {
  primaryCurveNumber: number;
  amplitude: BodeCurve;                // required
  phase?: BodeCurve;                   // optional — never break rendering if missing
  curveType: 'primary' | 'comparison';
  isActive: boolean;
  label?: string;                      // shown in legend + toolbar dropdown
  comparisonReferenceSetId?: string;   // if curveType === 'comparison'
}

// ── Axis state ───────────────────────────────────────────────────────────────
export type XUnit = 'RPM' | 'Hz' | 'RadPerSec';
export type PhaseMode = 'rollover' | 'clamped-360';

export interface BodeAxisState {
  xRange: [number, number];
  yAmpRange: [number, number];
  yPhaseRange: [number, number];
  xUnit: XUnit;
  yAmpUnit: string;                    // e.g. 'mil pp'
  yAmpSubUnit?: string;                // display suffix if needed
  phaseRolloverEnabled: boolean;       // true = allow wrap ( -180..180 or continuous )
                                       // false = clamp to [0, 360]
}

// ── Cursor state ─────────────────────────────────────────────────────────────
export interface BodeCursorState {
  cursorIndex: 0 | 1;                  // A = 0, B = 1
  xValue: number;
  timestampUtc?: number;
  ampValue: number;
  phaseValue?: number;
  isInvalid: boolean;
}

// ── Config (Angular @Input) ──────────────────────────────────────────────────
export interface BodePlotConfig {
  width: number;                       // default 900
  height: number;                      // default 560
  padding: { top: number; right: number; bottom: number; left: number };
  ampRegionRatio: number;              // 0..1, fraction of plot height for amplitude — default 0.55
  gutter: number;                      // px between regions — default 24
  gridTicksX: number;                  // default 8
  gridTicksY: number;                  // default 5 per region
  animationDuration: number;           // default 250
  darkMode: boolean;                   // default false
  enableCursorA: boolean;              // default true
  enableCursorB: boolean;              // default false
  showComparison: boolean;             // default true
  invalidGapPolicy: 'break-line' | 'skip-point';   // default 'break-line'
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

// ── Zoom history entry ───────────────────────────────────────────────────────
export interface BodeZoomState {
  xRange: [number, number];
  yAmpRange: [number, number];
  yPhaseRange: [number, number];
}
```

**Contract:** the service and the component consume these types unmodified. Do not add fields without also documenting them in the export payload (see §14).

---

## 5. Angular component — `ngx-bode-plot.component.ts`

Standalone, OnPush, thin. It owns the host DOM, forwards inputs to the service, re-emits outputs on the Angular zone. The pattern is a copy of `NgxPolarPlotComponent`.

```ts
@Component({
  selector: 'ngx-bode-plot',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="ngx-bode-host"></div>`,
  styles: [`
    :host { display: inline-block; }
    .ngx-bode-host { position: relative; }
  `],
})
export class NgxBodePlotComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('host', { static: true }) private hostRef!: ElementRef<HTMLDivElement>;

  @Input() compositeCurves: BodeCompositeCurve[] = [];
  @Input() axisState?: BodeAxisState;                 // if undefined, service computes from data
  @Input() cursors: BodeCursorState[] = [];
  @Input() activeCurveNumber?: number;
  @Input() config: Partial<BodePlotConfig> = {};

  @Output() axisStateChange   = new EventEmitter<BodeAxisState>();
  @Output() cursorStateChange = new EventEmitter<BodeCursorState[]>();
  @Output() activeCurveChange = new EventEmitter<number>();
  @Output() zoomCommand       = new EventEmitter<'in' | 'out-one' | 'out-all' | 'reset'>();

  private readonly service = new BodePlotService();
  private initialized = false;

  constructor(private readonly zone: NgZone) {}

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => this.initService());
    this.initialized = true;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.initialized) return;
    // Full re-init only on data or config changes — cursors/active can be patched
    if (changes['compositeCurves'] || changes['config'] || changes['axisState']) {
      this.zone.runOutsideAngular(() => {
        this.service.destroy();
        this.initService();
      });
      return;
    }
    if (changes['cursors']) this.zone.runOutsideAngular(() => this.service.setCursors(this.cursors));
    if (changes['activeCurveNumber']) this.zone.runOutsideAngular(() => this.service.setActive(this.activeCurveNumber));
  }

  ngOnDestroy(): void { this.service.destroy(); }

  // Public delegators (for host toolbar buttons)
  zoomOutOneLevel(): void { this.zone.runOutsideAngular(() => this.service.zoomOutOneLevel()); }
  zoomOutAll():      void { this.zone.runOutsideAngular(() => this.service.zoomOutAll()); }
  resetZoom():       void { this.zone.runOutsideAngular(() => this.service.resetZoom()); }

  private initService(): void {
    this.service.init(
      this.hostRef.nativeElement,
      this.compositeCurves,
      this.axisState,
      this.cursors,
      this.activeCurveNumber,
      this.config,
      {
        onAxisChange:   (s) => this.zone.run(() => this.axisStateChange.emit(s)),
        onCursorChange: (c) => this.zone.run(() => this.cursorStateChange.emit(c)),
        onActiveChange: (n) => this.zone.run(() => this.activeCurveChange.emit(n)),
      },
    );
  }
}
```

**Rules:**
- Never call `markForCheck` from the zoom hot path — outputs already trigger CD via `zone.run(...)`.
- Do **not** move zoom throttling into the component. It belongs in the service (see §10).

---

## 6. SVG layer contract (D3)

Inside `BodePlotService.init(...)`, build a **single** `<svg>` with these groups in this creation order (later groups render on top):

```
<svg viewBox="0 0 W H">
  <defs>
    <clipPath id="bode-clip-amp"><rect .../></clipPath>
    <clipPath id="bode-clip-phase"><rect .../></clipPath>
  </defs>
  <g class="bode-root" transform="translate(padLeft, padTop)">
    <g class="bode-axes">
      <g class="bode-y-amp-axis"/>
      <g class="bode-y-phase-axis"/>
      <g class="bode-x-axis"/>              ← shared X, drawn at the phase region's bottom
    </g>
    <g class="bode-grid-amp"/>
    <g class="bode-grid-phase"/>
    <g class="bode-plot-amp"   clip-path="url(#bode-clip-amp)">
      <g class="bode-curves-comparison-amp"/>
      <g class="bode-curves-primary-amp"/>
    </g>
    <g class="bode-plot-phase" clip-path="url(#bode-clip-phase)">
      <g class="bode-curves-comparison-phase"/>
      <g class="bode-curves-primary-phase"/>
    </g>
    <g class="bode-cursors"/>                ← spans both regions; no clip
    <g class="bode-overlays"/>               ← brush rect, hover halo
  </g>
  <!-- Three transparent interaction rects — one per hit region -->
  <rect class="hit-x"       pointer-events="all" fill="transparent"/>
  <rect class="hit-y-amp"   pointer-events="all" fill="transparent"/>
  <rect class="hit-y-phase" pointer-events="all" fill="transparent"/>
  <rect class="hit-plot-amp"   pointer-events="all" fill="transparent"/>
  <rect class="hit-plot-phase" pointer-events="all" fill="transparent"/>
</svg>
```

Why five hit rects: wheel zoom routes to a different scale depending on where the cursor is. The transparent rect pattern is proven in `polar-plot.service.ts` — do not attach zoom listeners directly to `<svg>`; wheel events over blank chart space would miss.

---

## 7. Scales and layout

`BodePlotService` owns these members:

```ts
private xScale!:      d3.ScaleLinear<number, number>;
private yAmpScale!:   d3.ScaleLinear<number, number>;
private yPhaseScale!: d3.ScaleLinear<number, number>;

private plotWidth = 0;      // inner width  after padding
private ampHeight = 0;      // amplitude region height
private phaseHeight = 0;    // phase region height
private ampTop = 0;         // y-offset (in root coords) of amplitude region top
private phaseTop = 0;       // y-offset of phase region top
```

Layout math on init/resize:

```
plotWidth   = W - padLeft - padRight
plotHeight  = H - padTop  - padBottom
ampHeight   = round( (plotHeight - gutter) * ampRegionRatio )
phaseHeight = plotHeight - gutter - ampHeight
ampTop      = 0
phaseTop    = ampHeight + gutter
```

Ranges:

```ts
xScale.range([0, plotWidth]);
yAmpScale.range([ampHeight, 0]);              // top of amp region is max
yPhaseScale.range([phaseTop + phaseHeight, phaseTop]);  // increasing downward
```

Domains:
- `xScale.domain([xMin, xMax])` — union of all composites' amplitude `xValues`.
- `yAmpScale.domain([0, yAmpMax])` — if all amplitudes are ≥ 0, do **not** apply a negative offset (§3.4 of the guide).
- `yPhaseScale.domain([0, 360])` when `phaseRolloverEnabled=false`. Otherwise the natural extent of phase values (typically `[-180, 180]`).

**Phase axis reversal:** in the reference image, phase increases downward (0° at top, 360° at bottom). Achieve this by inverting the range, not by negating the data: `yPhaseScale.range([phaseTop, phaseTop + phaseHeight])`.

**Nice-tick snap:** reuse the `niceAmplitudeDomain` idea from `polar-plot.service.ts` (see `niceAmplitudeDomain()` at `polar-plot-workspace/projects/ngx-radial-area/src/lib/polar-plot.service.ts`) for both Y scales so grid rings stay evenly spaced across zooms.

---

## 8. Curve rendering

Use `d3.line()` (Cartesian, not radial). Invalid-segment handling is a hard requirement from §3.7 of the guide.

```ts
const line = d3.line<{x:number; y:number; status:StatusPoint}>()
  .defined(d => d.status === 'Valid')          // breaks the line at invalid samples
  .x(d => xScale(d.x))
  .y(d => yAmpScale(d.y))
  .curve(d3.curveLinear);                      // Bode uses linear, NOT catmull-rom
```

Rules:
- Store parallel arrays as they arrive from the source (`xValues`, `yValues`, `yStatus`). Zip them lazily when building the `line()` input so the render step is O(n) and stays cache-friendly.
- Comparison curves render **below** primary curves (see group order in §6) so the primary is always on top.
- Active state: primary curves at `activeOpacity`; comparison/inactive at `inactiveOpacity`.
- Single-sample curves: render as a dot only, no `<path>`. Radius = `lineWidth + 1`.

Redraw contract — every draw path takes the composite list and builds one `<path>` per side per curve. Use `.join` for enter/update/exit; do not manually diff.

---

## 9. Cursors A/B

The reference image shows one vertical cursor line spanning both plot regions. Two independent cursors: A (default visible), B (optional).

Implementation:

```ts
private buildCursor(index: 0 | 1): void {
  const g = this.root.select('g.bode-cursors').append('g').attr('class', `cursor cursor-${index}`);
  // Vertical line from top of amp region to bottom of phase region
  g.append('line').attr('class', 'cursor-line')
    .attr('y1', ampTop).attr('y2', phaseTop + phaseHeight)
    .attr('stroke', index === 0 ? '#FF6B00' : '#0088CC')
    .attr('stroke-width', 1.5);
  // Two markers (dots) — one on the amp curve, one on the phase curve
  g.append('circle').attr('class', 'cursor-dot-amp').attr('r', 4);
  g.append('circle').attr('class', 'cursor-dot-phase').attr('r', 4);
  // Draggable handle at the top
  g.append('rect').attr('class', 'cursor-handle')
    .attr('y', ampTop - 12).attr('height', 12).attr('width', 10)
    .style('cursor', 'ew-resize')
    .call(d3.drag<SVGRectElement, unknown>()
      .on('drag', (event) => this.onCursorDrag(index, event.x)));
}
```

Nearest-sample lookup uses `d3.bisector` — binary search on sorted `xValues`. The **active** curve's amplitude drives the cursor's snap point; phase is looked up at the same index (see guide §3.8).

```ts
private snapCursor(index: 0 | 1, xPixel: number): BodeCursorState {
  const xVal = xScale.invert(xPixel);
  const active = this.getActiveComposite();
  const i = d3.bisectCenter(active.amplitude.xValues, xVal);
  const ampY   = active.amplitude.yValues[i];
  const phaseY = active.phase?.yValues[i];
  const ampStatus = active.amplitude.yStatus?.[i] ?? 'Valid';
  return {
    cursorIndex: index,
    xValue: active.amplitude.xValues[i],
    ampValue: ampY,
    phaseValue: phaseY,
    timestampUtc: active.amplitude.timestampsUtc?.[i],
    isInvalid: ampStatus !== 'Valid',
  };
}
```

Cursor state is a mirror of `BodeCursorState[]` — emit `cursorStateChange` after every drag step (already throttled by the browser drag event rate; no rAF needed).

---

## 10. Zoom (region-aware) — the hot path

**Do not use `d3.zoom()` for the wheel path.** It applies a geometric transform that would distort the two regions independently. Use the raw-listener + rAF pattern from `polar-plot.service.ts`.

### 10.1 Hit-region routing

On `wheel`:

```ts
const [mx, my] = d3.pointer(event, this.root.node()!);
const region = this.hitTest(mx, my);
// region ∈ 'x-axis' | 'y-amp' | 'y-phase' | 'plot-amp' | 'plot-phase' | null
```

Which scale each region updates:

| Region | Scale updated | Behaviour |
|---|---|---|
| `x-axis`, `plot-amp`, `plot-phase` (default) | `xScale.domain` | Zoom X centred on cursor's X value |
| `y-amp` | `yAmpScale.domain` | Zoom amplitude Y centred on cursor's Y value |
| `y-phase` | `yPhaseScale.domain` | Zoom phase Y centred on cursor's Y value |

### 10.2 Wheel handler + rAF coalescing

Copy the throttling structure verbatim from `polar-plot.service.ts:617-641`. Constants:

```ts
const ZOOM_SENSITIVITY = 100;      // 100 px deltaY == one 10% zoom step
const ZOOM_MIN = 0.05;             // zoom out up to 20×
const ZOOM_MAX = 50;               // zoom in up to 50×
```

Formula per event:

```ts
const factor = Math.pow(1.1, -event.deltaY / ZOOM_SENSITIVITY);
```

Zoom around the cursor (semantic — mutate domain, redraw):

```ts
private zoomScaleAround(scale: d3.ScaleLinear<number,number>, pixel: number, factor: number): void {
  const [d0, d1] = scale.domain();
  const centre   = scale.invert(pixel);
  const nd0 = centre - (centre - d0) / factor;
  const nd1 = centre + (d1 - centre) / factor;
  scale.domain([nd0, nd1]);
}
```

Every zoom step:
1. Compute new domain (above).
2. Push previous domains to the zoom history stack.
3. `redraw()` — axes ticks, grid rings, all curves, cursor projection.
4. Emit `onAxisChange` (throttled to one per rAF tick).

### 10.3 Rubber-band brush zoom (drag)

Use `d3.brush()` on a **temporary overlay** that appears on `mousedown` in the plot area and disappears on `mouseup`:

- Drag left-to-right → brush selection → apply as new X domain.
- Drag right-to-left → treat as **zoom-out-one-level** (§3.5 of the guide).
- Drag inside a Y region → Y zoom of that region only.
- Drag across regions → X zoom only.

### 10.4 Zoom history stack

```ts
private history: BodeZoomState[] = [];

private pushHistory(): void {
  this.history.push({
    xRange:      [...this.xScale.domain()]     as [number, number],
    yAmpRange:   [...this.yAmpScale.domain()]  as [number, number],
    yPhaseRange: [...this.yPhaseScale.domain()] as [number, number],
  });
}

zoomOutOneLevel(): void {
  const prev = this.history.pop();
  if (!prev) return this.zoomOutAll();
  this.xScale.domain(prev.xRange);
  this.yAmpScale.domain(prev.yAmpRange);
  this.yPhaseScale.domain(prev.yPhaseRange);
  this.redraw();
}

zoomOutAll(): void {
  this.history = [];
  this.applyBaseDomains();      // restores the domains captured on init
  this.redraw();
}
```

### 10.5 preventDefault

Attach the wheel listener with `{ passive: false }` and call `event.preventDefault()` — otherwise the page scrolls under the chart. This is the same pattern documented in `d3-radial-area-plot-research.md` §4.4.

---

## 11. Pan

`d3.drag()` on the plot region hit rects, active only when the user holds a modifier key (default: Shift). This avoids conflicting with brush-zoom drag.

```ts
d3.drag<SVGRectElement, unknown>()
  .filter(event => event.shiftKey && event.button === 0)
  .on('drag', (event) => {
    const dx = -event.dx;
    const [d0, d1] = this.xScale.domain();
    const step = (d1 - d0) / this.plotWidth * dx;
    this.xScale.domain([d0 + step, d1 + step]);
    this.redraw();
  });
```

Pan constraints: clamp the domain against the initial data extent so the user cannot pan into pure whitespace. This is different from zoom — you may go past the extent when zooming out, but never when panning.

---

## 12. Unit switching + phase rollover

X-unit conversion happens at the **axis label formatter**, not the data. Data stays in a canonical unit (RPM); the formatter transforms display values only:

```ts
const RPM_TO_HZ    = 1 / 60;
const RPM_TO_RADPS = (2 * Math.PI) / 60;

private xFormatter(unit: XUnit): (v: number) => string {
  switch (unit) {
    case 'RPM':       return v => d3.format(',d')(v);            // integer, no decimals
    case 'Hz':        return v => d3.format('.2f')(v * RPM_TO_HZ);
    case 'RadPerSec': return v => d3.format('.2f')(v * RPM_TO_RADPS);
  }
}
```

**Phase rollover toggle:**
- `phaseRolloverEnabled = true` → domain is natural extent, e.g. `[-180, 180]`, y-axis ticks every 45° or 90°.
- `phaseRolloverEnabled = false` → clamp domain to `[0, 360]`, tick every 45° or 60°. Phase values below 0 wrap to `+360`, above 360 wrap to `-360`. This wrap happens at **render time**, not at data time.

Phase labels always use a degree formatter: `v => `${v.toFixed(0)}°``. Never the generic numeric formatter.

---

## 13. Comparison / overlay curves

`BodeCompositeCurve.curveType = 'comparison'` — same shape, but styled dimmed and rendered below the primary group (see §6). Rules:

- Cursor readouts still use the **active primary** curve for its snap point; comparison curves have their own dots at the same X.
- Toolbar filter can hide comparison curves without unmounting the component — service exposes `setComparisonVisibility(id: string, visible: boolean)`.
- Legend groups comparison entries under their `comparisonReferenceSetId`.

---

## 14. Export — `bode-export.service.ts`

Pure functions. No SVG dependency. Takes the same domain model as the service.

### 14.1 JSON snapshot

```ts
export interface BodeSnapshot {
  version: 1;
  createdAtUtc: number;
  axis: BodeAxisState;
  cursors: BodeCursorState[];
  activeCurveNumber?: number;
  composites: BodeCompositeCurve[];
}

export function toJsonSnapshot(input: Omit<BodeSnapshot, 'version' | 'createdAtUtc'>): BodeSnapshot;
```

### 14.2 CSV export

One row per sample of the active primary composite. Columns:

```
speed_rpm, speed_display, amplitude, amp_status, phase_deg, phase_status, timestamp_utc, timestamp_iso
```

Include cursor rows as a separate footer block prefixed with `# Cursor` — mirrors the desktop export format described in §3.10 of the guide.

Speed formatting: **RPM is integer with no decimals** (§3.3 of the guide). Hz / rad-s use 2 decimals.

Timestamp column is optional — omit if no `timestampsUtc` on the curve. Do not emit empty columns for absent phase.

---

## 15. Data adapter for `bode_plotData.csv`

Create `bode-csv-adapter.ts` that takes the raw CSV string and returns a `BodeCompositeCurve`.

Layout of `bode_plotData.csv`:
- Rows 1–7: metadata (`Machine Name`, `Point Name`, `Comp`, `Probe Angle`, `X-Axis Unit`, `Y-Axis Unit`, `Variable`).
- Row 8: header (`X-Axis Value, Y-Axis Value, Y-Axis Status, Phase, Phase Status, Timestamp`).
- Row 9+: data.

Parse rules:
- Trim each line, split on `,`.
- Metadata block ends when the header row is found. Extract `X-Axis Unit` (should be `rpm`) and `Y-Axis Unit` (e.g. `mil pp`) — feed these into the returned axis state.
- Data rows: parse `X-Axis Value` as float (may be int), `Y-Axis Value` as float, `Phase` as float, statuses as `StatusPoint`, `Timestamp` as `Date.parse(...)` → epoch ms.
- Split into two parallel `BodeCurve` objects: `amplitude` (from `Y-Axis Value` + `Y-Axis Status`) and `phase` (from `Phase` + `Phase Status`). Both share the same `xValues` and `timestampsUtc`.
- Return `{ primaryCurveNumber: 1, amplitude, phase, curveType: 'primary', isActive: true, label: <Point Name> }`.

Export the pure loader alongside a demo helper that also embeds the CSV string (so the demo can be run without file I/O):

```ts
export function parseBodeCsv(csvText: string): { composite: BodeCompositeCurve; axis: Partial<BodeAxisState> };
export const sampleBodeCsv: string;   // embedded for demo/testing
```

---

## 16. Demo integration — `polar-plot-demo`

Extend `AppComponent` to add a Bode tab alongside the polar plot:

1. Add `chartType: 'polar' | 'radial' | 'bode'` to the toggle union.
2. Import `NgxBodePlotComponent` from `'ngx-bode-plot'`.
3. Add a data field:
   ```ts
   bodeComposite: BodeCompositeCurve = parseBodeCsv(sampleBodeCsv).composite;
   bodeAxis: BodeAxisState = { /* filled from parseBodeCsv */ };
   bodeCursors: BodeCursorState[] = [];
   ```
4. Template block:
   ```html
   <ngx-bode-plot
     *ngIf="chartType === 'bode'"
     [compositeCurves]="[bodeComposite]"
     [axisState]="bodeAxis"
     [cursors]="bodeCursors"
     (cursorStateChange)="bodeCursors = $event"
     (axisStateChange)="bodeAxis = $event"
   />
   ```
5. Sidebar: X-unit dropdown (RPM/Hz/Rad/s), phase-rollover toggle, zoom-out-one-level button, zoom-out-all button, comparison-visibility toggle.

Do **not** duplicate CSS between polar-plot styling and bode styling. Reuse the sidebar shell.

---

## 17. Testing

Same infrastructure as the existing libs — Karma + Jasmine, ChromeHeadless, `--watch=false`. Add `test:bode` to root `package.json`.

### 17.1 Service specs — `bode-plot.service.spec.ts`

At minimum, cover:

1. **Init produces the expected SVG structure** — assert one `<g class="bode-axes">`, one `<g class="bode-plot-amp">`, one `<g class="bode-plot-phase">`, and 5 transparent hit rects.
2. **Two independent Y scales** — set an axis state with distinct ranges, read back `yAmpScale.domain()` and `yPhaseScale.domain()`, assert both.
3. **Curve rendering with invalid samples produces broken lines** — feed 5 points with `yStatus[2] === 'Invalid'`, assert the resulting path has an `M` command after the break (i.e. more than one subpath).
4. **Wheel zoom over the X axis rect** narrows the X domain and does not touch the Y domains.
5. **Wheel zoom over the Y-amp rect** narrows the amp domain only.
6. **`zoomOutOneLevel` restores the previous domain** — synthesize two zoom events, call the method, assert domain match.
7. **`zoomOutAll` restores base domains** captured on init.
8. **Cursor snap picks the nearest X index** — feed `[100, 200, 300, 400]`, call `snapCursor(0, xScale(210))`, expect `xValue === 200`.
9. **Phase rollover clamped** — set `phaseRolloverEnabled: false`, assert `yPhaseScale.domain() === [0, 360]`.
10. **`destroy` removes all SVG nodes and cancels pending rAFs**.

Use a fake host element:

```ts
const host = document.createElement('div');
document.body.appendChild(host);
const svc = new BodePlotService();
svc.init(host, [composite], undefined, [], undefined, {}, {});
```

Clean up in `afterEach`.

### 17.2 Component specs — `ngx-bode-plot.component.spec.ts`

1. Creates the component.
2. `<ngx-bode-plot>` mounts an `<svg>` inside the host `<div>`.
3. Changing `compositeCurves` via `fixture.componentRef.setInput('compositeCurves', [...])` triggers re-render (assert new `<path>` count).
4. `cursorStateChange` fires after simulating a cursor drag event.
5. `axisStateChange` fires with narrower `xRange` after a synthetic `wheel` event on the X hit rect.
6. `ngOnDestroy` clears the SVG.

Follow the OnPush-input rule: **always** use `componentRef.setInput` in tests. Direct assignment to `component.compositeCurves` will be silently ignored.

### 17.3 CSV adapter specs — `bode-csv-adapter.spec.ts`

1. Metadata block is parsed (X unit + Y unit picked up).
2. Row count matches the number of data lines in the fixture.
3. Invalid rows are marked as `StatusPoint === 'Invalid'`.
4. Timestamps convert to positive integers.
5. Missing phase column does not throw — returns `phase: undefined`.

### 17.4 Acceptance smoke — do this manually before declaring done

- `npm run test:ci` passes (radial + polar + bode + demo).
- `npm start`, switch to the Bode tab, verify:
  - Both regions visible with independent Y ticks.
  - Wheel over the phase Y region moves phase ticks only.
  - Cursor A drags left–right and shows amplitude + phase.
  - Toggle phase rollover to `clamped-360` — Y ticks re-lay at [0, 360].
  - Change X unit to Hz — labels update; data does not shift.
  - Export button downloads a CSV whose first data row matches the CSV header row of `bode_plotData.csv`.

---

## 18. Performance rules (non-negotiable)

1. **`runOutsideAngular`** around every D3 init, `redraw`, drag, and wheel handler. Re-enter zone only for `@Output()` emissions.
2. **rAF coalescing** — copy the `rafId` + `pendingZoom` pattern from `polar-plot.service.ts:69-72`. One DOM update per animation frame, no matter how many wheel events fire.
3. **Parallel arrays > object arrays** — do not convert `xValues[] + yValues[]` to `{x,y}[]`. It doubles allocations for large datasets (`bode_plotData.csv` has thousands of rows).
4. **`.join` for enter/update/exit** — never manually `remove().append()` in a loop.
5. **Binary search via `d3.bisector`** for cursor snap. Linear scan is O(n) and blocks drag.
6. **Cache scale-invert results** during a single frame — do not call `scale.invert()` twice for the same pixel.
7. **Guard rAF against destroy** — `destroy()` must `cancelAnimationFrame(rafId)` and null both `rafId` and `pendingZoom`. Otherwise the callback fires against a removed SVG.
8. **Pre-decimate for very large samples** (>10,000 points): compute one representative point per plotWidth pixel using largest-triangle-three-buckets or plain stride sampling. Cursor snap always uses full resolution — decimation is a render-only optimisation.

---

## 19. Common pitfalls

| Symptom | Root cause | Fix |
|---|---|---|
| Wheel scrolls the page under the chart | Missing `event.preventDefault()` or listener attached with `{ passive: true }` (default) | Attach with `{ passive: false }` and call `preventDefault()`. |
| Phase y-axis ticks bunch at the top | Range direction not inverted | `yPhaseScale.range([phaseTop, phaseTop + phaseHeight])` (increasing downward). |
| Cursor drifts off the curve after zoom | Cursor coord recomputed from stale pixel, not from `xValue` | Store `cursorState.xValue` in domain units; recompute pixel from `xScale(xValue)` on every redraw. |
| `zoomOutOneLevel` skips history entries | `pushHistory` called on every rAF tick instead of once per gesture | Push once per user gesture start (mousedown / wheel-batch-begin), not per frame. |
| Curves connect across invalid samples | `line().defined(...)` missing | Add `.defined(d => d.status === 'Valid')`. |
| Phase looks wrong when `rollover=false` and data has negative values | Wrap logic in the data layer instead of render | Wrap only at render: `((v % 360) + 360) % 360`. Keep raw data intact for export. |
| `destroy` leaves rAF running | rAF not cancelled | `cancelAnimationFrame(this.rafId)` in `destroy()`. |
| OnPush input changes don't trigger re-render in tests | Direct property assignment on the component instance | Use `fixture.componentRef.setInput('name', value)`. |
| Demo TypeScript build fails after adding lib | Path mapping missing | Add `"ngx-bode-plot"` to root `tsconfig.json` `paths`. |

---

## 20. Acceptance checklist (mirrors `bode_plot_Guide.md` §6 + §8)

Tick every box before declaring done:

- [ ] Composite curve add/remove/update touches both amplitude and phase.
- [ ] Phase absent renders amplitude-only chart without errors.
- [ ] Shared X axis; independent Y scales (amp + phase) visually and functionally.
- [ ] X unit toggle (RPM / Hz / Rad-s) updates labels only, not data.
- [ ] Phase rollover toggle switches between clamped-360 and natural extent.
- [ ] Wheel zoom routes by hit region (X, Y-amp, Y-phase, plot).
- [ ] Rubber-band brush zoom works; right-to-left drag = zoom-out-one-level.
- [ ] Zoom history stack supports `zoomOutOneLevel` and `zoomOutAll`.
- [ ] Pan with Shift+drag.
- [ ] Cursor A drag → readout shows X, amplitude, phase (if present), timestamp, invalid flag.
- [ ] Cursor B toggle-on and independent drag.
- [ ] Comparison curves render dimmed, below primary. Toggle-off does not break cursor.
- [ ] CSV export: RPM as integer; phase column omitted when phase absent.
- [ ] JSON snapshot round-trips (import + export produce equivalent state).
- [ ] All tests pass: `npm run test:ci`.
- [ ] Manual smoke of the demo (see §17.4) passes.

---

## 21. Implementation sequence (execute in order)

If in doubt, follow this order and commit after each step so any regression is bisectable.

1. **Scaffold `ngx-bode-plot`** (§3). Verify `npm run build:bode` succeeds with an empty component.
2. **Domain model** (§4). Add types; export from `public-api.ts`.
3. **Static layout** — build the SVG structure (§6), scales (§7), and axis ticks. No interaction yet. Verify visually in the demo.
4. **Curve rendering** (§8), including invalid-segment breaks. Feed one composite from a hand-crafted array.
5. **CSV adapter** (§15). Wire `bode_plotData.csv` through the adapter into the demo.
6. **Cursor A** (§9). Verify snap + readout emission.
7. **Wheel zoom by region** (§10.1–10.2). Add rAF coalescing.
8. **Rubber-band brush zoom** (§10.3) + history stack (§10.4).
9. **Pan** (§11).
10. **Unit switching + phase rollover** (§12).
11. **Cursor B + comparison overlays** (§13).
12. **Export service** (§14).
13. **All tests** (§17).
14. **Acceptance smoke + checklist** (§20).

Every step should compile and pass existing tests before moving on. Do not merge multiple steps into one commit.

---

## 22. Notes to the implementing agent

- Treat Bode as **composite curves**, never as two independent lines. Every public surface must respect composite identity.
- Phase is optional at every layer — data, render, cursor, export.
- Match existing repo conventions: standalone + OnPush components, service-owned D3 state, `runOutsideAngular`, `.spec.ts` beside the source file, no barrel files except `public-api.ts`.
- **Do not** introduce a state-management library (NgRx, Signals store). The service already owns the render state; the component owns UI state. Angular Signals inside the component are fine if genuinely needed but not required.
- **Do not** add tooltips, animations beyond `animationDuration`, or theme systems unless a §20 checklist item requires it. Ship the checklist, then stop.
- If a decision is not covered here, prefer the choice that matches the desktop C# behaviour (`bode_plot_Guide.md` §3) over inventing a new one.
