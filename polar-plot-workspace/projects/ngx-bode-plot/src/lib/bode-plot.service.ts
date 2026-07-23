import * as d3 from 'd3';
import {
  BodeAxisState,
  BodeCompositeCurve,
  BodeCurve,
  BodeCursorState,
  BodePlotCallbacks,
  BodePlotConfig,
  BodeZoomState,
  DEFAULT_BODE_CONFIG,
  StatusPoint,
} from './bode-plot.models';

// ─── Constants ────────────────────────────────────────────────────────────────
// Wheel zoom: 100 px of deltaY == one 10% zoom step (matches polar-plot.service).
const ZOOM_SENSITIVITY = 100;
const ZOOM_MIN_FACTOR = 0.05;      // absolute zoom range guard per axis
const ZOOM_MAX_FACTOR = 50;
const CURSOR_A_COLOR = '#FF6B00';
const CURSOR_B_COLOR = '#0088CC';
const AXIS_COLOR = '#555';
const GRID_COLOR = 'rgba(0,0,0,0.08)';

type HitRegion = 'x-axis' | 'y-amp' | 'y-phase' | 'plot-amp' | 'plot-phase' | null;

/**
 * BodePlotService — pure D3 rendering engine for the Bode plot.
 *
 * Layout (root group, translated by padLeft/padTop):
 *   ┌──────────── plotWidth ────────────┐
 *   │  amplitude region (ampHeight)     │
 *   ├──── gutter ───────────────────────┤
 *   │  phase region     (phaseHeight)   │
 *   └───────────────────────────────────┘
 *   shared X axis drawn under the phase region.
 *
 * All D3 work runs synchronously — the Angular component calls init/destroy
 * inside NgZone.runOutsideAngular so change detection is not triggered by
 * mouse/wheel events. Callbacks fire only when user state actually changes.
 */
export class BodePlotService {
  // ─── DOM ────────────────────────────────────────────────────────────────────
  private host!: HTMLElement;
  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private root!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private hitX!: d3.Selection<SVGRectElement, unknown, null, undefined>;
  private hitYAmp!: d3.Selection<SVGRectElement, unknown, null, undefined>;
  private hitYPhase!: d3.Selection<SVGRectElement, unknown, null, undefined>;
  private hitPlotAmp!: d3.Selection<SVGRectElement, unknown, null, undefined>;
  private hitPlotPhase!: d3.Selection<SVGRectElement, unknown, null, undefined>;
  private clipAmpId = '';
  private clipPhaseId = '';

  // ─── State ──────────────────────────────────────────────────────────────────
  private cfg!: BodePlotConfig;
  private composites: BodeCompositeCurve[] = [];
  private axis!: BodeAxisState;
  private cursors: BodeCursorState[] = [];
  private activeCurveNumber?: number;
  private callbacks: BodePlotCallbacks = {};

  // ─── Layout ─────────────────────────────────────────────────────────────────
  private plotWidth = 0;
  private ampHeight = 0;
  private phaseHeight = 0;
  private ampTop = 0;
  private phaseTop = 0;

  // ─── Scales ─────────────────────────────────────────────────────────────────
  private xScale!: d3.ScaleLinear<number, number>;
  private yAmpScale!: d3.ScaleLinear<number, number>;
  private yPhaseScale!: d3.ScaleLinear<number, number>;

  // ─── Base (initial) domains — used by zoomOutAll ────────────────────────────
  private baseX: [number, number] = [0, 1];
  private baseYAmp: [number, number] = [0, 1];
  private baseYPhase: [number, number] = [0, 360];

  // ─── Zoom history (semantic domain snapshots) ───────────────────────────────
  private history: BodeZoomState[] = [];

  // ─── rAF coalescing for wheel zoom ──────────────────────────────────────────
  private rafId: number | null = null;
  private pendingZoomFactor = 1;
  private pendingPixel: [number, number] = [0, 0];
  private pendingRegion: HitRegion = null;

  // ─── Brush state ────────────────────────────────────────────────────────────
  private brushStart: [number, number] | null = null;
  private brushRegion: HitRegion = null;

  // ────────────────────────────────────────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────────────────────────────────────────

