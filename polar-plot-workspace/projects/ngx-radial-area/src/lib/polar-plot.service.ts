import * as d3 from 'd3';
import { PolarDataPoint, PolarPlotConfig } from './polar-plot.models';
import { LabelPoint, drawPolarLabelsWithoutOverlap } from './label-placement';

const DEG2RAD = Math.PI / 180;
const CURSOR_COLOR = '#FF6B00';
const ARM_LEN = 14;
const ARM_GAP = 5;
const PROJ_INNER = 0;   // px inward from outer ring for cursor angle projection
const PROJ_OUTER = 12;  // px outward from outer ring for cursor angle projection
const ANGLE_TICK_LEN = 7;   // px outward from outer ring for spoke-end ticks
const AMP_TICK_HALF = 4;    // px half-width of amplitude ruler ticks on 0° axis
const MINOR_AMP_TICK_HALF = 2; // px half-width of minor amplitude ticks (unlabelled)

// ─── ZOOM CONSTANTS ────────────────────────────────────────────────────────────
// Scroll sensitivity: each 100px of deltaY equals one 10% zoom step.
// Using an exponential formula keeps zoom feel consistent at any zoom level.
const ZOOM_SENSITIVITY = 100;
const ZOOM_MIN = 0.2;  // 0.2× — can zoom out to see 5× the amplitude range
const ZOOM_MAX = 20;   // 20× — can zoom in to see 1/20th of the amplitude range

interface Cfg {
  width: number; height: number; innerRadius: number; padding: number;
  showGrid: boolean; showSpokes: boolean; showAngularLabels: boolean; showRadialLabels: boolean;
  gridTicks: number; spokesEvery: number; lineColor: string; areaOpacity: number;
  showArea: boolean; showLine: boolean; showDots: boolean; dotRadius: number;
  animationDuration: number; darkMode: boolean; closedCurve: boolean; emptyAmplitudeMax: number; dotThreshold: number; showVector: boolean; minorAmplitudeTicks: number; startAngle: number; clockwise: boolean;
  // ── Label layer (Stage 2) ───────────────────────────────────────────────────
  showDataLabels: boolean; labelFormatter: ((pt: PolarDataPoint) => string) | undefined; labelFontSize: number; labelMinSpacingPx: number; labelThreshold: number;
}

const DEFAULTS: Cfg = {
  width: 560, height: 560, innerRadius: 0, padding: 50,
  showGrid: true, showSpokes: true, showAngularLabels: true, showRadialLabels: true,
  gridTicks: 5, spokesEvery: 30, lineColor: '#378ADD', areaOpacity: 0.2,
  showArea: true, showLine: true, showDots: true, dotRadius: 4,
  animationDuration: 300, darkMode: false, closedCurve: false, emptyAmplitudeMax: 100, dotThreshold: 500, showVector: true, minorAmplitudeTicks: 4, startAngle: 10, clockwise: true,
  showDataLabels: false, labelFormatter: undefined, labelFontSize: 10, labelMinSpacingPx: 40, labelThreshold: 2000,
};

export class PolarPlotService {
  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private root!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private rScale!: d3.ScaleLinear<number, number>;
  private outerRadius = 0;
  private cfg!: Cfg;

  // ─── State ─────────────────────────────────────────────────────────────────
  private data: PolarDataPoint[] = [];
  private renderData: PolarDataPoint[] = [];    // data in original array order — order defines how points are connected

  // Base domain values at zoom = 1. Never mutated after init.
  private baseMinAmp = 0;
  private baseMaxAmp = 1;

  // Current zoom multiplier. >1 = zoomed in (amplitude axis compressed).
  private currentZoom = 1;

  // Last selected data point — cursor follows it when zoom changes.
  private selectedPoint: PolarDataPoint | null = null;

  // ─── Callbacks (set by Angular component) ──────────────────────────────────
  private onSelectCallback?: (pt: PolarDataPoint) => void;
  private onZoomCallback?: (zoom: number) => void;

  // ─── requestAnimationFrame throttle for zoom ────────────────────────────────
  // Multiple wheel events can fire in a single frame (fast trackpad / mouse).
  // We accumulate the zoom level in pendingZoom and schedule one rAF per frame,
  // so the DOM is only updated once per rendered frame regardless of event rate.
  private rafId: number | null = null;
  private pendingZoom: number | null = null;

  // ─── Public API ─────────────────────────────────────────────────────────────

