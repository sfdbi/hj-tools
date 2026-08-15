// 曲线拟合：多项式最小二乘 / 对数（半对数）拟合 / 智能拟合
// 约定：拟合目标是 Q = f(Z)，残差方向为流量方向（与偏离数值检验一致）
// 输出为可直接编辑的控制节点（自动拟合 → 人工微调闭环）

import type { CurveNode, DataPoint } from '@/types';

export interface FitResult {
  nodes: CurveNode[];
  label: string;
  rmse: number; // 流量均方根误差
}

let nodeSeq = 0;
function nid(): string {
  return `n${Date.now().toString(36)}_${nodeSeq++}`;
}

/** 高斯消元（部分主元）解线性方程组 A x = b */
function solve(A: number[][], b: number[]): number[] | null {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-14) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

/** 多项式最小二乘：Q = a0 + a1·Z + a2·Z² + … */
export function polyFit(points: DataPoint[], degree = 2): { fn: (z: number) => number; label: string } | null {
  const n = points.length;
  if (n < degree + 1) return null;
  const d = degree + 1;
  // 加权最小二乘（w = 1/q²，最小化相对误差，与偏离数值检验口径一致）
  // 正规方程 Σ w·z^(i+j) · a_j = Σ w·q·z^i
  const powSum: number[] = new Array(2 * degree + 1).fill(0);
  const qpow: number[] = new Array(d).fill(0);
  for (const p of points) {
    const w = 1 / Math.max(p.q * p.q, 1e-6);
    let zp = 1;
    for (let k = 0; k <= 2 * degree; k++) {
      powSum[k] += w * zp;
      if (k < d) qpow[k] += w * p.q * zp;
      zp *= p.z;
    }
  }
  const A: number[][] = [];
  for (let i = 0; i < d; i++) {
    A.push(powSum.slice(i, i + d));
  }
  const a = solve(A, qpow);
  if (!a) return null;
  return {
    fn: (z) => a.reduce((acc, ai, i) => acc + ai * Math.pow(z, i), 0),
    label: `${degree} 次多项式拟合（加权）`,
  };
}

/** 半对数拟合：lg Q = a + b·Z（即 Q = 10^(a+bZ)，水文上常用指数型关系） */
export function logFit(points: DataPoint[]): { fn: (z: number) => number; label: string } | null {
  const valid = points.filter((p) => p.q > 0);
  const n = valid.length;
  if (n < 2) return null;
  let sz = 0, slq = 0, szz = 0, szlq = 0;
  for (const p of valid) {
    const lq = Math.log10(p.q);
    sz += p.z;
    slq += lq;
    szz += p.z * p.z;
    szlq += p.z * lq;
  }
  const denom = n * szz - sz * sz;
  if (Math.abs(denom) < 1e-14) return null;
  const b = (n * szlq - sz * slq) / denom;
  const a = (slq - b * sz) / n;
  return { fn: (z) => Math.pow(10, a + b * z), label: '半对数拟合 lgQ=a+bZ' };
}

/**
 * 幂函数拟合：Q = c·(Z − a)ⁿ（水文常用，a 可理解为断流水位）
 * 对 a 做网格搜索，lgQ = lg c + n·lg(Z−a) 线性回归取相对误差最小者
 */
export function powerFit(points: DataPoint[]): { fn: (z: number) => number; label: string; zeroStage: number } | null {
  const valid = points.filter((p) => p.q > 0);
  const n = valid.length;
  if (n < 3) return null;
  const zs = valid.map((p) => p.z);
  const zMin = Math.min(...zs);
  const zMax = Math.max(...zs);
  const range = zMax - zMin || 1;

  let best: { c: number; a: number; nn: number; err: number } | null = null;
  const STEPS = 80;
  for (let s = 0; s < STEPS; s++) {
    const a = zMin - 0.005 * range - (2 * range * s) / STEPS;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (const p of valid) {
      const x = Math.log10(p.z - a);
      const y = Math.log10(p.q);
      sx += x; sy += y; sxx += x * x; sxy += x * y;
    }
    const denom = n * sxx - sx * sx;
    if (Math.abs(denom) < 1e-14) continue;
    const nn = (n * sxy - sx * sy) / denom;
    const lgc = (sy - nn * sx) / n;
    const c = Math.pow(10, lgc);
    // 相对误差
    let err = 0;
    for (const p of valid) {
      const qc = c * Math.pow(p.z - a, nn);
      err += ((p.q - qc) / p.q) ** 2;
    }
    err = Math.sqrt(err / n);
    if (!best || err < best.err) best = { c, a, nn, err };
  }
  if (!best) return null;
  const { c, a, nn } = best;
  return {
    fn: (z) => (z > a ? c * Math.pow(z - a, nn) : 0.001),
    label: `幂函数拟合 Q=${c.toPrecision(3)}(Z−${a.toFixed(2)})^${nn.toFixed(2)}`,
    zeroStage: a,
  };
}

