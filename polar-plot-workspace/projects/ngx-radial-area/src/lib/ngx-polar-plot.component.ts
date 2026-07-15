import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  Output,
  SimpleChanges,
  ViewChild,
} from '@angular/core';
import { PolarDataPoint, PolarPlotConfig } from './polar-plot.models';
import { PolarPlotService } from './polar-plot.service';

@Component({
  selector: 'ngx-polar-plot',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host></div>`,
  styles: [':host { display: inline-block; }'],
})
export class NgxPolarPlotComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('host', { static: true }) private hostRef!: ElementRef<HTMLDivElement>;

  @Input() data: PolarDataPoint[] = [];
  @Input() config: Partial<PolarPlotConfig> = {};

  /** Emits the nearest data point whenever the user clicks on the chart. */
  @Output() pointSelected = new EventEmitter<PolarDataPoint>();

  /** Emits the current zoom multiplier (1 = default) on every scroll step. */
  @Output() zoomChange = new EventEmitter<number>();

  private readonly service = new PolarPlotService();
  private initialized = false;

  // Captures NgZone so heavy chart rendering can run outside Angular change detection.
  constructor(private readonly zone: NgZone) {}

  // Initializes the plotting service with data, config, and event bridges.
  private initService(): void {
    this.service.init(
      this.hostRef.nativeElement,
      this.data,
      this.config,
      (pt) => this.zone.run(() => this.pointSelected.emit(pt)),
      (k)  => this.zone.run(() => this.zoomChange.emit(k)),
    );
  }

  // Creates the chart once the host element is available.
  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => this.initService());
    this.initialized = true;
  }

  // Rebuilds the chart when input data or configuration changes.
  ngOnChanges(changes: SimpleChanges): void {
    if (!this.initialized || (!changes['data'] && !changes['config'])) return;
    this.zone.runOutsideAngular(() => {
      this.service.destroy();
      this.initService();
    });
  }

  // Tears down chart resources when the component is destroyed.
  ngOnDestroy(): void {
    this.service.destroy();
  }

  /** Programmatically place the cursor on a specific data point. */
  selectPoint(point: PolarDataPoint): void {
    this.zone.runOutsideAngular(() => this.service.moveCursorTo(point));
  }

  /** Toggle the vector line without triggering a full re-init. */
  setVector(show: boolean): void {
    this.zone.runOutsideAngular(() => this.service.setVector(show));
  }

  /** Reset the amplitude axis to its original zoom-1 state. */
  resetZoom(): void {
    this.zone.runOutsideAngular(() => this.service.resetZoom());
  }
}
