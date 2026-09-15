import { useEffect, useMemo, useState } from 'react';

type NoticeLevel = 'notice' | 'update' | 'important';
type NoticeSource = 'manual' | 'auto';

interface Announcement {
  id: string;
  title: string;
  summary: string;
  content: string;
  publishedAt: string;
  level: NoticeLevel;
  pinned: boolean;
  source: NoticeSource;
  url?: string;
}

interface AutoOverride {
  hidden?: boolean;
  title?: string;
  summary?: string;
  content?: string;
  publishedAt?: string;
  level?: NoticeLevel;
  pinned?: boolean;
}

interface AnnouncementConfig {
  version: number;
  autoSince: string;
  manual: Announcement[];
  autoOverrides: Record<string, AutoOverride>;
}

interface GitHubCommit {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    committer: { date: string | null };
    author: { date: string | null };
  };
}

interface Draft {
  id?: string;
  source?: NoticeSource;
  title: string;
  summary: string;
  content: string;
  level: NoticeLevel;
  pinned: boolean;
  publishedAt?: string;
}

const REPO = 'sfdbi/hj-tools';
const CONFIG_PATH = 'public/announcements.json';
const ADMIN_PASSWORD_HASH = '964bdb6aecbd312d6c0aad5ea6982fd47557f0eba64f818fa3890835b52e17dd';
const READ_KEY = 'hj-tools-read-announcements';
const TOKEN_KEY = 'hj-tools-announcement-token';
// ── 意见反馈：复用考勤工具的 GitHub 云端共享通道（localStorage 'hj-att-lc'，同源共享）──
const ATT_LC_KEY = 'hj-att-lc';
const FB_SEEN_KEY = 'hj-tools-feedback-seen';

interface FeedbackReply {
  content: string;
  repliedAt: string;
}
interface FeedbackItem {
  id: string;
  category: string;
  name: string;
  content: string;
  createdAt: string;
  reply?: FeedbackReply | null;
}
const FB_CATEGORIES: Record<string, { text: string; cls: string }> = {
  bug: { text: '运行错误', cls: 'border-red-400/50 bg-red-500/15 text-red-200' },
  opt: { text: '优化建议', cls: 'border-sky-400/50 bg-sky-500/15 text-sky-200' },
  use: { text: '实用性建议', cls: 'border-violet-400/50 bg-violet-500/15 text-violet-200' },
  need: { text: '新功能需求', cls: 'border-emerald-400/50 bg-emerald-500/15 text-emerald-200' },
};
function fbCategory(key: string) {
  return FB_CATEGORIES[key] || FB_CATEGORIES.opt;
}
const EMPTY_CONFIG: AnnouncementConfig = {
  version: 1,
  autoSince: '2026-09-15T00:00:00+08:00',
  manual: [],
  autoOverrides: {},
};

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function utf8ToBase64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const size = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + size));
  }
  return btoa(binary);
}

function base64ToUtf8(text: string) {
  const binary = atob(text.replace(/\s/g, ''));
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function cleanCommitTitle(message: string) {
  return message
    .split('\n')[0]
    .replace(/^(feat|fix|refactor|perf|docs|style|build|ci|test)(\([^)]*\))?!?:\s*/i, '')
    .trim();
}

function toAutoAnnouncements(commits: GitHubCommit[], config: AnnouncementConfig): Announcement[] {
  const since = new Date(config.autoSince).getTime();
  return commits.flatMap((item) => {
    const message = item.commit.message.trim();
    const firstLine = message.split('\n')[0];
    const publishedAt = item.commit.committer.date || item.commit.author.date || '';
    if (
      !publishedAt ||
      new Date(publishedAt).getTime() < since ||
      /^chore\(announcements?\):/i.test(firstLine) ||
      /\[skip announcement\]/i.test(message)
    ) {
      return [];
    }
    const override = config.autoOverrides[item.sha] || {};
    if (override.hidden) return [];
    const title = cleanCommitTitle(message) || '网站功能更新';
    const body = message.split('\n').slice(1).join('\n').trim();
    return [
      {
        id: item.sha,
        title: override.title || `网站更新：${title}`,
        summary: override.summary || body.slice(0, 100) || '工具集已发布新版本，点击查看本次更新详情。',
        content:
          override.content ||
          `工具集已完成一次网站更新。\n\n更新内容：${message}\n\n提交编号：${item.sha.slice(0, 7)}`,
        publishedAt: override.publishedAt || publishedAt,
        level: override.level || 'update',
        pinned: override.pinned ?? false,
        source: 'auto' as const,
        url: item.html_url,
      },
    ];
  });
}

function sortAnnouncements(items: Announcement[]) {
  return [...items].sort(
    (left, right) =>
      Number(right.pinned) - Number(left.pinned) ||
      new Date(right.publishedAt).getTime() - new Date(left.publishedAt).getTime(),
  );
}

