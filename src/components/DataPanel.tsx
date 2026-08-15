// 数据面板：测点表格（增删改）+ CSV 导入导出 + 示例数据
import { useRef, useState } from 'react';
import type { DataPoint } from '@/types';
import { parseCSV, toCSV, downloadFile, samplePoints, pid } from '@/lib/csv';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

interface Props {
  points: DataPoint[];
  onSetPoints: (pts: DataPoint[]) => void;
  onAdd: (p: DataPoint) => void;
  onUpdate: (id: string, patch: Partial<DataPoint>) => void;
  onDelete: (id: string) => void;
}

export default function DataPanel({ points, onSetPoints, onAdd, onUpdate, onDelete }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<string>('');
  const [newZ, setNewZ] = useState('');
  const [newQ, setNewQ] = useState('');

  const importFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const { points: pts, errors } = parseCSV(String(reader.result ?? ''));
      if (pts.length === 0) {
        setMsg(`导入失败：${errors.join('；') || '无有效数据'}`);
        return;
      }
      onSetPoints([...points, ...pts]);
      setMsg(`已导入 ${pts.length} 个测点${errors.length ? `（${errors.length} 条警告）` : ''}`);
    };
    reader.readAsText(file, 'utf-8');
  };

  const addRow = () => {
    const z = parseFloat(newZ);
    const q = parseFloat(newQ);
    if (isNaN(z) || isNaN(q)) {
      setMsg('请输入有效的水位与流量数值');
      return;
    }
    onAdd({ id: pid(), z, q });
    setNewZ('');
    setNewQ('');
    setMsg('');
  };

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex flex-wrap gap-1.5">
        <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}>
          导入 CSV
        </Button>
        <Button size="sm" variant="outline" onClick={() => downloadFile('水位流量数据.csv', toCSV(points))} disabled={points.length === 0}>
          导出 CSV
        </Button>
        <Button size="sm" variant="outline" onClick={() => onSetPoints(samplePoints())}>
          载入示例
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-red-600"
          onClick={() => onSetPoints([])}
          disabled={points.length === 0}
        >
          清空
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.txt,.tsv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) importFile(f);
            e.target.value = '';
          }}
        />
      </div>

      {msg && <div className="rounded bg-sky-50 px-2 py-1 text-xs text-sky-700">{msg}</div>}
      {points.length > 0 && points.length < 10 && (
        <div className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-700">
          当前仅 {points.length} 个测点，不足 10 个，不建议定线（SL/T 247-2020）
        </div>
      )}

      {/* 手动录入 */}
      <div className="flex items-center gap-1.5">
        <Input
          placeholder="水位 Z (m)"
          value={newZ}
          onChange={(e) => setNewZ(e.target.value)}
          className="h-8 text-xs"
          type="number"
          step="0.01"
        />
        <Input
          placeholder="流量 Q (m³/s)"
          value={newQ}
          onChange={(e) => setNewQ(e.target.value)}
          className="h-8 text-xs"
          type="number"
          step="0.1"
        />
        <Button size="sm" className="h-8 shrink-0" onClick={addRow}>
          添加
        </Button>
      </div>

      {/* 数据表格 */}
      <ScrollArea className="min-h-0 flex-1 rounded border">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-100 text-slate-600">
            <tr>
              <th className="px-2 py-1.5 text-left font-medium">#</th>
              <th className="px-2 py-1.5 text-left font-medium">时间</th>
              <th className="px-2 py-1.5 text-left font-medium">水位 Z (m)</th>
              <th className="px-2 py-1.5 text-left font-medium">流量 Q (m³/s)</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {points.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-8 text-center text-slate-400">
                  暂无数据。可导入 CSV、载入示例或手动录入。
                  <br />
                  CSV 需含"水位""流量"两列（或无表头前两列）。
                </td>
              </tr>
            )}
            {points.map((p, i) => (
              <tr key={p.id} className="border-t hover:bg-slate-50">
                <td className="px-2 py-1 text-slate-400">{i + 1}</td>
                <td className="px-2 py-1">
                  <input
                    className="w-20 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-slate-300 focus:border-sky-400 focus:outline-none"
                    value={p.time ?? ''}
                    placeholder="—"
                    onChange={(e) => onUpdate(p.id, { time: e.target.value })}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    className="w-20 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-slate-300 focus:border-sky-400 focus:outline-none"
                    type="number"
                    step="0.01"
                    value={p.z}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) onUpdate(p.id, { z: v });
                    }}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    className="w-20 rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-sky-300 hover:border-slate-300 focus:border-sky-400 focus:outline-none"
                    type="number"
                    step="0.1"
                    value={p.q}
                    onChange={(e) => {
                      const v = parseFloat(e.target.value);
                      if (!isNaN(v)) onUpdate(p.id, { q: v });
                    }}
                  />
                </td>
                <td className="px-2 py-1 text-right">
                  <button
                    className="rounded px-1.5 py-0.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    onClick={() => onDelete(p.id)}
                    title="删除该行"
                  >
                    ✕
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollArea>
      <div className="text-right text-[11px] text-slate-400">共 {points.length} 个测点</div>
    </div>
  );
}
