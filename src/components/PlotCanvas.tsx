// 绘图区：Canvas 2D 自绘，无限网格 + 自动疏密 + 缩放/平移 + 节点交互 + 右键样式菜单
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Curve, CurveNode, DataPoint, LineDash, MarkerShape, PointStyle, XY } from '@/types';
import { makeTicks, formatTick, niceStep } from '@/lib/grid';
import { monotoneCubic, catmullRom } from '@/lib/spline';
import type { DeviationInfo } from '@/lib/tests';
import StyleMenu, { type MenuTarget } from '@/components/StyleMenu';

const DASH_PATTERNS: Record<LineDash, number[]> = {
  solid: [],
  dash: [9, 5],
  dot: [2, 4],
  dashdot: [9, 4, 2, 4],
};

/** 通用标记绘制（圆形/方形/三角形/菱形/十字） */
function drawMarker(
  ctx: CanvasRenderingContext2D,
  shape: MarkerShape,
  x: number,
  y: number,
  r: number,
  fill: string,
  stroke?: string
): void {
  ctx.beginPath();
  if (shape === 'circle') {
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  } else if (shape === 'square') {
    ctx.rect(x - r * 0.85, y - r * 0.85, r * 1.7, r * 1.7);
    ctx.fillStyle = fill;
    ctx.fill();
  } else if (shape === 'triangle') {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.9, y + r * 0.7);
    ctx.lineTo(x - r * 0.9, y + r * 0.7);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  } else if (shape === 'diamond') {
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.85, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r * 0.85, y);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  } else {
    // cross：仅描边
    ctx.moveTo(x - r, y - r);
    ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r);
    ctx.lineTo(x - r, y + r);
    ctx.strokeStyle = fill;
    ctx.lineWidth = Math.max(1.5, r * 0.45);
    ctx.stroke();
    return;
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
}

interface Viewport {
  x0: number; // 流量 min
  x1: number; // 流量 max
  y0: number; // 水位 min
  y1: number; // 水位 max
}

interface Props {
  points: DataPoint[];
  curves: Curve[];
  activeCurveId: string | null;
  drawMode: boolean;
  deviations: Map<string, DeviationInfo>;
  resetSignal: number;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  showPoints: boolean;
  showNodes: boolean;
  showCurves: boolean;
  showCurveLabels: boolean;
  deviationFail: boolean; // 偏离检验不通过时在图上标注大偏差点
  pointStyle: PointStyle;
  backbendIds: Set<string>; // 反曲节点（橙色高亮）
  onAddNode: (q: number, z: number) => void;
  onStroke: (pts: XY[]) => void; // 手绘整笔提交
  onMoveNode: (nodeId: string, q: number, z: number) => void;
  onDeleteNode: (nodeId: string) => void;
  onDeletePoint: (id: string) => void;
  onUpdateCurve: (id: string, patch: Partial<Curve>) => void;
  onDeleteCurve: (id: string) => void;
  onPointStyle: (patch: Partial<PointStyle>) => void;
  onExitDraw: () => void;
}

const MARGIN = { l: 68, r: 20, t: 16, b: 46 };
const NODE_HIT = 10;

