import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { NgxRadialAreaComponent } from './ngx-radial-area.component';
import { RadialDataPoint, RadialSeries } from './radial-area.models';

describe('NgxRadialAreaComponent', () => {
  let component: NgxRadialAreaComponent;
  let fixture: ComponentFixture<NgxRadialAreaComponent>;

  const data: RadialDataPoint[] = [
    { label: 'A', v: 10, w: 5 },
    { label: 'B', v: 20, w: 8 },
    { label: 'C', v: 30, w: 12 },
    { label: 'D', v: 15, w: 7 },
  ];

  const series: RadialSeries[] = [
    { key: 'v', label: 'Series V', color: '#378ADD' },
    { key: 'w', label: 'Series W', color: '#1D9E75' },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NgxRadialAreaComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(NgxRadialAreaComponent);
    component = fixture.componentInstance;
    component.data = data;
    component.series = series;
    component.config = { width: 320, height: 320, innerRadius: 40, outerRadius: 120, gridTicks: 3 };
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('renders an SVG inside the chart host after view init', () => {
    const host = fixture.debugElement.query(By.css('.ngx-ra-chart-host')).nativeElement as HTMLElement;
    const svg = host.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('viewBox')).toBe('0 0 320 320');
  });

  it('draws one area group per series', () => {
    const host = fixture.debugElement.query(By.css('.ngx-ra-chart-host')).nativeElement as HTMLElement;
    expect(host.querySelector('g.ngx-ra-area-v')).toBeTruthy();
    expect(host.querySelector('g.ngx-ra-area-w')).toBeTruthy();
  });

  it('renders a legend item per series when controls enabled', () => {
    const items = fixture.debugElement.queryAll(By.css('.ngx-ra-legend-item'));
    expect(items.length).toBe(2);
    expect(items[0].nativeElement.textContent).toContain('Series V');
  });

  it('hides controls and hint when toggled off', () => {
    fixture.componentRef.setInput('showControls', false);
    fixture.componentRef.setInput('showHint', false);
    fixture.detectChanges();
    expect(fixture.debugElement.query(By.css('.ngx-ra-controls'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.ngx-ra-hint'))).toBeNull();
  });

  it('emits zoomReset and resets currentZoom when reset is clicked', () => {
    let resetCount = 0;
    component.zoomReset.subscribe(() => resetCount++);
    component.currentZoom = 2.5;

    const btn = fixture.debugElement.query(By.css('.ngx-ra-reset-btn')).nativeElement as HTMLButtonElement;
    btn.click();

    expect(resetCount).toBe(1);
    expect(component.currentZoom).toBe(1);
  });

  it('cleans up SVG on destroy', () => {
    const host = fixture.debugElement.query(By.css('.ngx-ra-chart-host')).nativeElement as HTMLElement;
    expect(host.querySelector('svg')).toBeTruthy();
    fixture.destroy();
    expect(host.querySelector('svg')).toBeNull();
  });
});