  /**
   * init()
   * Entry point. Called by the Angular component in ngAfterViewInit.
   * Sets up SVG structure, builds scales, renders all layers, and
   * attaches event handlers (click for cursor, wheel for zoom).
   */
  init(
    host: HTMLElement,
    data: PolarDataPoint[],
    config: Partial<PolarPlotConfig>,
    onSelect?: (pt: PolarDataPoint) => void,
    onZoom?: (zoom: number) => void,
  ): void {
    this.cfg = { ...DEFAULTS, ...config };
    this.outerRadius = Math.min(this.cfg.width, this.cfg.height) / 2 - this.cfg.padding;
    this.data = data;
    this.renderData = [...data];
    this.onSelectCallback = onSelect;
    this.onZoomCallback = onZoom;
    this.currentZoom = 1;
    this.selectedPoint = null;

    this.buildSvg(host);

    if (!data.length) {
      this.drawEmptyPlot();
      this.attachZoomHandler();   // zoom works on the empty grid too
      return;
    }

    this.buildScale(data);
    this.drawGrid();
    this.drawSpokes();
    this.drawAngularLabels();
    this.drawRadialLabels();
    this.drawData();
    this.drawDataLabels();  // Stage 2: sparse label overlay (skipped when showDataLabels=false)
    this.attachClickHandler();
    // Show cursor at the first data point by default
    this.selectedPoint = data[0];
    this.drawCursor(data[0]);

    this.attachZoomHandler();   // zoom works on the empty grid too
  }

  // Cleans up listeners, pending animation frames, and SVG nodes.
  destroy(): void {
    // Cancel any pending rAF so the callback doesn't fire after SVG removal
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.svg?.node()?.removeEventListener('wheel', this.wheelHandler);
    this.svg?.remove();
  }

  /** Programmatically place the cursor on a specific data point. */
  moveCursorTo(point: PolarDataPoint): void {
    this.selectedPoint = point;
    this.drawCursor(point);
  }

  /** Toggle the vector line without a full re-init. */
  setVector(show: boolean): void {
    this.cfg.showVector = show;
    if (this.selectedPoint) this.drawCursor(this.selectedPoint);
  }

  /**
   * resetZoom()
   * Public method — can be called from the Angular component or template.
   * Restores the amplitude axis to its original full-range state (zoom = 1).
   */
  resetZoom(): void {
    // Reset zoom level to 1
    this.currentZoom = 1;

    // Restore the original scale domain (already AP-aligned at init — no re-nicing needed)
    this.rScale.domain([this.baseMinAmp, this.baseMaxAmp]);

    // Redraw everything that depends on the amplitude scale
    this.updateGrid();
    this.updateRadialLabels();
    this.updateData();
    this.updateDataLabels();  // reposition labels at the restored scale

    // Keep cursor on its point at the new scale
    if (this.selectedPoint) this.drawCursor(this.selectedPoint);

    // Notify Angular component (zoom reset = zoom 1)
    this.onZoomCallback?.(1);
  }

  // ─── SVG Structure ──────────────────────────────────────────────────────────

  // Creates the SVG root, clip path, and rendering layer groups.
  private buildSvg(host: HTMLElement): void {
    const { width, height } = this.cfg;
    const cx = width / 2, cy = height / 2;
    const clipId = `pp-clip-${Math.random().toString(36).slice(2)}`;

    this.svg = d3.select(host).append('svg')
      .attr('width', width).attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .style('font-family', 'system-ui, -apple-system, sans-serif')
      .style('cursor', 'crosshair');

    // Clip path prevents data from rendering outside outerRadius when zoomed in
    this.svg.append('defs').append('clipPath').attr('id', clipId)
      .append('circle').attr('r', this.outerRadius);

    this.root = this.svg.append('g').attr('transform', `translate(${cx},${cy})`);

    // Layer order — later layers render on top
    // pp-datalabels sits between data and cursor: labels are visible above the
    // line/dots but the cursor crosshair always renders on top of labels.
    ['pp-grid', 'pp-spokes', 'pp-labels', 'pp-data', 'pp-datalabels', 'pp-cursor'].forEach(cls =>
      this.root.append('g').attr('class', cls)
    );
    this.root.select<SVGGElement>('g.pp-data').attr('clip-path', `url(#${clipId})`);
  }

  // ─── Scale ──────────────────────────────────────────────────────────────────

