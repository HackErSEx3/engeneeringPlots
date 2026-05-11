export interface RadialDataPoint {
  label: string;
  [key: string]: number | string;
}

export interface RadialSeries {
  key: string;
  label: string;
  color: string;
  domain?: [number, number];
}

export interface RadialAreaConfig {
  width?: number;
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
  zoomMin?: number;
  zoomMax?: number;
  zoomSensitivity?: number;
  showGrid?: boolean;
  showSpokes?: boolean;
  showAngularLabels?: boolean;
  showRadialLabels?: boolean;
  gridTicks?: number;
  animationDuration?: number;
  darkMode?: boolean;
}

export interface ZoomEvent {
  scale: number;
  transform: { k: number; x: number; y: number };
}

export const DEFAULT_CONFIG: Required<RadialAreaConfig> = {
  width: 560,
  height: 560,
  innerRadius: 55,
  outerRadius: 210,
  zoomMin: 0.35,
  zoomMax: 5,
  zoomSensitivity: 0.003,
  showGrid: true,
  showSpokes: true,
  showAngularLabels: true,
  showRadialLabels: true,
  gridTicks: 4,
  animationDuration: 300,
  darkMode: false,
};
