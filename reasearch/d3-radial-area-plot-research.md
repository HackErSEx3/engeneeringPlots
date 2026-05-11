# D3.js Radial Area Plot — Research & Implementation Plan

> **Topic:** Radial Area Chart with Dual Axes + Rubber Band Zoom via Mouse Wheel
> **Stack:** D3.js v7, SVG, Vanilla JS / Angular
> **Date:** May 2026

---

## 1. Overview

A **Radial Area Plot** (also called a polar area chart) renders data in a circular layout using polar coordinates. Instead of the familiar x/y Cartesian system, it uses:

- **Angle (θ)** — maps to the angular position around the circle (like the X axis)
- **Radius (r)** — maps to the distance from the center (like the Y axis)

The goal of this implementation is to build a radial area chart with:

1. **Two independent axes** — an angular axis (categorical/time) and a radial axis (quantitative value)
2. **Rubber band zoom** — mouse wheel scrolls zoom the radial plot in/out smoothly, centered on the cursor

---

## 2. Core D3 APIs Involved

### 2.1 `d3.areaRadial()`

The `d3.areaRadial()` generator produces a filled area in polar coordinates. It is the radial equivalent of `d3.area()` but replaces Cartesian accessors with polar ones:

| Cartesian (`d3.area`) | Radial (`d3.areaRadial`) |
|---|---|
| `.x(d => ...)` | `.angle(d => ...)` in radians, 0 at 12 o'clock |
| `.y0(d => ...)` | `.innerRadius(d => ...)` |
| `.y1(d => ...)` | `.outerRadius(d => ...)` |

**Basic Setup:**

```js
const areaGenerator = d3.areaRadial()
  .angle((d, i) => angleScale(i))        // Angular position (0 to 2π)
  .innerRadius(d => radiusScale(d.min))  // Inner bound of the filled area
  .outerRadius(d => radiusScale(d.max)); // Outer bound of the filled area
```

**Important Note on Curves:**
`curveMonotoneX` and `curveMonotoneY` are NOT recommended for radial areas because they assume monotonic data — which is typically false in a circular layout. Use `d3.curveBasisClosed` or `d3.curveCatmullRomClosed` instead.

```js
.curve(d3.curveBasisClosed)
```

---

## 3. Dual Axes Design

The two axes in a radial area chart serve distinct purposes and require separate scale + render strategies.

### 3.1 Angular Axis (Categorical / Time — the "X" equivalent)

The angular axis distributes data points evenly around the circle. It uses a band or linear scale mapped to `[0, 2π]`.

```js
const angleScale = d3.scaleBand()
  .domain(data.map(d => d.month))        // e.g. ['Jan', 'Feb', ..., 'Dec']
  .range([0, 2 * Math.PI]);
```

**Rendering the Angular Axis:**
Angular axis labels are placed by converting polar to Cartesian coordinates:

```js
function polarToCartesian(angle, radius) {
  return {
    x: Math.cos(angle - Math.PI / 2) * radius,
    y: Math.sin(angle - Math.PI / 2) * radius
  };
}
```

Each label is appended as an SVG `<text>` element at the outer boundary:

```js
container.selectAll('.angle-label')
  .data(data)
  .join('text')
  .attr('class', 'angle-label')
  .attr('transform', (d, i) => {
    const angle = angleScale(d.month) + angleScale.bandwidth() / 2;
    const { x, y } = polarToCartesian(angle, outerRadius + 20);
    return `translate(${x}, ${y})`;
  })
  .attr('text-anchor', 'middle')
  .text(d => d.month);
```

### 3.2 Radial Axis (Quantitative — the "Y" equivalent)

The radial axis marks concentric ring levels corresponding to data values. It uses `d3.scaleLinear()` mapped from the data domain to `[innerRadius, outerRadius]`.

```js
const radiusScale = d3.scaleLinear()
  .domain([0, d3.max(data, d => d.value)])
  .range([innerRadius, outerRadius]);
```

