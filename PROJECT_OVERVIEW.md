# Engineering Plots — Radial Area Chart

An Angular 19 monorepo that delivers `ngx-radial-area`, a reusable D3-powered radial-area / polar-plot library, alongside a demo application that consumes it. The chart implements the design described in `reasearch/d3-radial-area-plot-research.md`: dual independent radial scales, an angular axis, concentric radial grid rings, and a rubber-band wheel-zoom interaction.

---

## 1. Repository Layout

```
angular-workspace/
├── PROJECT_OVERVIEW.md         ← you are here
├── Prompt                      ← original prompt notes
├── reasearch/
│   └── d3-radial-area-plot-research.md   ← the spec we built against
└── polar-plot-workspace/       ← Angular 19 workspace
    ├── angular.json
    ├── package.json
    ├── tsconfig.json           ← path mapping: "ngx-radial-area" → library source
    └── projects/
        ├── ngx-radial-area/    ← the library (ng-packagr)
        │   └── src/
        │       ├── public-api.ts
        │       └── lib/
        │           ├── radial-area.models.ts
        │           ├── radial-area.service.ts
        │           ├── ngx-radial-area.component.ts
        │           ├── ngx-radial-area.component.spec.ts
        │           └── radial-area.service.spec.ts
        └── polar-plot-demo/    ← the consumer application
            └── src/
                ├── main.ts
                ├── styles.scss
                └── app/
                    ├── app.component.{ts,html,scss,spec.ts}
                    └── app.config.ts
```

> The `ngx-radial-area-package/` directory at the repository root is a third-party reference and is intentionally excluded from version control via `.gitignore`.

---

## 2. Tooling & Versions

| Component | Version |
|---|---|
| Angular | **19.2** (standalone APIs, OnPush) |
| TypeScript | 5.7 |
| Node.js (runtime) | **20.19.2** (Angular 19 requires `^18.19.1 \|\| ^20.11.1 \|\| ^22`) |
| D3 | 7.9 (`@types/d3` 7.4) |
| Build (lib) | `ng-packagr` 19 |
| Build (app) | `@angular-devkit/build-angular:application` (esbuild) |
| Tests | Karma 6.4 + Jasmine 5.6, run headless via Chrome |

The workspace must be driven with Node 20+. The user's global `ng` is an old v7 binary — use `npm` scripts or `npx ng` from inside the workspace.

```bash
nvm use 20.19.2
cd polar-plot-workspace
npm install
```

---

## 3. The Library — `ngx-radial-area`

### 3.1 Public API (`projects/ngx-radial-area/src/public-api.ts`)

```ts
export * from './lib/radial-area.models';
export * from './lib/radial-area.service';
export * from './lib/ngx-radial-area.component';
```

Three exported surfaces: the data model interfaces, the rendering service, and the standalone component.

### 3.2 Models (`radial-area.models.ts`)

```ts
interface RadialDataPoint { label: string; [key: string]: number | string; }
interface RadialSeries    { key: string; label: string; color: string; domain?: [number, number]; }
interface RadialAreaConfig { /* width, height, innerRadius, outerRadius,
                              zoomMin, zoomMax, zoomSensitivity,
                              showGrid, showSpokes, showAngularLabels,
                              showRadialLabels, gridTicks,
                              animationDuration, darkMode */ }
interface ZoomEvent       { scale: number; transform: { k: number; x: number; y: number }; }
const DEFAULT_CONFIG: Required<RadialAreaConfig>;
```

A `RadialDataPoint` carries a `label` plus one numeric field **per series**. Each `RadialSeries` declares which key it reads. This keeps the dataset shape flat while supporting N independent series on the same chart.

### 3.3 Component (`ngx-radial-area.component.ts`)

Standalone, OnPush, `selector: ngx-radial-area`. Surface:

```html
<ngx-radial-area
  [data]="data"
  [series]="series"
  [config]="config"
  [showControls]="true"
  [showHint]="true"
  (zoomChange)="onZoom($event)"
  (zoomReset)="onReset()"
></ngx-radial-area>
```

Responsibilities:

