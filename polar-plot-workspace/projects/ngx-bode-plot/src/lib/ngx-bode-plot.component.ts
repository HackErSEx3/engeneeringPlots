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
import {
  BodeAxisState,
  BodeCompositeCurve,
  BodeCursorState,
  BodePlotConfig,
} from './bode-plot.models';
import { BodePlotService } from './bode-plot.service';

@Component({
  selector: 'ngx-bode-plot',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="ngx-bode-host"></div>`,
  styles: [`
    :host { display: inline-block; }
    .ngx-bode-host { position: relative; }
  `],
})
export class NgxBodePlotComponent implements AfterViewInit, OnChanges, OnDestroy {
  @ViewChild('host', { static: true }) private hostRef!: ElementRef<HTMLDivElement>;

  @Input() compositeCurves: BodeCompositeCurve[] = [];
  @Input() axisState?: BodeAxisState;
  @Input() cursors: BodeCursorState[] = [];
  @Input() activeCurveNumber?: number;
  @Input() config: Partial<BodePlotConfig> = {};

  @Output() axisStateChange   = new EventEmitter<BodeAxisState>();
  @Output() cursorStateChange = new EventEmitter<BodeCursorState[]>();
  @Output() activeCurveChange = new EventEmitter<number>();

  private readonly service = new BodePlotService();
  private initialized = false;

  constructor(private readonly zone: NgZone) {}

  ngAfterViewInit(): void {
    this.zone.runOutsideAngular(() => this.initService());
    this.initialized = true;
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.initialized) return;
    if (changes['compositeCurves'] || changes['config'] || changes['axisState']) {
      this.zone.runOutsideAngular(() => {
        this.service.destroy();
        this.initService();
      });
      return;
    }
    if (changes['cursors']) {
      this.zone.runOutsideAngular(() => this.service.setCursors(this.cursors));
    }
    if (changes['activeCurveNumber']) {
      this.zone.runOutsideAngular(() => this.service.setActive(this.activeCurveNumber));
    }
  }

  ngOnDestroy(): void { this.service.destroy(); }

  // ── Public delegators (host toolbar can wire these) ─────────────────────────
  zoomOutOneLevel(): void { this.zone.runOutsideAngular(() => this.service.zoomOutOneLevel()); }
  zoomOutAll():      void { this.zone.runOutsideAngular(() => this.service.zoomOutAll()); }
  resetZoom():       void { this.zone.runOutsideAngular(() => this.service.resetZoom()); }

  private initService(): void {
    this.service.init(
      this.hostRef.nativeElement,
      this.compositeCurves,
      this.axisState,
      this.cursors,
      this.activeCurveNumber,
      this.config,
      {
        onAxisChange:   (s) => this.zone.run(() => this.axisStateChange.emit(s)),
        onCursorChange: (c) => this.zone.run(() => this.cursorStateChange.emit(c)),
        onActiveChange: (n) => this.zone.run(() => this.activeCurveChange.emit(n)),
      },
    );
  }
}
