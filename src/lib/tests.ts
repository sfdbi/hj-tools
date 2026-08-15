// 三性检验（SL/T 247-2020《水文资料整编规范》）
// 1) 符号检验 α=0.25；2) 适线检验 α=0.05；3) 偏离数值检验

import type { DataPoint } from '@/types';

/** 标准正态分布逆函数（Acklam 有理逼近，精度 ~1e-9） */
export function normInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > pHigh) {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/** 单个测点的偏离信息 */
export interface DeviationInfo {
  id: string;
  z: number;
  q: number; // 实测流量
  qc: number; // 曲线上流量
  dev: number; // 绝对偏离 q - qc
  rel: number; // 相对偏离 (q - qc)/qc × 100 %
}

/** 计算全部测点对曲线的偏离（qAtZ 为空或超出曲线范围者跳过） */
export function computeDeviations(
  points: DataPoint[],
  qAtZ: (z: number) => number | null
): DeviationInfo[] {
  const out: DeviationInfo[] = [];
  for (const p of points) {
    const qc = qAtZ(p.z);
    if (qc === null || qc <= 0) continue;
    const dev = p.q - qc;
    out.push({ id: p.id, z: p.z, q: p.q, qc, dev, rel: (dev / qc) * 100 });
  }
  return out;
}

export interface TestResult {
  name: string;
  pass: boolean;
  applicable: boolean; // 是否有足够数据作检验
  alpha: number;
  stats: { label: string; value: string }[];
  suggestion?: string; // 不通过时的修改建议
}

/** 符号检验：u = (|k − 0.5n| − 0.5) / (0.5√n)，α = 0.25 */
export function signTest(devs: DeviationInfo[]): TestResult {
  const n = devs.length;
  const alpha = 0.25;
  if (n < 2) {
    return { name: '符号检验', pass: false, applicable: false, alpha, stats: [], suggestion: '测点不足，无法检验' };
  }
  // 偏离值为零者正负各半分配
  let k = 0;
  for (const d of devs) {
    if (d.dev > 0) k += 1;
    else if (d.dev === 0) k += 0.5;
  }
  const u = (Math.abs(k - 0.5 * n) - 0.5) / (0.5 * Math.sqrt(n));
  const critical = normInv(1 - alpha / 2); // ≈1.1503
  const pass = u < critical;
  const kPos = k;
  const kNeg = n - k;
  return {
    name: '符号检验',
    pass,
    applicable: true,
    alpha,
    stats: [
      { label: '测点数 n', value: String(n) },
      { label: '正号个数 k', value: String(kPos) },
      { label: '负号个数', value: String(kNeg) },
      { label: '统计量 u', value: u.toFixed(3) },
      { label: `临界值 u(1−α/2)，α=${alpha}`, value: critical.toFixed(3) },
    ],
    suggestion: pass
      ? undefined
      : kPos > kNeg
        ? '正号偏多：曲线整体偏低，建议将曲线上移（增大同级水位对应的流量）'
        : '负号偏多：曲线整体偏高，建议将曲线下移（减小同级水位对应的流量）',
  };
}

/** 适线检验：按水位由低到高统计符号变换次数 k，α = 0.05 */
export function runTest(devs: DeviationInfo[]): TestResult {
  const alpha = 0.05;
  const sorted = [...devs].sort((a, b) => a.z - b.z);
  const n = sorted.length;
  if (n < 3) {
    return { name: '适线检验', pass: false, applicable: false, alpha, stats: [], suggestion: '测点不足，无法检验' };
  }
  const signs = sorted.map((d) => (d.dev > 0 ? 1 : d.dev < 0 ? -1 : 0));
  let k = 0;
  for (let i = 1; i < n; i++) {
    if (signs[i] !== 0 && signs[i - 1] !== 0 && signs[i] !== signs[i - 1]) k++;
  }
  const n1 = n - 1;
  const half = 0.5 * n1;
  const critical = normInv(1 - alpha); // ≈1.6449
  if (k >= half) {
    // 变换次数不少于期望值，认为适线良好
    return {
      name: '适线检验',
      pass: true,
      applicable: true,
      alpha,
      stats: [
        { label: '测点数 n', value: String(n) },
        { label: '符号变换次数 k', value: String(k) },
        { label: '0.5(n−1)', value: half.toFixed(1) },
        { label: '判定', value: 'k ≥ 0.5(n−1)，免于计算 u' },
      ],
    };
  }
  const u = (half - k - 0.5) / (0.5 * Math.sqrt(n1));
  const pass = u < critical;
  return {
    name: '适线检验',
    pass,
    applicable: true,
    alpha,
    stats: [
      { label: '测点数 n', value: String(n) },
      { label: '符号变换次数 k', value: String(k) },
      { label: '统计量 u', value: u.toFixed(3) },
      { label: `临界值 u(1−α)，α=${alpha}`, value: critical.toFixed(3) },
    ],
    suggestion: pass
      ? undefined
      : '符号变换次数过少：测点在曲线同侧成段聚集，存在局部系统偏离。建议检查点群弯曲处的曲率，适当调整中段节点',
  };
}

export interface DeviationTestResult extends TestResult {
  mean: number; // 系统误差 %
  std: number; // 标准差 %
  maxAbs: number; // 最大相对偏离 %
  maxAt?: DeviationInfo;
}

/**
 * 偏离数值检验：
 * 系统误差 |mean| ≤ 1%；≥75% 测点相对偏离在 ±5% 以内
 * （对应规范表 3.3.2-1 单一线定线精度：允许不超过 25% 的测点超出指标）
 */
export function deviationTest(devs: DeviationInfo[]): DeviationTestResult {
  const n = devs.length;
  const alpha = 0.05;
  if (n < 2) {
    return {
      name: '偏离数值检验', pass: false, applicable: false, alpha,
      stats: [], mean: 0, std: 0, maxAbs: 0, suggestion: '测点不足，无法检验',
    };
  }
  const mean = devs.reduce((s, d) => s + d.rel, 0) / n;
  const variance = devs.reduce((s, d) => s + (d.rel - mean) ** 2, 0) / (n - 1);
  const std = Math.sqrt(variance);
  let maxAbs = 0;
  let maxAt: DeviationInfo | undefined;
  let within5 = 0;
  for (const d of devs) {
    if (Math.abs(d.rel) > maxAbs) {
      maxAbs = Math.abs(d.rel);
      maxAt = d;
    }
    if (Math.abs(d.rel) <= 5) within5++;
  }
  const frac = within5 / n;
  const pass = Math.abs(mean) <= 1 && frac >= 0.75;
  let suggestion: string | undefined;
  if (!pass) {
    if (Math.abs(mean) > 1) {
      suggestion = mean > 0
        ? '系统误差为正：曲线整体偏低，建议整体上移曲线'
        : '系统误差为负：曲线整体偏高，建议整体下移曲线';
    } else if (maxAt) {
      suggestion = `仅 ${(frac * 100).toFixed(0)}% 测点在 ±5% 内（要求 ≥75%）。最大偏离 ${maxAbs.toFixed(2)}% 在 Z=${maxAt.z.toFixed(2)} m 处，建议局部微调该水位附近节点，或核查异常点`;
    }
  }
  return {
    name: '偏离数值检验',
    pass,
    applicable: true,
    alpha,
    mean, std, maxAbs, maxAt,
    stats: [
      { label: '测点数 n', value: String(n) },
      { label: '系统误差（均值）', value: `${mean.toFixed(2)} %（限差 ±1%）` },
      { label: '标准差 s', value: `${std.toFixed(2)} %` },
      { label: '±5% 内测点占比', value: `${(frac * 100).toFixed(0)} %（要求 ≥75%）` },
      { label: '最大相对偏离', value: `${maxAbs.toFixed(2)} %` },
    ],
    suggestion,
  };
}

/** 综合判定：三种检验均接受原假设 → 定线正确 */
export function overallVerdict(results: TestResult[]): { pass: boolean; text: string } {
  const applicable = results.filter((r) => r.applicable);
  if (applicable.length === 0) return { pass: false, text: '无有效检验（请先定线）' };
  if (applicable.every((r) => r.pass)) return { pass: true, text: '三种检验均接受原假设，定线正确' };
  const failed = applicable.filter((r) => !r.pass).map((r) => r.name);
  return { pass: false, text: `未通过：${failed.join('、')}，请根据建议调整曲线` };
}
