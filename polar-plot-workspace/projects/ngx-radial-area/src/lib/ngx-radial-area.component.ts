import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnChanges,
  OnDestroy,
  AfterViewInit,
  SimpleChanges,
  ViewChild,
  ElementRef,
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  NgZone,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { RadialAreaService } from './radial-area.service';
import { RadialDataPoint, RadialSeries, RadialAreaConfig, ZoomEvent } from './radial-area.models';

@Component({
  selector: 'ngx-radial-area',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="ngx-ra-wrapper">
      <div #chartHost class="ngx-ra-chart-host"></div>

      <div class="ngx-ra-controls" *ngIf="showControls">
        <div class="ngx-ra-legend">
          <span *ngFor="let s of series" class="ngx-ra-legend-item">
            <span class="ngx-ra-legend-swatch" [style.background]="s.color"></span>
            {{ s.label }}
          </span>
        </div>
        <div class="ngx-ra-zoom-info">
          <span class="ngx-ra-zoom-label">zoom: {{ currentZoom.toFixed(1) }}x</span>
          <button type="button" class="ngx-ra-reset-btn" (click)="resetZoom()">Reset</button>
        </div>
      </div>

      <p class="ngx-ra-hint" *ngIf="showHint">
        Scroll to zoom &middot; Double-click to reset
      </p>
    </div>
  `,
  styles: [`
    :host { display: block; width: 100%; }
    .ngx-ra-wrapper { width: 100%; font-family: inherit; }
    .ngx-ra-chart-host { width: 100%; display: flex; justify-content: center; }
    .ngx-ra-controls {
      display: flex; align-items: center; justify-content: space-between;
      flex-wrap: wrap; gap: 8px; margin-top: 8px; padding: 0 4px;
    }
    .ngx-ra-legend { display: flex; gap: 16px; flex-wrap: wrap; }
    .ngx-ra-legend-item { display: flex; align-items: center; gap: 5px; font-size: 12px; color: #666; }
    .ngx-ra-legend-swatch { width: 10px; height: 10px; border-radius: 2px; display: inline-block; opacity: 0.8; }
    .ngx-ra-zoom-info { display: flex; align-items: center; gap: 8px; }
    .ngx-ra-zoom-label { font-size: 12px; color: #999; min-width: 64px; text-align: right; }
    .ngx-ra-reset-btn {
      font-size: 12px; padding: 3px 10px; border: 1px solid #ccc;
      border-radius: 4px; background: transparent; cursor: pointer; color: inherit;
    }
    .ngx-ra-reset-btn:hover { background: rgba(0,0,0,0.05); }
    .ngx-ra-hint { text-align: center; font-size: 11px; color: #aaa; margin: 4px 0 0; }
  `],
  providers: [RadialAreaService],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NgxRadialAreaComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('chartHost', { static: true }) chartHost!: ElementRef<HTMLElement>;

  @Input() data: RadialDataPoint[] = [];
  @Input() series: RadialSeries[] = [];
  @Input() config: Partial<RadialAreaConfig> = {};
  @Input() showControls = true;
  @Input() showHint = true;

  @Output() zoomChange = new EventEmitter<ZoomEvent>();
  @Output() zoomReset = new EventEmitter<void>();

  currentZoom = 1;
  private initialized = false;

  constructor(
    private raService: RadialAreaService,
    private cdr: ChangeDetectorRef,
    private zone: NgZone
  ) {}

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => {
      this.raService.init(
        this.chartHost,
        this.data,
        this.series,
        this.config,
        (event: ZoomEvent) => {
          this.zone.run(() => {
            this.currentZoom = event.scale;
            this.zoomChange.emit(event);
            this.cdr.markForCheck();
          });
        }
      );
    });
    this.initialized = true;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.initialized) return;
    if (changes['data'] || changes['series'] || changes['config']) {
      this.zone.runOutsideAngular(() => {
        this.raService.update(this.data, this.series, this.config);
      });
    }
  }

  ngOnDestroy(): void {
    this.raService.destroy();
  }

  resetZoom(): void {
    this.raService.resetZoom();
    this.currentZoom = 1;
    this.zoomReset.emit();
    this.cdr.markForCheck();
  }
}