**Rendering Radial Grid Rings:**

```js
const ticks = radiusScale.ticks(5);

container.selectAll('.radial-ring')
  .data(ticks)
  .join('circle')
  .attr('class', 'radial-ring')
  .attr('r', d => radiusScale(d))
  .attr('fill', 'none')
  .attr('stroke', '#ccc')
  .attr('stroke-dasharray', '4 2');
```

**Radial Tick Labels** (placed at a fixed angle, e.g. 0°):

```js
container.selectAll('.radial-label')
  .data(ticks)
  .join('text')
  .attr('class', 'radial-label')
  .attr('y', d => -radiusScale(d))
  .attr('text-anchor', 'middle')
  .attr('dy', '-4px')
  .text(d => d);
```

### 3.3 Why Two Axes Matter

In a single-series radial area chart, only one radial scale is needed. But when displaying **two data series** (e.g. temperature and rainfall) on the same radial chart, two independent radial scales are necessary — one for each series — so their domains don't interfere. This is called a **dual-radial-axis** pattern:

```js
// Series A scale (e.g. temperature)
const radiusScaleA = d3.scaleLinear()
  .domain([0, d3.max(data, d => d.temperature)])
  .range([innerRadius, outerRadius]);

// Series B scale (e.g. rainfall) — separate domain, same radius range
const radiusScaleB = d3.scaleLinear()
  .domain([0, d3.max(data, d => d.rainfall)])
  .range([innerRadius, outerRadius]);
```

Each series gets its own `d3.areaRadial()` generator using its respective scale.

---

## 4. Rubber Band Zoom via Mouse Wheel

### 4.1 What Is Rubber Band Zoom?

"Rubber band zoom" means the chart **elastically scales in and out** around the center (or the cursor position) in response to mouse wheel events — producing a smooth, spring-like feel. It is distinct from a hard-cut zoom jump.

In the radial context, zooming affects the **radial scale's range**, effectively pulling the rings inward or outward as you scroll.

### 4.2 `d3-zoom` Module

D3 provides `d3.zoom()` — a flexible zoom/pan abstraction for SVG, HTML, or Canvas:

```js
const zoom = d3.zoom()
  .scaleExtent([0.5, 8])           // Min and max zoom levels
  .on('zoom', handleZoom);

svg.call(zoom);                    // Attach zoom listener to the SVG
```

The `d3-zoom` module automatically listens to mouse wheel events (`WheelEvent`) and derives a scale factor:

```
scale_factor = 2^Δ
where Δ = -deltaY * (deltaMode === 1 ? 0.05 : deltaMode ? 1 : 0.002)
```

### 4.3 Rubber Band Effect — Radial-Specific Strategy

Standard `d3.zoom()` performs geometric zooming (scales the whole SVG transform). For a radial chart, **semantic zoom** on the radius scale is more appropriate — it rescales data without distorting the layout.

**Implementation pattern:**

```js
// Track current zoom level
let currentZoom = 1;

const zoom = d3.zoom()
  .scaleExtent([0.5, 8])
  .wheelDelta(event => {
    // Customize wheel sensitivity for smoother rubber-band feel
    return -event.deltaY * (event.deltaMode === 1 ? 0.05 : event.deltaMode ? 1 : 0.002);
  })
  .on('zoom', (event) => {
    currentZoom = event.transform.k;
    updateRadialScale(currentZoom);
  });

function updateRadialScale(zoomLevel) {
  // Shrink/grow the outerRadius proportionally
  const zoomedOuter = innerRadius + (baseOuterRadius - innerRadius) * zoomLevel;

  radiusScaleA.range([innerRadius, zoomedOuter]);
  radiusScaleB.range([innerRadius, zoomedOuter]);

  // Redraw all chart elements
  redrawAreas();
  redrawRadialAxis();
}
```

