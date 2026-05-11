import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  NgxRadialAreaComponent,
  RadialDataPoint,
  RadialSeries,
  RadialAreaConfig,
  ZoomEvent,
} from 'ngx-radial-area';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, NgxRadialAreaComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
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
}
