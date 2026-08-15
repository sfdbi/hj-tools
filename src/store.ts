// 全局状态：测点 + 曲线 + 历史（撤销/重做）+ localStorage 持久化
import { useCallback, useEffect, useMemo, useReducer } from 'react';
import type { Curve, CurveNode, CurveType, DataPoint, PointStyle } from '@/types';
import { CURVE_TYPE_LABEL } from '@/types';

export interface AppState {
  points: DataPoint[];
  curves: Curve[];
  activeCurveId: string | null;
  drawMode: boolean;
  showPoints: boolean; // 是否显示实测点
  showNodes: boolean; // 是否显示控制节点
  showCurves: boolean; // 是否显示曲线
  showCurveLabels: boolean; // 是否显示线号标注
  pointStyle: PointStyle; // 实测点全局样式
}

const DEFAULT_POINT_STYLE: PointStyle = { shape: 'circle', size: 5.5, color: '#3b82f6' };

interface Snapshot {
  points: DataPoint[];
  curves: Curve[];
}

const STORAGE_KEY = 'zq-rating-curve-v1';
const HISTORY_LIMIT = 30;

/** 曲线默认黑色；备选色用于多条曲线对比 */
export const CURVE_COLORS = ['#000000', '#e11d48', '#7c3aed', '#0891b2', '#d97706', '#059669'];

type Action =
  | { type: 'commit'; points?: DataPoint[]; curves?: Curve[] }
  | { type: 'setActiveCurve'; id: string | null }
  | { type: 'setDrawMode'; on: boolean }
  | { type: 'setShow'; key: 'showPoints' | 'showNodes' | 'showCurves' | 'showCurveLabels'; on: boolean }
  | { type: 'setPointStyle'; style: PointStyle }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'replaceAll'; state: AppState };

interface FullState extends AppState {
  past: Snapshot[];
  future: Snapshot[];
}

function loadInitial(): AppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AppState;
    if (!Array.isArray(s.points) || !Array.isArray(s.curves)) return null;
    return {
      drawMode: false,
      activeCurveId: s.activeCurveId ?? null,
      points: s.points,
      curves: s.curves,
      showPoints: s.showPoints !== false,
      showNodes: s.showNodes !== false,
      showCurves: s.showCurves !== false,
      showCurveLabels: s.showCurveLabels !== false,
      pointStyle: s.pointStyle ?? DEFAULT_POINT_STYLE,
    };
  } catch {
    return null;
  }
}

function init(): FullState {
  const loaded = typeof window !== 'undefined' ? loadInitial() : null;
  return {
    points: loaded?.points ?? [],
    curves: loaded?.curves ?? [],
    activeCurveId: loaded?.activeCurveId ?? null,
    drawMode: false,
    showPoints: loaded?.showPoints ?? true,
    showNodes: loaded?.showNodes ?? true,
    showCurves: loaded?.showCurves ?? true,
    showCurveLabels: loaded?.showCurveLabels ?? true,
    pointStyle: loaded?.pointStyle ?? DEFAULT_POINT_STYLE,
    past: [],
    future: [],
  };
}

function reducer(state: FullState, action: Action): FullState {
  switch (action.type) {
    case 'commit': {
      const snap: Snapshot = { points: state.points, curves: state.curves };
      return {
        ...state,
        points: action.points ?? state.points,
        curves: action.curves ?? state.curves,
        past: [...state.past.slice(-HISTORY_LIMIT + 1), snap],
        future: [],
      };
    }
    case 'setActiveCurve':
      return { ...state, activeCurveId: action.id };
    case 'setDrawMode':
      return { ...state, drawMode: action.on };
    case 'setShow':
      return { ...state, [action.key]: action.on };
    case 'setPointStyle':
      return { ...state, pointStyle: action.style };
    case 'undo': {
      if (state.past.length === 0) return state;
      const prev = state.past[state.past.length - 1];
      return {
        ...state,
        points: prev.points,
        curves: prev.curves,
        past: state.past.slice(0, -1),
        future: [{ points: state.points, curves: state.curves }, ...state.future],
      };
    }
    case 'redo': {
      if (state.future.length === 0) return state;
      const [next, ...rest] = state.future;
      return {
        ...state,
        points: next.points,
        curves: next.curves,
        past: [...state.past, { points: state.points, curves: state.curves }],
        future: rest,
      };
    }
    case 'replaceAll':
      return { ...action.state, past: [], future: [] };
    default:
      return state;
  }
}

let nidSeq = 0;
const newId = () => `c${Date.now().toString(36)}_${nidSeq++}`;

