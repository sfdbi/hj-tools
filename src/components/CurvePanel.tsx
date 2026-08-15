// 曲线管理面板：曲线列表 + 新建（单一线/绳套/复合）+ 自动拟合
import type { Curve, CurveType, DataPoint } from '@/types';
import { CURVE_TYPE_LABEL } from '@/types';
import type { FitOptions } from '@/lib/fitting';
import { downloadFile } from '@/lib/csv';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useState } from 'react';

interface Props {
  points: DataPoint[];
  curves: Curve[];
  activeCurveId: string | null;
  onAddCurve: (type: CurveType) => void;
  onDeleteCurve: (id: string) => void;
  onSelectCurve: (id: string) => void;
  onFit: (curveId: string, opts: FitOptions) => void;
  onToggleVisible: (id: string) => void;
  onSetColor: (id: string, color: string) => void;
}

/** 常用曲线颜色（默认黑色） */
const PRESET_COLORS = ['#000000', '#e11d48', '#7c3aed', '#0891b2', '#d97706', '#059669'];

export default function CurvePanel(props: Props) {
  const { points, curves, activeCurveId } = props;
  const [newType, setNewType] = useState<CurveType>('single');
  const [fitMsg, setFitMsg] = useState('');

  const doFit = (opts: FitOptions) => {
    if (!activeCurveId) {
      setFitMsg('请先新建或选择一条曲线');
      return;
    }
    if (points.length < 3) {
      setFitMsg('测点不足（至少需要 3 个点）');
      return;
    }
    props.onFit(activeCurveId, opts);
    setFitMsg('');
  };

  const canFit = !!activeCurveId && points.length >= 3;

  /** 导出全部曲线节点为 CSV（绳套按添加顺序，其余按水位升序） */
  const exportNodes = () => {
    const rows: string[] = ['曲线线号,曲线类型,节点序号,水位Z(m),流量Q(m³/s)'];
    for (const c of curves) {
      const nodes = c.type === 'loop' ? c.nodes : [...c.nodes].sort((a, b) => a.z - b.z);
      nodes.forEach((n, i) => {
        rows.push(`${c.name},${CURVE_TYPE_LABEL[c.type]},${i + 1},${n.z.toFixed(3)},${n.q.toFixed(3)}`);
      });
    }
    downloadFile('曲线节点数据.csv', rows.join('\r\n'));
  };
  const totalNodes = curves.reduce((s, c) => s + c.nodes.length, 0);

  return (
    <ScrollArea className="h-full">
      <div className="flex flex-col gap-3 p-3">
        {/* 新建曲线 */}
        <div className="rounded-lg border p-3">
          <div className="mb-2 text-sm font-semibold text-slate-700">新建曲线</div>
          <div className="flex gap-1.5">
            {(['single', 'loop', 'composite'] as CurveType[]).map((t) => (
              <button
                key={t}
                onClick={() => setNewType(t)}
                className={`flex-1 rounded border px-2 py-1.5 text-xs ${
                  newType === t
                    ? 'border-sky-500 bg-sky-50 font-medium text-sky-700'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {CURVE_TYPE_LABEL[t]}
              </button>
            ))}
          </div>
          <Button className="mt-2 w-full" size="sm" onClick={() => props.onAddCurve(newType)}>
            + 新建{CURVE_TYPE_LABEL[newType]}
          </Button>
          <div className="mt-1.5 text-[11px] leading-4 text-slate-400">
            {newType === 'single' && '单一线：Q 为 Z 的单值函数，节点按水位自动排序，使用单调样条平滑。'}
            {newType === 'loop' && '绳套曲线：洪水涨落段分离，节点按添加顺序连线（双击/绘制模式依次加点），参数样条平滑。'}
            {newType === 'composite' && '复合曲线：多条单一线分段衔接，可分别建立后同时显示对比。'}
          </div>
        </div>

        {/* 自动拟合 */}
        <div className="rounded-lg border p-3">
          <div className="mb-2 text-sm font-semibold text-slate-700">一键定线（自动拟合）</div>
          <div className="grid grid-cols-2 gap-1.5">
            <Button size="sm" variant="outline" disabled={!canFit} onClick={() => doFit({ method: 'smart' })}>
              智能拟合
            </Button>
            <Button size="sm" variant="outline" disabled={!canFit} onClick={() => doFit({ method: 'poly2' })}>
              二次多项式
            </Button>
            <Button size="sm" variant="outline" disabled={!canFit} onClick={() => doFit({ method: 'poly3' })}>
              三次多项式
            </Button>
            <Button size="sm" variant="outline" disabled={!canFit} onClick={() => doFit({ method: 'log' })}>
              半对数拟合
            </Button>
          </div>
          {fitMsg && <div className="mt-2 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">{fitMsg}</div>}
          <div className="mt-1.5 text-[11px] leading-4 text-slate-400">
            拟合生成可编辑节点（低水延长 5%、高水延长 10%），随后可在图上拖拽微调，检验结果实时更新。
          </div>
        </div>

        {/* 曲线列表 */}
        <div className="rounded-lg border p-3">
          <div className="mb-2 flex items-center justify-between">
            <div className="text-sm font-semibold text-slate-700">曲线列表（{curves.length}）</div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs"
              disabled={totalNodes === 0}
              onClick={exportNodes}
              title="导出全部曲线的节点数据为 CSV（含线号、类型、序号、水位、流量）"
            >
              ⬇ 导出节点
            </Button>
          </div>
          {curves.length === 0 && (
            <div className="py-3 text-center text-xs text-slate-400">暂无曲线</div>
          )}
          <div className="flex flex-col gap-1.5">
            {curves.map((c) => (
              <div
                key={c.id}
                onClick={() => props.onSelectCurve(c.id)}
                className={`cursor-pointer rounded border px-2.5 py-2 text-xs ${
                  c.id === activeCurveId ? 'border-sky-500 bg-sky-50' : 'border-slate-200 hover:bg-slate-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span className="inline-block h-3 w-3 shrink-0 rounded-sm border border-slate-300" style={{ background: c.color }} />
                  <span className="font-medium text-slate-700">{c.name} 号线</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                    {CURVE_TYPE_LABEL[c.type]}
                  </span>
                  <span className="text-slate-400">{c.nodes.length} 节点</span>
                  <span className="flex-1" />
                  <button
                    className="rounded px-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    title={c.visible ? '隐藏该曲线' : '显示该曲线'}
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onToggleVisible(c.id);
                    }}
                  >
                    {c.visible ? '👁' : '—'}
                  </button>
                  <button
                    className="rounded px-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    title="删除曲线"
                    onClick={(e) => {
                      e.stopPropagation();
                      props.onDeleteCurve(c.id);
                    }}
                  >
                    ✕
                  </button>
                </div>
                {/* 颜色调节 */}
                <div
                  className="mt-1.5 flex items-center gap-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <span className="text-[10px] text-slate-400">颜色</span>
                  {PRESET_COLORS.map((color) => (
                    <button
                      key={color}
                      title={color}
                      onClick={() => props.onSetColor(c.id, color)}
                      className={`h-4 w-4 rounded-sm border ${
                        c.color.toLowerCase() === color.toLowerCase()
                          ? 'border-sky-500 ring-1 ring-sky-400'
                          : 'border-slate-300'
                      }`}
                      style={{ background: color }}
                    />
                  ))}
                  <input
                    type="color"
                    value={c.color}
                    onChange={(e) => props.onSetColor(c.id, e.target.value)}
                    className="h-5 w-7 cursor-pointer rounded border border-slate-300 bg-white p-0"
                    title="自定义颜色"
                  />
                </div>
              </div>
            ))}
          </div>
          {activeCurveId && (
            <div className="mt-2 text-[11px] leading-4 text-slate-400">
              {curves.find((c) => c.id === activeCurveId)?.fitLabel
                ? `当前曲线：${curves.find((c) => c.id === activeCurveId)?.fitLabel}`
                : '当前曲线为人工绘制'}
            </div>
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