  // Builds the data-driven radial scale and stores base zoom domain values.
  private buildScale(data: PolarDataPoint[]): void {
    const maxVal = d3.max(data, d => d.amplitudeValue) ?? 1;
    const minVal = Math.min(0, d3.min(data, d => d.amplitudeValue) ?? 0);

    // Snap domain endpoints to exact multiples of the D3 tick step so every
    // ring — including the outer boundary — sits at an AP amplitude value.
    const [niceMin, niceMax] = this.niceAmplitudeDomain(minVal, maxVal);

    // Store niced domain — zoom calculations always derive from these values
    this.baseMinAmp = niceMin;
    this.baseMaxAmp = niceMax;

    this.rScale = d3.scaleLinear()
      .domain([niceMin, niceMax])
      .range([this.cfg.innerRadius, this.outerRadius]);
  }

  /**
   * Converts a logical data angle into rendered polar radians.
   *
   * Logical angle: the value in PolarDataPoint.angle.
   * Rendered angle: chart position after applying startAngle and direction.
   */
  private angleToRad(logicalAngleDeg: number): number {
    const dir = this.cfg.clockwise ? 1 : -1;
    const renderedDeg = this.cfg.startAngle + dir * logicalAngleDeg;
    return renderedDeg * DEG2RAD;
  }

  /**
   * niceAmplitudeDomain(rawMin, rawMax)
   * Returns a [min, max] domain where both endpoints are exact multiples of the
   * D3 tick step for gridTicks. This guarantees every amplitude ring — including
   * the outer boundary ring — has equal pixel spacing (arithmetic progression).
   *
   * D3's built-in .nice() rounds endpoints to "friendly" numbers but does NOT
   * ensure domain[1] is a multiple of the tick step, which causes the gap between
   * the last inner ring and the outer ring to differ from all other gaps.
   */
  private niceAmplitudeDomain(rawMin: number, rawMax: number): [number, number] {
    if (rawMax <= rawMin) return [rawMin, rawMin + 1];
    const step = d3.tickStep(rawMin, rawMax, this.cfg.gridTicks);
    // toPrecision(12) eliminates floating-point noise from integer-multiple arithmetic
    // (e.g. prevents 199.99999999996 instead of 200).
    const snap = (v: number) => parseFloat(v.toPrecision(12));
    return [
      snap(Math.floor(rawMin / step) * step),
      snap(Math.ceil(rawMax / step) * step),
    ];
  }

  // ─── Static draw calls (only at init, not affected by zoom) ─────────────────

  // Draws fixed angular spokes from center to the outer radius.
  private drawSpokes(): void {
    if (!this.cfg.showSpokes) return;
    const stroke = this.cfg.darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)';
    const g = this.root.select<SVGGElement>('g.pp-spokes');