  init(
    host: HTMLElement,
    composites: BodeCompositeCurve[],
    axisState: BodeAxisState | undefined,
    cursors: BodeCursorState[],
    activeCurveNumber: number | undefined,
    config: Partial<BodePlotConfig>,
    callbacks: BodePlotCallbacks,
  ): void {
    this.host = host;
    this.composites = composites ?? [];
    this.cursors = cursors ? [...cursors] : [];
    this.activeCurveNumber = activeCurveNumber;
    this.callbacks = callbacks ?? {};
    this.cfg = { ...DEFAULT_BODE_CONFIG, ...config };
    this.history = [];

    this.axis = axisState ?? this.deriveAxisState(this.composites);
    // Base domains capture the initial view — zoomOutAll returns to these.
    this.baseX = [...this.axis.xRange] as [number, number];
    this.baseYAmp = [...this.axis.yAmpRange] as [number, number];
    this.baseYPhase = [...this.axis.yPhaseRange] as [number, number];

    this.computeLayout();
    this.buildSvg();
    this.buildScales();
    this.attachInteractionHandlers();
    this.redraw();
    // Initialise cursor A on the active curve's midpoint if no cursor was supplied
    if (this.cfg.enableCursorA && this.cursors.length === 0) {
      const active = this.getActiveComposite();
      if (active?.amplitude.xValues.length) {
        const midIdx = Math.floor(active.amplitude.xValues.length / 2);
        const initial = this.snapCursorAt(0, active.amplitude.xValues[midIdx]);
        this.cursors.push(initial);
      }
    }
    this.drawCursors();
  }

  destroy(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.svg?.node()?.removeEventListener('wheel', this.wheelHandler);
    this.svg?.remove();
  }

  setCursors(cursors: BodeCursorState[]): void {
    this.cursors = cursors ? [...cursors] : [];
    this.drawCursors();
  }

  setActive(curveNumber: number | undefined): void {
    this.activeCurveNumber = curveNumber;
    this.redraw();
  }

  zoomOutOneLevel(): void {
    const prev = this.history.pop();
    if (!prev) { this.zoomOutAll(); return; }
    this.xScale.domain(prev.xRange);
    this.yAmpScale.domain(prev.yAmpRange);
    this.yPhaseScale.domain(prev.yPhaseRange);
    this.emitAxis();
    this.redraw();
    this.reSnapCursors();
  }

  zoomOutAll(): void {
    this.history = [];
    this.xScale.domain(this.baseX);
    this.yAmpScale.domain(this.baseYAmp);
    this.yPhaseScale.domain(this.baseYPhase);
    this.emitAxis();
    this.redraw();
    this.reSnapCursors();
  }

  resetZoom(): void { this.zoomOutAll(); }

  // ────────────────────────────────────────────────────────────────────────────
  // Layout + SVG
  // ────────────────────────────────────────────────────────────────────────────

  private computeLayout(): void {
    const { width, height, padding, ampRegionRatio, gutter } = this.cfg;
    this.plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    this.ampHeight = Math.round((plotHeight - gutter) * ampRegionRatio);
    this.phaseHeight = plotHeight - gutter - this.ampHeight;
    this.ampTop = 0;
    this.phaseTop = this.ampHeight + gutter;
  }