function levelStyle(level: NoticeLevel) {
  if (level === 'important') return 'border-red-400/50 bg-red-500/15 text-red-200';
  if (level === 'update') return 'border-sky-400/50 bg-sky-500/15 text-sky-200';
  return 'border-[#d4af37]/50 bg-[#d4af37]/15 text-[#f5d978]';
}

function levelText(level: NoticeLevel) {
  return level === 'important' ? '重要' : level === 'update' ? '更新' : '公告';
}

function Modal({ children, onClose, wide = false }: { children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className={`max-h-[88vh] w-full overflow-y-auto rounded-2xl border border-[#d4af37]/35 bg-[#0b2944] shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-2xl'}`}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export default function AnnouncementCenter() {
  const [config, setConfig] = useState<AnnouncementConfig>(EMPTY_CONFIG);
  const [autoNotices, setAutoNotices] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadWarning, setLoadWarning] = useState('');
  const [detail, setDetail] = useState<Announcement | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(() => {
    try {
      return new Set<string>(JSON.parse(localStorage.getItem(READ_KEY) || '[]'));
    } catch {
      return new Set<string>();
    }
  });
  const [adminMode, setAdminMode] = useState<'closed' | 'login' | 'manage'>('closed');
  const [password, setPassword] = useState('');
  const [adminError, setAdminError] = useState('');
  const [token, setToken] = useState(() => sessionStorage.getItem(TOKEN_KEY) || '');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);

  const notices = useMemo(
    () => sortAnnouncements([...config.manual.filter((item) => item.source === 'manual'), ...autoNotices]),
    [config.manual, autoNotices],
  );
  const unreadCount = notices.filter((item) => !readIds.has(item.id)).length;

  const refresh = async () => {
    setLoading(true);
    setLoadWarning('');
    let nextConfig = config;
    try {
      const configResponse = await fetch(`${import.meta.env.BASE_URL}announcements.json?_=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!configResponse.ok) throw new Error(`公告配置读取失败（${configResponse.status}）`);
      nextConfig = (await configResponse.json()) as AnnouncementConfig;
      nextConfig.manual = Array.isArray(nextConfig.manual) ? nextConfig.manual : [];
      nextConfig.autoOverrides = nextConfig.autoOverrides || {};
      setConfig(nextConfig);
    } catch (error) {
      setLoadWarning(error instanceof Error ? error.message : '公告配置读取失败');
    }

    try {
      const response = await fetch(`https://api.github.com/repos/${REPO}/commits?sha=main&per_page=100`, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) throw new Error(`自动更新读取失败（${response.status}）`);
      const commits = (await response.json()) as GitHubCommit[];
      setAutoNotices(toAutoAnnouncements(commits, nextConfig));
    } catch (error) {
      setLoadWarning((current) => current || (error instanceof Error ? error.message : '自动更新读取失败'));
    } finally {
      setLoading(false);
    }
    void loadFeedback(true); // 顺带拉取意见反馈，更新收纳区数字角标
  };

  useEffect(() => {
    void refresh();
    // 首次挂载读取即可；管理操作后会直接更新本地状态。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNotice = (notice: Announcement) => {
    const next = new Set(readIds).add(notice.id);
    setReadIds(next);
    localStorage.setItem(READ_KEY, JSON.stringify([...next]));
    setListOpen(false);
    setDetail(notice);
  };

  const unlockAdmin = async () => {
    if ((await sha256Hex(password)) !== ADMIN_PASSWORD_HASH) {
      setAdminError('管理员密码错误');
      setPassword('');
      return;
    }
    setAdminError('');
    setPassword('');
    setAdminMode('manage');
  };

  const mutateRemoteConfig = async (
    mutator: (latest: AnnouncementConfig) => AnnouncementConfig,
    message: string,
  ) => {
    if (!token.trim()) throw new Error('请输入具有 Contents 读写权限的 GitHub 令牌');
    sessionStorage.setItem(TOKEN_KEY, token.trim());
    const headers = {
      Authorization: `Bearer ${token.trim()}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    const endpoint = `https://api.github.com/repos/${REPO}/contents/${CONFIG_PATH}`;
    const currentResponse = await fetch(`${endpoint}?ref=main&_=${Date.now()}`, { headers, cache: 'no-store' });
    if (!currentResponse.ok) throw new Error(`读取云端公告失败（${currentResponse.status}）`);
    const currentFile = (await currentResponse.json()) as { sha: string; content: string };
    const latest = JSON.parse(base64ToUtf8(currentFile.content)) as AnnouncementConfig;
    latest.manual = Array.isArray(latest.manual) ? latest.manual : [];
    latest.autoOverrides = latest.autoOverrides || {};
    const next = mutator(latest);
    const saveResponse = await fetch(endpoint, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `chore(announcements): ${message} [skip announcement]`,
        content: utf8ToBase64(`${JSON.stringify(next, null, 2)}\n`),
        sha: currentFile.sha,
        branch: 'main',
      }),
    });
    if (!saveResponse.ok) {
      const body = (await saveResponse.json().catch(() => ({}))) as { message?: string };
      throw new Error(`保存公告失败（${saveResponse.status}）：${body.message || '请检查令牌权限'}`);
    }
    setConfig(next);
    setAutoNotices((current) =>
      current.flatMap((item) => {
        const override = next.autoOverrides[item.id] || {};
        if (override.hidden) return [];
        return [{ ...item, ...override, source: 'auto' as const }];
      }),
    );
  };

  // ── 意见反馈：读取/提交/回复（与考勤工具共用 feedback.json 云端通道）──
  const [fbItems, setFbItems] = useState<FeedbackItem[]>([]);
  const [fbError, setFbError] = useState('');
  const [fbOpen, setFbOpen] = useState(false);
  const [fbSeenAt, setFbSeenAt] = useState(() => localStorage.getItem(FB_SEEN_KEY) || '');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [pushFlags, setPushFlags] = useState<Record<string, boolean>>({});
  const [fbDraft, setFbDraft] = useState({ category: 'bug', name: '', content: '' });

  const attConf = (): { token: string; repo: string } | null => {
    try {
      return JSON.parse(localStorage.getItem(ATT_LC_KEY) || 'null');
    } catch {
      return null;
    }
  };

  const fbSorted = useMemo(
    () => [...fbItems].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
    [fbItems],
  );
  const fbNewCount = fbItems.filter(
    (item) =>
      (item.createdAt && item.createdAt > fbSeenAt) || (item.reply?.repliedAt && item.reply.repliedAt > fbSeenAt),
  ).length;

  const loadFeedback = async (silent = false) => {
    const conf = attConf();
    if (!conf?.token || !conf?.repo) {
      if (!silent) setFbError('未配置共享通道：请先在「考勤工具 → 菜单 → 云存储设置」中填入访问令牌');
      return;
    }
    try {
      const res = await fetch(
        `https://api.github.com/repos/${conf.repo}/contents/feedback.json?ref=main&_=${Date.now()}`,
        { headers: { Authorization: `Bearer ${conf.token}`, Accept: 'application/vnd.github+json' }, cache: 'no-store' },
      );
      if (res.status === 404) {
        setFbItems([]);
        setFbError('');
        return;
      }
      if (!res.ok) throw new Error(`反馈读取失败（${res.status}）`);
      const file = (await res.json()) as { content: string };
      const obj = JSON.parse(base64ToUtf8(file.content)) as { items?: FeedbackItem[] };
      setFbItems(Array.isArray(obj.items) ? obj.items : []);
      setFbError('');
    } catch (error) {
      if (!silent) setFbError(error instanceof Error ? error.message : '反馈读取失败');
    }
  };

  const openFeedbackList = () => {
    const now = new Date().toISOString();
    localStorage.setItem(FB_SEEN_KEY, now);
    setFbSeenAt(now);
    setFbOpen(true);
    void loadFeedback();
  };

  /** 读-改-写 feedback.json（云端冲突自动重试） */
  const writeFeedback = async (
    conf: { token: string; repo: string },
    mutator: (items: FeedbackItem[]) => void,
    action: string,
  ) => {
    const headers = { Authorization: `Bearer ${conf.token}`, Accept: 'application/vnd.github+json' };
    const endpoint = `https://api.github.com/repos/${conf.repo}/contents/feedback.json`;
    for (let attempt = 0; attempt < 3; attempt++) {
      const cur = await fetch(`${endpoint}?ref=main&_=${Date.now()}`, { headers, cache: 'no-store' });
      let sha: string | undefined;
      let obj: { version: number; items: FeedbackItem[] } = { version: 1, items: [] };
      if (cur.status !== 404) {
        if (!cur.ok) throw new Error(`反馈读取失败（${cur.status}）`);
        const file = (await cur.json()) as { sha: string; content: string };
        sha = file.sha;
        obj = JSON.parse(base64ToUtf8(file.content)) as typeof obj;
        obj.items = Array.isArray(obj.items) ? obj.items : [];
      }
      mutator(obj.items);
      const put = await fetch(endpoint, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `${action} [skip announcement]`,
          content: utf8ToBase64(`${JSON.stringify(obj, null, 1)}\n`),
          sha,
          branch: 'main',
        }),
      });
      if (put.ok) {
        setFbItems(obj.items);
        return;
      }
      if (put.status !== 409 && put.status !== 422) throw new Error(`反馈保存失败（${put.status}）`);
    }
    throw new Error('反馈保存失败：云端冲突，请重试');
  };

  /** 用户提交反馈 */
  const submitFeedback = async () => {
    const conf = attConf();
    if (!conf?.token || !conf?.repo) {
      setFbError('未配置共享通道，无法提交：请先在「考勤工具 → 云存储设置」中配置');
      return;
    }
    const content = fbDraft.content.trim();
    if (!content) {
      setFbError('请填写反馈内容');
      return;
    }
    setSaving(true);
    setFbError('');
    try {
      await writeFeedback(
        conf,
        (items) => {
          items.push({
            id: `fb_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
            category: fbDraft.category,
            name: fbDraft.name.trim() || '匿名',
            content,
            createdAt: new Date().toISOString(),
            reply: null,
          });
        },
        '提交意见反馈',
      );
      setFbDraft({ category: 'bug', name: '', content: '' });
    } catch (error) {
      setFbError(error instanceof Error ? error.message : '提交失败');
    } finally {
      setSaving(false);
    }
  };

  /** 管理员回复反馈，可选推送到公告 */
  const saveReply = async (item: FeedbackItem) => {
    const content = (replyDrafts[item.id] || '').trim();
    if (!content) {
      setAdminError('请填写回复内容');
      return;
    }
    const conf = attConf();
    if (!conf?.token || !conf?.repo) {
      setAdminError('未找到考勤共享通道令牌，请先在考勤工具「云存储设置」中配置');
      return;
    }
    setSaving(true);
    setAdminError('');
    try {
      const reply: FeedbackReply = { content, repliedAt: new Date().toISOString() };
      await writeFeedback(
        conf,
        (items) => {
          const idx = items.findIndex((x) => x.id === item.id);
          if (idx === -1) throw new Error('该反馈已不存在（可能已被清理）');
          items[idx] = { ...items[idx], reply };
        },
        '回复意见反馈',
      );
      setReplyDrafts((d) => ({ ...d, [item.id]: '' }));
      if (pushFlags[item.id]) {
        const cat = fbCategory(item.category).text;
        try {
          await mutateRemoteConfig((latest) => {
            latest.manual = [
              ...latest.manual.filter((n) => n.id !== `fb-${item.id}`),
              {
                id: `fb-${item.id}`,
                title: `意见反馈回复 · ${cat}`,
                summary: `${item.name}：${item.content.slice(0, 60)}`,
                content: `【${cat}】${item.name} 反馈（${formatDate(item.createdAt)}）：\n${item.content}\n\n管理室回复（${formatDate(reply.repliedAt)}）：\n${content}`,
                publishedAt: new Date().toISOString(),
                level: 'notice' as const,
                pinned: false,
                source: 'manual' as const,
              },
            ];
            return latest;
          }, `推送反馈回复到公告 ${item.name}`);
        } catch (error) {
          setAdminError(
            `回复已保存；推送公告失败：${error instanceof Error ? error.message : ''}（推送公告需在上方填入 GitHub 发布令牌）`,
          );
          return;
        }
      }
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : '回复保存失败');
    } finally {
      setSaving(false);
    }
  };

  const saveDraft = async () => {
    if (!draft || !draft.title.trim() || !draft.content.trim()) {
      setAdminError('请填写公告标题和详细内容');
      return;
    }
    setSaving(true);
    setAdminError('');
    try {
      await mutateRemoteConfig((latest) => {
        if (draft.source === 'auto' && draft.id) {
          latest.autoOverrides[draft.id] = {
            ...latest.autoOverrides[draft.id],
            hidden: false,
            title: draft.title.trim(),
            summary: draft.summary.trim(),
            content: draft.content.trim(),
            level: draft.level,
            pinned: draft.pinned,
            publishedAt: draft.publishedAt,
          };
          return latest;
        }
        const item: Announcement = {
          id: draft.id || `manual-${Date.now()}`,
          title: draft.title.trim(),
          summary: draft.summary.trim() || draft.content.trim().slice(0, 100),
          content: draft.content.trim(),
          publishedAt: draft.publishedAt || new Date().toISOString(),
          level: draft.level,
          pinned: draft.pinned,
          source: 'manual',
        };
        latest.manual = [...latest.manual.filter((notice) => notice.id !== item.id), item];
        return latest;
      }, draft.id ? `修改公告 ${draft.title.trim()}` : `新增公告 ${draft.title.trim()}`);
      setDraft(null);
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : '公告保存失败');
    } finally {
      setSaving(false);
    }
  };

  const deleteNotice = async (notice: Announcement) => {
    if (!window.confirm(`确定要${notice.source === 'auto' ? '隐藏' : '删除'}公告“${notice.title}”吗？`)) return;
    setSaving(true);
    setAdminError('');
    try {
      await mutateRemoteConfig((latest) => {
        if (notice.source === 'auto') {
          latest.autoOverrides[notice.id] = { ...latest.autoOverrides[notice.id], hidden: true };
        } else {
          latest.manual = latest.manual.filter((item) => item.id !== notice.id);
        }
        return latest;
      }, `${notice.source === 'auto' ? '隐藏' : '删除'}公告 ${notice.title}`);
    } catch (error) {
      setAdminError(error instanceof Error ? error.message : '公告删除失败');
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (notice: Announcement) => {
    setDraft({
      id: notice.id,
      source: notice.source,
      title: notice.title,
      summary: notice.summary,
      content: notice.content,
      level: notice.level,
      pinned: notice.pinned,
      publishedAt: notice.publishedAt,
    });
  };

  return (
    <>
      <section className="mb-8 overflow-hidden rounded-2xl border border-[#d4af37]/45 bg-gradient-to-r from-[#133d61] via-[#123654] to-[#172f48] shadow-xl shadow-black/15">
        <div className="flex flex-wrap items-center gap-3 border-b border-[#d4af37]/20 bg-[#d4af37]/10 px-5 py-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-[#d4af37] text-lg text-[#0a2540]">📢</span>
          <div>
            <h2 className="font-semibold text-white">网站公告</h2>
            <p className="text-[11px] text-slate-300">功能上线、版本更新与重要通知</p>
          </div>
          {unreadCount > 0 && (
            <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-semibold text-white">{unreadCount} 条未读</span>
          )}
          <div className="ml-auto flex gap-2">
            <button onClick={() => setListOpen(true)} className="rounded-lg border border-[#d4af37]/35 px-3 py-1.5 text-xs text-[#f2d572] hover:bg-[#d4af37]/10">
              全部公告（{notices.length}）
            </button>
            <button
              onClick={() => {
                setAdminError('');
                setAdminMode('login');
              }}
              className="rounded-lg border border-slate-500/50 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5"
            >
              公告管理
            </button>
          </div>
        </div>
        <div className="divide-y divide-white/5">
          {loading && <div className="px-5 py-5 text-sm text-slate-400">正在读取公告…</div>}
          {!loading && notices.length === 0 && <div className="px-5 py-5 text-sm text-slate-400">暂无公告</div>}
          {!loading &&
            notices.slice(0, 3).map((notice) => (
              <button key={notice.id} onClick={() => openNotice(notice)} className="group flex w-full items-center gap-3 px-5 py-3 text-left transition hover:bg-white/5">
                <span className={`rounded border px-1.5 py-0.5 text-[10px] ${levelStyle(notice.level)}`}>{levelText(notice.level)}</span>
                {notice.pinned && <span className="text-xs text-[#f2d572]">置顶</span>}
                {!readIds.has(notice.id) && <span className="h-2 w-2 rounded-full bg-red-400" />}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium text-white group-hover:text-[#f2d572]">{notice.title}</div>
                  <div className="mt-0.5 truncate text-xs text-slate-400">{notice.summary}</div>
                </div>
                <time className="hidden shrink-0 text-[11px] text-slate-400 sm:block">{formatDate(notice.publishedAt)}</time>
                <span className="text-[#d4af37]">查看 →</span>
              </button>
            ))}
        </div>
        {/* 意见反馈与需求探讨（收纳显示，仅数字角标提示新增，不占公告位） */}
        <div className="flex flex-wrap items-center gap-2.5 border-t border-[#d4af37]/20 bg-white/[0.02] px-5 py-3">
          <button
            onClick={openFeedbackList}
            className="flex items-center gap-2 rounded-lg border border-[#2b5a82] px-3 py-1.5 text-xs text-slate-200 transition hover:border-[#d4af37]/60 hover:text-[#e6c15a]"
          >
            💬 意见反馈与需求探讨
            <span className="text-slate-400">{fbItems.length} 条</span>
          </button>
          {fbNewCount > 0 && (
            <span className="rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-semibold text-white">
              {fbNewCount} 条新信息
            </span>
          )}
          <span className="ml-auto text-[11px] text-slate-500">提交与回复实时共享 · 考勤工具内亦可提交</span>
        </div>
        {loadWarning && <div className="border-t border-amber-400/20 px-5 py-2 text-[11px] text-amber-200">⚠ {loadWarning}，已显示当前可用公告。</div>}
      </section>

      {detail && (
        <Modal onClose={() => setDetail(null)}>
          <div className="border-b border-white/10 px-6 py-5">
            <div className="mb-3 flex items-center gap-2">
              <span className={`rounded border px-2 py-0.5 text-[11px] ${levelStyle(detail.level)}`}>{levelText(detail.level)}</span>
              {detail.pinned && <span className="text-xs text-[#f2d572]">置顶</span>}
              <span className="text-xs text-slate-400">{detail.source === 'auto' ? '网站自动更新' : '管理员发布'}</span>
              <button onClick={() => setDetail(null)} className="ml-auto text-xl text-slate-400 hover:text-white">×</button>
            </div>
            <h3 className="text-xl font-semibold text-white">{detail.title}</h3>
            <time className="mt-2 block text-xs text-slate-400">{formatDate(detail.publishedAt)}</time>
          </div>
          <div className="whitespace-pre-wrap px-6 py-6 text-sm leading-7 text-slate-200">{detail.content}</div>
          {detail.url && (
            <div className="border-t border-white/10 px-6 py-4">
              <a href={detail.url} target="_blank" rel="noreferrer" className="text-xs text-sky-300 hover:text-sky-200">查看对应网站更新记录 ↗</a>
            </div>
          )}
        </Modal>
      )}

      {listOpen && (
        <Modal onClose={() => setListOpen(false)} wide>
          <div className="sticky top-0 z-10 flex items-center border-b border-white/10 bg-[#0b2944] px-6 py-4">
            <h3 className="text-lg font-semibold text-white">全部公告</h3>
            <button onClick={() => void refresh()} className="ml-3 text-xs text-sky-300 hover:text-sky-200">刷新</button>
            <button onClick={() => setListOpen(false)} className="ml-auto text-xl text-slate-400 hover:text-white">×</button>
          </div>
          <div className="divide-y divide-white/10">
            {notices.map((notice) => (
              <button key={notice.id} onClick={() => openNotice(notice)} className="flex w-full items-start gap-3 px-6 py-4 text-left hover:bg-white/5">
                <span className={`mt-0.5 rounded border px-1.5 py-0.5 text-[10px] ${levelStyle(notice.level)}`}>{levelText(notice.level)}</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-white">
                    {notice.title}
                    {!readIds.has(notice.id) && <span className="h-2 w-2 rounded-full bg-red-400" />}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-slate-400">{notice.summary}</p>
                </div>
                <time className="shrink-0 text-[11px] text-slate-400">{formatDate(notice.publishedAt)}</time>
              </button>
            ))}
          </div>
        </Modal>
      )}

      {/* 意见反馈与需求探讨：提交 + 列表（回复实时同步） */}
      {fbOpen && (
        <Modal onClose={() => setFbOpen(false)} wide>
          <div className="sticky top-0 z-10 flex items-center border-b border-white/10 bg-[#0b2944] px-6 py-4">
            <h3 className="text-lg font-semibold text-white">💬 意见反馈与需求探讨</h3>
            <button onClick={() => void loadFeedback()} className="ml-3 text-xs text-sky-300 hover:text-sky-200">刷新</button>
            <button onClick={() => setFbOpen(false)} className="ml-auto text-xl text-slate-400 hover:text-white">×</button>
          </div>
          <div className="px-6 py-5">
            {/* 提交区：所有登录用户可用 */}
            <div className="mb-5 rounded-xl border border-[#d4af37]/30 bg-[#d4af37]/5 p-4">
              <div className="mb-3 flex flex-wrap items-center gap-3">
                <span className="text-xs text-slate-300">我要反馈：</span>
                <select
                  value={fbDraft.category}
                  onChange={(event) => setFbDraft({ ...fbDraft, category: event.target.value })}
                  className="rounded border border-[#2b5a82] bg-[#071e33] px-2 py-1.5 text-xs text-white"
                >
                  <option value="bug">运行错误（功能报错/异常）</option>
                  <option value="opt">优化建议（让功能更好用）</option>
                  <option value="use">实用性建议（实用性/可正常运行性）</option>
                  <option value="need">新功能需求（建议部署相关功能）</option>
                </select>
                <input
                  value={fbDraft.name}
                  onChange={(event) => setFbDraft({ ...fbDraft, name: event.target.value })}
                  placeholder="你的姓名（可空）"
                  className="w-36 rounded border border-[#2b5a82] bg-[#071e33] px-2 py-1.5 text-xs text-white outline-none focus:border-[#d4af37]"
                />
              </div>
              <textarea
                rows={3}
                value={fbDraft.content}
                onChange={(event) => setFbDraft({ ...fbDraft, content: event.target.value })}
                placeholder="尽量描述清楚：哪个工具、什么操作、期望达到的效果…"
                className="w-full resize-y rounded-lg border border-[#2b5a82] bg-[#071e33] px-3 py-2 text-sm leading-6 text-white outline-none focus:border-[#d4af37]"
              />
              <div className="mt-3 flex items-center">
                {fbError && <span className="text-xs text-red-300">{fbError}</span>}
                <button
                  onClick={() => void submitFeedback()}
                  disabled={saving}
                  className="ml-auto rounded-lg bg-[#d4af37] px-4 py-2 text-xs font-semibold text-[#0a2540] hover:brightness-110 disabled:opacity-50"
                >
                  {saving ? '提交中…' : '提交反馈'}
                </button>
              </div>
            </div>
            {/* 列表区 */}
            <div className="space-y-3">
              {fbSorted.length === 0 && (
                <p className="py-4 text-center text-xs text-slate-500">
                  {fbError ? fbError : '暂无反馈，欢迎提出第一条意见或需求'}
                </p>
              )}
              {fbSorted.map((item) => {
                const cat = fbCategory(item.category);
                const replied = !!item.reply?.content;
                return (
                  <div key={item.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`rounded border px-1.5 py-0.5 text-[10px] ${cat.cls}`}>{cat.text}</span>
                      <span className="text-xs font-medium text-white">{item.name || '匿名'}</span>
                      <span className="text-[11px] text-slate-500">{formatDate(item.createdAt)}</span>
                      <span
                        className={`ml-auto rounded-full border px-2 py-0.5 text-[10px] ${
                          replied
                            ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300'
                            : 'border-amber-400/40 bg-amber-500/10 text-amber-300'
                        }`}
                      >
                        {replied ? '已回复' : '待回复'}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-slate-200">{item.content}</p>
                    {replied && (
                      <div className="mt-2 rounded-lg border-l-2 border-[#d4af37] bg-[#d4af37]/10 px-3 py-2">
                        <div className="text-[10px] text-[#e6c15a]">管理室回复 · {formatDate(item.reply!.repliedAt)}</div>
                        <p className="mt-1 whitespace-pre-wrap text-[13px] leading-6 text-slate-100">{item.reply!.content}</p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </Modal>
      )}

      {adminMode === 'login' && (
        <Modal onClose={() => setAdminMode('closed')}>
          <div className="px-6 py-6">
            <div className="flex items-center">
              <h3 className="text-lg font-semibold text-white">公告管理员验证</h3>
              <button onClick={() => setAdminMode('closed')} className="ml-auto text-xl text-slate-400 hover:text-white">×</button>
            </div>
            <p className="mt-2 text-xs leading-5 text-slate-400">输入管理员密码后可进入公告管理。密码仅保存为 SHA-256 校验值。</p>
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setAdminError('');
              }}
              onKeyDown={(event) => event.key === 'Enter' && void unlockAdmin()}
              placeholder="请输入管理员密码"
              className="mt-5 w-full rounded-lg border border-[#2b5a82] bg-[#071e33] px-3 py-2.5 text-sm text-white outline-none focus:border-[#d4af37]"
            />
            {adminError && <p className="mt-2 text-xs text-red-300">{adminError}</p>}
            <button onClick={() => void unlockAdmin()} className="mt-4 w-full rounded-lg bg-[#d4af37] py-2.5 text-sm font-semibold text-[#0a2540] hover:brightness-110">进入管理</button>
          </div>
        </Modal>
      )}

      {adminMode === 'manage' && (
        <Modal onClose={() => setAdminMode('closed')} wide>
          <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0b2944] px-6 py-4">
            <div className="flex items-center gap-3">
              <h3 className="text-lg font-semibold text-white">公告管理</h3>
              <span className="rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">密码已验证</span>
              <button onClick={() => setAdminMode('closed')} className="ml-auto text-xl text-slate-400 hover:text-white">×</button>
            </div>
            <div className="mt-3">
              <label className="text-[11px] text-slate-400">GitHub 发布令牌（仅保留在当前标签页会话，需 Contents 读写权限）</label>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="github_pat_… 或 ghp_…"
                autoComplete="off"
                className="mt-1 w-full rounded-lg border border-[#2b5a82] bg-[#071e33] px-3 py-2 text-xs text-white outline-none focus:border-[#d4af37]"
              />
            </div>
          </div>
          <div className="px-6 py-5">
            <div className="mb-4 flex items-center">
              <p className="text-xs leading-5 text-slate-400">自动公告由网站更新提交生成；删除自动公告时会将其设为隐藏。</p>
              <button
                onClick={() => setDraft({ title: '', summary: '', content: '', level: 'notice', pinned: false })}
                disabled={saving}
                className="ml-auto shrink-0 rounded-lg bg-[#d4af37] px-3 py-2 text-xs font-semibold text-[#0a2540] disabled:opacity-50"
              >
                ＋ 新增公告
              </button>
            </div>
            {adminError && <div className="mb-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{adminError}</div>}
            <div className="space-y-2">
              {notices.map((notice) => (
                <div key={notice.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                  <span className={`rounded border px-1.5 py-0.5 text-[10px] ${levelStyle(notice.level)}`}>{levelText(notice.level)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-white">{notice.title}</div>
                    <div className="mt-0.5 text-[11px] text-slate-500">{notice.source === 'auto' ? '自动公告' : '手动公告'} · {formatDate(notice.publishedAt)}</div>
                  </div>
                  <button onClick={() => startEdit(notice)} disabled={saving} className="text-xs text-sky-300 disabled:opacity-50">修改</button>
                  <button onClick={() => void deleteNotice(notice)} disabled={saving} className="text-xs text-red-300 disabled:opacity-50">{notice.source === 'auto' ? '隐藏' : '删除'}</button>
                </div>
              ))}
            </div>

            {/* ── 意见反馈回复（数据存于考勤共享通道，回复实时同步给用户）── */}
            <div className="mt-6 border-t border-white/10 pt-4">
              <div className="mb-3 flex items-center gap-2">
                <h4 className="text-sm font-semibold text-white">💬 意见反馈回复（{fbItems.length}）</h4>
                <button onClick={() => void loadFeedback()} disabled={saving} className="text-xs text-sky-300 hover:text-sky-200 disabled:opacity-50">刷新反馈</button>
                <span className="ml-auto text-[10px] text-slate-500">勾选「推送到公告」后，问题与回复将同时发布到网站公告</span>
              </div>
              {fbSorted.length === 0 && (
                <p className="py-2 text-xs text-slate-500">暂无反馈{attConf() ? '' : '（本机未配置考勤共享通道，请到考勤工具「云存储设置」中配置令牌）'}</p>
              )}
              <div className="space-y-3">
                {fbSorted.map((item) => {
                  const cat = fbCategory(item.category);
                  return (
                    <div key={item.id} className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded border px-1.5 py-0.5 text-[10px] ${cat.cls}`}>{cat.text}</span>
                        <span className="text-xs font-medium text-white">{item.name || '匿名'}</span>
                        <span className="text-[11px] text-slate-500">{formatDate(item.createdAt)}</span>
                        {item.reply?.content && (
                          <span className="ml-auto rounded-full border border-emerald-400/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300">已回复</span>
                        )}
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-6 text-slate-200">{item.content}</p>
                      {item.reply?.content && (
                        <div className="mt-2 rounded-lg border-l-2 border-[#d4af37] bg-[#d4af37]/10 px-3 py-2">
                          <div className="text-[10px] text-[#e6c15a]">当前回复 · {formatDate(item.reply.repliedAt)}</div>
                          <p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-100">{item.reply.content}</p>
                        </div>
                      )}
                      <textarea
                        rows={2}
                        value={replyDrafts[item.id] ?? ''}
                        onChange={(event) => setReplyDrafts((d) => ({ ...d, [item.id]: event.target.value }))}
                        placeholder={item.reply?.content ? '修改回复内容…' : '填写回复内容…'}
                        className="mt-2 w-full resize-y rounded-lg border border-[#2b5a82] bg-[#071e33] px-3 py-2 text-xs leading-5 text-white outline-none focus:border-[#d4af37]"
                      />
                      <div className="mt-2 flex items-center gap-3">
                        <label className="flex items-center gap-1.5 text-[11px] text-slate-300">
                          <input
                            type="checkbox"
                            checked={pushFlags[item.id] ?? false}
                            onChange={(event) => setPushFlags((f) => ({ ...f, [item.id]: event.target.checked }))}
                          />
                          同时推送到公告
                        </label>
                        <button
                          onClick={() => void saveReply(item)}
                          disabled={saving}
                          className="ml-auto rounded-lg bg-[#d4af37] px-3 py-1.5 text-[11px] font-semibold text-[#0a2540] hover:brightness-110 disabled:opacity-50"
                        >
                          {saving ? '保存中…' : item.reply?.content ? '更新回复' : '保存回复'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </Modal>
      )}

      {draft && (
        <Modal onClose={() => !saving && setDraft(null)}>
          <div className="border-b border-white/10 px-6 py-4">
            <div className="flex items-center">
              <h3 className="text-lg font-semibold text-white">{draft.id ? '修改公告' : '新增公告'}</h3>
              <button onClick={() => !saving && setDraft(null)} className="ml-auto text-xl text-slate-400 hover:text-white">×</button>
            </div>
          </div>
          <div className="space-y-4 px-6 py-5">
            <label className="block text-xs text-slate-300">
              公告标题
              <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="mt-1 w-full rounded-lg border border-[#2b5a82] bg-[#071e33] px-3 py-2 text-sm text-white outline-none focus:border-[#d4af37]" />
            </label>
            <label className="block text-xs text-slate-300">
              摘要
              <input value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} className="mt-1 w-full rounded-lg border border-[#2b5a82] bg-[#071e33] px-3 py-2 text-sm text-white outline-none focus:border-[#d4af37]" />
            </label>
            <label className="block text-xs text-slate-300">
              详细内容
              <textarea rows={8} value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} className="mt-1 w-full resize-y rounded-lg border border-[#2b5a82] bg-[#071e33] px-3 py-2 text-sm leading-6 text-white outline-none focus:border-[#d4af37]" />
            </label>
            <div className="flex flex-wrap items-center gap-5">
              <label className="text-xs text-slate-300">
                类型
                <select value={draft.level} onChange={(event) => setDraft({ ...draft, level: event.target.value as NoticeLevel })} className="ml-2 rounded border border-[#2b5a82] bg-[#071e33] px-2 py-1.5 text-white">
                  <option value="notice">公告</option>
                  <option value="update">更新</option>
                  <option value="important">重要</option>
                </select>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={draft.pinned} onChange={(event) => setDraft({ ...draft, pinned: event.target.checked })} />
                置顶显示
              </label>
            </div>
            {adminError && <div className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{adminError}</div>}
            <div className="flex justify-end gap-3">
              <button onClick={() => setDraft(null)} disabled={saving} className="rounded-lg border border-slate-500/50 px-4 py-2 text-xs text-slate-300 disabled:opacity-50">取消</button>
              <button onClick={() => void saveDraft()} disabled={saving} className="rounded-lg bg-[#d4af37] px-4 py-2 text-xs font-semibold text-[#0a2540] disabled:opacity-50">{saving ? '正在发布…' : '保存并发布'}</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
