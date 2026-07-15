# Bode Plot Implementation Guide (Angular + D3.js)

## 1. Goal

This document captures the current Bode implementation behavior from the C# codebase and translates it into an implementation blueprint for Angular + D3.js.

It is intended to help build a functionally equivalent web Bode plot with:
- Zoom
- Pan
- Curve rendering
- X/Y axes management
- Multi-axis segmented layout (main plot + subplot-like behavior)
- Cursor behavior
- Export readiness
- Overlay/comparison behavior

---

## 2. Source Implementation Reviewed

Primary files reviewed:

- `Framework/source/Framework/Code/Platform.Plots.Views/Views/BodePlot.cs`
- `Framework/source/Framework/Code/Platform.Plots.Views/Views/BodeDataView.cs`
- `Framework/source/Framework/Code/Platform.Plots.Views/Views/BodeViewChartSection.cs`
- `Framework/source/Framework/Code/Platform.Plots.Views/Views/BodeCursorPopupHelper.cs`
- `Framework/source/Framework/Code/Platform.Plots.Views/Views/XYViewChartSection.cs`
- `Framework/source/Framework/Code/Platform.Plots.Views/Views/PlotDataControl.cs`
- `Framework/source/Framework/Code/Platform.Plots.Views/ViewModels/PlotDataViewModel.cs`
- `Framework/source/Framework/Code/Platform.Plots.Views/Helpers/CurveStrategies/BodeStrategy.cs`
- `Framework/source/Framework/Code/Platform.Plots.Views/AxesRangeChangeHandlers/BodeAxisScalesCalculator.cs`
- `Framework/source/Framework/Code/Platform.Plots.Views/Helpers/ExportHelper/BodeExportDataHelper.cs`
- `Framework/source/Framework/Code/Platform.Plots.DataSources/PlotModels/BodePlotModel.cs`
- `Framework/source/Framework/Code/Platform.Plots.DataSources/CurveModels/CompositeCurveModel.cs`

Validation tests sampled:
- `System1/Test/XmlRpcApiTest/System1.XmlRpcApi.Li/LargeIntegrationSuite/PlottingDataScenarios/BodePlotFeatureValidation.cs`

---

## 3. Current Behavior Summary (What must be preserved)

## 3.1 Plot composition model

A Bode “logical curve” is **composite**:
- Amplitude curve
- Phase curve (optional for some measurements)

The two are linked by `PrimaryCurveNumber` and must be treated as one user-level curve entry.

### Required behavior
- Add/remove/update of a primary curve may imply add/remove/update of amplitude + phase pair.
- Phase may be absent and must not break rendering/export.
- Active curve operations should use primary/composite identity.

---

## 3.2 Axes model and subplot structure

The desktop implementation uses a segmented XY chart where each Y axis/segment can represent different scale data types (amplitude vs phase).

This is effectively a **subplot model inside one chart container**:
- Shared X axis (speed/frequency units)
- Multiple Y axis regions/segments
- Visibility-aware Y axis hit detection
- Per-segment curve activation in stacked mode

### D3 translation
Implement as:
- Shared `xScale`
- Two vertically stacked plot regions:
  - Top: amplitude
  - Bottom: phase
- Independent `yScaleAmplitude`, `yScalePhase`
- Shared interaction layer for synchronized zoom/pan/cursors

---

## 3.3 X-axis units and formatting

Supported display X units:
- RPM
- Hz
- Rad/s

Behavior:
- X-axis scale data type remains rotation-speed category.
- Cursor/export values use selected display unit.
- RPM formatting is integer-like in several paths (no decimals for speed formatting in export/cursor).

---

## 3.4 Y-axis specifics (critical)

- Bode sets Y-axis min-offset behavior differently than default.
- For amplitude, if min >= 0, special handling avoids extra negative offset.
- For phase:
  - Axis is reversed in some contexts (`PhaseScale` axis reversed)
  - Phase labels are specially formatted (degree rendering)
  - If phase rollover is off, max can be forced to 360°

### D3 recommendation
- Explicit phase scale mode:
  - `rollover=true`: allow wrapped phase behavior (e.g., -180..180 or continuous based on product design)
  - `rollover=false`: clamp/render up to 360 as required by current behavior
