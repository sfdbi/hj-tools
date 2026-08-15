// 手绘笔划处理：Douglas-Peucker 简化、单一线单调化（PAVA 等值回归）、反曲检测
import type { CurveNode, XY } from '@/types';

let seq = 0;
const nid = () => `s${Date.now().toString(36)}_${seq++}`;

/** Douglas-Peucker 折线简化 */
export function simplifyDP(pts: XY[], tol: number): XY[] {
  if (pts.length <= 2) return pts.slice();
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const pa = pts[a];
    const pb = pts[b];
    const dx = pb.q - pa.q;
    const dz = pb.z - pa.z;
    const len = Math.hypot(dx, dz) || 1e-12;
    let maxD = -1;
    let maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((pts[i].q - pa.q) * dz - (pts[i].z - pa.z) * dx) / len;
      if (d > maxD) {
        maxD = d;
        maxI = i;
      }
    }
    if (maxD > tol && maxI > 0) {
      keep[maxI] = true;
      stack.push([a, maxI], [maxI, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/**
 * PAVA 等值回归（递增）：把序列调整为单调不减的最小改动序列。
 * 用于消除单一水位流量关系线的"反曲"（Q 随 Z 减小）。
 */
export function isotonicIncreasing(vals: number[]): number[] {
  const n = vals.length;
  const v = vals.slice();
  const w = new Array<number>(n).fill(1);
  for (let i = 1; i < n; i++) {
    if (v[i] < v[i - 1]) {
      // 向前合并违反单调性的块
      let j = i;
      let sum = v[i] * w[i];
      let cnt = w[i];
      while (j > 0 && v[j - 1] > sum / cnt) {
        j--;
        sum += v[j] * w[j];
        cnt += w[j];
      }
      const avg = sum / cnt;
      for (let k = j; k <= i; k++) {
        v[k] = avg;
        w[k] = cnt;
      }
    }
  }
  return v;
}

/** 反曲检测：单一线/复合曲线按 Z 升序后 Q 应单调不减。返回违反节点 id 集合 */
export function findBackbend(nodes: CurveNode[]): Set<string> {
  const sorted = [...nodes].sort((a, b) => a.z - b.z);
  const bad = new Set<string>();
  let maxQ = -Infinity;
  for (const n of sorted) {
    if (n.q < maxQ - 1e-9) {
      bad.add(n.id);
    } else {
      maxQ = n.q;
    }
  }
  return bad;
}

/** 手绘笔划 → 绳套曲线节点（保持绘制顺序，DP 简化） */
export function strokeToLoopNodes(stroke: XY[], rangeHint: number): CurveNode[] {
  const tol = Math.max(rangeHint * 0.004, 1e-4);
  let pts = simplifyDP(stroke, tol);
  const MAX = 40;
  while (pts.length > MAX) {
    pts = simplifyDP(pts, tol * (pts.length / MAX));
  }
  return pts.map((p) => ({ id: nid(), q: round3(Math.max(0, p.q)), z: round3(p.z) }));
}

/**
 * 手绘笔划 → 单一线/复合曲线节点：
 * 与既有节点合并 → 按 Z 分箱取均值（保证单值函数）→ PAVA 单调化（消除反曲）→ 控制节点数量
 */
export function strokeToSingleNodes(stroke: XY[], existing: CurveNode[], bins = 14): CurveNode[] {
  const all: XY[] = [
    ...existing.map((n) => ({ q: n.q, z: n.z })),
    ...stroke,
  ];
  if (all.length === 0) return [];
  const zs = all.map((p) => p.z);
  const zMin = Math.min(...zs);
  const zMax = Math.max(...zs);
  const range = zMax - zMin;
  if (range < 1e-9) {
    return [{ id: nid(), q: round3(Math.max(0, all[0].q)), z: round3(zMin) }];
  }

  // 按 Z 分箱，箱内 Q 取均值
  const k = Math.max(6, Math.min(bins, Math.floor(all.length / 2) || 1));
  const bucketQ: number[][] = Array.from({ length: k }, () => []);
  for (const p of all) {
    const idx = Math.min(k - 1, Math.floor(((p.z - zMin) / range) * k));
    bucketQ[idx].push(p.q);
  }
  const centers: number[] = [];
  const means: number[] = [];
  for (let i = 0; i < k; i++) {
    if (bucketQ[i].length === 0) continue;
    centers.push(zMin + ((i + 0.5) / k) * range);
    means.push(bucketQ[i].reduce((s, q) => s + q, 0) / bucketQ[i].length);
  }
  // PAVA 单调化：Q 随 Z 单调不减，消除反曲
  const mono = isotonicIncreasing(means);
  return centers.map((z, i) => ({
    id: nid(),
    q: round3(Math.max(0, mono[i])),
    z: round3(z),
  }));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