export default function PlotCanvas(props: Props) {
  const { points, curves, activeCurveId, drawMode, deviations, resetSignal, canvasRef, showPoints, showNodes, showCurves, showCurveLabels, deviationFail, pointStyle, backbendIds } = props;
  const [menu, setMenu] = useState<{ target: MenuTarget; x: number; y: number } | null>(null);
  const [mouse, setMouse] = useState<{ px: number; py: number } | null>(null); // CAD 式光标跟踪
  const [stroke, setStroke] = useState<XY[] | null>(null); // 手绘进行中的笔划（数据坐标）
  const strokePxLen = useRef(0); // 笔划像素长度（区分单击与手绘）
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [vp, setVp] = useState<Viewport>({ x0: 0, x1: 10, y0: 0, y1: 10 });
  const vpRef = useRef(vp);
  vpRef.current = vp;

  const [hoverNode, setHoverNode] = useState<string | null>(null);
  const [hoverPoint, setHoverPoint] = useState<string | null>(null);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [dragNode, setDragNode] = useState<{ id: string; q: number; z: number } | null>(null);
  const dragRef = useRef<{
    kind: 'pan' | 'node';
    nodeId?: string;
    startX: number;
    startY: number;
    vp0: Viewport;
    moved: boolean;
  } | null>(null);
  const [cursor, setCursor] = useState('default');

  const activeCurve = useMemo(
    () => curves.find((c) => c.id === activeCurveId) ?? null,
    [curves, activeCurveId]
  );

  // 拖拽中节点用临时位置参与样条计算（松开后才提交 store）
  const effectiveCurves = useMemo(() => {
    if (!dragNode || !activeCurve) return curves;
    return curves.map((c) =>
      c.id === activeCurve.id
        ? { ...c, nodes: c.nodes.map((n) => (n.id === dragNode.id ? { ...n, q: dragNode.q, z: dragNode.z } : n)) }
        : c
    );
  }, [curves, dragNode, activeCurve]);

  // 曲线采样
  const sampled = useMemo(() => {
    const map = new Map<string, XY[]>();
    for (const c of effectiveCurves) {
      const nodes: CurveNode[] = c.type === 'loop' ? c.nodes : [...c.nodes].sort((a, b) => a.z - b.z);
      map.set(c.id, c.type === 'loop' ? catmullRom(nodes) : monotoneCubic(nodes));
    }
    return map;
  }, [effectiveCurves]);

  // 视口自适应数据
  const fitView = useCallback(() => {
    const qs = points.map((p) => p.q);
    const zs = points.map((p) => p.z);
    for (const c of curves) {
      for (const n of c.nodes) {
        qs.push(n.q);
        zs.push(n.z);
      }
    }
    if (qs.length === 0) {
      setVp({ x0: 0, x1: 10, y0: 0, y1: 10 });
      return;
    }

    // 鲁棒范围：IQR 栅栏剔除离群值，避免个别错误数据压扁图形
    const robustRange = (vals: number[]): [number, number] => {
      const s = [...vals].sort((a, b) => a - b);
      const n = s.length;
      if (n < 8) return [s[0], s[n - 1]];
      const q1 = s[Math.floor(n * 0.25)];
      const q3 = s[Math.floor(n * 0.75)];
      const iqr = q3 - q1;
      if (iqr <= 1e-12) return [s[0], s[n - 1]];
      const lo = q1 - 3 * iqr;
      const hi = q3 + 3 * iqr;
      const f = s.filter((v) => v >= lo && v <= hi);
      return f.length >= 2 ? [f[0], f[f.length - 1]] : [s[0], s[n - 1]];
    };

    let [x0, x1] = robustRange(qs);
    let [y0, y1] = robustRange(zs);
    // 最小跨度：数据近乎水平/垂直时仍给出可读尺度
    if (x1 - x0 < 1e-6) {
      x0 -= 0.5;
      x1 += 0.5;
    }
    if (y1 - y0 < 1e-6) {
      y0 -= 0.5;
      y1 += 0.5;
    }

    // 视口边界取整为"漂亮数"，与网格刻度对齐
    const sx = niceStep(x1 - x0, 6);
    const sy = niceStep(y1 - y0, 5);
    const qMin = Math.min(...qs);
    x0 = Math.floor(x0 / sx) * sx;
    x1 = Math.ceil(x1 / sx) * sx;
    y0 = Math.floor(y0 / sy) * sy;
    y1 = Math.ceil(y1 / sy) * sy;
    // 数据贴边时再外扩一格，保证留白
    if (qMin - x0 < sx * 0.15) x0 -= sx;
    if (x1 - Math.max(...qs) < sx * 0.15) x1 += sx;
    if (Math.min(...zs) - y0 < sy * 0.15) y0 -= sy;
    if (y1 - Math.max(...zs) < sy * 0.15) y1 += sy;
    // 流量不为负：下边界收回 0
    if (x0 < 0 && qMin >= 0) x0 = 0;
    setVp({ x0, x1, y0, y1 });
  }, [points, curves]);

  useEffect(() => {
    fitView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetSignal]);
  // 首次有数据时自适应一次
  const didInitFit = useRef(false);
  useEffect(() => {
    if (!didInitFit.current && (points.length > 0 || curves.some((c) => c.nodes.length > 0))) {
      didInitFit.current = true;
      fitView();
    }
  }, [points, curves, fitView]);

  // 容器尺寸监听
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setSize({ w: el.clientWidth, h: el.clientHeight });
    });
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // 坐标换算
  const plotW = size.w - MARGIN.l - MARGIN.r;
  const plotH = size.h - MARGIN.t - MARGIN.b;
  const toX = useCallback((q: number, v: Viewport) => MARGIN.l + ((q - v.x0) / (v.x1 - v.x0)) * plotW, [plotW]);
  const toY = useCallback((z: number, v: Viewport) => MARGIN.t + plotH - ((z - v.y0) / (v.y1 - v.y0)) * plotH, [plotH]);
  const fromX = useCallback((px: number, v: Viewport) => v.x0 + ((px - MARGIN.l) / plotW) * (v.x1 - v.x0), [plotW]);
  const fromY = useCallback((py: number, v: Viewport) => v.y0 + ((plotH - (py - MARGIN.t)) / plotH) * (v.y1 - v.y0), [plotH]);

  // ── 绘制 ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size.w * dpr;
    canvas.height = size.h * dpr;
    canvas.style.width = `${size.w}px`;
    canvas.style.height = `${size.h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, size.w, size.h);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.w, size.h);

    const v = vp;
    const xTicks = makeTicks(v.x0, v.x1, Math.max(4, Math.round(plotW / 110)));
    const yTicks = makeTicks(v.y0, v.y1, Math.max(4, Math.round(plotH / 60)));

    // 次网格（工程图纸红色细线）
    ctx.strokeStyle = 'rgba(178, 58, 52, 0.14)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const q of xTicks.minor) {
      ctx.moveTo(toX(q, v), MARGIN.t);
      ctx.lineTo(toX(q, v), MARGIN.t + plotH);
    }
    for (const z of yTicks.minor) {
      ctx.moveTo(MARGIN.l, toY(z, v));
      ctx.lineTo(MARGIN.l + plotW, toY(z, v));
    }
    ctx.stroke();

    // 主网格（暗红色，仿工程计算纸）
    ctx.strokeStyle = 'rgba(168, 44, 38, 0.55)';
    ctx.beginPath();
    for (const q of xTicks.major) {
      ctx.moveTo(toX(q, v), MARGIN.t);
      ctx.lineTo(toX(q, v), MARGIN.t + plotH);
    }
    for (const z of yTicks.major) {
      ctx.moveTo(MARGIN.l, toY(z, v));
      ctx.lineTo(MARGIN.l + plotW, toY(z, v));
    }
    ctx.stroke();

    // 边框（Origin 风格：四边框线 + 向内刻度）
    ctx.strokeStyle = '#8a3230';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(MARGIN.l, MARGIN.t, plotW, plotH);
    // 主刻度：四边向内 6px
    ctx.beginPath();
    for (const q of xTicks.major) {
      const x = toX(q, v);
      ctx.moveTo(x, MARGIN.t + plotH);
      ctx.lineTo(x, MARGIN.t + plotH - 6);
      ctx.moveTo(x, MARGIN.t);
      ctx.lineTo(x, MARGIN.t + 6);
    }
    for (const z of yTicks.major) {
      const y = toY(z, v);
      ctx.moveTo(MARGIN.l, y);
      ctx.lineTo(MARGIN.l + 6, y);
      ctx.moveTo(MARGIN.l + plotW, y);
      ctx.lineTo(MARGIN.l + plotW - 6, y);
    }
    ctx.stroke();
    // 次刻度：四边向内 3px
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (const q of xTicks.minor) {
      const x = toX(q, v);
      ctx.moveTo(x, MARGIN.t + plotH);
      ctx.lineTo(x, MARGIN.t + plotH - 3);
      ctx.moveTo(x, MARGIN.t);
      ctx.lineTo(x, MARGIN.t + 3);
    }
    for (const z of yTicks.minor) {
      const y = toY(z, v);
      ctx.moveTo(MARGIN.l, y);
      ctx.lineTo(MARGIN.l + 3, y);
      ctx.moveTo(MARGIN.l + plotW, y);
      ctx.lineTo(MARGIN.l + plotW - 3, y);
    }
    ctx.stroke();

    // 刻度标签
    ctx.fillStyle = '#475569';
    ctx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.textAlign = 'center';
    for (const q of xTicks.major) {
      ctx.fillText(formatTick(q, xTicks.step), toX(q, v), MARGIN.t + plotH + 18);
    }
    ctx.textAlign = 'right';
    for (const z of yTicks.major) {
      ctx.fillText(formatTick(z, yTicks.step), MARGIN.l - 8, toY(z, v) + 4);
    }
    // 轴标题
    ctx.textAlign = 'center';
    ctx.fillStyle = '#334155';
    ctx.font = '12px "Segoe UI", "Microsoft YaHei", sans-serif';
    ctx.fillText('流量 Q（m³/s）', MARGIN.l + plotW / 2, size.h - 8);
    ctx.save();
    ctx.translate(16, MARGIN.t + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('水位 Z（m）', 0, 0);
    ctx.restore();

    // 裁剪绘图区
    ctx.save();
    ctx.beginPath();
    ctx.rect(MARGIN.l, MARGIN.t, plotW, plotH);
    ctx.clip();

    // 高水延长 30% 上限线
    if (points.length >= 2) {
      const zs = points.map((p) => p.z);
      const zMax = Math.max(...zs);
      const zMin = Math.min(...zs);
      const limit = zMax + 0.3 * (zMax - zMin);
      if (limit >= v.y0 && limit <= v.y1) {
        ctx.strokeStyle = '#ea580c';
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(MARGIN.l, toY(limit, v));
        ctx.lineTo(MARGIN.l + plotW, toY(limit, v));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#ea580c';
        ctx.textAlign = 'left';
        ctx.font = '11px "Microsoft YaHei", sans-serif';
        ctx.fillText('高水延长上限（水位变幅 30%）', MARGIN.l + 6, toY(limit, v) - 5);
      }
    }

    // 曲线
    if (showCurves) {
      for (const c of effectiveCurves) {
        if (!c.visible) continue;
      const samples = sampled.get(c.id);
      if (!samples || samples.length < 2) continue;
      const isActive = c.id === activeCurveId;
      ctx.strokeStyle = c.color;
      ctx.lineWidth = c.lineWidth ?? (isActive ? 2.2 : 1.6);
      ctx.setLineDash(DASH_PATTERNS[c.lineDash ?? 'solid']);
      ctx.globalAlpha = isActive ? 1 : 0.8;
      ctx.beginPath();
      ctx.moveTo(toX(samples[0].q, v), toY(samples[0].z, v));
      for (let i = 1; i < samples.length; i++) {
        ctx.lineTo(toX(samples[i].q, v), toY(samples[i].z, v));
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // 线号标注：曲线上端 1/3 处，沿曲线切线方向，白色描边无框（Origin 风格）
      if (showCurveLabels && c.labelVisible !== false) {
        const zTop = samples[samples.length - 1].z;
        const zBot = samples[0].z;
        const zLabel = zTop - (zTop - zBot) / 3;
        let li = Math.floor(samples.length / 2);
        let bestD = Infinity;
        for (let i = 0; i < samples.length; i++) {
          const d = Math.abs(samples[i].z - zLabel);
          if (d < bestD) {
            bestD = d;
            li = i;
          }
        }
        const lp = samples[li];
        // 切线方向（屏幕坐标系）
        const pPrev = samples[Math.max(0, li - 2)];
        const pNext = samples[Math.min(samples.length - 1, li + 2)];
        const tx = toX(pNext.q, v) - toX(pPrev.q, v);
        const ty = toY(pNext.z, v) - toY(pPrev.z, v);
        let angle = Math.atan2(ty, tx);
        // 文字保持可读（不颠倒），过陡时不旋转
        if (angle > Math.PI / 2) angle -= Math.PI;
        if (angle < -Math.PI / 2) angle += Math.PI;
        if (Math.abs(angle) > Math.PI / 3) angle = 0;
        ctx.save();
        ctx.translate(toX(lp.q, v), toY(lp.z, v));
        ctx.rotate(angle);
        ctx.font = 'bold 13px "Segoe UI", "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'left';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(255,255,255,0.92)';
        ctx.strokeText(c.name, 10, -7); // 白色描边形成光晕，免边框
        ctx.fillStyle = c.color;
        ctx.fillText(c.name, 10, -7);
        ctx.restore();
      }
      }
    }

    // 实测点：较大的亮色实心标记（形状/大小/填充色可右键调整）
    if (showPoints) {
      for (const p of points) {
        const x = toX(p.q, v);
        const y = toY(p.z, v);
        if (x < MARGIN.l - 12 || x > MARGIN.l + plotW + 12 || y < MARGIN.t - 12 || y > MARGIN.t + plotH + 12) continue;
        const dev = deviations.get(p.id);
        const outlier = dev && Math.abs(dev.rel) > 5;
        const hovered = p.id === hoverPoint;
        const r = hovered ? pointStyle.size + 1.5 : pointStyle.size;
        drawMarker(ctx, pointStyle.shape, x, y, r, outlier ? '#dc2626' : pointStyle.color, 'rgba(255,255,255,0.9)');

        // 偏离检验不通过时，在超限点旁标注偏差值
        if (deviationFail && outlier && dev) {
          const label = `${dev.rel > 0 ? '+' : ''}${dev.rel.toFixed(1)}%`;
          ctx.font = 'bold 10px "Segoe UI", sans-serif';
          const lw = ctx.measureText(label).width + 8;
          let lx2 = x + 9;
          if (lx2 + lw > MARGIN.l + plotW) lx2 = x - lw - 9;
          const ly2 = y - 4;
          ctx.fillStyle = 'rgba(220, 38, 38, 0.92)';
          ctx.fillRect(lx2, ly2 - 10, lw, 14);
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'left';
          ctx.fillText(label, lx2 + 4, ly2 + 1);
        }
      }
    }

    // 活动曲线控制节点：较小的深色实心标记（与实测点大小、明暗区分）
    if (activeCurve && showNodes) {
      const nShape = activeCurve.nodeShape ?? 'circle';
      const nSize = activeCurve.nodeSize ?? 3.2;
      const nColor = activeCurve.nodeColor ?? '#1e293b';
      const nodes = activeCurve.type === 'loop' ? activeCurve.nodes : [...activeCurve.nodes].sort((a, b) => a.z - b.z);
      nodes.forEach((n, idx) => {
        const pos = dragNode && dragNode.id === n.id ? dragNode : n;
        const x = toX(pos.q, v);
        const y = toY(pos.z, v);
        const hovered = hoverNode === n.id;
        const selected = selectedNode === n.id;
        const isBackbend = backbendIds.has(n.id); // 反曲节点：橙色警示
        const r = hovered || selected ? nSize + 1.3 : nSize;
        drawMarker(ctx, nShape, x, y, r, isBackbend ? '#f97316' : selected ? '#facc15' : nColor);
        if (hovered || selected || isBackbend) {
          ctx.beginPath();
          ctx.arc(x, y, r + 2.5, 0, Math.PI * 2);
          ctx.strokeStyle = isBackbend ? '#ea580c' : selected ? '#a16207' : nColor;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }
        // 绳套曲线标注节点序号（涨落次序）
        if (activeCurve.type === 'loop') {
          ctx.fillStyle = '#64748b';
          ctx.font = '9px sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(String(idx + 1), x + 6, y - 5);
        }
      });
    }

    // 绘制模式：CAD 式橡皮筋预览（最后节点 → 光标，手绘中不显示）
    if (drawMode && activeCurve && mouse && !stroke) {
      const nodes = activeCurve.nodes;
      if (nodes.length > 0) {
        const last =
          activeCurve.type === 'loop'
            ? nodes[nodes.length - 1]
            : [...nodes].sort((a, b) => a.z - b.z)[nodes.length - 1];
        const mx = mouse.px;
        const my = mouse.py;
        if (mx > MARGIN.l && mx < MARGIN.l + plotW && my > MARGIN.t && my < MARGIN.t + plotH) {
          ctx.strokeStyle = activeCurve.color;
          ctx.globalAlpha = 0.55;
          ctx.setLineDash([5, 4]);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(toX(last.q, v), toY(last.z, v));
          ctx.lineTo(mx, my);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;
          // 光标处十字预览
          ctx.strokeStyle = activeCurve.color;
          ctx.lineWidth = 1.2;
          ctx.beginPath();
          ctx.moveTo(mx - 7, my);
          ctx.lineTo(mx + 7, my);
          ctx.moveTo(mx, my - 7);
          ctx.lineTo(mx, my + 7);
          ctx.stroke();
        }
      }
    }

    // 手绘进行中的笔划（实线预览 + 采样点）
    if (stroke && stroke.length > 1 && activeCurve) {
      ctx.strokeStyle = activeCurve.color;
      ctx.lineWidth = 1.8;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(toX(stroke[0].q, v), toY(stroke[0].z, v));
      for (let i = 1; i < stroke.length; i++) {
        ctx.lineTo(toX(stroke[i].q, v), toY(stroke[i].z, v));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      // 起终点标记
      ctx.fillStyle = activeCurve.color;
      ctx.beginPath();
      ctx.arc(toX(stroke[0].q, v), toY(stroke[0].z, v), 3.5, 0, Math.PI * 2);
      ctx.fill();
      const last = stroke[stroke.length - 1];
      ctx.beginPath();
      ctx.arc(toX(last.q, v), toY(last.z, v), 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // 拖拽/悬停数值提示
    const tip = dragNode
      ? { q: dragNode.q, z: dragNode.z, x: toX(dragNode.q, v), y: toY(dragNode.z, v) }
      : hoverPoint
        ? (() => {
            const p = points.find((pt) => pt.id === hoverPoint);
            return p ? { q: p.q, z: p.z, x: toX(p.q, v), y: toY(p.z, v) } : null;
          })()
        : null;
    if (tip) {
      const text = `Z=${tip.z.toFixed(2)} m   Q=${tip.q.toFixed(1)} m³/s`;
      ctx.font = '11px "Segoe UI", "Microsoft YaHei", sans-serif';
      const tw = ctx.measureText(text).width + 12;
      let bx = tip.x + 12;
      let by = tip.y - 30;
      if (bx + tw > MARGIN.l + plotW) bx = tip.x - tw - 12;
      if (by < MARGIN.t) by = tip.y + 12;
      ctx.fillStyle = 'rgba(15,23,42,0.85)';
      ctx.fillRect(bx, by, tw, 20);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'left';
      ctx.fillText(text, bx + 6, by + 14);
    }

    ctx.restore();
  }, [size, vp, points, effectiveCurves, sampled, activeCurve, activeCurveId, deviations, hoverNode, hoverPoint, selectedNode, dragNode, plotW, plotH, toX, toY, canvasRef, showPoints, showNodes, showCurves, showCurveLabels, deviationFail, pointStyle, drawMode, mouse, stroke, backbendIds]);

  // 退出绘线模式时丢弃未完成笔划
  useEffect(() => {
    if (!drawMode && stroke) {
      setStroke(null);
      lastStrokePx.current = null;
      strokePxLen.current = 0;
    }
  }, [drawMode, stroke]);

  // ── 命中检测 ──
  const hitNode = useCallback(
    (px: number, py: number): CurveNode | null => {
      if (!activeCurve || !showNodes) return null;
      const v = vpRef.current;
      const nodes = dragNode
        ? activeCurve.nodes.map((n) => (n.id === dragNode.id ? { ...n, q: dragNode.q, z: dragNode.z } : n))
        : activeCurve.nodes;
      for (const n of nodes) {
        const x = toX(n.q, v);
        const y = toY(n.z, v);
        if (Math.abs(px - x) <= NODE_HIT && Math.abs(py - y) <= NODE_HIT) return n;
      }
      return null;
    },
    [activeCurve, dragNode, toX, toY, showNodes]
  );

  const hitPoint = useCallback(
    (px: number, py: number): DataPoint | null => {
      if (!showPoints) return null;
      const v = vpRef.current;
      for (const p of points) {
        const x = toX(p.q, v);
        const y = toY(p.z, v);
        if ((px - x) ** 2 + (py - y) ** 2 <= 81) return p;
      }
      return null;
    },
    [points, toX, toY, showPoints]
  );

  const eventPos = (e: React.PointerEvent | React.MouseEvent): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - rect.left, e.clientY - rect.top];
  };

  // ── 交互 ──
  /** 距既有节点过近（<6px）时拒绝重复加点，避免样条退化 */
  const nearExistingNode = useCallback(
    (px: number, py: number): boolean => {
      if (!activeCurve) return false;
      const v = vpRef.current;
      return activeCurve.nodes.some((n) => {
        const dx = toX(n.q, v) - px;
        const dy = toY(n.z, v) - py;
        return dx * dx + dy * dy < 36;
      });
    },
    [activeCurve, toX, toY]
  );

  const onPointerDown = (e: React.PointerEvent) => {
    setMenu(null); // 点击画布任意处关闭右键菜单
    if (e.button === 2) return; // 右键在 contextmenu 处理
    const [px, py] = eventPos(e);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);

    if (drawMode) {
      // Shift+拖动 = 平移；否则开始手绘笔划（松开时不足 8px 视为单击加点）
      if (e.shiftKey) {
        dragRef.current = { kind: 'pan', startX: px, startY: py, vp0: { ...vpRef.current }, moved: false };
        setCursor('grabbing');
        return;
      }
      if (px > MARGIN.l && px < MARGIN.l + plotW && py > MARGIN.t && py < MARGIN.t + plotH) {
        strokePxLen.current = 0;
        setStroke([{ q: fromX(px, vpRef.current), z: fromY(py, vpRef.current) }]);
      }
      return;
    }

    const node = hitNode(px, py);
    if (node) {
      dragRef.current = { kind: 'node', nodeId: node.id, startX: px, startY: py, vp0: { ...vpRef.current }, moved: false };
      setDragNode({ id: node.id, q: node.q, z: node.z });
      setSelectedNode(node.id);
      return;
    }
    setSelectedNode(null);
    dragRef.current = { kind: 'pan', startX: px, startY: py, vp0: { ...vpRef.current }, moved: false };
    setCursor('grabbing');
  };

  const lastStrokePx = useRef<{ px: number; py: number } | null>(null);

  const onPointerMove = (e: React.PointerEvent) => {
    const [px, py] = eventPos(e);
    setMouse({ px, py });

    // 手绘笔划采样（像素间距 ≥4px 才记点）
    if (stroke) {
      const last = lastStrokePx.current;
      if (!last || Math.hypot(px - last.px, py - last.py) >= 4) {
        strokePxLen.current += last ? Math.hypot(px - last.px, py - last.py) : 0;
        lastStrokePx.current = { px, py };
        const cx = Math.max(MARGIN.l, Math.min(MARGIN.l + plotW, px));
        const cy = Math.max(MARGIN.t, Math.min(MARGIN.t + plotH, py));
        setStroke([...stroke, { q: fromX(cx, vpRef.current), z: fromY(cy, vpRef.current) }]);
      }
      return;
    }

    const drag = dragRef.current;
    if (drag?.kind === 'node' && dragNode) {
      const q = fromX(px, vpRef.current);
      const z = fromY(py, vpRef.current);
      setDragNode({ id: dragNode.id, q: Math.max(0, q), z });
      drag.moved = true;
      return;
    }
    if (drag?.kind === 'pan') {
      const v0 = drag.vp0;
      const dq = ((px - drag.startX) / plotW) * (v0.x1 - v0.x0);
      const dz = ((py - drag.startY) / plotH) * (v0.y1 - v0.y0);
      setVp({ x0: v0.x0 - dq, x1: v0.x1 - dq, y0: v0.y0 + dz, y1: v0.y1 + dz });
      drag.moved = true;
      return;
    }
    // 悬停
    const node = hitNode(px, py);
    setHoverNode(node?.id ?? null);
    const pt = node ? null : hitPoint(px, py);
    setHoverPoint(pt?.id ?? null);
    setCursor(drawMode ? 'crosshair' : node ? 'move' : 'default');
  };

  const onPointerUp = () => {
    // 手绘笔划结束
    if (stroke) {
      const isClick = strokePxLen.current < 8 || stroke.length < 2;
      if (isClick) {
        // 单击加点（CAD 多段线式），距既有节点过近则忽略
        const p = stroke[0];
        const px = toX(p.q, vpRef.current);
        const py = toY(p.z, vpRef.current);
        if (!nearExistingNode(px, py)) props.onAddNode(p.q, p.z);
      } else if (stroke.length >= 3) {
        props.onStroke(stroke); // 整笔一次提交（一步撤销）
      }
      setStroke(null);
      lastStrokePx.current = null;
      strokePxLen.current = 0;
      return;
    }
    const drag = dragRef.current;
    if (drag?.kind === 'node' && dragNode && drag.moved) {
      props.onMoveNode(dragNode.id, dragNode.q, dragNode.z);
    }
    dragRef.current = null;
    setDragNode(null);
    setCursor('default');
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    if (drawMode) return; // 绘线模式下单击即加点，双击不再重复
    const [px, py] = eventPos(e);
    if (px < MARGIN.l || px > MARGIN.l + plotW || py < MARGIN.t || py > MARGIN.t + plotH) return;
    if (!activeCurve) return;
    // 双击空白：向活动曲线插入节点（距既有节点过近则忽略）
    if (!hitNode(px, py) && !nearExistingNode(px, py)) {
      props.onAddNode(fromX(px, vpRef.current), fromY(py, vpRef.current));
    }
  };

  /** 命中曲线：距采样折线最近点在阈值内 */
  const hitCurve = useCallback(
    (px: number, py: number): Curve | null => {
      if (!showCurves) return null;
      const v = vpRef.current;
      let best: Curve | null = null;
      let bestD = 100; // 10px 阈值的平方
      for (const c of effectiveCurves) {
        if (!c.visible) continue;
        const samples = sampled.get(c.id);
        if (!samples) continue;
        for (let i = 0; i < samples.length; i += 2) {
          const dx = toX(samples[i].q, v) - px;
          const dy = toY(samples[i].z, v) - py;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
      }
      return best;
    },
    [effectiveCurves, sampled, toX, toY, showCurves]
  );

  // 右键：绘制模式下结束绘线；否则命中节点/测点/曲线 → 弹出样式菜单
  const onContextMenu = (e: React.MouseEvent) => {
    if (drawMode) {
      e.preventDefault();
      props.onExitDraw();
      return;
    }
    const [px, py] = eventPos(e);
    const node = hitNode(px, py);
    if (node && activeCurve) {
      e.preventDefault();
      setMenu({ target: { kind: 'node', id: node.id, curve: activeCurve }, x: px, y: py });
      return;
    }
    const pt = hitPoint(px, py);
    if (pt) {
      e.preventDefault();
      setMenu({ target: { kind: 'point', id: pt.id }, x: px, y: py });
      return;
    }
    const curve = hitCurve(px, py);
    if (curve) {
      e.preventDefault();
      setMenu({ target: { kind: 'curve', id: curve.id, curve }, x: px, y: py });
      return;
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    const [px, py] = eventPos(e);
    const v = vpRef.current;
    const factor = Math.exp(e.deltaY * 0.0012);
    const anchorQ = fromX(px, v);
    const anchorZ = fromY(py, v);
    const clampSpan = (s: number) => Math.min(1e6, Math.max(1e-3, s));
    const nx0 = anchorQ - (anchorQ - v.x0) * factor;
    const nx1 = anchorQ + (v.x1 - anchorQ) * factor;
    const ny0 = anchorZ - (anchorZ - v.y0) * factor;
    const ny1 = anchorZ + (v.y1 - anchorZ) * factor;
    if (clampSpan(nx1 - nx0) !== nx1 - nx0 || clampSpan(ny1 - ny0) !== ny1 - ny0) return;
    setVp({ x0: nx0, x1: nx1, y0: ny0, y1: ny1 });
  };

  // Delete 键删除选中节点；绘制模式下 Backspace 撤销上一点（CAD 习惯）
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if (drawMode && e.key === 'Backspace' && activeCurve && activeCurve.nodes.length > 0) {
        const nodes = activeCurve.nodes;
        const last =
          activeCurve.type === 'loop'
            ? nodes[nodes.length - 1]
            : [...nodes].sort((a, b) => a.z - b.z)[nodes.length - 1];
        props.onDeleteNode(last.id);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedNode && activeCurve && !drawMode) {
        props.onDeleteNode(selectedNode);
        setSelectedNode(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedNode, activeCurve, drawMode, props]);

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden bg-white">
      <canvas
        ref={canvasRef}
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setMouse(null)}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        onWheel={onWheel}
        className="touch-none select-none"
      />
      <div className="pointer-events-none absolute bottom-12 left-20 rounded bg-slate-800/75 px-2 py-1 text-[10px] leading-4 text-white">
        滚轮缩放 · 拖拽空白平移 · 双击加节点 · 拖拽节点微调 · 右键改样式 · Delete 删节点
      </div>
      {/* CAD 式坐标状态栏 */}
      {mouse && mouse.px > MARGIN.l && mouse.px < MARGIN.l + plotW && mouse.py > MARGIN.t && mouse.py < MARGIN.t + plotH && (
        <div className="pointer-events-none absolute bottom-2 right-6 rounded bg-slate-800/85 px-2.5 py-1 font-mono text-[11px] text-white">
          Z = {fromY(mouse.py, vp).toFixed(3)} m　　Q = {fromX(mouse.px, vp).toFixed(2)} m³/s
        </div>
      )}
      {drawMode && (
        <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded bg-rose-600/90 px-3 py-1 text-xs text-white shadow">
          绘制模式：单击逐点加点 · 按住拖动 = 手绘整根线 · Shift+拖动平移 · Backspace 撤点 · 右键/Esc 结束
        </div>
      )}
      {menu && (
        <StyleMenu
          target={menu.target}
          x={Math.min(menu.x, Math.max(0, size.w - 260))}
          y={Math.min(menu.y, Math.max(0, size.h - 240))}
          pointStyle={pointStyle}
          onPointStyle={props.onPointStyle}
          onUpdateCurve={props.onUpdateCurve}
          onDeletePoint={(id) => {
            props.onDeletePoint(id);
          }}
          onDeleteNode={(curveId, nodeId) => {
            if (curveId === activeCurveId) props.onDeleteNode(nodeId);
          }}
          onDeleteCurve={props.onDeleteCurve}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}