    // Spokes are purely angular — outerRadius is fixed — no zoom involvement
    d3.range(0, 360, this.cfg.spokesEvery).forEach(deg => {
      const r = this.angleToRad(deg);
      g.append('line')
        .attr('x2', this.outerRadius * Math.sin(r))
        .attr('y2', -this.outerRadius * Math.cos(r))
        .attr('stroke', stroke).attr('stroke-width', 1);
    });
  }

  // Draws spoke-end ticks and angular labels around the outer boundary.
  private drawAngularLabels(): void {
    // Angular labels (0°, 30°, 60° …) never move — zoom does not affect them.
    // Called once at init; no update equivalent exists intentionally.
    if (!this.cfg.showAngularLabels) return;
    const color = this.cfg.darkMode ? 'rgba(255,255,255,0.6)' : '#555';
    const g = this.root.select<SVGGElement>('g.pp-labels');
    const offset = this.outerRadius + 18;

    d3.range(0, 360, this.cfg.spokesEvery).forEach(deg => {
      const r = this.angleToRad(deg);
      const sx = Math.sin(r), cy = Math.cos(r);

      // Small tick mark protruding outward from the outer ring at this spoke angle
      g.append('line').attr('class', 'angular-label')
        .attr('x1', this.outerRadius * sx)
        .attr('y1', -this.outerRadius * cy)
        .attr('x2', (this.outerRadius + ANGLE_TICK_LEN) * sx)
        .attr('y2', -(this.outerRadius + ANGLE_TICK_LEN) * cy)
        .attr('stroke', color).attr('stroke-width', 1.5).attr('stroke-linecap', 'round');

      g.append('text').attr('class', 'angular-label')
        .attr('x', offset * sx).attr('y', -offset * cy)
        .attr('text-anchor', Math.abs(sx) < 0.12 ? 'middle' : sx > 0 ? 'start' : 'end')
        .attr('dominant-baseline', Math.abs(cy) < 0.12 ? 'middle' : cy > 0 ? 'auto' : 'hanging')
        .attr('font-size', 11).attr('fill', color)
        .text(`${deg}°`);
    });
  }

  /** Draws only the base plot layers used for an empty chart. */
  private drawEmptyPlot(): void {
    // Empty chart uses configured default amplitude range instead of data-driven extents.
    const minVal = 0;
    const maxVal = this.cfg.emptyAmplitudeMax;
    const [niceMin, niceMax] = this.niceAmplitudeDomain(minVal, maxVal);

    this.baseMinAmp = niceMin;
    this.baseMaxAmp = niceMax;

    this.rScale = d3.scaleLinear()
      .domain([niceMin, niceMax])
      .range([this.cfg.innerRadius, this.outerRadius]);

    this.drawGrid();
    this.drawSpokes();
    this.drawAngularLabels();
    this.drawRadialLabels();
  }

  // ─── Zoom-aware draw calls (called at init AND on every zoom step) ───────────

  // Draws concentric grid rings, outer boundary ring, and center dot.
  private drawGrid(): void {
    if (!this.cfg.showGrid) return;
    const stroke = this.cfg.darkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
    const outerStroke = this.cfg.darkMode ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.3)';
    const g = this.root.select<SVGGElement>('g.pp-grid');

    // Inner rings from rScale ticks — D3 adapts count and spacing to the current
    // amplitude domain, so rings redistribute on zoom. Linear scale guarantees
    // equal amplitude step = equal pixel step. Exclude ticks within 4px of
    // outerRadius to avoid visually colliding with the fixed outer boundary ring.
    const innerTicks = this.rScale.ticks(this.cfg.gridTicks)
      .filter(t => t > 0 && this.rScale(t) < this.outerRadius - 4);

    g.selectAll<SVGCircleElement, number>('circle.ring')
      .data(innerTicks)
      .join('circle').attr('class', 'ring')
      .attr('r', t => this.rScale(t))
      .attr('fill', 'none').attr('stroke', stroke)
      .attr('stroke-dasharray', '4 4');

    // Outer boundary ring — fixed at outerRadius like the spokes, always visible.
    g.selectAll('circle.outer-ring')
      .data([null])
      .join('circle').attr('class', 'outer-ring')
      .attr('r', this.outerRadius)
      .attr('fill', 'none').attr('stroke', outerStroke).attr('stroke-width', 1.5);

    // Center dot — stays at origin regardless of zoom
    g.selectAll('circle.center-dot')
      .data([null])
      .join('circle').attr('class', 'center-dot')
      .attr('r', 3).attr('fill', stroke);
  }

  // Draws major and minor amplitude ruler ticks and radial labels.
  private drawRadialLabels(): void {
    if (!this.cfg.showRadialLabels) return;
    const color = this.cfg.darkMode ? 'rgba(255,255,255,0.6)' : '#555';
    const g = this.root.select<SVGGElement>('g.pp-labels');
    const axisRad = this.angleToRad(0);
    const sx = Math.sin(axisRad);
    const cy = Math.cos(axisRad);
    // Unit normal to the 0° axis: used to draw small ruler ticks and offset text.
    const nx = cy;
    const ny = sx;

    // Remove old radial labels only — angular labels (.angular-label) stay intact
    g.selectAll('.radial-label').remove();

    // Labels and ticks match the inner grid rings — same filter as drawGrid().
    // Tick values are already "nice" amplitude numbers from D3, no invert needed.
    const fmt = (v: number) => parseFloat(v.toPrecision(3));
    const innerTicks = this.rScale.ticks(this.cfg.gridTicks)
      .filter(t => t > 0 && this.rScale(t) < this.outerRadius - 4);

    innerTicks.forEach(t => {
      const r = this.rScale(t);
      const bx = r * sx;
      const by = -r * cy;
      g.append('line').attr('class', 'radial-label')
        .attr('x1', bx).attr('y1', by)
        .attr('x2', bx + AMP_TICK_HALF * nx).attr('y2', by + AMP_TICK_HALF * ny)
        .attr('stroke', color).attr('stroke-width', 1).attr('stroke-linecap', 'round');
      g.append('text').attr('class', 'radial-label')
        .attr('x', bx + (AMP_TICK_HALF + 2) * nx)
        .attr('y', by + (AMP_TICK_HALF + 2) * ny + 3)
        .attr('font-size', 9).attr('fill', color)
        .text(t);
    });

    // Outer boundary tick and label
    const outerVal = this.rScale.domain()[1];
    const outerBx = this.outerRadius * sx;
    const outerBy = -this.outerRadius * cy;
    g.append('line').attr('class', 'radial-label')
      .attr('x1', outerBx).attr('y1', outerBy)
      .attr('x2', outerBx + AMP_TICK_HALF * nx).attr('y2', outerBy + AMP_TICK_HALF * ny)
      .attr('stroke', color).attr('stroke-width', 1.5).attr('stroke-linecap', 'round');
    g.append('text').attr('class', 'radial-label')
      .attr('x', outerBx + (AMP_TICK_HALF + 2) * nx)
      .attr('y', outerBy + (AMP_TICK_HALF + 2) * ny + 3)
      .attr('font-size', 9).attr('font-weight', '600').attr('fill', color)
      .text(fmt(outerVal));

    // Minor ticks — unlabelled, drawn between consecutive major amplitude tick boundaries.
    // The boundaries array includes the domain min/max so minor ticks also fill the
    // gaps before the first major ring and after the last major ring.
    if (this.cfg.minorAmplitudeTicks > 0) {
      const [domMin, domMax] = this.rScale.domain();
      const majorBoundaries = [domMin, ...innerTicks, domMax];
      const divisions = this.cfg.minorAmplitudeTicks + 1;

      majorBoundaries.forEach((start, i) => {
        if (i === majorBoundaries.length - 1) return;
        const end = majorBoundaries[i + 1];
        for (let j = 1; j < divisions; j++) {
          const val = start + j * (end - start) / divisions;
          const r = this.rScale(val);
          const bx = r * sx;
          const by = -r * cy;
          // Skip ticks that land outside the visible radial range
          if (r <= 0 || r > this.outerRadius) continue;
          g.append('line').attr('class', 'radial-label')
            .attr('x1', bx).attr('y1', by)
            .attr('x2', bx + MINOR_AMP_TICK_HALF * nx).attr('y2', by + MINOR_AMP_TICK_HALF * ny)
            .attr('stroke', color).attr('stroke-width', 0.75).attr('stroke-linecap', 'round');
        }
      });
    }
  }

  // Draws or updates the area/line path and optional data point markers.
  private drawData(): void {
    const { lineColor, areaOpacity, showArea, showLine, showDots, dotRadius } = this.cfg;
    const g = this.root.select<SVGGElement>('g.pp-data');

    if (showArea || showLine) {
      const lineGen = d3.lineRadial<PolarDataPoint>()
        .angle(d => this.angleToRad(d.phaseValue))
        .radius(d => this.rScale(d.amplitudeValue))
        .curve(this.cfg.closedCurve ? d3.curveLinearClosed : d3.curveLinear);

      // D3 join handles create-vs-update — single path element reused on updates
      g.selectAll<SVGPathElement, PolarDataPoint[]>('path.data-line')
        .data([this.renderData])
        .join('path').attr('class', 'data-line')
        .attr('d', lineGen)
        .attr('fill', showArea ? lineColor : 'none')
        .attr('fill-opacity', showArea ? areaOpacity : 0)
        .attr('stroke', showLine ? lineColor : 'none')
        .attr('stroke-width', 2);
    }

    if (showDots) {
      // SVG circle elements are expensive DOM nodes. Above dotThreshold the line
      // alone conveys the pattern; individual dots add no information but multiply
      // render cost linearly. Auto-suppress for large datasets.
      // Set dotThreshold: Infinity in config to always show dots.
      if (this.renderData.length <= this.cfg.dotThreshold) {
        g.selectAll<SVGCircleElement, PolarDataPoint>('circle.dot')
          .data(this.renderData).join('circle').attr('class', 'dot')
          .attr('cx', d => this.rScale(d.amplitudeValue) * Math.sin(this.angleToRad(d.phaseValue)))
          .attr('cy', d => -this.rScale(d.amplitudeValue) * Math.cos(this.angleToRad(d.phaseValue)))
          .attr('r', dotRadius)
          .attr('fill', lineColor).attr('stroke', 'red').attr('stroke-width', 1.5);
      } else {
        // Remove any dots left from a previous render with fewer points
        g.selectAll('circle.dot').remove();
      }
    }
  }

  // ─── Zoom-triggered partial redraws ─────────────────────────────────────────
  // These are thin wrappers so the zoom handler reads like a clear call list.

  // Re-renders the grid layer after radial scale changes.
  private updateGrid(): void {
    this.drawGrid();
  }

  // Re-renders radial labels after radial scale changes.
  private updateRadialLabels(): void {
    this.drawRadialLabels();
  }

  // Re-renders plotted data after radial scale changes.
  private updateData(): void {
    this.drawData();
  }

  // ─── Data Labels ─────────────────────────────────────────────────────────────

  /**
   * drawDataLabels()  — Stage 2 render pass
   *
   * The curve (Stage 1 — drawData) always renders ALL renderData points.
   * Labels are an independent sparse overlay: only a readable subset is shown.
   *
   * Pipeline:
   *   1. Filter renderData to points within the current zoom domain
   *   2. Resolve label text: point.labelText  >  cfg.labelFormatter  >  skip
   *   3. Compute SVG position (radially offset past the dot)
   *   4. thinCandidates()              — O(n) pre-pass for dense clusters
   *   5. drawPolarLabelsWithoutOverlap — O(1) per check via LabelSpatialGrid
   */
  private drawDataLabels(): void {
    const g = this.root.select<SVGGElement>('g.pp-datalabels');
    g.selectAll('*').remove();

    if (!this.cfg.showDataLabels) return;

    const {
      labelFormatter, labelFontSize,
      dotRadius, darkMode, width, height,
    } = this.cfg;

    const color = darkMode ? 'rgba(255,255,255,0.75)' : '#333';
    const [domMin, domMax] = this.rScale.domain();
    const boundaryHalfW = width / 2;
    const boundaryHalfH = height / 2;

    // ── Build label candidate list from visible data points ───────────────────
    const candidates: LabelPoint[] = [];

    for (const d of this.renderData) {
      // Skip points outside the current amplitude zoom window
      if (d.amplitudeValue < domMin || d.amplitudeValue > domMax) continue;

      // Resolve label: per-point text wins over formatter
      const labelText: string =
        (d as PolarDataPoint & { labelText?: string }).labelText ??
        (labelFormatter ? labelFormatter(d) : '');
      if (!labelText) continue;

      const angleRad  = this.angleToRad(d.phaseValue);
      const r         = this.rScale(d.amplitudeValue);
      const sinA      = Math.sin(angleRad);
      const cosA      = Math.cos(angleRad);

      // Place label radially outward from the dot to avoid occlusion
      const offsetR     = r + dotRadius + 6;
      const xAnchorValue = sinA > 0.1 ? 0 : sinA < -0.1 ? 1 : 0.5;

      candidates.push({
        x: offsetR * sinA,
        y: -offsetR * cosA,
        labelText,
        xAnchorValue,
      });
    }

    if (candidates.length === 0) return;

    // ── Run placement — pure code.js approach, no pre-thinning ───────────────
    // All candidates are fed directly to the AABB overlap checker.
    // The rect test itself decides what gets placed; nothing is discarded
    // before it gets a chance to be checked.
    // Label anchor (x, y) sits dotRadius+6 px radially outward from the data point.
    // Dot position = (x, y) scaled back inward by that offset:
    //   dotPos = (x, y) * (|anchor| - dotOffset) / |anchor|
    const dotOffset = dotRadius + 6;
    const lineColor = this.cfg.lineColor;

    drawPolarLabelsWithoutOverlap(
      candidates,
      { fontSize: labelFontSize, minSpacingPx: 0, boundaryHalfW, boundaryHalfH },
      (text, x, y, xAnchorValue) => {
        // Draw the data-point dot at the radially inward position
        const anchorDist = Math.sqrt(x * x + y * y);
        if (anchorDist > 0) {
          const scale = (anchorDist - dotOffset) / anchorDist;
          g.append('circle')
            .attr('cx', x * scale)
            .attr('cy', y * scale)
            .attr('r', 2)
            .attr('fill', lineColor)
            .attr('stroke', 'transparent')
            .attr('stroke-width', 1.5)
            .attr('pointer-events', 'none');
        }

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

  /** Re-renders data labels after radial scale changes (zoom / reset). */
  private updateDataLabels(): void {
    this.drawDataLabels();
  }

  // ─── Zoom Handler ────────────────────────────────────────────────────────────

  /**
   * wheelHandler
   * Stored as an arrow function so the same reference can be passed to both
   * addEventListener and removeEventListener (required for cleanup in destroy()).
   *
   * ZOOM FLOW — what happens on every scroll event:
   *   1. Browser fires 'wheel' on the SVG element
   *   2. wheelHandler() computes the new zoom level from deltaY
   *   3. onZoom() updates this.rScale domain → baseMaxAmp / zoomLevel
   *   4. updateGrid()          — grid ring radii reflect the new tick values
   *   5. updateRadialLabels()  — amplitude labels reflect the new tick values
   *   6. updateData()          — data-line path and dots recomputed at new scale
   *   7. drawCursor()          — cursor repositioned on the selected point (if any)
   *   8. onZoomCallback()      — Angular component notified (could trigger API, analytics …)
   */
  private readonly wheelHandler = (event: WheelEvent): void => {
    // Prevent the page from scrolling while the pointer is over the chart
    event.preventDefault();

    // Accumulate zoom level from every wheel tick in this frame
    const factor = Math.pow(1.1, -event.deltaY / ZOOM_SENSITIVITY);
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, this.currentZoom * factor));
    if (newZoom === this.currentZoom) return;
    this.currentZoom = newZoom;
    this.pendingZoom = newZoom;

    // Schedule a single DOM update for the next animation frame.
    // If multiple wheel events arrive before the frame fires, only the last
    // accumulated zoom level is applied — no intermediate redraws wasted.
    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        if (this.pendingZoom !== null) {
          // ZOOM CHAIN: rAF fires → onZoom() → updateGrid / updateData / cursor
          this.onZoom(this.pendingZoom);
          this.pendingZoom = null;
        }
      });
    }
  };

  // Attaches wheel listener to drive radial zoom interactions.
  private attachZoomHandler(): void {
    // Use a raw wheel listener instead of d3.zoom so we stay in full control of
    // the SVG transform — d3.zoom would apply a geometric transform we don't want.
    // { passive: false } is required to allow event.preventDefault() on the wheel.
    this.svg.node()!.addEventListener('wheel', this.wheelHandler, { passive: false });
  }

  /**
   * onZoom(k)
   * Core zoom logic. Called by wheelHandler with the new zoom level.
   * Also called by resetZoom() with k = 1.
   *
   *   k > 1  →  zoomed in:  amplitude axis shows [0, baseMaxAmp / k]
   *              data points move outward; high-amplitude points may leave the view
   *   k < 1  →  zoomed out: amplitude axis shows [0, baseMaxAmp / k]  (wider range)
   *              data points move inward; the plot looks smaller
   *   k = 1  →  original scale
   *
   * Only the amplitude (radial) scale changes.
   * Angular positions, spokes, and outer boundary remain fixed.
   *
   * FUTURE: add onZoomCallback invocation to trigger an API call, emit an
   * analytics event, or update external state based on the visible amplitude range.
   */
  private onZoom(k: number): void {
    // ── Step 1: update scale domain ──────────────────────────────────────────
    // Divide the base max by the zoom factor so zooming in shows a narrower range.
    // Snap to tick-step multiples so all rings stay evenly spaced after zoom.
    const [niceMin, niceMax] = this.niceAmplitudeDomain(this.baseMinAmp, this.baseMaxAmp / k);
    this.rScale.domain([niceMin, niceMax]);

    // ── Step 2: redraw amplitude-dependent visual layers ─────────────────────
    this.updateGrid();          // grid ring positions change with the new tick values
    this.updateRadialLabels();  // amplitude labels change with the new tick values
    this.updateData();          // data-line path and dots reposition at the new scale
    this.updateDataLabels();    // data labels reposition at the new scale

    // ── Step 3: keep cursor locked on the selected point ─────────────────────
    // The cursor is drawn in chart-centered coordinates derived from rScale,
    // so it must be redrawn whenever the scale changes.
    if (this.selectedPoint) this.drawCursor(this.selectedPoint);

    // ── Step 4: notify Angular component ─────────────────────────────────────
    // FUTURE HOOK: replace or augment onZoomCallback to fire an API call,
    // emit telemetry, or update a shared store with the visible amplitude range.
    //   Example future usage:
    //     this.apiService.fetchDataForRange(0, this.baseMaxAmp / k);
    this.onZoomCallback?.(k);
  }

  // ─── Click → Cursor ──────────────────────────────────────────────────────────

  // Attaches click handler to select and highlight the nearest point.
  private attachClickHandler(): void {
    // d3.pointer(event, this.root.node()) converts SVG client coordinates
    // into the root group's centered coordinate space automatically.
    this.svg.on('click', (event: MouseEvent) => {
      const [mx, my] = d3.pointer(event, this.root.node()!);
      const nearest = this.findNearestPoint(mx, my);
      this.selectedPoint = nearest;
      this.drawCursor(nearest);
      this.onSelectCallback?.(nearest);
    });
  }

  /**
   * findNearestPoint(cx, cy)
   * Returns the data point with the smallest Euclidean distance to the click
   * position (cx, cy) in chart-centered pixels.
   * Coordinates follow D3's radial convention: x = r·sin θ, y = –r·cos θ.
   */
  private findNearestPoint(cx: number, cy: number): PolarDataPoint {
    return this.data.reduce((best, pt) => {
      const px = this.rScale(pt.amplitudeValue) * Math.sin(this.angleToRad(pt.phaseValue));
      const py = -this.rScale(pt.amplitudeValue) * Math.cos(this.angleToRad(pt.phaseValue));
      const bx = this.rScale(best.amplitudeValue) * Math.sin(this.angleToRad(best.phaseValue));
      const by = -this.rScale(best.amplitudeValue) * Math.cos(this.angleToRad(best.phaseValue));
      return Math.hypot(cx - px, cy - py) < Math.hypot(cx - bx, cy - by) ? pt : best;
    });
  }

  // Draws the cursor marker, optional vector, projection, and value label.
  private drawCursor(point: PolarDataPoint): void {
    const g = this.root.select<SVGGElement>('g.pp-cursor');
    g.selectAll('*').remove();

    // If the selected point's amplitude is outside the current zoom domain,
    // the data line is clipped but the cursor group has no clip-path — so the
    // cursor would appear floating in empty space. Hide it instead; selectedPoint
    // is still stored so the cursor comes back when the user zooms out again.
    const [domMin, domMax] = this.rScale.domain();
    if (point.amplitudeValue > domMax || point.amplitudeValue < domMin) return;

    // Cursor position recalculated from rScale so it tracks the point
    // correctly at any zoom level
    const angleRad = this.angleToRad(point.phaseValue);
    const px = this.rScale(point.amplitudeValue) * Math.sin(angleRad);
    const py = -this.rScale(point.amplitudeValue) * Math.cos(angleRad);

    // Vector line from origin to cursor point
    if (this.cfg.showVector) {
      g.append('line').attr('class', 'vector-line')
        .attr('x1', 0).attr('y1', 0)
        .attr('x2', px).attr('y2', py)
        .attr('stroke', CURSOR_COLOR).attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.55).attr('stroke-dasharray', '5 3');
    }

    // Projection line crossing the outer ring at the cursor's angle —
    // extends PROJ_INNER px inward and PROJ_OUTER px outward from the boundary.
    // pp-cursor has no clip-path so the outer portion renders beyond outerRadius.
    const projSin = Math.sin(angleRad);
    const projCos = Math.cos(angleRad);
    g.append('line').attr('class', 'cursor-proj')
      .attr('x1', (this.outerRadius - PROJ_INNER) * projSin)
      .attr('y1', -(this.outerRadius - PROJ_INNER) * projCos)
      .attr('x2', (this.outerRadius + PROJ_OUTER) * projSin)
      .attr('y2', -(this.outerRadius + PROJ_OUTER) * projCos)
      .attr('stroke', CURSOR_COLOR).attr('stroke-width', 2).attr('stroke-linecap', 'round');

    const cur = g.append('g').attr('transform', `translate(${px},${py})`);

    // × crosshair: 4 arms at 45°, 135°, 225°, 315° (SVG math angles, y-down)
    [45, 135, 225, 315].forEach(deg => {
      const r = deg * DEG2RAD;
      const cos = Math.cos(r), sin = Math.sin(r);
      cur.append('line')
        .attr('x1', ARM_GAP * cos).attr('y1', ARM_GAP * sin)
        .attr('x2', ARM_LEN * cos).attr('y2', ARM_LEN * sin)
        .attr('stroke', CURSOR_COLOR).attr('stroke-width', 2)
        .attr('stroke-linecap', 'round');
    });

    cur.append('circle').attr('r', 3).attr('fill', CURSOR_COLOR);

    // Label shifts left or right so it stays inside the chart boundary
    const labelDx = px >= 0 ? ARM_LEN + 4 : -(ARM_LEN + 4);
    const anchor = px >= 0 ? 'start' : 'end';
    cur.append('text')
      .attr('x', labelDx).attr('y', 4)
      .attr('text-anchor', anchor)
      .attr('font-size', 11).attr('font-weight', '600').attr('fill', CURSOR_COLOR)
      .text(`${point.phaseValue}° · ${point.amplitudeValue}`);
  }
}
