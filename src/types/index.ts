// 全局类型定义
// 约定：Z = 水位（纵轴，单位 m），Q = 流量（横轴，单位 m³/s）

export interface DataPoint {
  id: string;
  z: number; // 水位
  q: number; // 流量
  time?: string; // 测次时间（可选）
  group?: string; // 分组（年份/测次，可选）
}

/** 曲线类型：单一线 / 绳套曲线 / 复合曲线 */
export type CurveType = 'single' | 'loop' | 'composite';

/** 标记形状 */
export type MarkerShape = 'circle' | 'square' | 'triangle' | 'diamond' | 'cross';

/** 线型 */
export type LineDash = 'solid' | 'dash' | 'dot' | 'dashdot';

export const LINE_DASH_LABEL: Record<LineDash, string> = {
  solid: '实线',
  dash: '虚线',
  dot: '点线',
  dashdot: '点划线',
};

export const MARKER_SHAPE_LABEL: Record<MarkerShape, string> = {
  circle: '圆形',
  square: '方形',
  triangle: '三角形',
  diamond: '菱形',
  cross: '十字',
};

/** 实测点全局样式 */
export interface PointStyle {
  shape: MarkerShape;
  size: number; // 半径 px
  color: string; // 填充色
}

export const CURVE_TYPE_LABEL: Record<CurveType, string> = {
  single: '单一线',
  loop: '绳套曲线',
  composite: '复合曲线',
};

export interface CurveNode {
  id: string;
  q: number; // 流量（横轴）
  z: number; // 水位（纵轴）
}

export interface Curve {
  id: string;
  name: string; // 曲线线号（按时间次序编号，如 "1"、"2"）
  type: CurveType;
  nodes: CurveNode[];
  color: string;
  visible: boolean;
  fitLabel?: string; // 最近一次自动拟合方法说明
  labelVisible?: boolean; // 线号标注显隐，默认 true
  // ── 曲线样式（可选，缺省用默认值）──
  lineWidth?: number; // 线宽 px，默认 2
  lineDash?: LineDash; // 线型，默认实线
  nodeShape?: MarkerShape; // 节点形状，默认圆形
  nodeSize?: number; // 节点半径 px，默认 3.2
  nodeColor?: string; // 节点填充色，默认深灰
}

/** 屏幕采样点 */
export interface XY {
  q: number;
  z: number;
}