### 4.4 Preventing Page Scroll

When attaching wheel zoom to a chart, the browser's default scroll behavior must be suppressed:

```js
svg.on('wheel', event => event.preventDefault());
```

Or, using `d3.zoom().filter()` to ensure all wheel events are captured:

```js
const zoom = d3.zoom()
  .filter(event => {
    // Accept wheel events always; ignore secondary mouse buttons
    return event.type === 'wheel' || (!event.ctrlKey && !event.button);
  });
```

### 4.5 Double-Click to Reset Zoom

```js
svg.on('dblclick.zoom', () => {
  svg.transition()
    .duration(500)
    .call(zoom.transform, d3.zoomIdentity);
});
```

---

## 5. Full Implementation Architecture

```
SVG
└── <g class="chart-root" transform="translate(cx, cy)">
    ├── <g class="radial-grid">         ← Concentric rings (radial axis)
    ├── <g class="angular-spokes">      ← Radial lines at each angle
    ├── <g class="area-series-a">       ← areaRadial() path for series A
    ├── <g class="area-series-b">       ← areaRadial() path for series B
    ├── <g class="radial-labels">       ← Tick labels on radius axis
    ├── <g class="angle-labels">        ← Labels around the perimeter
    └── <rect class="zoom-listener"     ← Transparent overlay capturing zoom events
          fill="none" pointer-events="all"
          width="..." height="..." />
```

> **Key insight:** The zoom listener should be a transparent `<rect>` element placed on top of all chart content, so wheel events register regardless of where the cursor is within the chart boundary.

---

## 6. Clip Path for Zoom Boundary

To prevent the radial area from overflowing the chart boundary during zoom-out, use a circular `<clipPath>`:

```js
svg.append('defs').append('clipPath')
  .attr('id', 'radial-clip')
  .append('circle')
  .attr('r', outerRadius);

container.attr('clip-path', 'url(#radial-clip)');
```

---

## 7. Code Skeleton

```js
import * as d3 from 'd3';

const width = 600, height = 600;
const cx = width / 2, cy = height / 2;
const innerRadius = 60, baseOuterRadius = 240;

const svg = d3.select('#chart')
  .append('svg')
  .attr('viewBox', `0 0 ${width} ${height}`);

const container = svg.append('g')
  .attr('transform', `translate(${cx}, ${cy})`);

// --- Scales ---
const angleScale = d3.scaleBand()
  .domain(data.map(d => d.label))
  .range([0, 2 * Math.PI]);

const radiusScaleA = d3.scaleLinear()
  .domain([0, d3.max(data, d => d.seriesA)])
  .range([innerRadius, baseOuterRadius]);

const radiusScaleB = d3.scaleLinear()
  .domain([0, d3.max(data, d => d.seriesB)])
  .range([innerRadius, baseOuterRadius]);

// --- Area Generators ---
const areaA = d3.areaRadial()
  .angle(d => angleScale(d.label) + angleScale.bandwidth() / 2)
  .innerRadius(innerRadius)
  .outerRadius(d => radiusScaleA(d.seriesA))
  .curve(d3.curveBasisClosed);

const areaB = d3.areaRadial()
  .angle(d => angleScale(d.label) + angleScale.bandwidth() / 2)
  .innerRadius(innerRadius)
  .outerRadius(d => radiusScaleB(d.seriesB))
  .curve(d3.curveBasisClosed);

// --- Draw Areas ---
container.append('path').datum(data)
  .attr('d', areaA)
  .attr('fill', 'steelblue').attr('fill-opacity', 0.5);

container.append('path').datum(data)
  .attr('d', areaB)
  .attr('fill', 'tomato').attr('fill-opacity', 0.4);

// --- Zoom Behavior (Rubber Band) ---
const zoom = d3.zoom()
  .scaleExtent([0.4, 6])
  .on('zoom', event => {
    const k = event.transform.k;
    const zoomedOuter = innerRadius + (baseOuterRadius - innerRadius) * k;
    radiusScaleA.range([innerRadius, zoomedOuter]);
    radiusScaleB.range([innerRadius, zoomedOuter]);
    redraw();
  });

// Transparent overlay to capture all wheel events
svg.append('rect')
  .attr('width', width).attr('height', height)
  .attr('fill', 'none')
  .attr('pointer-events', 'all')
  .call(zoom)
  .on('wheel', event => event.preventDefault());

// Double-click resets zoom
svg.on('dblclick.zoom', () => {
  svg.transition().duration(500)
    .call(zoom.transform, d3.zoomIdentity);
});

function redraw() {
  container.select('.area-a').attr('d', areaA(data));
  container.select('.area-b').attr('d', areaB(data));
  // Also update radial grid rings and labels
}
```

