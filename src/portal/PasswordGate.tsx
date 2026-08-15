// 密码门禁：输入正确密码后方可进入站点
// 说明：纯静态站点的门禁为"防随手访问"级别——密码哈希放在前端，
// 懂技术的人查看源码可绕过。如需真正保密，请部署到支持服务端鉴权的服务器。
import { useState } from 'react';

// SHA-256("88888888")
const PASSWORD_HASH = '615ed7fb1504b0c724a296d7a69e6c7b2f9ea2c57c1d8206c5afdf392ebdfd25';
const AUTH_KEY = 'hj-tools-auth';

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export default function PasswordGate({ children }: { children: React.ReactNode }) {
  const [authed, setAuthed] = useState(() => sessionStorage.getItem(AUTH_KEY) === '1');
  const [pwd, setPwd] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);

  if (authed) return <>{children}</>;

  const submit = async () => {
    if (!pwd || checking) return;
    setChecking(true);
    try {
      const hash = await sha256Hex(pwd);
      if (hash === PASSWORD_HASH) {
        sessionStorage.setItem(AUTH_KEY, '1');
        setAuthed(true);
      } else {
        setError(true);
        setPwd('');
      }
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#0a2540] via-[#0e3a5f] to-[#0a2540]">
      {/* 背景装饰 */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-32 -top-32 h-96 w-96 rounded-full bg-[#d4af37]/10 blur-3xl" />
        <div className="absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-[#3b82f6]/15 blur-3xl" />
      </div>

      <div className="relative w-[380px] rounded-2xl border border-[#d4af37]/30 bg-[#0d2f4e]/90 p-8 shadow-2xl backdrop-blur">
        <div className="mb-1 text-center text-[13px] tracking-[0.3em] text-[#d4af37]">汉江局技术管理室</div>
        <h1 className="mb-6 text-center text-2xl font-bold text-white">
          工 具 集
        </h1>
        <div className="mx-auto mb-6 h-px w-24 bg-gradient-to-r from-transparent via-[#d4af37] to-transparent" />

        <label className="mb-2 block text-xs text-slate-300">访问密码</label>
        <input
          type="password"
          value={pwd}
          autoFocus
          onChange={(e) => {
            setPwd(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="请输入访问密码"
          className={`w-full rounded-lg border bg-[#0a2540]/80 px-3 py-2.5 text-sm text-white placeholder-slate-500 outline-none transition ${
            error ? 'border-red-400' : 'border-[#2b5a82] focus:border-[#d4af37]'
          }`}
        />
        {error && <div className="mt-2 text-xs text-red-400">密码错误，请重试</div>}

        <button
          onClick={submit}
          disabled={checking || !pwd}
          className="mt-5 w-full rounded-lg bg-gradient-to-r from-[#c9a227] to-[#e6c15a] py-2.5 text-sm font-semibold text-[#0a2540] transition hover:brightness-110 disabled:opacity-50"
        >
          {checking ? '验证中…' : '进入工具集'}
        </button>

        <div className="mt-6 text-center text-[11px] text-slate-400">
          内部工具平台 · 未经授权请勿访问
        </div>
      </div>
    </div>
  );
}
