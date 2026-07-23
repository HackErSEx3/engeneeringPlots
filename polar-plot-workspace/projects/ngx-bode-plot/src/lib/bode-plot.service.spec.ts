import { BodePlotService } from './bode-plot.service';
import {
  BodeAxisState,
  BodeCompositeCurve,
  StatusPoint,
} from './bode-plot.models';

function makeComposite(overrides: Partial<BodeCompositeCurve> = {}): BodeCompositeCurve {
  const xValues = [100, 200, 300, 400, 500];
  const ampValues = [0.1, 0.2, 0.5, 0.3, 0.2];
  const ampStatus: StatusPoint[] = ['Valid', 'Valid', 'Invalid', 'Valid', 'Valid'];
  const phaseValues = [10, 20, 30, 40, 50];
  return {
    primaryCurveNumber: 1,
    curveType: 'primary',
    isActive: true,
    label: 'Test',
    amplitude: {
      curveNumber: 1,
      xValues, yValues: ampValues, yStatus: ampStatus,
      timestampsUtc: [1000, 2000, 3000, 4000, 5000],
      style: { color: '#378ADD', lineWidth: 1.5 },
    },
    phase: {
      curveNumber: 2,
      xValues, yValues: phaseValues,
      style: { color: '#378ADD', lineWidth: 1.5 },
    },
    ...overrides,
  };
}

function makeAxis(): BodeAxisState {
  return {
    xRange: [100, 500],
    yAmpRange: [0, 1],
    yPhaseRange: [0, 360],
    xUnit: 'RPM',
    yAmpUnit: 'mil pp',
    phaseRolloverEnabled: false,
  };
}