---

## 8. Angular Integration Notes

When integrating with Angular (as per your project stack):

- Wrap D3 logic inside `ngAfterViewInit()` to ensure the DOM is ready
- Use `@ViewChild('chartContainer') chartRef: ElementRef` to get the SVG host
- Use `d3.select(this.chartRef.nativeElement)` instead of `d3.select('#chart')`
- Store scales and zoom state as class properties for use in Angular's change detection
- For reactive data, re-call `redraw()` inside `ngOnChanges()`

```typescript
@Component({ selector: 'app-radial-chart', template: `<div #chartContainer></div>` })
export class RadialChartComponent implements AfterViewInit {
  @ViewChild('chartContainer') chartRef!: ElementRef;

  ngAfterViewInit() {
    this.initChart();
  }

  initChart() {
    const svg = d3.select(this.chartRef.nativeElement).append('svg');
    // ... D3 logic here
  }
}
```

---

## 9. Key Challenges & Solutions

| Challenge | Solution |
|---|---|
| Wheel events captured by browser scroll | Attach `event.preventDefault()` on the zoom `<rect>` overlay |
| Two series on different value scales | Use two independent `radiusScale` instances with same pixel range |
| Labels going off-screen during zoom | Clamp `scaleExtent` and use `clipPath` |
| Smooth rubber-band feel | Customize `wheelDelta` function to reduce zoom step per scroll tick |
| Angular axis labels rotating weirdly | Compute angle for each label, flip text-anchor for labels on the left half |
| `curveMonotoneX` breaks the radial path | Use `curveBasisClosed` or `curveCatmullRomClosed` only |

---

## 10. Recommended Libraries & References

| Resource | Link |
|---|---|
| D3 Radial Area API | https://d3js.org/d3-shape/radial-area |
| D3 Zoom API | https://d3js.org/d3-zoom |
| D3 Brush API (for brushable zoom) | https://d3js.org/d3-brush |
| `d3-radial-axis` npm package | https://www.npmjs.com/package/d3-radial-axis |
| D3 In Depth — Zoom & Pan | https://www.d3indepth.com/zoom-and-pan/ |
| D3 Graph Gallery — Area Brush Zoom | https://d3-graph-gallery.com/graph/area_brushZoom.html |

---

## 11. Summary

To implement the radial area plot with dual axes and rubber band zoom:

1. Use `d3.areaRadial()` with `innerRadius` and `outerRadius` for the filled areas
2. Create two separate linear scales (`radiusScaleA`, `radiusScaleB`) for the two data series
3. Render the angular axis as SVG text labels using polar-to-Cartesian conversion
4. Render the radial axis as concentric dashed circles with tick labels
5. Attach `d3.zoom()` to a transparent `<rect>` overlay on the SVG
6. On every zoom event, rescale the radius range and redraw both areas + grid
7. Use `scaleExtent([0.4, 6])` to limit zoom bounds and prevent extreme distortion
8. Use `event.preventDefault()` to suppress browser scroll interference
9. Add double-click reset as a UX convenience