- Use dedicated phase formatter, not generic numeric formatter.

---

## 3.5 Zoom behavior

Two primary zoom paths exist:
1. **Mouse wheel zoom** on hovered axis region
2. **Rubber-band zoom** on drag in drawing region

Additional behavior:
- Right-to-left drag may trigger zoom-out-all behavior.
- One-level zoom out uses a zoom stack cache.
- Zoom state is persisted per curve/axis relationship.
- Sync-zoom support exists via shared events.

### D3 implementation target
- `d3.zoom()` for wheel + drag zoom
- Maintain custom zoom history stack for one-level undo
- Axis-region-aware zoom:
  - wheel over X axis -> X zoom
  - wheel over Y segment -> respective Y zoom
- Provide:
  - `zoomOutOneLevel()`
  - `zoomOutAll()`
  - optional global sync hooks (if multiple charts)

---

## 3.6 Pan behavior

Direct “pan function” is not explicitly visible in sampled Bode files, but axis range manipulation is event-driven and chart library supports axis interactions.

### D3 implementation target
Implement explicit panning:
- Horizontal pan on plot drag (with modifier key if needed)
- Optional per-segment Y pan
- Keep pan constraints consistent with min/max range guards

---

## 3.7 Curve rendering behavior

From strategy (`BodeStrategy`):
- Uses free-form line rendering
- Data breaking enabled for solid line style (invalid data segmentation support)
- Status-aware X/Y values
- Color/transparency changes for active/inactive curves
- Handles single-point styling

### D3 implementation target
- Render with `d3.line()`
- Segment line at invalid points (do not connect across invalid runs)
- Use per-curve style config:
  - color
  - alpha based on active state
  - line style (solid/dashed)
- Optional point marker for single sample

---

## 3.8 Cursors and readouts

Current implementation:
- Multiple cursors (A/B)
- Cursor projects to X axis and captures:
  - primary Y (amplitude)
  - secondary Y (phase when available)
  - secondary X as timestamp
- Cursor popup/header readout updates on cursor move and data update
- Sync by speed supported for Bode

### D3 implementation target
- Shared vertical cursor lines with draggable handles
- For each cursor:
  - nearest sample search on active amplitude curve
  - map same sample index to phase companion (or nearest by speed/time if needed)
  - display:
    - X value + unit
    - amplitude + unit/subunit
    - phase (deg) when present
    - timestamp
    - invalid state flags

---

## 3.9 Overlay / comparison curves

Behavior present:
- Comparison sample curves exist and are associated with primary curve.
- Export includes active, first inactive, and comparison amplitude/phase pairs.
- Cursor sync logic accounts for overlay curves and primary linkage.

### D3 implementation target
- Keep explicit `curveType`:
  - primary
  - comparison/overlay
- Styling:
  - active primary emphasized
  - inactive/comparison dimmed
- In data model, keep parent mapping:
  - `primaryCurveNumber`
  - `comparisonReferenceSetId/name`

---

## 3.10 Export behavior expectations

Export paths include:
- Plot export object model (axes + curves + cursor values + secondary values)
- CSV export with:
  - speed formatting logic
  - phase optional columns
  - status arrays
  - timestamps (milliseconds toggle)

### D3 implementation target
Prepare export services for:
- JSON snapshot export (chart state + data + cursor state)
- CSV export with columns:
  - speed, amplitude, phase (optional), status, timestamp
  - comparison dataset naming
- Include cursor snapshots in export payload

---

## 4. Implementation guide (Monorepo Angular + D3 new library)

This project should follow the same monorepo pattern used by the existing Angular + D3 plot library in this repository:

- Angular workspace root: `polar-plot-workspace/`
- Reusable D3 library under `projects/<lib-name>/`
- Demo/consumer app under `projects/polar-plot-demo/`

### 4.1 Target monorepo structure for Bode enablement

Create a dedicated library for the new plot type:

- `polar-plot-workspace/projects/ngx-bode-plot/`
  - `src/public-api.ts`
  - `src/lib/bode-plot.models.ts`
  - `src/lib/bode-plot.service.ts`
  - `src/lib/ngx-bode-plot.component.ts`
  - `src/lib/bode-cursor-readout.component.ts` (optional if split view is needed)
  - `src/lib/bode-toolbar.component.ts` (optional if split controls are needed)
  - `src/lib/*.spec.ts`