- Owns the `<div #chartHost>` element and a small UI shell (legend, zoom indicator, reset button, hint).
- Delegates all D3 work to `RadialAreaService`.
- Calls `service.init()` in `ngAfterViewInit`, `service.update()` on `ngOnChanges`, `service.destroy()` in `ngOnDestroy`.
- Runs the D3 setup and the zoom callback **outside Angular** (`NgZone.runOutsideAngular`) and re-enters the zone only to emit outputs / mark for check — avoids change-detection storms on wheel events.

### 3.4 Service (`radial-area.service.ts`)

Pure D3 rendering engine. Key decisions, mapped to the research doc:

| Research section | Implementation |
|---|---|
| §3.1 Angular axis | `d3.scaleBand` over `[0, 2π]`, `paddingInner/Outer = 0`. `midAngle(label)` adds `bandwidth / 2`. |
| §3.2 Radial axis | One `d3.scaleLinear` per series, `domain` from `series.domain` or `d3.max`, `range = [innerRadius, outerRadius]`. |
| §3.3 Dual axes | `scales: Map<seriesKey, ScaleLinear>` — each series picks its own scale, both share the same pixel range so they overlay cleanly. |
| §4 Rubber-band zoom | `d3.zoom().scaleExtent([zoomMin, zoomMax]).wheelDelta(...)`. On zoom, **rescale the radius range** (semantic zoom), not the SVG transform. |
| §4.4 Page scroll | Transparent `<rect>` overlay sized to the SVG receives all wheel events; `event.preventDefault()` on `wheel`. |
| §4.5 Dblclick reset | `overlay.on('dblclick.zoom', …)` transitions back to `d3.zoomIdentity` over `animationDuration` ms. |
| §6 Clip path | `<clipPath id="radial-clip">` with radius `outerRadius + 35`, applied to the inner `chartGroup`. Prevents area overflow at high zoom. |
| §2 Curves | `d3.curveCatmullRomClosed.alpha(0.5)` — closed curves are required for radial paths; `curveMonotoneX/Y` would break, per the research warning. |

Rendering layers (matching §5):

```
<svg>
  <defs><clipPath id="radial-clip"><circle r="…"/></clipPath></defs>
  <g translate(cx, cy)>
    <g clip-path="url(#radial-clip)">
      <g class="ngx-ra-grid"/>           ← concentric rings per series + inner disc
      <g class="ngx-ra-spokes"/>         ← optional radial lines
      <g class="ngx-ra-area-{key}"/>     ← one group per series: area path + line path + dots
    </g>
    <g class="ngx-ra-angular-labels"/>   ← month/day labels around perimeter
    <g class="ngx-ra-radial-labels"/>    ← tick values (series 0 at 12 o'clock, series 1 at 3 o'clock)
  </g>
  <rect width=… height=… pointer-events="all"/>   ← zoom listener overlay
</svg>
```

Semantic-zoom hot path:

```ts
.on('zoom', (event) => {
  const k = event.transform.k;
  const zoomedOuter = innerRadius + (baseOuterRadius - innerRadius) * k;
  this.scales.forEach(scale => scale.range([innerRadius, zoomedOuter]));
  this.redraw();
  this.onZoomCallback?.({ scale: k, transform: event.transform });
});
```

`redraw()` rebuilds grid, areas, angular labels, and radial labels every tick. Spokes are static (drawn once in `init` / `update`) because their angles don't change with zoom.

### 3.5 Source path-mapping vs. built dist

`tsconfig.json` at the workspace root maps the library name to source for fast dev iteration:

```json
"paths": { "ngx-radial-area": ["./projects/ngx-radial-area/src/public-api.ts"] }
```

For a real publish flow you'd switch this to `./dist/ngx-radial-area` and run `npm run build:lib` first.

---

## 4. The Demo Application — `polar-plot-demo`

Standalone bootstrap (`main.ts` → `bootstrapApplication(AppComponent, appConfig)`). The `AppComponent`:

- Ships two illustrative datasets: **Weather** (12 months × `temp` °C + `rain` mm) and **Server Load** (7 days × `cpu` % + `memory` %).
- Renders a sidebar with a dataset switcher, grid/spokes toggles, a live zoom indicator, and a usage code snippet.
- Wires `(zoomChange)` and `(zoomReset)` to update the on-screen scale readout.

