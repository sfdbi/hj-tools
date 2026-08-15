// 核心算法快速验证（tsx 运行）
import { monotoneCubic, catmullRom, qAtZ } from './src/lib/spline';
import { polyFit, logFit, fitCurve } from './src/lib/fitting';
import { computeDeviations, signTest, runTest, deviationTest, normInv } from './src/lib/tests';
import { samplePoints } from './src/lib/csv';
import { makeTicks } from './src/lib/grid';

let fail = 0;
const assert = (cond: boolean, name: string) => {
  console.log(`${cond ? '✓' : '✗ FAIL'} ${name}`);
  if (!cond) fail++;
};

// 1. 正态逆函数已知值
assert(Math.abs(normInv(0.875) - 1.1503) < 0.001, `normInv(0.875)=${normInv(0.875).toFixed(4)} ≈ 1.1503`);
assert(Math.abs(normInv(0.95) - 1.6449) < 0.001, `normInv(0.95)=${normInv(0.95).toFixed(4)} ≈ 1.6449`);

// 2. 多项式拟合还原已知关系 Q = (Z-7.6)^2.6
const pts = samplePoints();
const fit = polyFit(pts, 2);
assert(!!fit, 'polyFit 可解');
if (fit) {
  const errs = pts.map((p) => Math.abs(p.q - fit.fn(p.z)) / p.q);
  const maxRel = Math.max(...errs);
  console.log(`  二次多项式（加权）最大相对误差 ${(maxRel * 100).toFixed(2)}%`);
  assert(maxRel < 0.35, '二次多项式（加权）近似误差在可接受范围');
}
assert(!!logFit(pts), 'logFit 可解');

// 3. 智能拟合生成节点且单调
const smart = fitCurve(pts, { method: 'smart' });
assert(!!smart && smart.nodes.length >= 5, `智能拟合生成 ${smart?.nodes.length} 个节点（${smart?.label}）RMSE=${smart?.rmse.toFixed(2)}`);
if (smart) {
  const s = monotoneCubic(smart.nodes);
  assert(s.length > 100, `单调样条采样 ${s.length} 点`);
  let mono = true;
  for (let i = 1; i < s.length; i++) if (s[i].z < s[i - 1].z - 1e-9) mono = false;
  assert(mono, '样条 z 单调');
  // 曲线应穿过点群中心：三性检验应通过
  const devs = computeDeviations(pts, (z) => qAtZ(s, z));
  assert(devs.length === pts.length, `偏离计算覆盖全部 ${pts.length} 点`);
  const st = signTest(devs);
  const rt = runTest(devs);
  const dt = deviationTest(devs);
  console.log(`  符号检验 u=${st.stats[3]?.value} pass=${st.pass}；适线 pass=${rt.pass}；偏离 mean=${dt.mean.toFixed(2)}% max=${dt.maxAbs.toFixed(2)}% pass=${dt.pass}`);
  assert(st.pass, '符号检验通过（示例数据+智能拟合）');
  assert(rt.pass, '适线检验通过');
  assert(dt.pass, '偏离数值检验通过');
}

// 4. 绳套样条不发散
const loop = catmullRom([
  { id: 'a', q: 10, z: 1 }, { id: 'b', q: 50, z: 3 }, { id: 'c', q: 80, z: 5 },
  { id: 'd', q: 60, z: 4 }, { id: 'e', q: 30, z: 2 },
]);
assert(loop.length > 100, `绳套样条采样 ${loop.length} 点`);
assert(loop.every((p) => isFinite(p.q) && isFinite(p.z)), '绳套样条数值有效');

// 5. 网格刻度疏密
const t1 = makeTicks(0, 10, 10);
const t2 = makeTicks(0, 0.5, 10);
console.log(`  range=10 → step=${t1.step}；range=0.5 → step=${t2.step}`);
assert(t1.step === 1 && t2.step === 0.05, '网格间隔自动疏密正确');

process.exit(fail ? 1 : 0);
