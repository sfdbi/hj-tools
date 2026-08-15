// CSV 导入导出 + 示例数据
import type { DataPoint } from '@/types';

let seq = 0;
export function pid(): string {
  return `p${Date.now().toString(36)}_${seq++}`;
}

/** 解析 CSV/TSV 文本，自动识别水位/流量列 */
export function parseCSV(text: string): { points: DataPoint[]; errors: string[] } {
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { points: [], errors: ['文件为空'] };
  const delim = lines[0].includes('\t') ? '\t' : lines[0].includes(';') ? ';' : ',';
  const rows = lines.map((l) => l.split(delim).map((c) => c.trim()));

  // 找表头
  const header = rows[0].map((h) => h.toLowerCase());
  let zCol = header.findIndex((h) => /水位|^z$|level|stage/.test(h));
  let qCol = header.findIndex((h) => /流量|^q$|discharge/.test(h));
  let timeCol = header.findIndex((h) => /时间|日期|time|date/.test(h));
  let startRow = 1;
  if (zCol === -1 || qCol === -1) {
    // 无表头：假定前两列依次为水位、流量
    zCol = 0;
    qCol = 1;
    timeCol = -1;
    startRow = 0;
    if (!rows[0].every((c, i) => i > 1 || !isNaN(parseFloat(c)))) {
      errors.push('未能识别水位/流量列，已按第 1 列=水位、第 2 列=流量处理');
    }
  }

  const points: DataPoint[] = [];
  for (let i = startRow; i < rows.length; i++) {
    const r = rows[i];
    const z = parseFloat(r[zCol]);
    const q = parseFloat(r[qCol]);
    if (isNaN(z) || isNaN(q)) {
      errors.push(`第 ${i + 1} 行数据无效，已跳过`);
      continue;
    }
    points.push({ id: pid(), z, q, time: timeCol >= 0 ? r[timeCol] : undefined });
  }
  return { points, errors };
}

/** 导出 CSV 文本 */
export function toCSV(points: DataPoint[]): string {
  const header = '序号,时间,水位(m),流量(m³/s)';
  const lines = points.map(
    (p, i) => `${i + 1},${p.time ?? ''},${p.z},${p.q}`
  );
  return [header, ...lines].join('\r\n');
}

/** 触发浏览器下载 */
export function downloadFile(name: string, content: string, mime = 'text/csv'): void {
  const blob = new Blob(['﻿' + content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** 内置示例数据：某站 2024 年实测水位流量（Q ≈ 0.9·(Z−7.6)^2.6 加噪声） */
export function samplePoints(): DataPoint[] {
  seq = 1000; // 保证示例数据 id 稳定
  const raw: [number, number][] = [
    [8.21, 2.6], [8.35, 3.9], [8.52, 5.8], [8.68, 7.9], [8.85, 10.8],
    [9.02, 14.1], [9.18, 17.6], [9.35, 22.4], [9.55, 28.9], [9.76, 36.2],
    [9.98, 45.5], [10.22, 57.8], [10.45, 71.2], [10.68, 86.5], [10.92, 105.8],
    [11.15, 127.4], [11.42, 155.6], [11.68, 187.2], [11.95, 224.5], [12.24, 270.8],
    [12.52, 322.4], [12.83, 385.2], [13.15, 458.6], [13.48, 542.5], [13.82, 641.8],
    [14.15, 748.2],
  ];
  // 确定性扰动（±4% 以内），模拟实测偏离
  const noise = [0.02, -0.03, 0.01, 0.04, -0.02, 0.03, -0.01, 0.035, -0.025, 0.01,
    -0.04, 0.02, 0.03, -0.015, 0.025, -0.035, 0.015, -0.02, 0.04, -0.01,
    0.02, -0.03, 0.015, 0.035, -0.02, 0.01];
  const months = ['03-12', '04-02', '04-25', '05-14', '06-03', '06-22', '07-05', '07-18', '07-30', '08-08',
    '08-16', '08-25', '09-02', '09-11', '09-20', '09-28', '10-06', '10-15', '05-28', '06-15',
    '07-09', '07-26', '08-12', '08-29', '09-14', '10-02'];
  return raw.map(([z, q], i) => ({
    id: pid(),
    z,
    q: Math.round(q * (1 + noise[i % noise.length]) * 10) / 10,
    time: `2024-${months[i % months.length]}`,
    group: '2024 年',
  }));
}