  private buildSvg(): void {
    const { width, height, padding } = this.cfg;
    const uid = Math.random().toString(36).slice(2);
    this.clipAmpId = `bode-clip-amp-${uid}`;
    this.clipPhaseId = `bode-clip-phase-${uid}`;

    d3.select(this.host).select('svg.ngx-bode').remove();

    this.svg = d3.select(this.host).append('svg')
      .attr('class', 'ngx-bode')
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', `0 0 ${width} ${height}`)
      .style('display', 'block')
      .style('font-family', 'system-ui, -apple-system, sans-serif')
      .style('user-select', 'none');

    const defs = this.svg.append('defs');
    defs.append('clipPath').attr('id', this.clipAmpId)
      .append('rect')
      .attr('x', 0).attr('y', this.ampTop)
      .attr('width', this.plotWidth).attr('height', this.ampHeight);
    defs.append('clipPath').attr('id', this.clipPhaseId)
      .append('rect')
      .attr('x', 0).attr('y', this.phaseTop)
      .attr('width', this.plotWidth).attr('height', this.phaseHeight);

    this.root = this.svg.append('g')
      .attr('class', 'bode-root')
      .attr('transform', `translate(${padding.left},${padding.top})`);

    // Layer order (later renders on top)
    ['bode-axes', 'bode-grid-amp', 'bode-grid-phase',
      'bode-plot-amp', 'bode-plot-phase',
      'bode-cursors', 'bode-overlays'].forEach(cls =>
      this.root.append('g').attr('class', cls),
    );
    this.root.select<SVGGElement>('g.bode-plot-amp').attr('clip-path', `url(#${this.clipAmpId})`);
    this.root.select<SVGGElement>('g.bode-plot-phase').attr('clip-path', `url(#${this.clipPhaseId})`);

    // Sub-groups for axes
    const axes = this.root.select<SVGGElement>('g.bode-axes');
    axes.append('g').attr('class', 'bode-y-amp-axis');
    axes.append('g').attr('class', 'bode-y-phase-axis');
    axes.append('g').attr('class', 'bode-x-axis');

    // Sub-groups for curves per region
    const ampPlot = this.root.select<SVGGElement>('g.bode-plot-amp');
    ampPlot.append('g').attr('class', 'bode-curves-comparison-amp');
    ampPlot.append('g').attr('class', 'bode-curves-primary-amp');
    const phasePlot = this.root.select<SVGGElement>('g.bode-plot-phase');
    phasePlot.append('g').attr('class', 'bode-curves-comparison-phase');
    phasePlot.append('g').attr('class', 'bode-curves-primary-phase');

    // Hit rects (transparent, top of stack, in root coords)
    const hitLayer = this.svg.append('g')
      .attr('class', 'bode-hits')
      .attr('transform', `translate(${padding.left},${padding.top})`);
    this.hitYAmp = hitLayer.append('rect').attr('class', 'hit-y-amp')
      .attr('x', -padding.left).attr('y', this.ampTop)
      .attr('width', padding.left).attr('height', this.ampHeight)
      .attr('fill', 'transparent').style('cursor', 'ns-resize');
    this.hitYPhase = hitLayer.append('rect').attr('class', 'hit-y-phase')
      .attr('x', -padding.left).attr('y', this.phaseTop)
      .attr('width', padding.left).attr('height', this.phaseHeight)
      .attr('fill', 'transparent').style('cursor', 'ns-resize');
    this.hitX = hitLayer.append('rect').attr('class', 'hit-x')
      .attr('x', 0).attr('y', this.phaseTop + this.phaseHeight)
      .attr('width', this.plotWidth).attr('height', padding.bottom)
      .attr('fill', 'transparent').style('cursor', 'ew-resize');
    this.hitPlotAmp = hitLayer.append('rect').attr('class', 'hit-plot-amp')
      .attr('x', 0).attr('y', this.ampTop)
      .attr('width', this.plotWidth).attr('height', this.ampHeight)
      .attr('fill', 'transparent').style('cursor', 'crosshair');
    this.hitPlotPhase = hitLayer.append('rect').attr('class', 'hit-plot-phase')
      .attr('x', 0).attr('y', this.phaseTop)
      .attr('width', this.plotWidth).attr('height', this.phaseHeight)
      .attr('fill', 'transparent').style('cursor', 'crosshair');
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Scales
  // ────────────────────────────────────────────────────────────────────────────

  private buildScales(): void {
    this.xScale = d3.scaleLinear()
      .domain(this.axis.xRange)
      .range([0, this.plotWidth]);

    // amp: top of amp region == max value
    this.yAmpScale = d3.scaleLinear()
      .domain(this.axis.yAmpRange)
      .range([this.ampTop + this.ampHeight, this.ampTop]);

    // phase: top of phase region == min value (0°), bottom == max (360°) — matches reference image
    this.yPhaseScale = d3.scaleLinear()
      .domain(this.axis.yPhaseRange)
      .range([this.phaseTop, this.phaseTop + this.phaseHeight]);
  }

  private deriveAxisState(composites: BodeCompositeCurve[]): BodeAxisState {
    let xMin = Infinity, xMax = -Infinity;
    let ampMin = Infinity, ampMax = -Infinity;
    let phaseMin = Infinity, phaseMax = -Infinity;

    for (const c of composites) {
      const xs = c.amplitude.xValues;
      const ys = c.amplitude.yValues;
      for (let i = 0; i < xs.length; i++) {
        if (xs[i] < xMin) xMin = xs[i];
        if (xs[i] > xMax) xMax = xs[i];
        if (ys[i] < ampMin) ampMin = ys[i];
        if (ys[i] > ampMax) ampMax = ys[i];
      }
      if (c.phase) {
        for (const p of c.phase.yValues) {
          if (p < phaseMin) phaseMin = p;
          if (p > phaseMax) phaseMax = p;
        }
      }
    }

    if (!Number.isFinite(xMin)) { xMin = 0; xMax = 1; }
    if (!Number.isFinite(ampMin)) { ampMin = 0; ampMax = 1; }

    return {
      xRange: [xMin, xMax],
      // If min amplitude is ≥ 0, do NOT push into negatives (spec §3.4)
      yAmpRange: [ampMin >= 0 ? 0 : ampMin, ampMax === ampMin ? ampMax + 1 : ampMax],
      yPhaseRange: [0, 360],
      xUnit: 'RPM',
      yAmpUnit: 'mil pp',
      phaseRolloverEnabled: false,
    };
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Drawing
  // ────────────────────────────────────────────────────────────────────────────

  private redraw(): void {
    this.drawAxes();
    this.drawGrid();
    this.drawCurves();
    this.drawCursors();
  }

  private drawAxes(): void {
    const axes = this.root.select<SVGGElement>('g.bode-axes');

    // X axis — under the phase region
    const xAxis = axes.select<SVGGElement>('g.bode-x-axis')
      .attr('transform', `translate(0,${this.phaseTop + this.phaseHeight})`);
    xAxis.call(d3.axisBottom(this.xScale).ticks(this.cfg.gridTicksX).tickFormat(d3.format(',d')) as any);
    xAxis.selectAll('text').attr('fill', AXIS_COLOR).attr('font-size', 10);
    xAxis.selectAll('line,path').attr('stroke', AXIS_COLOR);

    // Y amp axis
    const yAmp = axes.select<SVGGElement>('g.bode-y-amp-axis');
    yAmp.call(d3.axisLeft(this.yAmpScale).ticks(this.cfg.gridTicksY) as any);
    yAmp.selectAll('text').attr('fill', AXIS_COLOR).attr('font-size', 10);
    yAmp.selectAll('line,path').attr('stroke', AXIS_COLOR);

    // Y phase axis
    const yPhase = axes.select<SVGGElement>('g.bode-y-phase-axis');
    yPhase.call(d3.axisLeft(this.yPhaseScale).ticks(this.cfg.gridTicksY).tickFormat(d => `${d}°`) as any);
    yPhase.selectAll('text').attr('fill', AXIS_COLOR).attr('font-size', 10);
    yPhase.selectAll('line,path').attr('stroke', AXIS_COLOR);

    // Axis unit labels
    axes.selectAll('.bode-axis-label').remove();
    axes.append('text').attr('class', 'bode-axis-label')
      .attr('x', -8).attr('y', this.ampTop - 6)
      .attr('text-anchor', 'end').attr('font-size', 10).attr('fill', AXIS_COLOR)
      .text(this.axis.yAmpUnit);
    axes.append('text').attr('class', 'bode-axis-label')
      .attr('x', -8).attr('y', this.phaseTop - 6)
      .attr('text-anchor', 'end').attr('font-size', 10).attr('fill', AXIS_COLOR)
      .text('deg');
    axes.append('text').attr('class', 'bode-axis-label')
      .attr('x', this.plotWidth).attr('y', this.phaseTop + this.phaseHeight + 32)
      .attr('text-anchor', 'end').attr('font-size', 10).attr('fill', AXIS_COLOR)
      .text(this.axis.xUnit.toLowerCase());
  }

  private drawGrid(): void {
    const drawRegionGrid = (
      groupClass: string, yScale: d3.ScaleLinear<number, number>,
      top: number, bottom: number,
    ) => {
      const g = this.root.select<SVGGElement>(`g.${groupClass}`);
      g.selectAll('*').remove();
      // Vertical (X) grid lines
      const xTicks = this.xScale.ticks(this.cfg.gridTicksX);
      g.selectAll('line.gx')
        .data(xTicks).join('line').attr('class', 'gx')
        .attr('x1', d => this.xScale(d)).attr('x2', d => this.xScale(d))
        .attr('y1', top).attr('y2', bottom)
        .attr('stroke', GRID_COLOR).attr('stroke-width', 1);
      // Horizontal (Y) grid lines
      const yTicks = yScale.ticks(this.cfg.gridTicksY);
      g.selectAll('line.gy')
        .data(yTicks).join('line').attr('class', 'gy')
        .attr('y1', d => yScale(d)).attr('y2', d => yScale(d))
        .attr('x1', 0).attr('x2', this.plotWidth)
        .attr('stroke', GRID_COLOR).attr('stroke-width', 1);
      // Region frame
      g.append('rect').attr('class', 'frame')
        .attr('x', 0).attr('y', top).attr('width', this.plotWidth).attr('height', bottom - top)
        .attr('fill', 'none').attr('stroke', AXIS_COLOR).attr('stroke-width', 1);
    };
    drawRegionGrid('bode-grid-amp', this.yAmpScale, this.ampTop, this.ampTop + this.ampHeight);
    drawRegionGrid('bode-grid-phase', this.yPhaseScale, this.phaseTop, this.phaseTop + this.phaseHeight);
  }

  private drawCurves(): void {
    const primaries = this.composites.filter(c => c.curveType === 'primary');
    const comparisons = this.cfg.showComparison
      ? this.composites.filter(c => c.curveType === 'comparison')
      : [];

    this.drawCurveGroup('bode-curves-primary-amp', primaries, 'amplitude', this.yAmpScale, true);
    this.drawCurveGroup('bode-curves-primary-phase', primaries, 'phase', this.yPhaseScale, true);
    this.drawCurveGroup('bode-curves-comparison-amp', comparisons, 'amplitude', this.yAmpScale, false);
    this.drawCurveGroup('bode-curves-comparison-phase', comparisons, 'phase', this.yPhaseScale, false);
  }

  private drawCurveGroup(
    groupClass: string,
    composites: BodeCompositeCurve[],
    side: 'amplitude' | 'phase',
    yScale: d3.ScaleLinear<number, number>,
    primary: boolean,
  ): void {
    const g = this.root.select<SVGGElement>(`g.${groupClass}`);
    g.selectAll('*').remove();

    for (const c of composites) {
      const curve = side === 'amplitude' ? c.amplitude : c.phase;
      if (!curve) continue;
      const activeCurve = primary && (this.activeCurveNumber === undefined || this.activeCurveNumber === c.primaryCurveNumber);
      const opacity = activeCurve
        ? (curve.style.activeOpacity ?? 1)
        : (curve.style.inactiveOpacity ?? 0.35);

      const values = this.buildLineSamples(curve, side);
      const line = d3.line<{ x: number; y: number; valid: boolean }>()
        .defined(d => d.valid)
        .x(d => this.xScale(d.x))
        .y(d => yScale(d.y))
        .curve(d3.curveLinear);

      g.append('path')
        .attr('class', `curve curve-${c.primaryCurveNumber}`)
        .datum(values)
        .attr('d', line as any)
        .attr('fill', 'none')
        .attr('stroke', curve.style.color)
        .attr('stroke-width', curve.style.lineWidth ?? 1.5)
        .attr('stroke-dasharray', curve.style.dashArray ?? '')
        .attr('opacity', opacity);
    }
  }

  private buildLineSamples(curve: BodeCurve, side: 'amplitude' | 'phase'):
    { x: number; y: number; valid: boolean }[] {
    const xs = curve.xValues;
    const ys = curve.yValues;
    const ystat = curve.yStatus;
    const out: { x: number; y: number; valid: boolean }[] = new Array(xs.length);
    for (let i = 0; i < xs.length; i++) {
      const s: StatusPoint = ystat ? ystat[i] : 'Valid';
      const yv = ys[i];
      const valid = s === 'Valid' && Number.isFinite(yv);
      out[i] = { x: xs[i], y: side === 'phase' ? this.wrapPhaseForRender(yv) : yv, valid };
    }
    return out;
  }

  private wrapPhaseForRender(v: number): number {
    if (this.axis.phaseRolloverEnabled) return v;
    // Clamped-360 mode: wrap into [0, 360)
    if (!Number.isFinite(v)) return v;
    return ((v % 360) + 360) % 360;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Interaction — wheel zoom + brush zoom + cursor drag
  // ────────────────────────────────────────────────────────────────────────────

  private attachInteractionHandlers(): void {
    // Wheel — passive:false is required for preventDefault
    this.svg.node()!.addEventListener('wheel', this.wheelHandler, { passive: false });

    // Brush zoom on plot regions (left = zoom in; right = zoom out one level)
    const drag = d3.drag<SVGRectElement, unknown>()
      .filter((event: MouseEvent) => !event.shiftKey && event.button === 0)
      .on('start', (event: any) => {
        const [mx, my] = d3.pointer(event, this.root.node()!);
        this.brushStart = [mx, my];
        this.brushRegion = this.hitTest(mx, my);
        this.drawBrushRect(mx, my, mx, my);
      })
      .on('drag', (event: any) => {
        if (!this.brushStart) return;
        const [mx, my] = d3.pointer(event, this.root.node()!);
        this.drawBrushRect(this.brushStart[0], this.brushStart[1], mx, my);
      })
      .on('end', (event: any) => {
        if (!this.brushStart) return;
        const [mx, my] = d3.pointer(event, this.root.node()!);
        const [sx, sy] = this.brushStart;
        this.brushStart = null;
        this.clearBrushRect();
        const dx = mx - sx;
        const dy = my - sy;
        // Right-to-left drag → zoom out one level (§10.3)
        if (dx < -12) { this.zoomOutOneLevel(); return; }
        // Tiny drag → treat as a click; do nothing
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        this.applyBrushZoom(sx, sy, mx, my, this.brushRegion);
      });
    this.hitPlotAmp.call(drag as any);
    this.hitPlotPhase.call(drag as any);
  }

  // ─── Wheel handler + rAF coalescing ────────────────────────────────────────

  private readonly wheelHandler = (event: WheelEvent): void => {
    // Route by which hit rect (or region rect) the pointer is over
    const target = event.target as SVGElement | null;
    const cls = target?.getAttribute('class') ?? '';
    let region: HitRegion = null;
    if (cls.includes('hit-x')) region = 'x-axis';
    else if (cls.includes('hit-y-amp')) region = 'y-amp';
    else if (cls.includes('hit-y-phase')) region = 'y-phase';
    else if (cls.includes('hit-plot-amp')) region = 'plot-amp';
    else if (cls.includes('hit-plot-phase')) region = 'plot-phase';
    if (!region) return;

    event.preventDefault();
    const [mx, my] = d3.pointer(event, this.root.node()!);
    const factor = Math.pow(1.1, -event.deltaY / ZOOM_SENSITIVITY);

    // Accumulate — multiple wheel events within one frame collapse to one redraw.
    this.pendingZoomFactor *= factor;
    this.pendingPixel = [mx, my];
    this.pendingRegion = region;

    if (this.rafId === null) {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.applyPendingZoom();
      });
    }
  };

  private applyPendingZoom(): void {
    const region = this.pendingRegion;
    const factor = this.pendingZoomFactor;
    const [mx, my] = this.pendingPixel;
    this.pendingZoomFactor = 1;
    this.pendingRegion = null;
    if (!region || factor === 1) return;

    // Snapshot for one-level zoom-out
    this.pushHistory();

    switch (region) {
      case 'x-axis':
      case 'plot-amp':
      case 'plot-phase':
        this.zoomScaleAround(this.xScale, mx, factor, this.baseX);
        break;
      case 'y-amp':
        this.zoomScaleAround(this.yAmpScale, my, factor, this.baseYAmp);
        break;
      case 'y-phase':
        this.zoomScaleAround(this.yPhaseScale, my, factor, this.baseYPhase);
        break;
    }
    this.emitAxis();
    this.redraw();
    this.reSnapCursors();
  }

  private zoomScaleAround(
    scale: d3.ScaleLinear<number, number>,
    pixel: number,
    factor: number,
    baseDomain: [number, number],
  ): void {
    const [d0, d1] = scale.domain();
    const centre = scale.invert(pixel);
    const nd0 = centre - (centre - d0) / factor;
    const nd1 = centre + (d1 - centre) / factor;
    // Clamp against absolute zoom range guards
    const span = nd1 - nd0;
    const baseSpan = baseDomain[1] - baseDomain[0];
    if (span < baseSpan / ZOOM_MAX_FACTOR) return;         // too zoomed in
    if (span > baseSpan * (1 / ZOOM_MIN_FACTOR)) return;   // too zoomed out
    scale.domain([nd0, nd1]);
  }

  // ─── Brush zoom ─────────────────────────────────────────────────────────────

  private drawBrushRect(x0: number, y0: number, x1: number, y1: number): void {
    const g = this.root.select<SVGGElement>('g.bode-overlays');
    g.selectAll('rect.brush').remove();
    const xMin = Math.min(x0, x1), xMax = Math.max(x0, x1);
    // Brush always covers full region vertically if drag stays in plot area
    const region = this.hitTest((x0 + x1) / 2, (y0 + y1) / 2);
    let yMin = 0, yMax = 0;
    if (region === 'plot-amp') { yMin = this.ampTop; yMax = this.ampTop + this.ampHeight; }
    else if (region === 'plot-phase') { yMin = this.phaseTop; yMax = this.phaseTop + this.phaseHeight; }
    else return;
    g.append('rect').attr('class', 'brush')
      .attr('x', xMin).attr('y', yMin)
      .attr('width', xMax - xMin).attr('height', yMax - yMin)
      .attr('fill', 'rgba(55,138,221,0.15)')
      .attr('stroke', '#378ADD').attr('stroke-width', 1).attr('stroke-dasharray', '3 3');
  }

  private clearBrushRect(): void {
    this.root.select('g.bode-overlays').selectAll('rect.brush').remove();
  }

  private applyBrushZoom(sx: number, sy: number, mx: number, my: number, region: HitRegion): void {
    if (!region) return;
    this.pushHistory();
    const [x0, x1] = [Math.min(sx, mx), Math.max(sx, mx)];
    // X zoom (from either plot region)
    const nx0 = this.xScale.invert(x0);
    const nx1 = this.xScale.invert(x1);
    if (nx1 > nx0) this.xScale.domain([nx0, nx1]);
    // Y zoom within region only if drag is meaningfully vertical too
    if (Math.abs(my - sy) > 20) {
      const yScale = region === 'plot-amp' ? this.yAmpScale : this.yPhaseScale;
      const y0 = Math.min(sy, my), y1 = Math.max(sy, my);
      // yScale range is inverted for amp; use invert regardless
      const ny0 = yScale.invert(y1); // low pixel = high value for amp
      const ny1 = yScale.invert(y0);
      if (ny1 > ny0) yScale.domain([ny0, ny1]);
    }
    this.emitAxis();
    this.redraw();
    this.reSnapCursors();
  }

  private pushHistory(): void {
    this.history.push({
      xRange: [...this.xScale.domain()] as [number, number],
      yAmpRange: [...this.yAmpScale.domain()] as [number, number],
      yPhaseRange: [...this.yPhaseScale.domain()] as [number, number],
    });
  }

  // ─── Hit-testing ────────────────────────────────────────────────────────────

  hitTest(mx: number, my: number): HitRegion {
    const inPlotX = mx >= 0 && mx <= this.plotWidth;
    if (my >= this.ampTop && my <= this.ampTop + this.ampHeight) {
      if (mx < 0) return 'y-amp';
      if (inPlotX) return 'plot-amp';
      return null;
    }
    if (my >= this.phaseTop && my <= this.phaseTop + this.phaseHeight) {
      if (mx < 0) return 'y-phase';
      if (inPlotX) return 'plot-phase';
      return null;
    }
    if (my > this.phaseTop + this.phaseHeight && inPlotX) return 'x-axis';
    return null;
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Cursor A
  // ────────────────────────────────────────────────────────────────────────────

  getActiveComposite(): BodeCompositeCurve | undefined {
    if (!this.composites.length) return undefined;
    if (this.activeCurveNumber !== undefined) {
      return this.composites.find(c => c.primaryCurveNumber === this.activeCurveNumber) ?? this.composites[0];
    }
    return this.composites.find(c => c.isActive) ?? this.composites[0];
  }

  snapCursorAt(index: 0 | 1, xVal: number): BodeCursorState {
    const active = this.getActiveComposite();
    if (!active) {
      return { cursorIndex: index, xValue: xVal, ampValue: NaN, isInvalid: true };
    }
    const bisect = d3.bisector<number, number>(d => d).center;
    const i = bisect(active.amplitude.xValues, xVal);
    const clamped = Math.max(0, Math.min(i, active.amplitude.xValues.length - 1));
    const status = active.amplitude.yStatus?.[clamped] ?? 'Valid';
    return {
      cursorIndex: index,
      xValue: active.amplitude.xValues[clamped],
      ampValue: active.amplitude.yValues[clamped],
      phaseValue: active.phase?.yValues[clamped],
      timestampUtc: active.amplitude.timestampsUtc?.[clamped],
      isInvalid: status !== 'Valid',
    };
  }

  private reSnapCursors(): void {
    if (!this.cursors.length) return;
    this.cursors = this.cursors.map(c => this.snapCursorAt(c.cursorIndex, c.xValue));
    this.drawCursors();
    this.callbacks.onCursorChange?.(this.cursors);
  }

  private drawCursors(): void {
    const g = this.root.select<SVGGElement>('g.bode-cursors');
    g.selectAll('*').remove();
    for (const c of this.cursors) {
      this.drawCursor(c);
    }
  }

  private drawCursor(c: BodeCursorState): void {
    const g = this.root.select<SVGGElement>('g.bode-cursors');
    // If cursor x-value is outside the visible x-domain, skip rendering — snap point still stored
    const [d0, d1] = this.xScale.domain();
    if (c.xValue < d0 || c.xValue > d1) return;

    const px = this.xScale(c.xValue);
    const color = c.cursorIndex === 0 ? CURSOR_A_COLOR : CURSOR_B_COLOR;

    const cur = g.append('g').attr('class', `cursor cursor-${c.cursorIndex}`);
    cur.append('line').attr('class', 'cursor-line')
      .attr('x1', px).attr('x2', px)
      .attr('y1', this.ampTop).attr('y2', this.phaseTop + this.phaseHeight)
      .attr('stroke', color).attr('stroke-width', 1.5);

    // Draggable handle at the very top
    cur.append('rect').attr('class', 'cursor-handle')
      .attr('x', px - 6).attr('y', this.ampTop - 14)
      .attr('width', 12).attr('height', 12)
      .attr('fill', color).attr('rx', 2)
      .style('cursor', 'ew-resize')
      .call(d3.drag<SVGRectElement, unknown>()
        .on('drag', (event: any) => {
          const [mx] = d3.pointer(event, this.root.node()!);
          const clamped = Math.max(0, Math.min(mx, this.plotWidth));
          const xVal = this.xScale.invert(clamped);
          const snapped = this.snapCursorAt(c.cursorIndex, xVal);
          this.cursors = this.cursors.map(cc => cc.cursorIndex === c.cursorIndex ? snapped : cc);
          this.drawCursors();
          this.callbacks.onCursorChange?.(this.cursors);
        }) as any);

    // Amplitude dot
    if (Number.isFinite(c.ampValue)) {
      const yAmp = this.yAmpScale(c.ampValue);
      if (yAmp >= this.ampTop && yAmp <= this.ampTop + this.ampHeight) {
        cur.append('circle').attr('class', 'cursor-dot-amp')
          .attr('cx', px).attr('cy', yAmp).attr('r', 4)
          .attr('fill', color).attr('stroke', 'white').attr('stroke-width', 1.5);
      }
    }
    // Phase dot
    if (c.phaseValue !== undefined && Number.isFinite(c.phaseValue)) {
      const rendered = this.wrapPhaseForRender(c.phaseValue);
      const yPhase = this.yPhaseScale(rendered);
      if (yPhase >= this.phaseTop && yPhase <= this.phaseTop + this.phaseHeight) {
        cur.append('circle').attr('class', 'cursor-dot-phase')
          .attr('cx', px).attr('cy', yPhase).attr('r', 4)
          .attr('fill', color).attr('stroke', 'white').attr('stroke-width', 1.5);
      }
    }
  }

  // ─── Emit axis change (throttled by rAF at the call-site) ───────────────────

  private emitAxis(): void {
    const nextAxis: BodeAxisState = {
      ...this.axis,
      xRange: [...this.xScale.domain()] as [number, number],
      yAmpRange: [...this.yAmpScale.domain()] as [number, number],
      yPhaseRange: [...this.yPhaseScale.domain()] as [number, number],
    };
    this.axis = nextAxis;
    this.callbacks.onAxisChange?.(nextAxis);
  }
}
