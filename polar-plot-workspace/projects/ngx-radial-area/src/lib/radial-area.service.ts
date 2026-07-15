import { Injectable, ElementRef } from '@angular/core';
import * as d3 from 'd3';
import {
  RadialDataPoint,
  RadialSeries,
  RadialAreaConfig,
  DEFAULT_CONFIG,
  ZoomEvent,
} from './radial-area.models';

@Injectable()
export class RadialAreaService {
  private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
  private root!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private chartGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private gridGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private spokesGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private labelsGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private radialLabelsGroup!: d3.Selection<SVGGElement, unknown, null, undefined>;
  private areaGroups: Map<string, d3.Selection<SVGGElement, unknown, null, undefined>> = new Map();

  private scales: Map<string, d3.ScaleLinear<number, number>> = new Map();
  private angleScale!: d3.ScaleBand<string>;
  private zoomBehavior!: d3.ZoomBehavior<SVGRectElement, unknown>;
  private overlay!: d3.Selection<SVGRectElement, unknown, null, undefined>;

  private config: Required<RadialAreaConfig> = { ...DEFAULT_CONFIG };
  private data: RadialDataPoint[] = [];
  private series: RadialSeries[] = [];
  private currentZoom = 1;
  private baseOuterRadius = DEFAULT_CONFIG.outerRadius;

  private onZoomCallback?: (event: ZoomEvent) => void;

  init(
    hostEl: ElementRef<HTMLElement>,
    data: RadialDataPoint[],
    series: RadialSeries[],
    config: Partial<RadialAreaConfig>,
    onZoom?: (event: ZoomEvent) => void
  ): void {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.data = data;
    this.series = series;
    this.onZoomCallback = onZoom;

    d3.select(hostEl.nativeElement).select('svg').remove();

    const { width, height } = this.config;
    const cx = width / 2;
    const cy = height / 2;

    this.svg = d3
      .select(hostEl.nativeElement)
      .append('svg')
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('style', 'display:block;');

    this.svg
      .append('defs')
      .append('clipPath')
      .attr('id', 'radial-clip')
      .append('circle')
      .attr('r', this.config.outerRadius + 35)
      .attr('cx', 0)
      .attr('cy', 0);

    this.baseOuterRadius = this.config.outerRadius;

    this.root = this.svg.append('g').attr('transform', `translate(${cx},${cy})`);
    this.chartGroup = this.root.append('g').attr('clip-path', 'url(#radial-clip)');
    this.gridGroup = this.chartGroup.append('g').attr('class', 'ngx-ra-grid');
    this.spokesGroup = this.chartGroup.append('g').attr('class', 'ngx-ra-spokes');

    this.series.forEach((s) => {
      this.areaGroups.set(s.key, this.chartGroup.append('g').attr('class', `ngx-ra-area-${s.key}`));
    });

    this.labelsGroup = this.root.append('g').attr('class', 'ngx-ra-angular-labels');
    this.radialLabelsGroup = this.root.append('g').attr('class', 'ngx-ra-radial-labels');

    this.buildScales();
    this.drawSpokes();
    this.redraw();
    this.attachZoom();
  }

  update(data: RadialDataPoint[], series: RadialSeries[], config?: Partial<RadialAreaConfig>): void {
    this.data = data;
    this.areaGroups.forEach((g) => g.remove());
    this.areaGroups.clear();
    this.series = series;
    this.series.forEach((s) => {
      this.areaGroups.set(s.key, this.chartGroup.append('g').attr('class', `ngx-ra-area-${s.key}`));
    });
    if (config) this.config = { ...this.config, ...config };
    this.buildScales();
    this.drawSpokes();
    this.redraw();
  }

  resetZoom(): void {
    this.overlay
      .transition()
      .duration(this.config.animationDuration)
      .call(this.zoomBehavior.transform, d3.zoomIdentity);
  }

  getCurrentZoom(): number {
    return this.currentZoom;
  }

  destroy(): void {
    if (this.svg) {
      this.svg.on('.zoom', null);
      this.svg.remove();
    }
    this.scales.clear();
    this.areaGroups.clear();
  }