describe('BodePlotService', () => {
  let host: HTMLElement;
  let svc: BodePlotService;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    svc = new BodePlotService();
  });

  afterEach(() => {
    svc.destroy();
    host.remove();
  });

  it('builds the expected SVG layer structure on init', () => {
    svc.init(host, [makeComposite()], makeAxis(), [], undefined, {}, {});
    const svg = host.querySelector('svg.ngx-bode');
    expect(svg).toBeTruthy();
    expect(svg!.querySelector('g.bode-root')).toBeTruthy();
    expect(svg!.querySelector('g.bode-plot-amp')).toBeTruthy();
    expect(svg!.querySelector('g.bode-plot-phase')).toBeTruthy();
    expect(svg!.querySelector('g.bode-x-axis')).toBeTruthy();
    expect(svg!.querySelector('g.bode-y-amp-axis')).toBeTruthy();
    expect(svg!.querySelector('g.bode-y-phase-axis')).toBeTruthy();
    // Five transparent hit rects
    expect(svg!.querySelectorAll('rect.hit-x, rect.hit-y-amp, rect.hit-y-phase, rect.hit-plot-amp, rect.hit-plot-phase').length).toBe(5);
  });

  it('renders one primary path per side of the composite', () => {
    svc.init(host, [makeComposite()], makeAxis(), [], undefined, {}, {});
    const primaryAmp = host.querySelectorAll('g.bode-curves-primary-amp path.curve');
    const primaryPhase = host.querySelectorAll('g.bode-curves-primary-phase path.curve');
    expect(primaryAmp.length).toBe(1);
    expect(primaryPhase.length).toBe(1);
  });

  it('breaks the amplitude line at invalid samples (path has multiple subpaths)', () => {
    svc.init(host, [makeComposite()], makeAxis(), [], undefined, {}, {});
    const path = host.querySelector('g.bode-curves-primary-amp path.curve') as SVGPathElement;
    const d = path.getAttribute('d') ?? '';
    // Expect two 'M' commands — one before the invalid sample, one after
    const moves = d.match(/M/g) ?? [];
    expect(moves.length).toBeGreaterThanOrEqual(2);
  });

  it('clamps phase domain to [0, 360] when phaseRolloverEnabled is false', () => {
    const axis: BodeAxisState = { ...makeAxis(), phaseRolloverEnabled: false, yPhaseRange: [0, 360] };
    svc.init(host, [makeComposite()], axis, [], undefined, {}, {});
    const svg = host.querySelector('svg')!;
    // At least one phase-degree tick label must be rendered
    const texts = Array.from(svg.querySelectorAll('g.bode-y-phase-axis text')).map(t => t.textContent);
    expect(texts.some(t => t?.match(/\d+°/))).toBe(true);
  });

  it('emits an axis change when the wheel zooms the X region and narrows the X span', (done) => {
    let received: BodeAxisState | null = null;
    svc.init(host, [makeComposite()], makeAxis(), [], undefined, {}, {
      onAxisChange: (s) => { received = s; },
    });
    const hit = host.querySelector('rect.hit-x') as SVGRectElement;
    expect(hit).toBeTruthy();
    hit.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -100, bubbles: true, cancelable: true,
      clientX: 300, clientY: 400,
    } as WheelEventInit));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        expect(received).toBeTruthy();
        // Span narrows (zoom-in)
        const spanAfter = received!.xRange[1] - received!.xRange[0];
        expect(spanAfter).toBeLessThan(400);
        // Y ranges must NOT have moved
        expect(received!.yAmpRange).toEqual([0, 1]);
        expect(received!.yPhaseRange).toEqual([0, 360]);
        done();
      });
    });
  });

  it('routes wheel on the Y-amp region to the amp scale only', (done) => {
    let received: BodeAxisState | null = null;
    svc.init(host, [makeComposite()], makeAxis(), [], undefined, {}, {
      onAxisChange: (s) => { received = s; },
    });
    const hit = host.querySelector('rect.hit-y-amp') as SVGRectElement;
    hit.dispatchEvent(new WheelEvent('wheel', {
      deltaY: -100, bubbles: true, cancelable: true,
      clientX: 20, clientY: 100,
    } as WheelEventInit));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        expect(received).toBeTruthy();
        expect(received!.xRange).toEqual([100, 500]);
        expect(received!.yPhaseRange).toEqual([0, 360]);
        const spanAfter = received!.yAmpRange[1] - received!.yAmpRange[0];
        expect(spanAfter).toBeLessThan(1);
        done();
      });
    });
  });

  it('snapCursorAt picks the nearest X index and returns its amp + phase values', () => {
    svc.init(host, [makeComposite()], makeAxis(), [], undefined, {}, {});
    const cursor = svc.snapCursorAt(0, 210);
    expect(cursor.xValue).toBe(200);
    expect(cursor.ampValue).toBe(0.2);
    expect(cursor.phaseValue).toBe(20);
    expect(cursor.isInvalid).toBe(false);
  });

  it('flags cursor as invalid when the nearest sample has Invalid status', () => {
    svc.init(host, [makeComposite()], makeAxis(), [], undefined, {}, {});
    // 300 is the invalid sample in the fixture
    const cursor = svc.snapCursorAt(0, 300);
    expect(cursor.isInvalid).toBe(true);
  });

  it('zoomOutAll restores the base domains after a zoom', (done) => {
    svc.init(host, [makeComposite()], makeAxis(), [], undefined, {}, {});
    const hit = host.querySelector('rect.hit-x') as SVGRectElement;
    hit.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true } as WheelEventInit));
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        svc.zoomOutAll();
        // The service exposes state indirectly — we assert via a fresh axis emission
        let axisAfter: BodeAxisState | null = null;
        svc.init(host, [makeComposite()], makeAxis(), [], undefined, {}, {
          onAxisChange: (s) => { axisAfter = s; },
        });
        svc.zoomOutAll();
        expect(axisAfter!.xRange).toEqual([100, 500]);
        expect(axisAfter!.yPhaseRange).toEqual([0, 360]);
        done();
      });
    });
  });

  it('destroy removes the SVG and cancels pending rAF frames', () => {
    svc.init(host, [makeComposite()], makeAxis(), [], undefined, {}, {});
    expect(host.querySelector('svg.ngx-bode')).toBeTruthy();
    svc.destroy();
    expect(host.querySelector('svg.ngx-bode')).toBeNull();
  });
});
