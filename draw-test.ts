// 绘线算法验证（tsx 运行）
import { simplifyDP, isotonicIncreasing, findBackbend, strokeToSingleNodes, strokeToLoopNodes } from './src/lib/draw';
import { monotoneCubic } from './src/lib/spline';

let fail = 0;
const assert = (cond: boolean, name: string) => {
  console.log(`${cond ? '✓' : '✗ FAIL'} ${name}`);
  if (!cond) fail++;
};

// 1. DP 简化：直线上密点应简化为 2 点
const line = Array.from({ length: 100 }, (_, i) => ({ q: i, z: i * 2 }));
assert(simplifyDP(line, 0.5).length === 2, 'DP：直线 100 点简化为 2 点');

// 2. 等值回归单调化
const messy = [5, 3, 8, 6, 10, 7, 12];
const mono = isotonicIncreasing(messy);
let ok = true;
for (let i = 1; i < mono.length; i++) if (mono[i] < mono[i - 1] - 1e-9) ok = false;
assert(ok, `PAVA 输出单调不减: [${mono.map((v) => v.toFixed(1)).join(', ')}]`);

// 3. 反曲检测
const bendNodes = [
  { id: 'a', q: 10, z: 1 },
  { id: 'b', q: 50, z: 2 },
  { id: 'c', q: 30, z: 3 }, // 反曲
  { id: 'd', q: 80, z: 4 },
];
const bad = findBackbend(bendNodes);
assert(bad.size === 1 && bad.has('c'), '反曲检测准确定位违反节点');
assert(findBackbend([{ id: 'x', q: 1, z: 1 }, { id: 'y', q: 2, z: 2 }]).size === 0, '单调曲线无误报');

// 4. 手绘笔划 → 单一线节点：带抖动的上升笔划，输出必须单调且无反曲
const stroke = Array.from({ length: 200 }, (_, i) => {
  const t = i / 199;
  return { q: 10 + 200 * t + Math.sin(i * 1.7) * 15, z: 1 + 5 * t + Math.sin(i * 2.3) * 0.1 };
});
const nodes = strokeToSingleNodes(stroke, []);
assert(nodes.length >= 6 && nodes.length <= 14, `单一线笔划 → ${nodes.length} 个节点（6~14）`);
assert(findBackbend(nodes).size === 0, '单一线笔划结果无反曲');
// 样条渲染后仍单调
const samples = monotoneCubic(nodes);
let mono2 = true;
for (let i = 1; i < samples.length; i++) if (samples[i].q < samples[i - 1].q - 1e-6) mono2 = false;
assert(mono2, '单调化节点经单调样条渲染后 Q(Z) 单调不减');

// 5. 绳套笔划：保持顺序、数量受控
const loopStroke = Array.from({ length: 300 }, (_, i) => {
  const t = (i / 299) * Math.PI * 2;
  return { q: 100 + 60 * Math.cos(t) + Math.random() * 2, z: 5 + 3 * Math.sin(t) };
});
const loopNodes = strokeToLoopNodes(loopStroke, 200);
assert(loopNodes.length <= 40 && loopNodes.length >= 4, `绳套笔划 → ${loopNodes.length} 个节点（≤40）`);

process.exit(fail ? 1 : 0);
