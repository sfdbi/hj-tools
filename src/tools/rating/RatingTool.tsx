// 水位流量关系定线系统 — 主界面
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAppStore } from '@/store';
import type { CurveType } from '@/types';
import { monotoneCubic, catmullRom, qAtZ } from '@/lib/spline';
import { computeDeviations, signTest, runTest, deviationTest, type TestResult } from '@/lib/tests';
import { fitCurve, type FitOptions } from '@/lib/fitting';
import { findBackbend } from '@/lib/draw';
import PlotCanvas from '@/components/PlotCanvas';
import DataPanel from '@/components/DataPanel';
import TestPanel from '@/components/TestPanel';
import CurvePanel from '@/components/CurvePanel';
import { Button } from '@/components/ui/button';

type TabKey = 'data' | 'curve' | 'test';

export default function RatingTool() {
  const { state, api, activeCurve } = useAppStore();
  const [tab, setTab] = useState<TabKey>('data');
  const [resetSignal, setResetSignal] = useState(0);
  const [probeMode, setProbeMode] = useState(false); // 查读探针开关（与绘线互斥）
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // ── 三性检验（实时）──
  const { deviations, devList, testResults, deviationFail } = useMemo(() => {
    if (!activeCurve || activeCurve.nodes.length < 2) {
      return { deviations: new Map(), devList: [], testResults: [] as TestResult[], deviationFail: false };
    }
    const nodes =
      activeCurve.type === 'loop' ? activeCurve.nodes : [...activeCurve.nodes].sort((a, b) => a.z - b.z);
    const samples = activeCurve.type === 'loop' ? catmullRom(nodes) : monotoneCubic(nodes);
    const devs = computeDeviations(state.points, (z) => qAtZ(samples, z));
    const map = new Map(devs.map((d) => [d.id, d]));
    const results = [signTest(devs), runTest(devs), deviationTest(devs)] as TestResult[];
    const dt = results[2];
    return {
      deviations: map,
      devList: devs,
      testResults: results,
      deviationFail: dt.applicable && !dt.pass,
    };
  }, [activeCurve, state.points]);

  // ── 快捷键：Ctrl+Z / Ctrl+Y / Esc ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        api.undo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        api.redo();
      } else if (e.key === 'Escape') {
        if (state.drawMode) api.setDrawMode(false);
        if (probeMode) setProbeMode(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [api, state.drawMode, probeMode]);

  const handleFit = (curveId: string, opts: FitOptions) => {
    const result = fitCurve(state.points, opts);
    if (result) {
      api.setCurveNodes(curveId, result.nodes, result.label);
      // 拟合生成的曲线可能超出当前视口（高水/低水延长），自动重新适配
      setResetSignal((s) => s + 1);
    }
  };

  // 批量设置数据（导入/示例/清空）后自动按新数据量级重适配刻度
  const handleSetPoints = (pts: typeof state.points) => {
    api.setPoints(pts);
    setResetSignal((s) => s + 1);
  };

  const exportPNG = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = '水位流量关系曲线.png';
    a.click();
  };

  // ── 项目文件保存 / 打开 ──
  const projectFileRef = useRef<HTMLInputElement>(null);
  const [projectMsg, setProjectMsg] = useState('');

  const saveProject = () => {
    const data = {
      app: 'zq-rating-curve',
      version: 1,
      savedAt: new Date().toISOString(),
      points: state.points,
      curves: state.curves,
      activeCurveId: state.activeCurveId,
      pointStyle: state.pointStyle,
      showPoints: state.showPoints,
      showNodes: state.showNodes,
      showCurves: state.showCurves,
      showCurveLabels: state.showCurveLabels,
    };
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `定线项目_${new Date().toISOString().slice(0, 10)}.zqp.json`;
    a.click();
    URL.revokeObjectURL(url);
    setProjectMsg('项目已保存到本地文件');
    setTimeout(() => setProjectMsg(''), 3000);
  };

  const openProject = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result ?? ''));
        if (!Array.isArray(data.points) || !Array.isArray(data.curves)) {
          setProjectMsg('文件格式不正确：缺少测点或曲线数据');
          return;
        }
        api.loadProject(data);
        setResetSignal((s) => s + 1);
        setProjectMsg(`已打开项目：${data.points.length} 个测点，${data.curves.length} 条曲线，可继续编辑`);
        setTimeout(() => setProjectMsg(''), 4000);
      } catch {
        setProjectMsg('文件解析失败：不是有效的项目文件');
      }
    };
    reader.readAsText(file, 'utf-8');
  };

  // 高水延长检查
  const extensionWarning = useMemo(() => {
    if (!activeCurve || state.points.length < 2 || activeCurve.nodes.length === 0) return null;
    const zs = state.points.map((p) => p.z);
    const zMax = Math.max(...zs);
    const zMin = Math.min(...zs);
    const range = zMax - zMin;
    if (range <= 0) return null;
    const curveZMax = Math.max(...activeCurve.nodes.map((n) => n.z));
    const ext = (curveZMax - zMax) / range;
    if (ext > 0.3) {
      return `高水延长达水位变幅的 ${(ext * 100).toFixed(1)}%，超过规范 30% 上限，请压低上端节点`;
    }
    return null;
  }, [activeCurve, state.points]);

  // 反曲检测：单一线/复合曲线的 Q 应随 Z 单调不减
  const backbendIds = useMemo(() => {
    if (!activeCurve || activeCurve.type === 'loop') return new Set<string>();
    return findBackbend(activeCurve.nodes);
  }, [activeCurve]);

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'data', label: '数据' },
    { key: 'curve', label: '曲线' },
    { key: 'test', label: '三性检验' },
  ];

  return (
    <div className="flex h-screen w-screen flex-col bg-slate-100 text-slate-800">
      {/* 工具栏 */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-white px-4 shadow-sm">
        <div className="mr-2 flex items-center gap-2">
          <Link
            to="/"
            className="rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700"
            title="返回工具集首页"
          >
            ← 工具集
          </Link>
          <span className="text-base font-bold text-sky-700">水位流量关系定线系统</span>
          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">SL/T 247-2020</span>
        </div>
        <Button size="sm" variant="outline" className="h-8" onClick={() => projectFileRef.current?.click()} title="打开项目文件（.zqp.json），接着上次继续编辑">
          📂 打开项目
        </Button>
        <Button size="sm" variant="outline" className="h-8" onClick={saveProject} title="保存全部数据、曲线与样式为项目文件">
          💾 保存项目
        </Button>
        <input
          ref={projectFileRef}
          type="file"
          accept=".json,.zqp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) openProject(f);
            e.target.value = '';
          }}
        />
        <div className="mx-1 h-5 w-px bg-slate-200" />
        <Button size="sm" variant="outline" className="h-8" onClick={api.undo} title="Ctrl+Z">
          ↩ 撤销
        </Button>
        <Button size="sm" variant="outline" className="h-8" onClick={api.redo} title="Ctrl+Y">
          ↪ 重做
        </Button>
        <div className="mx-1 h-5 w-px bg-slate-200" />
        <Button
          size="sm"
          variant={state.drawMode ? 'default' : 'outline'}
          className="h-8"
          onClick={() => {
            if (!state.drawMode) setProbeMode(false); // 绘线与查读互斥
            api.setDrawMode(!state.drawMode);
          }}
          disabled={!activeCurve}
          title={activeCurve ? '单击绘图区连续添加节点' : '请先在"曲线"页新建曲线'}
        >
          ✏️ 绘线
        </Button>
        <Button
          size="sm"
          variant={probeMode ? 'default' : 'outline'}
          className="h-8"
          onClick={() => {
            const next = !probeMode;
            setProbeMode(next);
            if (next) api.setDrawMode(false); // 查读与绘线互斥
          }}
          title="查读模式：移动实时发光显示水位/流量；点击关系线出现发光标记，可在标记处添加节点（Enter）；Esc 退出"
        >
          🔍 查读
        </Button>
        <Button size="sm" variant="outline" className="h-8" onClick={() => setResetSignal((s) => s + 1)}>
          ⛶ 重置视图
        </Button>
        <Button size="sm" variant="outline" className="h-8" onClick={exportPNG}>
          🖼 导出 PNG
        </Button>
        <div className="mx-1 h-5 w-px bg-slate-200" />
        {/* 元素显隐开关 */}
        {(
          [
            ['测点', state.showPoints, api.setShowPoints],
            ['节点', state.showNodes, api.setShowNodes],
            ['曲线', state.showCurves, api.setShowCurves],
            ['线号', state.showCurveLabels, api.setShowCurveLabels],
          ] as const
        ).map(([label, on, setter]) => (
          <button
            key={label}
            onClick={() => setter(!on)}
            title={`${on ? '隐藏' : '显示'}${label}`}
            className={`flex h-8 items-center gap-1 rounded-md border px-2 text-xs ${
              on
                ? 'border-sky-300 bg-sky-50 text-sky-700'
                : 'border-slate-200 bg-white text-slate-400'
            }`}
          >
            <span className={`inline-block h-2 w-2 rounded-full ${on ? 'bg-sky-500' : 'bg-slate-300'}`} />
            {label}
          </button>
        ))}
        <span className="flex-1" />
        {activeCurve && (
          <span className="text-xs text-slate-500">
            当前曲线：<b style={{ color: activeCurve.color }}>{activeCurve.name} 号线</b>
            {activeCurve.fitLabel ? `（${activeCurve.fitLabel}）` : ''}
          </span>
        )}
        <span className="text-xs text-slate-400">测点 {state.points.length} · 曲线 {state.curves.length}</span>
      </header>

      {extensionWarning && (
        <div className="shrink-0 bg-red-50 px-4 py-1.5 text-xs text-red-700">⚠ {extensionWarning}</div>
      )}
      {backbendIds.size > 0 && (
        <div className="flex shrink-0 items-center gap-2 bg-orange-50 px-4 py-1.5 text-xs text-orange-700">
          <span>
            ⚠ 检测到反曲：{backbendIds.size} 个节点处流量随水位不增（橙色标记），单一水位流量关系线应避免反曲
          </span>
          <button
            onClick={() => activeCurve && api.fixMonotonic(activeCurve.id)}
            className="rounded border border-orange-300 bg-white px-2 py-0.5 text-orange-700 hover:bg-orange-100"
          >
            一键单调修复
          </button>
        </div>
      )}
      {projectMsg && (
        <div className="shrink-0 bg-sky-50 px-4 py-1.5 text-xs text-sky-700">{projectMsg}</div>
      )}

      {/* 主区域：左绘图 70% / 右面板 30% */}
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-[7] p-2">
          <div className="h-full w-full overflow-hidden rounded-lg border bg-white shadow-sm">
            <PlotCanvas
              points={state.points}
              curves={state.curves}
              activeCurveId={state.activeCurveId}
              drawMode={state.drawMode}
              deviations={deviations}
              resetSignal={resetSignal}
              canvasRef={canvasRef}
              showPoints={state.showPoints}
              showNodes={state.showNodes}
              showCurves={state.showCurves}
              showCurveLabels={state.showCurveLabels}
              deviationFail={deviationFail}
              pointStyle={state.pointStyle}
              backbendIds={backbendIds}
              probeMode={probeMode}
              onProbeAddNode={(cid, q, z) => {
                api.addNode(cid, q, z);
                api.setActiveCurve(cid);
              }}
              onPointStyle={api.setPointStyle}
              onUpdateCurve={api.updateCurve}
              onDeletePoint={api.deletePoint}
              onDeleteCurve={api.deleteCurve}
              onExitDraw={() => api.setDrawMode(false)}
              onAddNode={(q, z) => state.activeCurveId && api.addNode(state.activeCurveId, q, z)}
              onStroke={(pts) => state.activeCurveId && api.addStroke(state.activeCurveId, pts)}
              onMoveNode={(nodeId, q, z) => state.activeCurveId && api.moveNode(state.activeCurveId, nodeId, q, z)}
              onDeleteNode={(nodeId) => state.activeCurveId && api.deleteNode(state.activeCurveId, nodeId)}
            />
          </div>
        </main>

        <aside className="flex w-[30%] min-w-[360px] flex-col p-2 pl-0">
          <div className="flex shrink-0 gap-1 rounded-t-lg border border-b-0 bg-white px-2 pt-2">
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`rounded-t px-3 py-1.5 text-sm ${
                  tab === t.key
                    ? 'border-b-2 border-sky-600 font-medium text-sky-700'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 rounded-b-lg border bg-white shadow-sm">
            {tab === 'data' && (
              <DataPanel
                points={state.points}
                onSetPoints={handleSetPoints}
                onAdd={api.addPoint}
                onUpdate={api.updatePoint}
                onDelete={api.deletePoint}
              />
            )}
            {tab === 'curve' && (
              <CurvePanel
                points={state.points}
                curves={state.curves}
                activeCurveId={state.activeCurveId}
                onAddCurve={(t: CurveType) => api.addCurve(t)}
                onDeleteCurve={api.deleteCurve}
                onSelectCurve={api.setActiveCurve}
                onFit={handleFit}
                onToggleVisible={api.toggleCurveVisible}
                onSetColor={api.setCurveColor}
              />
            )}
            {tab === 'test' && (
              <TestPanel results={testResults} deviations={devList} hasCurve={!!activeCurve && activeCurve.nodes.length >= 2} pointCount={state.points.length} />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