/** 相对均方根误差（%） */
function relRmse(points: DataPoint[], fn: (z: number) => number): number {
  let s = 0;
  for (const p of points) {
    const qc = fn(p.z);
    const r = qc > 0 ? (p.q - qc) / p.q : 1e3;
    s += r * r;
  }
  return Math.sqrt(s / points.length) * 100;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

export interface FitOptions {
  method: 'poly2' | 'poly3' | 'log' | 'smart';
  hiExtend?: number; // 高水延长比例（默认 0.1，上限 0.3）
  loExtend?: number; // 低水延长比例（默认 0.05）
}

/** 拟合入口：返回可编辑控制节点 */
export function fitCurve(points: DataPoint[], opts: FitOptions): FitResult | null {
  if (points.length < 3) return null;
  const zs = points.map((p) => p.z);
  const zMin = Math.min(...zs);
  const zMax = Math.max(...zs);
  const range = zMax - zMin || 1;
  const hiE = Math.min(opts.hiExtend ?? 0.1, 0.3);
  const loE = opts.loExtend ?? 0.05;

  const toNodes = (fn: (z: number) => number, count: number): CurveNode[] => {
    // 节点按测点水位分位数布设（曲率大/数据密处节点更密），首尾再加延长段节点
    const sorted = [...zs].sort((a, b) => a - b);
    const levels: number[] = [zMin - range * loE];
    const k = Math.max(count - 2, 6);
    for (let i = 0; i < k; i++) {
      const idx = Math.min(sorted.length - 1, Math.floor((i / (k - 1)) * (sorted.length - 1)));
      levels.push(sorted[idx]);
    }
    levels.push(zMax + range * hiE);
    const nodes: CurveNode[] = [];
    for (const z of levels) {
      const q = Math.max(0.001, fn(z));
      nodes.push({ id: nid(), q: round3(q), z: round3(z) });
    }
    return nodes;
  };

  if (opts.method === 'poly2' || opts.method === 'poly3') {
    const deg = opts.method === 'poly2' ? 2 : 3;
    const fit = polyFit(points, deg);
    if (!fit) return null;
    return { nodes: toNodes(fit.fn, 8), label: fit.label, rmse: relRmse(points, fit.fn) };
  }
  if (opts.method === 'log') {
    const fit = logFit(points);
    if (!fit) return null;
    return { nodes: toNodes(fit.fn, 8), label: fit.label, rmse: relRmse(points, fit.fn) };
  }
  // 智能拟合：候选方法中选相对 RMSE 最小者
  const candidates: { fn: (z: number) => number; label: string; count: number }[] = [];
  const pw = powerFit(points);
  if (pw) candidates.push({ ...pw, count: 12 });
  const p2 = polyFit(points, 2);
  if (p2) candidates.push({ ...p2, count: 12 });
  const p3 = polyFit(points, 3);
  if (p3) candidates.push({ ...p3, count: 12 });
  const lg = logFit(points);
  if (lg) candidates.push({ ...lg, count: 12 });
  if (candidates.length === 0) return null;
  let best = candidates[0];
  let bestRmse = relRmse(points, best.fn);
  for (const c of candidates.slice(1)) {
    const r = relRmse(points, c.fn);
    if (r < bestRmse) {
      best = c;
      bestRmse = r;
    }
  }
  return { nodes: toNodes(best.fn, best.count), label: `智能拟合（${best.label}）`, rmse: bestRmse };
}
