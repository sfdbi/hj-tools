// 汉江局技术管理室 · H-ADCP 在线推流 — 内嵌单文件工具页
import { Link } from 'react-router';

const TOOL_URL = './hadcp/index.html';

export default function HadcpTool() {
  return (
    <div className="flex h-screen flex-col bg-[#0a2540]">
      <header className="flex flex-wrap items-center gap-3 border-b border-[#d4af37]/25 bg-[#0a2540]/90 px-4 py-2.5">
        <Link
          to="/"
          className="rounded-lg border border-[#2b5a82] px-3 py-1.5 text-xs text-slate-300 transition hover:border-[#d4af37]/60 hover:text-[#e6c15a]"
        >
          ← 返回工具集
        </Link>
        <div className="text-sm font-semibold text-white">
          📡 H-ADCP 在线推流数据处理
          <span className="ml-2 text-[11px] font-normal text-slate-400">
            数据转换 · 实测流速 · 时间匹配 · 模型构建 · 批量推流
          </span>
        </div>
        <a
          href={TOOL_URL}
          target="_blank"
          rel="noreferrer"
          className="ml-auto rounded-lg border border-[#2b5a82] px-3 py-1.5 text-xs text-slate-300 transition hover:border-[#d4af37]/60 hover:text-[#e6c15a]"
        >
          ⛶ 新窗口打开
        </a>
      </header>
      <iframe
        src={TOOL_URL}
        title="H-ADCP 在线推流数据处理工具"
        className="w-full flex-1 border-0 bg-white"
      />
    </div>
  );
}