Demo integration remains in:

- `polar-plot-workspace/projects/polar-plot-demo/src/app/`

Use tsconfig path mapping for source-first development (same as current `ngx-radial-area` flow), then publish/build from `dist/ngx-bode-plot` when packaging.

### 4.2 Angular ownership boundaries

- `NgxBodePlotComponent` (standalone, OnPush):
  - Owns host container (`div`) and lightweight controls/readouts.
  - Handles Angular inputs/outputs and lifecycle only.
  - Delegates rendering and interaction math to the D3 service.
- `BodePlotService` (D3 engine):
  - Creates and updates SVG groups/layers.
  - Owns scales, zoom transforms, hit-regions, and cursor geometry.
  - Exposes focused API: `init`, `update`, `resize`, `resetZoom`, `destroy`.
- Optional UI helpers:
  - Toolbar component for unit toggle, rollover toggle, zoom controls.
  - Readout component for cursor A/B values and delta values.

### 4.3 Runtime data flow (existing architecture style)

```mermaid
flowchart TD
  A[Polar Plot Demo / Host Container] --> B[NgxBodePlotComponent]
  B --> C[BodeStateStore (signals or RxJS)]
  C --> B

  B --> D[BodePlotService (D3)]
  D --> E[Axes Layer: X + Amp Y + Phase Y]
  D --> F[Curve Layer: Primary + Comparison]
  D --> G[Cursor Layer: A/B + markers + popup anchors]
  D --> H[Interaction Layer: wheel zoom, brush zoom, pan]

  C --> I[BodeExportService]
  D --> I
  C --> J[BodeCursorReadoutComponent]
```

### 4.4 D3 SVG layer contract

Inside one SVG, keep explicit groups to avoid cross-feature coupling:

- `g.bode-root`
- `g.bode-axes`
  - `g.bode-x-axis`
  - `g.bode-y-amp-axis`
  - `g.bode-y-phase-axis`
- `g.bode-plot-amp` (clipped amplitude region)
- `g.bode-plot-phase` (clipped phase region)
- `g.bode-curves-primary`
- `g.bode-curves-comparison`
- `g.bode-cursors`
- `g.bode-overlays` (selection boxes, hover, zoom brush)
- transparent interaction rect(s) for deterministic pointer/wheel capture

This keeps subplot separation explicit while preserving one shared X domain.

### 4.5 Scale and interaction ownership

- Shared X scale: frequency/speed domain with display-unit formatting (RPM/Hz/Rad/s).
- Independent Y scales:
  - `yAmpScale` for amplitude region.
  - `yPhaseScale` for phase region (supports reverse/rollover modes).
- Zoom model:
  - Wheel zoom uses hit-region routing (X axis vs amp Y vs phase Y).
  - Brush/rubber-band zoom applies to active region scope.
  - Maintain zoom history stack (`zoomOutOneLevel`, `zoomOutAll`).
- Pan model:
  - Horizontal pan on plot region drag.
  - Optional Y pan per segment with guard rails.

### 4.6 Angular integration pattern (match current code flow)

- Run D3 initialization and high-frequency interaction handlers outside Angular zone.
- Re-enter Angular zone only for:
  - emitting `@Output()` events (`zoomChanged`, `cursorChanged`, `selectionChanged`)
  - updating lightweight UI state
- Keep all heavy render state in service-local memory to reduce change detection churn.

### 4.7 Suggested public API surface for the new lib

- Inputs:
  - `compositeCurves: BodeCompositeCurve[]`
  - `axisState: BodeAxisState`
  - `cursors: BodeCursorState[]`
  - `activeCurveNumber?: number`
  - `options` (pan/zoom/cursor/toolbar toggles)
- Outputs:
  - `axisStateChange`
  - `cursorStateChange`
  - `activeCurveChange`
  - `zoomCommand` (if host needs synchronization)

### 4.8 File-by-file implementation sequence in monorepo

