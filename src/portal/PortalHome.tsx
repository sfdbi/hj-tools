// 门户首页：汉江局技术管理室 · 工具集
// 主题色"流金蓝"：深蓝底 + 流金点缀；工具卡片式布局，预留窗口供后续工具接入
import { Link } from 'react-router';

interface ToolCard {
  key: string;
  name: string;
  desc: string;
  icon: string;
  path?: string; // 有路径表示已上线
  tags?: string[];
  apk?: string; // 安卓安装包下载地址
}

// ── 工具注册表：后续新增工具只需在此追加条目 ──
const TOOLS: ToolCard[] = [
  {
    key: 'rating-curve',
    name: '水位流量关系定线系统',
    desc: '实测水位流量数据录入、单一线/绳套/复合曲线定线、节点微调、三性检验实时判定，依据 SL/T 247-2020。',
    icon: '📈',
    path: '/rating-curve',
    tags: ['水文整编', '定线', '三性检验'],
  },
  {
    key: 'flow-discharge',
    name: '河道断面流量计算',
    desc: '流速-面积法推流：一/二/三/五/六点法系数标定、现场速测直接输水深、部分面积双算法、成果图交互查看与 Excel 成果表一键导出。',
    icon: '🌊',
    path: '/flow-discharge',
    tags: ['流量测验', '推流', '成果导出'],
  },
  {
    key: 'attendance',
    name: '考勤工具',
    desc: '日常按天打卡（状态多选+工作内容）、指定人员发布任务、按年月导出月考勤表（Excel/PDF），多人云端共享，独立密码进入。',
    icon: '📋',
    path: '/attendance',
    tags: ['考勤打卡', '任务发布', '独立密码'],
    apk: './apk/attendance.apk',
  },
  // 预留窗口：后续工具在此追加
  { key: 'slot-3', name: '预留工具窗口', desc: '后续工具将部署于此，敬请期待。', icon: '📊' },
  { key: 'slot-4', name: '预留工具窗口', desc: '后续工具将部署于此，敬请期待。', icon: '🗂️' },
];

export default function PortalHome() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#0a2540] via-[#0e3a5f] to-[#123f66]">
      {/* 顶部横幅 */}
      <header className="border-b border-[#d4af37]/25 bg-[#0a2540]/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gradient-to-br from-[#c9a227] to-[#e6c15a] text-lg font-bold text-[#0a2540]">
              汉
            </div>
            <div>
              <div className="text-lg font-bold tracking-wide text-white">
                汉江局技术管理室 <span className="text-[#d4af37]">· 工具集</span>
              </div>
              <div className="text-[11px] tracking-widest text-slate-400">TECHNICAL MANAGEMENT OFFICE · TOOLKIT</div>
            </div>
          </div>
          <span className="rounded-full border border-[#d4af37]/40 px-3 py-1 text-[11px] text-[#e6c15a]">
            内部平台
          </span>
        </div>
      </header>

      {/* 主体 */}
      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-8">
          <h2 className="text-xl font-semibold text-white">
            专业工具 <span className="ml-2 text-sm font-normal text-slate-400">点击卡片进入工具</span>
          </h2>
          <div className="mt-2 h-px w-32 bg-gradient-to-r from-[#d4af37] to-transparent" />
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {TOOLS.map((t) =>
            t.path ? (
              <div key={t.key} className="flex flex-col gap-2">
                <Link
                  to={t.path}
                  className="group flex-1 rounded-xl border border-[#2b5a82] bg-[#0d2f4e]/80 p-5 shadow-lg transition hover:border-[#d4af37]/60 hover:bg-[#103a5f] hover:shadow-[#d4af37]/10 hover:shadow-xl"
                >
                  <div className="mb-3 flex items-center gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-gradient-to-br from-[#1a4a74] to-[#0e3a5f] text-xl ring-1 ring-[#d4af37]/30">
                      {t.icon}
                    </span>
                    <div className="text-[15px] font-semibold text-white group-hover:text-[#e6c15a]">
                      {t.name}
                    </div>
                  </div>
                  <p className="mb-4 text-xs leading-5 text-slate-300">{t.desc}</p>
                  <div className="flex items-center gap-1.5">
                    {t.tags?.map((tag) => (
                      <span key={tag} className="rounded bg-[#1a4a74] px-2 py-0.5 text-[10px] text-slate-300">
                        {tag}
                      </span>
                    ))}
                    <span className="ml-auto text-xs text-[#d4af37] opacity-0 transition group-hover:opacity-100">
                      进入 →
                    </span>
                  </div>
                </Link>
                {t.apk && (
                  <a
                    href={t.apk}
                    download
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-[#d4af37]/40 bg-[#12395c]/60 py-1.5 text-xs text-[#e6c15a] transition hover:bg-[#1a4a74]"
                  >
                    📱 安卓版 APP 下载（APK）
                  </a>
                )}
              </div>
            ) : (
              <div
                key={t.key}
                className="rounded-xl border border-dashed border-[#2b5a82]/70 bg-[#0d2f4e]/40 p-5"
              >
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#12395c]/60 text-xl opacity-60">
                    {t.icon}
                  </span>
                  <div className="text-[15px] font-semibold text-slate-400">{t.name}</div>
                </div>
                <p className="mb-4 text-xs leading-5 text-slate-500">{t.desc}</p>
                <span className="rounded border border-slate-600/50 px-2 py-0.5 text-[10px] text-slate-500">
                  即将上线
                </span>
              </div>
            )
          )}
        </div>
      </main>

      <footer className="border-t border-[#d4af37]/15 py-4 text-center text-[11px] text-slate-500">
        汉江局技术管理室 · 工具集 — 水文资料整编与专业计算工具平台
      </footer>
    </div>
  );
}
