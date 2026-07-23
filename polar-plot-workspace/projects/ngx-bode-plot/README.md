# ngx-bode-plot

Angular 19 + D3 library for Bode plots. Renders a **composite curve** (amplitude + optional phase) as two vertically stacked plot regions sharing a common X axis, with region-aware wheel zoom, rubber-band brush zoom, zoom history, and a draggable cursor with a nearest-sample readout.

See `implementation.md` at the repo root for the full contract, and `reasearch/bode_plot_Guide.md` for the behavioural spec.

## Usage

```html
<ngx-bode-plot
  [compositeCurves]="[composite]"
  [axisState]="axis"
  [cursors]="cursors"
  (cursorStateChange)="cursors = $event"
  (axisStateChange)="axis = $event"
/>
```

## Build

```bash
npm run build:bode
```

## Test

```bash
npm run test:bode
```
