# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Angular 19 monorepo delivering `ngx-radial-area` — a D3-powered chart library exposing **two independent components** — alongside a demo app. The library and app live in a nested Angular workspace at `polar-plot-workspace/`; the outer repo also holds reference material (`reasearch/`, `PROJECT_OVERVIEW.md`, `POLAR_PLOT_DESIGN_DOCUMENT.md`) and sample CSVs used to feed the demo. The `ngx-radial-area-package/` directory is a third-party reference and is gitignored — do not treat it as source of truth.

## Working Directory

**All development commands must be run from `polar-plot-workspace/`.** The user's global `ng` is an old v7 binary — use `npm` scripts or `npx ng` from inside the workspace. Requires Node 20+ (Angular 19 needs `^18.19.1 || ^20.11.1 || ^22`).

```bash
cd polar-plot-workspace
npm install
```

## Commands

```bash
npm start                       # ng serve polar-plot-demo → http://localhost:4200
npm run build                   # build demo app
npm run build:lib               # build library via ng-packagr → dist/ngx-radial-area
npm run build:all               # library, then app

npm run test:lib                # library specs, headless Chrome, watch=false
npm run test:app                # demo app specs, headless Chrome
npm run test:ci                 # both

# single spec file
npx ng test ngx-radial-area --watch=false --browsers=ChromeHeadless --include='**/radial-area.service.spec.ts'
```

Karma needs Chrome on macOS: `export CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"`.

## Architecture

### Two components, two services, one library

`public-api.ts` exports two independent chart surfaces plus a couple of data adapters:

| Component | Selector | Service | Purpose |
|---|---|---|---|
| `NgxRadialAreaComponent` | `ngx-radial-area` | `RadialAreaService` | Multi-series radial-area chart with dual radial scales, band angular scale, rubber-band wheel zoom on the radial range. Series are keyed via `RadialSeries.key` + flat `RadialDataPoint` rows. |
| `NgxPolarPlotComponent` | `ngx-polar-plot` | `PolarPlotService` | Single-series polar plot (phase/amplitude) with a movable cursor, vector arm, click-to-select, and exponential wheel zoom. Supports a sparse non-overlapping data-label overlay (`label-placement.ts`). |

Both components are standalone + OnPush, own a host `<div>`, and delegate all D3 to their service. **D3 init and the zoom callbacks run outside `NgZone`** (`zone.runOutsideAngular`) and re-enter the zone only to emit outputs — this is intentional to keep wheel/mouse events smooth. Preserve this pattern when editing.

### Semantic zoom (not geometric)

Both services rescale the radius **domain's pixel range** on every zoom tick and redraw, rather than applying an SVG `transform`. This keeps labels crisp and the inner radius anchored. `RadialAreaService` uses `d3.zoom()` on a transparent overlay `<rect>` (attaching to `<svg>` misses wheel events over empty space). `PolarPlotService` implements its own exponential wheel handler (constants `ZOOM_SENSITIVITY=100`, `ZOOM_MIN=0.2`, `ZOOM_MAX=20`) and throttles updates with `requestAnimationFrame` — multiple wheel events per frame collapse to one DOM update.

### Curves

Use `d3.curveCatmullRomClosed.alpha(0.5)` for radial areas — closed curves are required. **Do not switch to `curveMonotoneX/Y`**; radial data is non-monotonic when wrapped around a circle and breaks the path.

### Label placement (polar plot)

`label-placement.ts` is a TS port of a C# algorithm with three perf tweaks: OffscreenCanvas measurement (no DOM reflow), spatial-grid O(1) overlap checks, and a `thinCandidates()` pre-pass that only kicks in above `labelThreshold` (default 2000). When touching this, remember the goal is a **sparse readable overlay** on top of a dense curve — the curve always renders every point; only labels are thinned.

### Path mapping to library source

Root `tsconfig.json` maps `"ngx-radial-area"` → `./projects/ngx-radial-area/src/public-api.ts`, so the demo imports library source directly for fast iteration. **You do not need to `npm run build:lib` before running the demo.** For a real publish you'd repoint this to `./dist/ngx-radial-area`.

### Test conventions

- Component tests drive `@Input()` changes via `fixture.componentRef.setInput(...)` (OnPush ignores direct property writes on existing components).
- Services can be exercised via a fake host element (`document.createElement('div')`) and asserted against the SVG structure they produce (viewBox, group classes, path counts).

## Reference material

- `PROJECT_OVERVIEW.md` — full architecture writeup for the radial-area library (may lag behind current code — the polar plot pieces were added later).
- `POLAR_PLOT_DESIGN_DOCUMENT.md` — polar plot design notes.
- `reasearch/d3-radial-area-plot-research.md` — the D3 spec the radial-area library was built against.
- `reasearch/polar-plot-data-label-placement.md` — algorithm notes for `label-placement.ts`.
- `polarData1.csv`, `bode_plotData.csv` — real datasets the demo consumes via `csvPolarData` / `transformCsvToPolarPoints`.
