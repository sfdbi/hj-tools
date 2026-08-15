// 三性检验面板：实时显示符号检验 / 适线检验 / 偏离数值检验结果 + 大偏差测点清单
import type { DeviationInfo, TestResult } from '@/lib/tests';
import { overallVerdict } from '@/lib/tests';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Props {
  results: TestResult[];
  deviations: DeviationInfo[];
  hasCurve: boolean;
  pointCount: number;
}

export default function TestPanel({ results, deviations, hasCurve, pointCount }: Props) {
  const verdict = overallVerdict(results);
  const devResult = results.find((r) => r.name === '偏离数值检验');

  // 按 |相对偏离| 降序；超限（>±5%）的必须全部列出，否则列前 5 个
  const ranked = [...deviations].sort((a, b) => Math.abs(b.rel) - Math.abs(a.rel));
  const overLimit = ranked.filter((d) => Math.abs(d.rel) > 5);
  const shown = overLimit.length > 0 ? overLimit : ranked.slice(0, 5);

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-3">
        {/* 综合判定 */}
        <div
          className={`rounded-lg border px-3 py-2 text-sm font-medium ${
            !hasCurve
              ? 'border-slate-200 bg-slate-50 text-slate-500'
              : verdict.pass
                ? 'border-green-300 bg-green-50 text-green-700'
                : 'border-red-300 bg-red-50 text-red-700'
          }`}
        >
          {!hasCurve ? '尚未定线 — 请先在"曲线"页拟合或绘制曲线' : verdict.text}
        </div>

        {pointCount < 10 && pointCount > 0 && (
          <div className="rounded bg-amber-50 px-3 py-2 text-xs text-amber-700">
            测点数量 &lt; 10，检验统计意义有限，建议补充测点
          </div>
        )}

        {results.map((r) => (
          <div
            key={r.name}
            className={`rounded-lg border ${
              !r.applicable
                ? 'border-slate-200 bg-white'
                : r.pass
                  ? 'border-green-300 bg-green-50/50'
                  : 'border-red-300 bg-red-50/50'
            }`}
          >
            <div className="flex items-center justify-between border-b border-inherit px-3 py-2">
              <span className="text-sm font-semibold text-slate-700">{r.name}</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  !r.applicable
                    ? 'bg-slate-100 text-slate-500'
                    : r.pass
                      ? 'bg-green-100 text-green-700'
                      : 'bg-red-100 text-red-700'
                }`}
              >
                {!r.applicable ? '数据不足' : r.pass ? '✓ 通过' : '✗ 不通过'}
              </span>
            </div>
            {r.stats.length > 0 && (
              <div className="px-3 py-2">
                {r.stats.map((s) => (
                  <div key={s.label} className="flex justify-between py-0.5 text-xs">
                    <span className="text-slate-500">{s.label}</span>
                    <span className="font-mono text-slate-700">{s.value}</span>
                  </div>
                ))}
              </div>
            )}
            {!r.pass && r.suggestion && (
              <div className="mx-3 mb-2 rounded bg-amber-50 px-2 py-1.5 text-xs leading-5 text-amber-800">
                💡 {r.suggestion}
              </div>
            )}
          </div>
        ))}

        {/* 偏差较大测点清单 */}
        {devResult?.applicable && shown.length > 0 && (
          <div
            className={`rounded-lg border ${
              overLimit.length > 0 ? 'border-red-300 bg-red-50/40' : 'border-slate-200 bg-white'
            }`}
          >
            <div className="border-b border-inherit px-3 py-2">
              <span className="text-sm font-semibold text-slate-700">
                {overLimit.length > 0 ? `偏差超限测点（${overLimit.length} 个，>±5%）` : '偏差最大的测点（前 5）'}
              </span>
              <div className="mt-0.5 text-[10px] text-slate-400">
                相对偏离 =（实测 Q − 曲线 Q）/ 曲线 Q × 100%；正值表示曲线在该水位处偏低
              </div>
            </div>
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-[10px] text-slate-400">
                  <th className="px-3 py-1 font-medium">水位 Z (m)</th>
                  <th className="px-2 py-1 font-medium">实测 Q</th>
                  <th className="px-2 py-1 font-medium">曲线 Q</th>
                  <th className="px-2 py-1 font-medium">相对偏离</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => {
                  const over = Math.abs(d.rel) > 5;
                  return (
                    <tr key={d.id} className={`border-t ${over ? 'bg-red-50' : ''}`}>
                      <td className="px-3 py-1 font-mono">{d.z.toFixed(2)}</td>
                      <td className="px-2 py-1 font-mono">{d.q.toFixed(1)}</td>
                      <td className="px-2 py-1 font-mono">{d.qc.toFixed(1)}</td>
                      <td className={`px-2 py-1 font-mono font-semibold ${over ? 'text-red-600' : 'text-slate-600'}`}>
                        {d.rel > 0 ? '+' : ''}{d.rel.toFixed(2)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {overLimit.length > 0 && (
              <div className="px-3 py-2 text-[11px] leading-4 text-slate-500">
                这些测点在图上已用红色标出并标注偏差值，可拖动对应水位处的曲线节点进行局部调整。
              </div>
            )}
          </div>
        )}

        <div className="rounded bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-500">
          检验依据 SL/T 247-2020：符号检验 α=0.25；适线检验 α=0.05；偏离检验采用系统误差 ≤±1%、≥75% 测点相对偏离 ≤±5%（对应规范表 3.3.2-1 单一线定线精度指标）。节点调整后结果实时刷新。
        </div>
      </div>
    </ScrollArea>
  );
}