export function useAppStore() {
  const [state, dispatch] = useReducer(reducer, undefined, init);

  // 自动保存
  useEffect(() => {
    const { points, curves, activeCurveId, showPoints, showNodes, showCurves, showCurveLabels, pointStyle } = state;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ points, curves, activeCurveId, showPoints, showNodes, showCurves, showCurveLabels, pointStyle })
      );
    } catch {
      /* 忽略存储异常 */
    }
  }, [state.points, state.curves, state.activeCurveId, state.showPoints, state.showNodes, state.showCurves, state.showCurveLabels, state.pointStyle]); // eslint-disable-line react-hooks/exhaustive-deps

  const api = useMemo(() => {
    const commit = (points?: DataPoint[], curves?: Curve[]) =>
      dispatch({ type: 'commit', points, curves });

    return {
      // ── 测点 ──
      setPoints: (points: DataPoint[]) => commit(points),
      addPoint: (p: DataPoint) => commit([...state.points, p]),
      updatePoint: (id: string, patch: Partial<DataPoint>) =>
        commit(state.points.map((p) => (p.id === id ? { ...p, ...patch } : p))),
      deletePoint: (id: string) => commit(state.points.filter((p) => p.id !== id)),

      // ── 曲线 ──
      addCurve: (type: CurveType): string => {
        const id = newId();
        const num = state.curves.length + 1;
        const curve: Curve = {
          id,
          name: String(num),
          type,
          nodes: [],
          color: '#000000', // 默认黑色，可在曲线列表中调整
          visible: true,
        };
        commit(undefined, [...state.curves, curve]);
        dispatch({ type: 'setActiveCurve', id });
        return id;
      },
      deleteCurve: (id: string) => {
        const curves = state.curves.filter((c) => c.id !== id);
        commit(undefined, curves);
        if (state.activeCurveId === id) {
          dispatch({ type: 'setActiveCurve', id: curves.length ? curves[curves.length - 1].id : null });
        }
      },
      setCurveNodes: (id: string, nodes: CurveNode[], fitLabel?: string) =>
        commit(
          undefined,
          state.curves.map((c) => (c.id === id ? { ...c, nodes, fitLabel: fitLabel ?? c.fitLabel } : c))
        ),
      addNode: (curveId: string, q: number, z: number) => {
        const curve = state.curves.find((c) => c.id === curveId);
        if (!curve) return;
        const node: CurveNode = { id: newId(), q: round3(q), z: round3(z) };
        let nodes: CurveNode[];
        if (curve.type === 'loop') {
          nodes = [...curve.nodes, node]; // 绳套：按添加顺序连线
        } else {
          nodes = [...curve.nodes, node].sort((a, b) => a.z - b.z); // 单一线/复合：按水位排序
        }
        commit(
          undefined,
          state.curves.map((c) => (c.id === curveId ? { ...c, nodes } : c))
        );
      },
      moveNode: (curveId: string, nodeId: string, q: number, z: number) => {
        const curve = state.curves.find((c) => c.id === curveId);
        if (!curve) return;
        let nodes = curve.nodes.map((n) => (n.id === nodeId ? { ...n, q: round3(q), z: round3(z) } : n));
        if (curve.type !== 'loop') nodes = [...nodes].sort((a, b) => a.z - b.z);
        commit(
          undefined,
          state.curves.map((c) => (c.id === curveId ? { ...c, nodes } : c))
        );
      },
      deleteNode: (curveId: string, nodeId: string) =>
        commit(
          undefined,
          state.curves.map((c) =>
            c.id === curveId ? { ...c, nodes: c.nodes.filter((n) => n.id !== nodeId) } : c
          )
        ),
      setActiveCurve: (id: string | null) => dispatch({ type: 'setActiveCurve', id }),
      setDrawMode: (on: boolean) => dispatch({ type: 'setDrawMode', on }),
      setShowPoints: (on: boolean) => dispatch({ type: 'setShow', key: 'showPoints', on }),
      setShowNodes: (on: boolean) => dispatch({ type: 'setShow', key: 'showNodes', on }),
      setShowCurves: (on: boolean) => dispatch({ type: 'setShow', key: 'showCurves', on }),
      setShowCurveLabels: (on: boolean) => dispatch({ type: 'setShow', key: 'showCurveLabels', on }),
      /** 载入项目文件（整体替换，经调用方校验） */
      loadProject: (s: Partial<AppState>) =>
        dispatch({
          type: 'replaceAll',
          state: {
            points: Array.isArray(s.points) ? s.points : [],
            curves: Array.isArray(s.curves) ? s.curves : [],
            activeCurveId: s.activeCurveId ?? null,
            drawMode: false,
            showPoints: s.showPoints !== false,
            showNodes: s.showNodes !== false,
            showCurves: s.showCurves !== false,
            showCurveLabels: s.showCurveLabels !== false,
            pointStyle: s.pointStyle ?? DEFAULT_POINT_STYLE,
          },
        }),
      setCurveColor: (id: string, color: string) =>
        commit(
          undefined,
          state.curves.map((c) => (c.id === id ? { ...c, color } : c))
        ),
      /** 通用曲线样式更新（线宽/线型/节点形状/节点大小/节点颜色/颜色等） */
      updateCurve: (id: string, patch: Partial<Curve>) =>
        commit(
          undefined,
          state.curves.map((c) => (c.id === id ? { ...c, ...patch } : c))
        ),
      setPointStyle: (patch: Partial<PointStyle>) =>
        dispatch({ type: 'setPointStyle', style: { ...state.pointStyle, ...patch } }),
      toggleCurveVisible: (id: string) =>
        commit(
          undefined,
          state.curves.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c))
        ),

      // ── 历史 ──
      undo: () => dispatch({ type: 'undo' }),
      redo: () => dispatch({ type: 'redo' }),
      resetAll: () =>
        dispatch({
          type: 'replaceAll',
          state: {
            points: [], curves: [], activeCurveId: null, drawMode: false,
            showPoints: true, showNodes: true, showCurves: true, showCurveLabels: true,
            pointStyle: DEFAULT_POINT_STYLE,
          },
        }),
    };
  }, [state]);

  const activeCurve = useMemo(
    () => state.curves.find((c) => c.id === state.activeCurveId) ?? null,
    [state.curves, state.activeCurveId]
  );

  const curveTypeLabel = useCallback((t: CurveType) => CURVE_TYPE_LABEL[t], []);

  return { state, api, activeCurve, curveTypeLabel };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
