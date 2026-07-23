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

  it('renders the demo title', () => {
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('.demo-title')?.textContent).toBeTruthy();
  });

  it('embeds the ngx-radial-area element when chartType is radial', () => {
    app.chartType = 'radial';
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('ngx-radial-area')).toBeTruthy();
  });

  it('defaults to the weather dataset', () => {
    expect(app.activeDataset).toBe('weather');
    expect(app.activeData).toBe(app.weatherData);
    expect(app.activeSeries).toBe(app.weatherSeries);
  });

  it('switches dataset on click when in radial mode', () => {
    app.chartType = 'radial';
    fixture.detectChanges();
    // Second button in the "Dataset" group is "Server Load"
    const groups = fixture.debugElement.queryAll(By.css('.demo-btn-group'));
    // Groups in order (radial mode): Chart Type, Dataset, Display, ...
    const datasetButtons = groups[1].queryAll(By.css('button'));
    (datasetButtons[1].nativeElement as HTMLButtonElement).click();
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
