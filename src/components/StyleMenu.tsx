// 右键样式菜单：更改测点/节点/曲线的形状、颜色、大小、线型、粗细
import { useEffect } from 'react';
import type { Curve, LineDash, MarkerShape, PointStyle } from '@/types';
import { LINE_DASH_LABEL, MARKER_SHAPE_LABEL, CURVE_TYPE_LABEL } from '@/types';

export type MenuTarget =
  | { kind: 'point'; id: string }
  | { kind: 'node'; id: string; curve: Curve }
  | { kind: 'curve'; id: string; curve: Curve };

interface Props {
  target: MenuTarget;
  x: number;
  y: number;
  pointStyle: PointStyle;
  onPointStyle: (patch: Partial<PointStyle>) => void;
  onUpdateCurve: (id: string, patch: Partial<Curve>) => void;
  onDeletePoint: (id: string) => void;
  onDeleteNode: (curveId: string, nodeId: string) => void;
  onDeleteCurve: (id: string) => void;
  onClose: () => void;
}

const SHAPES: MarkerShape[] = ['circle', 'square', 'triangle', 'diamond', 'cross'];
const SHAPE_ICON: Record<MarkerShape, string> = {
  circle: '●', square: '■', triangle: '▲', diamond: '◆', cross: '✚',
};
const DASHES: LineDash[] = ['solid', 'dash', 'dot', 'dashdot'];
const DASH_ICON: Record<LineDash, string> = {
  solid: '———', dash: '─ ─ ─', dot: '·······', dashdot: '─·─·─',
};
const SIZES = [2.5, 3.2, 4, 5.5, 7, 9];
const WIDTHS = [1, 1.5, 2, 2.5, 3, 4];
const COLORS = ['#000000', '#1e293b', '#3b82f6', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2'];

export default function StyleMenu(props: Props) {
  const { target, x, y, pointStyle, onClose } = props;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const curve: Curve | null = target.kind !== 'point' ? target.curve : null;

  const shapeRow = (
    label: string,
    current: MarkerShape,
    onPick: (s: MarkerShape) => void
  ) => (
    <div className="flex items-center gap-1 px-3 py-1.5">
      <span className="w-12 text-[11px] text-slate-500">{label}</span>
      {SHAPES.map((s) => (
        <button
          key={s}
          title={MARKER_SHAPE_LABEL[s]}
          onClick={() => onPick(s)}
          className={`h-6 w-6 rounded text-sm leading-6 ${
            current === s ? 'bg-sky-100 text-sky-700 ring-1 ring-sky-400' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {SHAPE_ICON[s]}
        </button>
      ))}
    </div>
  );

  const sizeRow = (label: string, current: number, onPick: (v: number) => void, options: number[]) => (
    <div className="flex items-center gap-1 px-3 py-1.5">
      <span className="w-12 text-[11px] text-slate-500">{label}</span>
      {options.map((v) => (
        <button
          key={v}
          onClick={() => onPick(v)}
          className={`rounded px-1.5 py-0.5 text-[11px] ${
            Math.abs(current - v) < 0.01 ? 'bg-sky-100 text-sky-700 ring-1 ring-sky-400' : 'text-slate-600 hover:bg-slate-100'
          }`}
        >
          {v}
        </button>
      ))}
    </div>
  );

  const colorRow = (label: string, current: string, onPick: (c: string) => void) => (
    <div className="flex items-center gap-1 px-3 py-1.5">
      <span className="w-12 text-[11px] text-slate-500">{label}</span>
      <div className="flex flex-wrap items-center gap-1">
        {COLORS.map((c) => (
          <button
            key={c}
            title={c}
            onClick={() => onPick(c)}
            className={`h-[18px] w-[18px] rounded-sm border ${
              current.toLowerCase() === c.toLowerCase() ? 'border-sky-500 ring-1 ring-sky-400' : 'border-slate-300'
            }`}
            style={{ background: c }}
          />
        ))}
        <input
          type="color"
          value={current}
          onChange={(e) => onPick(e.target.value)}
          className="h-5 w-7 cursor-pointer rounded border border-slate-300 bg-white p-0"
        />
      </div>
    </div>
  );

  const dangerBtn = (label: string, onClick: () => void) => (
    <button
      onClick={() => {
        onClick();
        onClose();
      }}
      className="mx-3 my-1.5 rounded border border-red-200 bg-red-50 px-2 py-1 text-left text-[11px] text-red-600 hover:bg-red-100"
    >
      {label}
    </button>
  );

  return (
    <div
      className="absolute z-20 w-[248px] rounded-lg border border-slate-200 bg-white py-1 shadow-xl"
      style={{ left: x, top: y }}
      onPointerDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="border-b border-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700">
        {target.kind === 'point' && '实测点样式（全局）'}
        {target.kind === 'node' && `节点样式（${curve?.name} 号线）`}
        {target.kind === 'curve' && `曲线样式（${curve?.name} 号线 · ${curve ? CURVE_TYPE_LABEL[curve.type] : ''}）`}
      </div>

      {target.kind === 'point' && (
        <>
          {shapeRow('形状', pointStyle.shape, (s) => props.onPointStyle({ shape: s }))}
          {sizeRow('大小', pointStyle.size, (v) => props.onPointStyle({ size: v }), SIZES)}
          {colorRow('填充色', pointStyle.color, (c) => props.onPointStyle({ color: c }))}
          {dangerBtn('删除该测点', () => props.onDeletePoint(target.id))}
        </>
      )}

      {target.kind === 'node' && curve && (
        <>
          {shapeRow('形状', curve.nodeShape ?? 'circle', (s) => props.onUpdateCurve(curve.id, { nodeShape: s }))}
          {sizeRow('大小', curve.nodeSize ?? 3.2, (v) => props.onUpdateCurve(curve.id, { nodeSize: v }), SIZES)}
          {colorRow('填充色', curve.nodeColor ?? '#1e293b', (c) => props.onUpdateCurve(curve.id, { nodeColor: c }))}
          {dangerBtn('删除该节点', () => props.onDeleteNode(curve.id, target.id))}
        </>
      )}

      {target.kind === 'curve' && curve && (
        <>
          {colorRow('颜色', curve.color, (c) => props.onUpdateCurve(curve.id, { color: c }))}
          <div className="flex items-center gap-1 px-3 py-1.5">
            <span className="w-12 text-[11px] text-slate-500">线型</span>
            {DASHES.map((d) => (
              <button
                key={d}
                title={LINE_DASH_LABEL[d]}
                onClick={() => props.onUpdateCurve(curve.id, { lineDash: d })}
                className={`rounded px-1 py-0.5 text-[11px] ${
                  (curve.lineDash ?? 'solid') === d
                    ? 'bg-sky-100 text-sky-700 ring-1 ring-sky-400'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                {DASH_ICON[d]}
              </button>
            ))}
          </div>
          {sizeRow('粗细', curve.lineWidth ?? 2, (v) => props.onUpdateCurve(curve.id, { lineWidth: v }), WIDTHS)}
          <div className="mx-3 my-1 flex gap-1.5">
            <button
              onClick={() => {
                props.onUpdateCurve(curve.id, { visible: !curve.visible });
                onClose();
              }}
              className="flex-1 rounded border border-slate-200 px-2 py-1 text-left text-[11px] text-slate-600 hover:bg-slate-50"
            >
              {curve.visible ? '隐藏该曲线' : '显示该曲线'}
            </button>
            <button
              onClick={() => {
                props.onUpdateCurve(curve.id, { labelVisible: curve.labelVisible === false });
                onClose();
              }}
              className="flex-1 rounded border border-slate-200 px-2 py-1 text-left text-[11px] text-slate-600 hover:bg-slate-50"
            >
              {curve.labelVisible === false ? '显示线号' : '隐藏线号'}
            </button>
          </div>
          {dangerBtn('删除该曲线', () => props.onDeleteCurve(curve.id))}
        </>
      )}
    </div>
  );
}