1. Scaffold `projects/ngx-bode-plot` and export `NgxBodePlotComponent` from `public-api.ts`.
2. Add `bode-plot.models.ts` using section 5 contracts (composite curves, axis, cursor).
3. Implement `bode-plot.service.ts` with static axes + two plot regions.
4. Add amplitude/phase curve rendering with invalid-data segmentation.
5. Add cursor A/B behavior and readout payload mapping.
6. Add wheel + brush zoom, then pan + zoom-history commands.
7. Add export service (`BodeExportService`) and wire to host callbacks.
8. Integrate into `polar-plot-demo` with mock datasets (primary + comparison + optional phase).
9. Add library and demo tests mirroring existing workspace testing strategy.


---

## 5. Suggested TypeScript domain model

- `BodeCompositeCurve`
  - `primaryCurveNumber`
  - `amplitude: BodeCurve`
  - `phase?: BodeCurve`
  - `curveType: 'primary' | 'comparison'`
  - `isActive`

- `BodeCurve`
  - `curveNumber`
  - `xValues: number[]`
  - `yValues: number[]`
  - `xStatus?: StatusPoint[]`
  - `yStatus?: StatusPoint[]`
  - `timestampsUtc?: number[]`
  - `style: CurveStyle`

- `BodeAxisState`
  - `xRange`, `yAmpRange`, `yPhaseRange`
  - `xUnit`, `yAmpUnit`, `yAmpSubUnit`
  - `phaseRolloverEnabled`

- `BodeCursorState`
  - `cursorIndex`
  - `xValue`, `xUnit`
  - `timestampUtc`
  - `ampValue`, `ampUnit`
  - `phaseValue?`
  - `isInvalid`

---

## 6. Interaction design checklist

Implement all:

- [ ] Drag/drop/add/remove composite curves
- [ ] Active curve selection by plot region
- [ ] Wheel zoom (X or Y by hit region)
- [ ] Rubber-band zoom
- [ ] One-level zoom out
- [ ] Zoom-out-all
- [ ] Pan
- [ ] Cursor A/B drag + readout popup
- [ ] Sync cursors by speed (future-ready)
- [ ] X unit switching (RPM/Hz/Rad/s)
- [ ] Phase rollover toggle
- [ ] Overlay/comparison display modes
- [ ] Export CSV/JSON including cursor data

---

## 7. Rendering and performance recommendations

- Use one SVG with clipped groups for each subplot region.
- For large sample counts:
  - pre-decimate for view width
  - preserve nearest-point accuracy for cursor operations using full-resolution lookup
- Cache scaled path strings per zoom level where practical.
- Use binary search for nearest X index.
- Keep status arrays parallel to value arrays to avoid object-heavy point storage.

---

## 8. Acceptance criteria aligned to existing behavior

1. **Composite integrity**
   - Adding a primary curve renders amplitude and phase pair if phase exists.
2. **Axis behavior**
   - Shared X axis and separate Y regions are visually and functionally independent.
3. **Formatting**
   - RPM and phase label formatting matches desktop expectations.
4. **Zoom**
   - Wheel and rubber-band zoom produce predictable axis range updates.
5. **Cursor**
   - Cursor readout shows amplitude + phase + timestamp when available.
6. **Comparison**
   - Overlay/comparison curves remain linked to primary for cursor/export context.
7. **Export**
   - CSV/JSON contains speed, amplitude, phase (if present), statuses, and timestamps.

---

## 9. Implementation sequence (recommended)

1. Build static layout (axes + two subplot regions, no interaction).
2. Render primary amplitude/phase curves from composite input.
3. Add cursor system and nearest-point lookup.
4. Add wheel zoom + brush zoom + history stack.
5. Add pan.
6. Add comparison curves and active/inactive styling.
7. Add unit switching and phase rollover options.
8. Add export services.
9. Validate with scenario-driven tests equivalent to `BodePlotFeatureValidation`.

---

## 10. Notes for engineers

- Treat Bode as a **composite-curve plot**, not independent lines.
- Keep phase optional and non-breaking at every layer.
- Keep axis semantics explicit (speed X, amplitude Y, phase Y).
- Build cursor and export contracts early; many downstream features depend on them.
- Preserve invalid-state fidelity (line breaks + status in readouts/export).