  buildScales(): void {
    this.scales.clear();
    const { innerRadius, outerRadius } = this.config;

    this.angleScale = d3
      .scaleBand()
      .domain(this.data.map((d) => d.label))
      .range([0, 2 * Math.PI])
      .paddingInner(0)
      .paddingOuter(0);

    this.series.forEach((s) => {
      const domainMax = s.domain
        ? s.domain[1]
        : (d3.max(this.data, (d) => d[s.key] as number) ?? 100);
      const domainMin = s.domain ? s.domain[0] : 0;

      this.scales.set(
        s.key,
        d3.scaleLinear().domain([domainMin, domainMax]).range([innerRadius, outerRadius])
      );
    });
  }

  getScale(key: string): d3.ScaleLinear<number, number> | undefined {
    return this.scales.get(key);
  }

  getAngleScale(): d3.ScaleBand<string> {
    return this.angleScale;
  }

  private midAngle(label: string): number {
    return (this.angleScale(label) ?? 0) + this.angleScale.bandwidth() / 2;
  }

  private polarToXY(angleRad: number, r: number): [number, number] {
    return [Math.sin(angleRad) * r, -Math.cos(angleRad) * r];
  }

  private getTextColor(): string {
    return this.config.darkMode ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.68)';
  }

  private getGridColor(): string {
    return this.config.darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
  }

  private redraw(): void {
    this.drawGrid();
    this.drawAreas();
    if (this.config.showAngularLabels) this.drawAngularLabels();
    if (this.config.showRadialLabels) this.drawRadialLabels();
  }

  private drawGrid(): void {
    if (!this.config.showGrid) {
      this.gridGroup.selectAll('*').remove();
      return;
    }
    this.gridGroup.selectAll('*').remove();

    const gridColor = this.getGridColor();

    this.series.forEach((s, idx) => {
      const scale = this.scales.get(s.key)!;
      const ticks = scale.ticks(this.config.gridTicks);
      const dashPattern = idx === 0 ? '4 3' : '2 4';
      const strokeColor = idx === 0 ? `${s.color}44` : `${s.color}33`;

      this.gridGroup
        .selectAll(`.ring-${s.key}`)
        .data(ticks)
        .join('circle')
        .attr('class', `ring-${s.key}`)
        .attr('r', (d) => scale(d))
        .attr('fill', 'none')
        .attr('stroke', strokeColor)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', dashPattern);
    });

    this.gridGroup
      .append('circle')
      .attr('r', this.config.innerRadius)
      .attr('fill', this.config.darkMode ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)')
      .attr('stroke', gridColor)
      .attr('stroke-width', 1);
  }

  private drawSpokes(): void {
    this.spokesGroup.selectAll('*').remove();
    if (!this.config.showSpokes) return;
    const spokeColor = this.config.darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)';
    const outerR = this.config.outerRadius + 15;

    this.data.forEach((d) => {
      const a = this.midAngle(d.label);
      const [x, y] = this.polarToXY(a, outerR);
      this.spokesGroup
        .append('line')
        .attr('x1', 0).attr('y1', 0)
        .attr('x2', x).attr('y2', y)
        .attr('stroke', spokeColor)
        .attr('stroke-width', 1);
    });
  }

  private drawAreas(): void {
    this.series.forEach((s) => {
      const group = this.areaGroups.get(s.key);
      if (!group) return;
      group.selectAll('*').remove();

      const scale = this.scales.get(s.key)!;

      const areaGen = d3
        .areaRadial<RadialDataPoint>()
        .angle((d) => this.midAngle(d.label))
        .innerRadius(this.config.innerRadius)
        .outerRadius((d) => scale(d[s.key] as number))
        .curve(d3.curveCatmullRomClosed.alpha(0.5));

      const lineGen = d3
        .lineRadial<RadialDataPoint>()
        .angle((d) => this.midAngle(d.label))
        .radius((d) => scale(d[s.key] as number))
        .curve(d3.curveCatmullRomClosed.alpha(0.5));

      group
        .append('path')
        .datum(this.data)
        .attr('d', areaGen as any)
        .attr('fill', s.color)
        .attr('fill-opacity', 0.25)
        .attr('stroke', 'none');

      group
        .append('path')
        .datum(this.data)
        .attr('d', lineGen as any)
        .attr('fill', 'none')
        .attr('stroke', s.color)
        .attr('stroke-width', 2)
        .attr('stroke-linejoin', 'round');

      group
        .selectAll(`.dot-${s.key}`)
        .data(this.data)
        .join('circle')
        .attr('class', `dot-${s.key}`)
        .attr('cx', (d) => this.polarToXY(this.midAngle(d.label), scale(d[s.key] as number))[0])
        .attr('cy', (d) => this.polarToXY(this.midAngle(d.label), scale(d[s.key] as number))[1])
        .attr('r', 3.5)
        .attr('fill', s.color)
        .attr('stroke', this.config.darkMode ? '#1e1e1e' : '#fff')
        .attr('stroke-width', 1.5);
    });
  }

  private drawAngularLabels(): void {
    this.labelsGroup.selectAll('*').remove();
    if (this.scales.size === 0) return;
    const firstScale = this.scales.values().next().value as d3.ScaleLinear<number, number>;
    const r = firstScale.range()[1] + 26;
    const textColor = this.getTextColor();

    this.data.forEach((d) => {
      const a = this.midAngle(d.label);
      const [x, y] = this.polarToXY(a, r);

      const sinA = Math.sin(a);
      const anchor = sinA > 0.1 ? 'start' : sinA < -0.1 ? 'end' : 'middle';

      this.labelsGroup
        .append('text')
        .attr('x', x).attr('y', y)
        .attr('text-anchor', anchor)
        .attr('dominant-baseline', 'middle')
        .attr('font-size', '11px')
        .attr('font-family', 'inherit')
        .attr('fill', textColor)
        .text(d.label);
    });
  }

  private drawRadialLabels(): void {
    this.radialLabelsGroup.selectAll('*').remove();

    this.series.forEach((s, idx) => {
      const scale = this.scales.get(s.key)!;
      const ticks = scale.ticks(this.config.gridTicks);

      ticks.slice(0, -1).forEach((v) => {
        const r = scale(v);
        const x = idx === 0 ? 4 : r + 3;
        const y = idx === 0 ? -r + 4 : 4;
        this.radialLabelsGroup
          .append('text')
          .attr('x', x)
          .attr('y', y)
          .attr('font-size', '9px')
          .attr('font-family', 'inherit')
          .attr('fill', s.color)
          .attr('opacity', 0.85)
          .attr('text-anchor', 'start')
          .text(v);
      });
    });
  }

  private attachZoom(): void {
    const { width, height, zoomMin, zoomMax, zoomSensitivity, innerRadius, animationDuration } = this.config;

    this.zoomBehavior = d3
      .zoom<SVGRectElement, unknown>()
      .scaleExtent([zoomMin, zoomMax])
      .wheelDelta((event) => {
        return -event.deltaY * (event.deltaMode === 1 ? 0.08 : event.deltaMode ? 1 : zoomSensitivity);
      })
      .on('zoom', (event) => {
        const k: number = event.transform.k;
        this.currentZoom = k;

        const zoomedOuter = innerRadius + (this.baseOuterRadius - innerRadius) * k;

        this.scales.forEach((scale) => {
          scale.range([innerRadius, zoomedOuter]);
        });

        this.redraw();

        if (this.onZoomCallback) {
          this.onZoomCallback({ scale: k, transform: event.transform });
        }
      });

    this.overlay = this.svg
      .append('rect')
      .attr('width', width)
      .attr('height', height)
      .attr('fill', 'none')
      .attr('pointer-events', 'all')
      .style('cursor', 'crosshair')
      .call(this.zoomBehavior)
      .on('wheel', (event: WheelEvent) => event.preventDefault())
      .on('dblclick.zoom', () => {
        this.overlay.transition().duration(animationDuration).call(this.zoomBehavior.transform, d3.zoomIdentity);
      });
  }
}
