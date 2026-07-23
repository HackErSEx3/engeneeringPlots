import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { NgxBodePlotComponent } from './ngx-bode-plot.component';
import { BodeCompositeCurve, BodeAxisState } from './bode-plot.models';

function fixtureComposite(): BodeCompositeCurve {
  return {
    primaryCurveNumber: 1,
    curveType: 'primary',
    isActive: true,
    amplitude: {
      curveNumber: 1,
      xValues: [100, 200, 300, 400],
      yValues: [0.1, 0.2, 0.3, 0.4],
      style: { color: '#378ADD' },
    },
    phase: {
      curveNumber: 2,
      xValues: [100, 200, 300, 400],
      yValues: [10, 20, 30, 40],
      style: { color: '#378ADD' },
    },
  };
}

function fixtureAxis(): BodeAxisState {
  return {
    xRange: [100, 400],
    yAmpRange: [0, 0.5],
    yPhaseRange: [0, 360],
    xUnit: 'RPM',
    yAmpUnit: 'mil pp',
    phaseRolloverEnabled: false,
  };
}

describe('NgxBodePlotComponent', () => {
  let component: NgxBodePlotComponent;
  let fixture: ComponentFixture<NgxBodePlotComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [NgxBodePlotComponent],
    }).compileComponents();
    fixture = TestBed.createComponent(NgxBodePlotComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('compositeCurves', [fixtureComposite()]);
    fixture.componentRef.setInput('axisState', fixtureAxis());
    fixture.componentRef.setInput('config', { width: 600, height: 400 });
    fixture.detectChanges();
  });

  it('creates the component', () => {
    expect(component).toBeTruthy();
  });

  it('mounts an <svg.ngx-bode> in the host div', () => {
    const host = fixture.debugElement.query(By.css('.ngx-bode-host')).nativeElement as HTMLElement;
    expect(host.querySelector('svg.ngx-bode')).toBeTruthy();
  });

  it('re-renders when compositeCurves changes via setInput', () => {
    const host = fixture.debugElement.query(By.css('.ngx-bode-host')).nativeElement as HTMLElement;
    const before = host.querySelectorAll('path.curve').length;
    // Add a second composite with different data
    const second: BodeCompositeCurve = {
      ...fixtureComposite(),
      primaryCurveNumber: 2,
      amplitude: { ...fixtureComposite().amplitude, curveNumber: 3 },
      phase: { ...fixtureComposite().phase!, curveNumber: 4 },
    };
    fixture.componentRef.setInput('compositeCurves', [fixtureComposite(), second]);
    fixture.detectChanges();
    const after = host.querySelectorAll('path.curve').length;
    expect(after).toBeGreaterThan(before);
  });

  it('cleans up SVG on destroy', () => {
    const host = fixture.debugElement.query(By.css('.ngx-bode-host')).nativeElement as HTMLElement;
    expect(host.querySelector('svg.ngx-bode')).toBeTruthy();
    fixture.destroy();
    expect(host.querySelector('svg.ngx-bode')).toBeNull();
  });
});
