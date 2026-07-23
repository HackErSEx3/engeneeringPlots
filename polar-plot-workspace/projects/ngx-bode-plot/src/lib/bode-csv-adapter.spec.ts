import { parseBodeCsv, buildSampleComposite, bodeSampleTuples } from './bode-csv-adapter';

const SAMPLE_CSV = [
  'Machine Name,STG-10',
  'Point Name,VX-1X (VERTICAL)',
  'Comp,',
  'Probe Angle,45° Right',
  'X-Axis Unit,rpm',
  'Y-Axis Unit,mil pp',
  'Variable,1X',
  'X-Axis Value,Y-Axis Value,Y-Axis Status,Phase,Phase Status,Timestamp',
  '234,0.217,Valid,47,Valid,4/4/2021 4:35:40 AM',
  '241,0.231,Valid,48,Valid,4/4/2021 4:35:41 AM',
  '248,0.231,Invalid,48,Valid,4/4/2021 4:35:43 AM',
  '255,0.240,Valid,48,Valid,4/4/2021 4:35:45 AM',
].join('\n');

describe('parseBodeCsv', () => {
  it('parses the metadata block and picks up X-Axis Unit + Y-Axis Unit', () => {
    const { metadata, axis } = parseBodeCsv(SAMPLE_CSV);
    expect(metadata['Machine Name']).toBe('STG-10');
    expect(metadata['Point Name']).toBe('VX-1X (VERTICAL)');
    expect(metadata['X-Axis Unit']).toBe('rpm');
    expect(metadata['Y-Axis Unit']).toBe('mil pp');
    expect(axis.yAmpUnit).toBe('mil pp');
  });

  it('reads all data rows into parallel arrays', () => {
    const { composite } = parseBodeCsv(SAMPLE_CSV);
    expect(composite.amplitude.xValues.length).toBe(4);
    expect(composite.amplitude.xValues[0]).toBe(234);
    expect(composite.amplitude.yValues[0]).toBeCloseTo(0.217, 5);
    expect(composite.phase).toBeTruthy();
    expect(composite.phase!.yValues[0]).toBe(47);
  });

  it('marks Invalid rows in yStatus', () => {
    const { composite } = parseBodeCsv(SAMPLE_CSV);
    expect(composite.amplitude.yStatus?.[2]).toBe('Invalid');
    expect(composite.amplitude.yStatus?.[0]).toBe('Valid');
  });

  it('parses timestamps into positive epoch millis', () => {
    const { composite } = parseBodeCsv(SAMPLE_CSV);
    const ts = composite.amplitude.timestampsUtc?.[0];
    expect(ts).toBeDefined();
    expect(ts! > 0).toBe(true);
  });

  it('throws a helpful error when the header row is missing', () => {
    expect(() => parseBodeCsv('Machine Name,STG-10\nsome,other,line')).toThrow();
  });
});

describe('buildSampleComposite', () => {
  it('produces a composite backed by the embedded tuple data', () => {
    const { composite, axis } = buildSampleComposite();
    expect(composite.amplitude.xValues.length).toBe(bodeSampleTuples.length);
    expect(composite.phase).toBeTruthy();
    expect(axis.xRange![0]).toBeLessThan(axis.xRange![1]);
    expect(axis.yPhaseRange).toEqual([0, 360]);
  });

  it('does not throw for a large real dataset', () => {
    expect(() => buildSampleComposite()).not.toThrow();
  });
});
