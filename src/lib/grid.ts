// 网格与坐标轴刻度：自动疏密（nice-number 算法）

/** 计算"漂亮"的刻度间隔（1/2/5 × 10^n） */
export function niceStep(range: number, targetCount: number): number {
  if (range <= 0 || !isFinite(range)) return 1;
  const raw = range / Math.max(1, targetCount);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  let step: number;
  if (norm >= 7) step = 10;
  else if (norm >= 3) step = 5;
  else if (norm >= 1.5) step = 2;
  else step = 1;
  return step * mag;
}

export interface TickSet {
  major: number[];
  minor: number[];
  step: number;
}

/** 生成主/次刻度。缩放时视口范围变化 → 间隔自动疏密 */
export function makeTicks(min: number, max: number, targetCount = 10): TickSet {
  const step = niceStep(max - min, targetCount);
  const minorStep = step / 5;
  const major: number[] = [];
  const minor: number[] = [];
  const eps = step * 1e-9;
  for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + eps; v += step) {
    major.push(roundTo(v, step));
  }
  for (let v = Math.ceil(min / minorStep - 1e-9) * minorStep; v <= max + minorStep; v += minorStep) {
    const r = roundTo(v, minorStep);
    if (!major.some((m) => Math.abs(m - r) < step * 1e-6)) minor.push(r);
  }
  return { major, minor, step };
}

function roundTo(v: number, step: number): number {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  const f = Math.pow(10, decimals);
  return Math.round(v * f) / f;
}

/** 刻度标签格式化：根据间隔自动决定小数位；大数值加千分位分隔 */
export function formatTick(v: number, step: number): string {
  const decimals = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
  const s = v.toFixed(Math.min(decimals, 6));
  if (Math.abs(v) >= 10000) {
    const [int, dec] = s.split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return dec ? `${grouped}.${dec}` : grouped;
  }
  return s;
}
