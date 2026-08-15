// 曲线插值：单调三次样条（Fritsch–Carlson）与向心 Catmull-Rom
// 单一线/复合曲线：Q 作为 Z 的单调函数插值；绳套曲线：参数样条（允许回环）

import type { CurveNode, XY } from '@/types';

const SAMPLE_PER_SEG = 32;

/**
 * Fritsch–Carlson 单调三次 Hermite 插值。
 * 输入节点按 z 升序；输出密集采样点（z 单调递增）。
 */
export function monotoneCubic(nodes: CurveNode[]): XY[] {
  const pts = [...nodes].sort((a, b) => a.z - b.z);
  const n = pts.length;
  if (n === 0) return [];
  if (n === 1) return [{ q: pts[0].q, z: pts[0].z }];
  if (n === 2) return sampleLinear(pts[0], pts[1]);

  const xs = pts.map((p) => p.z);
  const ys = pts.map((p) => p.q);

  // 段斜率
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1] - xs[i];
    d.push(h > 1e-12 ? (ys[i + 1] - ys[i]) / h : 0);
  }
  // 切线（F-C 单调性限制）
  const m: number[] = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m[i] = 0;
    } else {
      const h0 = xs[i] - xs[i - 1];
      const h1 = xs[i + 1] - xs[i];
      const w1 = 2 * h1 + h0;
      const w2 = h1 + 2 * h0;
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }

  const out: XY[] = [];
  for (let i = 0; i < n - 1; i++) {
    const h = xs[i + 1] - xs[i];
    for (let s = 0; s < SAMPLE_PER_SEG; s++) {
      const t = s / SAMPLE_PER_SEG;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      out.push({
        z: xs[i] + h * t,
        q: h00 * ys[i] + h10 * h * m[i] + h01 * ys[i + 1] + h11 * h * m[i + 1],
      });
    }
  }
  out.push({ z: xs[n - 1], q: ys[n - 1] });
  return out;
}

/** 向心 Catmull-Rom 参数样条（用于绳套曲线，允许 Z 非单调回环） */
export function catmullRom(nodes: CurveNode[]): XY[] {
  const n = nodes.length;
  if (n === 0) return [];
  if (n === 1) return [{ q: nodes[0].q, z: nodes[0].z }];
  if (n === 2) return sampleLinear(nodes[0], nodes[1]);

  const P = nodes.map((p) => [p.q, p.z]);
  const out: XY[] = [];
  const alpha = 0.5; // 向心参数化

  // 端点复制（开放曲线）
  const ext = [P[0], ...P, P[n - 1]];
  const ts = [0];
  for (let k = 1; k < ext.length; k++) {
    const dx = ext[k][0] - ext[k - 1][0];
    const dy = ext[k][1] - ext[k - 1][1];
    ts.push(ts[k - 1] + Math.pow(Math.sqrt(dx * dx + dy * dy) + 1e-12, alpha));
  }

  for (let seg = 0; seg < n - 1; seg++) {
    const p0 = ext[seg];
    const p1 = ext[seg + 1];
    const p2 = ext[seg + 2];
    const p3 = ext[seg + 3];
    const t0 = ts[seg];
    const t1 = ts[seg + 1];
    const t2 = ts[seg + 2];
    const t3 = ts[seg + 3];
    for (let s = 0; s < SAMPLE_PER_SEG; s++) {
      const t = t1 + ((t2 - t1) * s) / SAMPLE_PER_SEG;
      const a1 = lerp2(p0, p1, (t - t0) / (t1 - t0 + 1e-12));
      const a2 = lerp2(p1, p2, (t - t1) / (t2 - t1 + 1e-12));
      const a3 = lerp2(p2, p3, (t - t2) / (t3 - t2 + 1e-12));
      const b1 = lerp2(a1, a2, (t - t0) / (t2 - t0 + 1e-12));
      const b2 = lerp2(a2, a3, (t - t1) / (t3 - t1 + 1e-12));
      const c = lerp2(b1, b2, (t - t1) / (t2 - t1 + 1e-12));
      out.push({ q: c[0], z: c[1] });
    }
  }
  out.push({ q: nodes[n - 1].q, z: nodes[n - 1].z });
  return out;
}

function lerp2(a: number[], b: number[], t: number): number[] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

function sampleLinear(a: CurveNode, b: CurveNode): XY[] {
  const out: XY[] = [];
  for (let s = 0; s <= SAMPLE_PER_SEG; s++) {
    const t = s / SAMPLE_PER_SEG;
    out.push({ q: a.q + (b.q - a.q) * t, z: a.z + (b.z - a.z) * t });
  }
  return out;
}

/** 由采样折线求给定水位 z 处的流量 q（最近邻 + 线性插值） */
export function qAtZ(samples: XY[], z: number): number | null {
  if (samples.length === 0) return null;
  if (samples.length === 1) return samples[0].q;
  // 找到 z 所在的采样区间（z 单调时等价于二分；非单调时取最近区间）
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < samples.length - 1; i++) {
    const z0 = samples[i].z;
    const z1 = samples[i + 1].z;
    const lo = Math.min(z0, z1);
    const hi = Math.max(z0, z1);
    let dist: number;
    if (z >= lo && z <= hi) dist = 0;
    else dist = Math.min(Math.abs(z - z0), Math.abs(z - z1));
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
      if (dist === 0) break;
    }
  }
  const s0 = samples[best];
  const s1 = samples[best + 1];
  const dz = s1.z - s0.z;
  if (Math.abs(dz) < 1e-12) return (s0.q + s1.q) / 2;
  let t = (z - s0.z) / dz;
  t = Math.max(0, Math.min(1, t));
  return s0.q + (s1.q - s0.q) * t;
}
