import { TestBed, ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { AppComponent } from './app.component';

describe('AppComponent', () => {
  let fixture: ComponentFixture<AppComponent>;
  let app: AppComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(AppComponent);
    app = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('creates the app', () => {
    expect(app).toBeTruthy();
  });

  it('renders the heading', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.demo-title')?.textContent).toContain('ngx-radial-area');
  });

  it('embeds the ngx-radial-area element', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('ngx-radial-area')).toBeTruthy();
  });

  it('defaults to the weather dataset', () => {
    expect(app.activeDataset).toBe('weather');
    expect(app.activeData).toBe(app.weatherData);
    expect(app.activeSeries).toBe(app.weatherSeries);
  });

  it('switches dataset on click', () => {
    const buttons = fixture.debugElement.queryAll(By.css('.demo-btn-group button'));
    (buttons[1].nativeElement as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(app.activeDataset).toBe('performance');
    expect(app.activeData).toBe(app.performanceData);
  });

  it('toggleGrid flips showGrid and updates chartConfig', () => {
    expect(app.showGrid).toBeTrue();
    app.toggleGrid();
    expect(app.showGrid).toBeFalse();
    expect(app.chartConfig.showGrid).toBeFalse();
  });

  it('updates currentZoom when chart emits zoomChange', () => {
    app.onZoomChange({ scale: 2.5, transform: { k: 2.5, x: 0, y: 0 } });
    expect(app.currentZoom).toBe(2.5);
    app.onZoomReset();
    expect(app.currentZoom).toBe(1);
  });
});
