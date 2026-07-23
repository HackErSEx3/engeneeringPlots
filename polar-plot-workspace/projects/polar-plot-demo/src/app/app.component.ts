import { Component, ViewChild } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  NgxRadialAreaComponent,
  RadialDataPoint,
  RadialSeries,
  RadialAreaConfig,
  ZoomEvent,
  NgxPolarPlotComponent,
  PolarDataPoint,
  PolarPlotConfig,
  // CSV polar data adapter (real compressor data, degrees)
  csvPolarData,
  transformCsvToPolarPoints,
  CsvLabelMode,
} from 'ngx-radial-area';
import {
  NgxBodePlotComponent,
  BodeAxisState,
  BodeCompositeCurve,
  BodeCursorState,
  BodePlotConfig,
  buildSampleComposite,
} from 'ngx-bode-plot';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, NgxRadialAreaComponent, NgxPolarPlotComponent, NgxBodePlotComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  @ViewChild(NgxPolarPlotComponent) private polarPlotRef?: NgxPolarPlotComponent;
  @ViewChild(NgxBodePlotComponent)  private bodePlotRef?: NgxBodePlotComponent;

  chartType: 'polar' | 'radial' | 'bode' = 'polar';

  // ── Polar plot ─────────────────────────────────────────────────────────────
  polarShowGrid   = true;
  polarShowSpokes = true;
  polarShowVector = true;
  polarShowLabels = true;                      // Stage 2 label overlay
  polarLabelMode: CsvLabelMode = 'datetime';  // 'datetime' | 'speed' | 'none'
  polarZoom = 1;

  // Real compressor data from polarData1.csv — 3713 valid points, phase in degrees
  // Stage 1: full point set drives the curve geometry
  // Stage 2: labelText on each point drives the label overlay
  polarData: PolarDataPoint[] =
    transformCsvToPolarPoints(csvPolarData, 'datetime') as PolarDataPoint[];

  polarConfig: Partial<PolarPlotConfig> = {
    width: 500,
    height: 500,
    padding: 55,
    lineColor: '#378ADD',
    showArea: false,
    showGrid: true,
    showSpokes: true,
    gridTicks: 4,
    spokesEvery: 30,
    closedCurve: false,
    showVector: true,
    showDots: true,
    dotRadius: 3,
    dotThreshold: 500,
    // ── Stage 2: label overlay ───────────────────────────────────
    // labelFormatter reads labelText set by transformNxVectorToPolarPoints()
    showDataLabels:    true,
    labelFormatter:    (pt) => (pt as any).labelText ?? '',
    labelFontSize:     10,
    labelMinSpacingPx: 40,   // 40 px gap keeps the dense steady-state cluster readable
    labelThreshold:    2000, // thinning pre-pass kicks in above 2 000 candidates
  };

  selectedPoint: PolarDataPoint | null = null;

  onPolarZoom(k: number): void {
    this.polarZoom = k;
  }

  onPointSelected(pt: PolarDataPoint): void {
    this.selectedPoint = pt;
  }

  togglePolarGrid(): void {
    this.polarShowGrid = !this.polarShowGrid;
    this.polarConfig = { ...this.polarConfig, showGrid: this.polarShowGrid };
  }

  togglePolarSpokes(): void {
    this.polarShowSpokes = !this.polarShowSpokes;
    this.polarConfig = { ...this.polarConfig, showSpokes: this.polarShowSpokes };
  }

  togglePolarVector(): void {
    this.polarShowVector = !this.polarShowVector;
    this.polarPlotRef?.setVector(this.polarShowVector);
  }

  togglePolarLabels(): void {
    this.polarShowLabels = !this.polarShowLabels;
    this.polarConfig = { ...this.polarConfig, showDataLabels: this.polarShowLabels };
  }

  setPolarLabelMode(mode: CsvLabelMode): void {
    this.polarLabelMode = mode;
    // Re-transform with new label mode — regenerates labelText per point
    this.polarData = transformCsvToPolarPoints(csvPolarData, mode) as PolarDataPoint[];
  }

  // ── Radial area ─────────────────────────────────────────────────────────────
  currentZoom = 1;
  activeDataset: 'weather' | 'performance' = 'weather';
  showGrid = true;
  showSpokes = true;

  weatherData: RadialDataPoint[] = [
    { label: 'Jan', temp: 12, rain: 68 },
    { label: 'Feb', temp: 13, rain: 55 },
    { label: 'Mar', temp: 16, rain: 50 },
    { label: 'Apr', temp: 20, rain: 42 },
    { label: 'May', temp: 25, rain: 35 },
    { label: 'Jun', temp: 31, rain: 22 },
    { label: 'Jul', temp: 34, rain: 18 },
    { label: 'Aug', temp: 33, rain: 24 },
    { label: 'Sep', temp: 29, rain: 40 },
    { label: 'Oct', temp: 23, rain: 58 },
    { label: 'Nov', temp: 17, rain: 65 },
    { label: 'Dec', temp: 13, rain: 72 },
  ];

  performanceData: RadialDataPoint[] = [
    { label: 'Mon', cpu: 45, memory: 62 },
    { label: 'Tue', cpu: 72, memory: 75 },
    { label: 'Wed', cpu: 58, memory: 80 },
    { label: 'Thu', cpu: 91, memory: 88 },
    { label: 'Fri', cpu: 67, memory: 71 },
    { label: 'Sat', cpu: 30, memory: 55 },
    { label: 'Sun', cpu: 25, memory: 48 },
  ];

  weatherSeries: RadialSeries[] = [
    { key: 'temp', label: 'Temperature (°C)', color: '#378ADD', domain: [0, 40] },
    { key: 'rain', label: 'Rainfall (mm)', color: '#1D9E75', domain: [0, 100] },
  ];

  performanceSeries: RadialSeries[] = [
    { key: 'cpu', label: 'CPU Usage (%)', color: '#D85A30', domain: [0, 100] },
    { key: 'memory', label: 'Memory Usage (%)', color: '#7F77DD', domain: [0, 100] },
  ];

  chartConfig: Partial<RadialAreaConfig> = {
    width: 500,
    height: 500,
    innerRadius: 55,
    outerRadius: 200,
    showGrid: true,
    showSpokes: true,
    gridTicks: 4,
  };

  get activeData(): RadialDataPoint[] {
    return this.activeDataset === 'weather' ? this.weatherData : this.performanceData;
  }

  get activeSeries(): RadialSeries[] {
    return this.activeDataset === 'weather' ? this.weatherSeries : this.performanceSeries;
  }

  switchChartType(type: 'polar' | 'radial'): void {
    this.chartType = type;
  }

  onZoomChange(event: ZoomEvent): void {
    this.currentZoom = event.scale;
  }

  onZoomReset(): void {
    this.currentZoom = 1;
  }

  switchDataset(name: 'weather' | 'performance'): void {
    this.activeDataset = name;
  }

  toggleGrid(): void {
    this.showGrid = !this.showGrid;
    this.chartConfig = { ...this.chartConfig, showGrid: this.showGrid };
  }

  toggleSpokes(): void {
    this.showSpokes = !this.showSpokes;
    this.chartConfig = { ...this.chartConfig, showSpokes: this.showSpokes };
  }

  // ── Bode plot ──────────────────────────────────────────────────────────────
  private readonly bodeSample = buildSampleComposite();
  bodeComposite: BodeCompositeCurve = this.bodeSample.composite;
  bodeAxis: BodeAxisState = {
    xRange: this.bodeSample.axis.xRange ?? [0, 1],
    yAmpRange: this.bodeSample.axis.yAmpRange ?? [0, 1],
    yPhaseRange: this.bodeSample.axis.yPhaseRange ?? [0, 360],
    xUnit: 'RPM',
    yAmpUnit: this.bodeSample.axis.yAmpUnit ?? 'mil pp',
    phaseRolloverEnabled: false,
  };
  bodeCursors: BodeCursorState[] = [];
  bodeConfig: Partial<BodePlotConfig> = {
    width: 900,
    height: 560,
    ampRegionRatio: 0.55,
    gutter: 24,
    gridTicksX: 8,
    gridTicksY: 5,
    enableCursorA: true,
  };

  onBodeCursorChange(state: BodeCursorState[]): void {
    this.bodeCursors = state;
  }

  onBodeAxisChange(state: BodeAxisState): void {
    this.bodeAxis = state;
  }

  bodeZoomOutOne(): void { this.bodePlotRef?.zoomOutOneLevel(); }
  bodeZoomOutAll(): void { this.bodePlotRef?.zoomOutAll(); }
  bodeResetZoom():  void { this.bodePlotRef?.resetZoom(); }

  formatTimestamp(ms: number | undefined): string {
    if (!ms || !Number.isFinite(ms)) return '—';
    const d = new Date(ms);
    return d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
  }
}