The two datasets use independent series colors and `domain` declarations, demonstrating the **dual-scale** capability from research §3.3.

---

## 5. Tests

**Library — 14 specs in 2 files**

- `ngx-radial-area.component.spec.ts` — creation, SVG mounting + viewBox, one area group per series, legend item count, OnPush input updates via `componentRef.setInput`, reset emission, SVG teardown on destroy.
- `radial-area.service.spec.ts` — SVG viewBox, per-series linear scales (auto vs. explicit `domain`), band scale domain/range, presence of grid / spokes / area+line paths / per-point dots, `update()` rebuilds scales for new series, wheel event invokes the zoom callback with `scale > 1`, `destroy()` removes the SVG and clears state.

**App — 7 specs in `app.component.spec.ts`** — creation, heading text, `<ngx-radial-area>` is in the DOM, default dataset state, dataset switching via the sidebar button, `toggleGrid` updates `chartConfig`, `onZoomChange` / `onZoomReset` update `currentZoom`.

```bash
npm run test:lib    # 14/14
npm run test:app    #  7/7
npm run test:ci     # both, headless
```

> Karma needs Chrome: `export CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"` on macOS. The `test:*` scripts use `--browsers=ChromeHeadless`.

---

## 6. npm Scripts

```jsonc
{
  "start":     "ng serve polar-plot-demo",
  "build":     "ng build polar-plot-demo",
  "build:lib": "ng build ngx-radial-area",
  "build:all": "npm run build:lib && npm run build",
  "watch":     "ng build polar-plot-demo --watch --configuration development",
  "test":      "ng test",
  "test:lib":  "ng test ngx-radial-area --watch=false --browsers=ChromeHeadless",
  "test:app":  "ng test polar-plot-demo --watch=false --browsers=ChromeHeadless",
  "test:ci":   "npm run test:lib && npm run test:app"
}
```

---

## 7. Running Locally

```bash
nvm use 20.19.2
cd polar-plot-workspace
npm install
npm start                  # → http://127.0.0.1:4200/
```

Interactions:
- **Scroll wheel** over the chart — radial scale rubber-band-zooms.
- **Double-click** — animated reset to 1×.
- **Reset** button — same as dblclick.
- **Weather / Server Load** — swap datasets and series scales.
- **Grid rings / Spokes** — toggle the radial guides.

---

## 8. Design Notes & Trade-offs

- **Semantic vs. geometric zoom.** We rescale the radial domain's pixel range on every zoom tick rather than applying a `transform` to the chart group. The chart stays crisp, labels don't stretch, and the inner radius stays anchored.
- **OnPush + outside-zone D3.** The component is OnPush. The D3 init and the zoom callback run outside the Angular zone, then re-enter only to emit `zoomChange` / `zoomReset` and `markForCheck`. This keeps mouse-wheel zooming smooth even on slower hardware.
- **`setInput` in tests.** Because OnPush ignores direct property writes on existing components, tests use `fixture.componentRef.setInput(...)` to drive input changes (Angular 14+ API).
- **Closed curves only.** `curveCatmullRomClosed` matches the research recommendation. `curveMonotoneX/Y` is unsafe for radial paths (data is not monotonic when wrapped into a circle).
- **Why the `<rect>` overlay for zoom.** Attaching `d3.zoom` directly to the `<svg>` makes wheel events fire only over rendered geometry. The transparent overlay guarantees the listener covers the whole chart box.

---

## 9. Future Work

- Tooltips on point hover (per-series, polar-aware positioning).
- Optional transition between dataset switches (`d3.transition` on path interpolation).
- Dark-mode polish — `darkMode` config flag is honored by grid + label colors; needs corresponding host theming hooks.
- Publish the library to npm (`ng build ngx-radial-area && cd dist/ngx-radial-area && npm publish`).
- Brushable angular range (research §4 mentions `d3-brush` as an alternative interaction).

---

## 10. References

- Research spec: [`reasearch/d3-radial-area-plot-research.md`](reasearch/d3-radial-area-plot-research.md)
- D3 Radial Area: <https://d3js.org/d3-shape/radial-area>
- D3 Zoom: <https://d3js.org/d3-zoom>
- Angular 19 release notes: <https://blog.angular.dev/meet-angular-v19-7b29dfd05b84>
