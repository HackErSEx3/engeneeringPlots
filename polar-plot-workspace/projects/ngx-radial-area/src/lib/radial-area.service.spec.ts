import { ElementRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { RadialAreaService } from './radial-area.service';
import { DEFAULT_CONFIG, RadialDataPoint, RadialSeries } from './radial-area.models';

describe('RadialAreaService', () => {
  let service: RadialAreaService;
  let hostEl: HTMLElement;
  let hostRef: ElementRef<HTMLElement>;

  const data: RadialDataPoint[] = [
    { label: 'A', v: 10, w: 5 },
    { label: 'B', v: 20, w: 8 },
    { label: 'C', v: 30, w: 12 },
  ];

  const series: RadialSeries[] = [
    { key: 'v', label: 'V', color: '#111' },
    { key: 'w', label: 'W', color: '#222', domain: [0, 50] },
  ];

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [RadialAreaService] });
    service = TestBed.inject(RadialAreaService);
    hostEl = document.createElement('div');
    document.body.appendChild(hostEl);
    hostRef = new ElementRef(hostEl);
  });

  afterEach(() => {
    service.destroy();
    hostEl.remove();
  });

  it('initializes SVG with viewBox derived from config', () => {
    service.init(hostRef, data, series, { width: 400, height: 400 });
    const svg = hostEl.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg!.getAttribute('viewBox')).toBe('0 0 400 400');
  });

  it('builds one linear scale per series with correct domain when provided', () => {
    service.init(hostRef, data, series, {});
    const scaleV = service.getScale('v')!;
    const scaleW = service.getScale('w')!;
    expect(scaleV).toBeTruthy();
    expect(scaleW).toBeTruthy();
    // Auto-detected domain max for v = 30
    expect(scaleV.domain()).toEqual([0, 30]);
    // Provided domain for w
    expect(scaleW.domain()).toEqual([0, 50]);
    // Range starts at innerRadius and ends at outerRadius (defaults)
    expect(scaleV.range()).toEqual([DEFAULT_CONFIG.innerRadius, DEFAULT_CONFIG.outerRadius]);
  });

  it('creates a band angle scale covering [0, 2π]', () => {
    service.init(hostRef, data, series, {});
    const angle = service.getAngleScale();
    expect(angle.domain()).toEqual(['A', 'B', 'C']);
    expect(angle.range()).toEqual([0, 2 * Math.PI]);
  });

  it('draws grid rings, spokes, and area+line paths', () => {
    service.init(hostRef, data, series, {});
    expect(hostEl.querySelector('g.ngx-ra-grid')).toBeTruthy();
    expect(hostEl.querySelectorAll('g.ngx-ra-spokes line').length).toBe(data.length);
    expect(hostEl.querySelectorAll('g.ngx-ra-area-v path').length).toBe(2); // area + line
    expect(hostEl.querySelectorAll('g.ngx-ra-area-w path').length).toBe(2);
    // one dot per data point per series
    expect(hostEl.querySelectorAll('circle.dot-v').length).toBe(data.length);
    expect(hostEl.querySelectorAll('circle.dot-w').length).toBe(data.length);
  });

  it('update() rebuilds scales when new series are provided', () => {
    service.init(hostRef, data, series, {});
    const next: RadialSeries[] = [{ key: 'v', label: 'V', color: '#000' }];
    service.update(data, next, {});
    expect(service.getScale('v')).toBeTruthy();
    expect(service.getScale('w')).toBeUndefined();
    expect(hostEl.querySelector('g.ngx-ra-area-w')).toBeNull();
  });

  it('invokes the zoom callback with a scale value when zooming', () => {
    const onZoom = jasmine.createSpy('onZoom');
    service.init(hostRef, data, series, { width: 200, height: 200 }, onZoom);

    const overlay = hostEl.querySelector('rect') as SVGRectElement;
    expect(overlay).toBeTruthy();

    const wheel = new WheelEvent('wheel', {
      deltaY: -200,
      clientX: 100,
      clientY: 100,
      bubbles: true,
      cancelable: true,
    });
    overlay.dispatchEvent(wheel);

    expect(onZoom).toHaveBeenCalled();
    const [arg] = onZoom.calls.mostRecent().args;
    expect(typeof arg.scale).toBe('number');
    expect(arg.scale).toBeGreaterThan(1);
    expect(service.getCurrentZoom()).toBe(arg.scale);
  });

  it('destroy() tears down SVG and clears scales', () => {
    service.init(hostRef, data, series, {});
    expect(hostEl.querySelector('svg')).toBeTruthy();
    service.destroy();
    expect(hostEl.querySelector('svg')).toBeNull();
    expect(service.getScale('v')).toBeUndefined();
  });
});
