import { useEffect, useState } from "react";
import type { RoomState } from "@yiqikan/shared";
import { Compass, ExternalLink, Globe, History, Search } from "lucide-react";
import { cn } from "../../lib/utils";

interface EmptyStateProps {
  room: RoomState | null;
  lastUrl: string;
  lastTitle: string;
  onOpenLastUrl: () => void;
  onNavigate: (value: string) => void;
}

export interface RecommendSite {
  name: string;
  url: string;
  color: string;
  tag: string;
}

export function AppLogo({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 512 512" className={className} fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="logo-bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#e11d48" />
        </linearGradient>
        <linearGradient id="logo-screen" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.75)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.55)" />
        </linearGradient>
      </defs>
      <rect x="16" y="16" width="480" height="480" rx="112" ry="112" fill="url(#logo-bg)" />
      <rect x="196" y="128" width="200" height="148" rx="20" ry="20" fill="rgba(255,255,255,0.3)" />
      <rect x="116" y="196" width="200" height="148" rx="20" ry="20" fill="url(#logo-screen)" />
      <polygon points="196,245 196,305 242,275" fill="url(#logo-bg)" opacity="0.95" />
      <circle cx="296" cy="248" r="14" fill="white" opacity="0.9" />
      <circle cx="296" cy="248" r="6" fill="url(#logo-bg)" />
    </svg>
  );
}

const DEFAULT_RECOMMEND_SITES: RecommendSite[] = [
  { name: "哔哩哔哩", url: "https://www.bilibili.com", color: "#00AEEC", tag: "B站" },
  { name: "Libvio影视", url: "https://www.libvio.app", color: "#F97316", tag: "Libvio" },
];

export function EmptyState({ room, lastUrl, lastTitle, onOpenLastUrl, onNavigate }: EmptyStateProps) {
  const [query, setQuery] = useState("");
  const [recommendSites, setRecommendSites] = useState<RecommendSite[]>(DEFAULT_RECOMMEND_SITES);
  const [searchTemplate, setSearchTemplate] = useState("https://yandex.com/search/?text=%s");
  const displayTitle = lastTitle || lastUrl;
  const displayUrl = lastUrl ? (lastUrl.length > 60 ? lastUrl.slice(0, 60) + "…" : lastUrl) : "";

  useEffect(() => {
    fetch("https://yiqikan.cpolar.cn/api/recommend-sites", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: RecommendSite[]) => {
        if (Array.isArray(data) && data.length > 0) {
          setRecommendSites(data);
        }
      })
      .catch(() => {
        // use default
      });

    fetch("https://yiqikan.cpolar.cn/api/search-config", { cache: "no-store" })
      .then((res) => res.json())
      .then((data: { templateUrl?: string }) => {
        if (data?.templateUrl) {
          setSearchTemplate(data.templateUrl);
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-[#111113]">
      <div className="min-h-full flex items-center justify-center p-8">
        <div className="max-w-xl w-full text-center space-y-7">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs font-medium mb-1 shadow-sm shadow-orange-500/5">
              <AppLogo className="w-4 h-4 rounded-sm" />
              <span className="font-semibold tracking-wide">YiQiKan · 异起看</span>
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">异地开启同步观影</h2>
            <p className="text-zinc-400 text-sm">搜索影视资源，或直接点击精选站点快速开播</p>
          </div>

          {/* 搜索框 (支持从后台动态读取搜索引擎配置) */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (query.trim()) {
                const trimmed = query.trim();
                const isDomain = /^[^\s]+\.[^\s]+$/.test(trimmed);
                const searchUrl = isDomain
                  ? (trimmed.startsWith("http") ? trimmed : `https://${trimmed}`)
                  : (searchTemplate.includes("%s")
                      ? searchTemplate.replace(/%s/g, encodeURIComponent(trimmed))
                      : `${searchTemplate}${encodeURIComponent(trimmed)}`);
                onNavigate(searchUrl);
              }
            }}
            className="relative"
          >
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索影视电影、动漫、视频或直接输入网址…"
              className="w-full rounded-2xl border border-white/[0.1] bg-white/[0.04] pl-10 pr-24 py-3.5 text-sm text-white placeholder:text-zinc-500 outline-none focus:border-orange-500/50 focus:ring-2 focus:ring-orange-500/20 focus:bg-white/[0.06] transition-all shadow-lg shadow-black/40"
            />
            <button
              type="submit"
              disabled={!query.trim()}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-orange-500 hover:bg-orange-400 disabled:opacity-30 disabled:cursor-default text-white text-xs font-semibold px-4 py-2 transition-all shadow-md shadow-orange-500/20 active:scale-95"
            >
              搜索
            </button>
          </form>

          {/* 常用站点推荐专区 (支持后台动态配置 Tag 与多个站点) */}
          <div className="text-left">
            <p className="text-xs font-semibold text-zinc-400 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <Compass className="w-3.5 h-3.5 text-orange-400" />
              精选推荐站点
            </p>
            <div className="grid grid-cols-2 gap-3">
              {recommendSites.map((site, index) => (
                <button
                  key={`${site.url}-${index}`}
                  onClick={() => onNavigate(site.url)}
                  className="group relative flex items-center justify-between p-3.5 rounded-2xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.07] hover:border-orange-500/30 transition-all text-left shadow-sm hover:shadow-md hover:shadow-orange-500/5 cursor-pointer"
                >
                  <div className="flex items-center gap-3 min-w-0 pr-2">
                    <div
                      className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border border-white/10"
                      style={{ backgroundColor: `${site.color || "#F97316"}20` }}
                    >
                      <Globe className="w-4 h-4" style={{ color: site.color || "#F97316" }} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-zinc-100 group-hover:text-white transition-colors truncate">
                        {site.name}
                      </p>
                      <p className="text-[11px] text-zinc-500 truncate font-mono">
                        {site.url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
                      </p>
                    </div>
                  </div>
                  {site.tag ? (
                    <span
                      className="shrink-0 text-[10px] font-semibold px-2 py-0.5 rounded-md border"
                      style={{
                        backgroundColor: `${site.color || "#F97316"}15`,
                        borderColor: `${site.color || "#F97316"}35`,
                        color: site.color || "#F97316",
                      }}
                    >
                      {site.tag}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          {lastUrl && (
            <div className="text-left">
              <p className="text-xs text-zinc-500 uppercase tracking-widest mb-2 flex items-center gap-1.5">
                <History className="w-3 h-3" />
                上次浏览
              </p>
              <button
                onClick={onOpenLastUrl}
                className="w-full flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06] hover:border-orange-500/30 px-4 py-3 transition-all group text-left"
              >
                <div className="shrink-0 w-8 h-8 rounded-lg bg-orange-500/10 flex items-center justify-center">
                  <ExternalLink className="w-3.5 h-3.5 text-orange-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-white truncate group-hover:text-orange-300 transition-colors">
                    {displayTitle}
                  </p>
                  {lastTitle && (
                    <p className="text-xs text-zinc-500 truncate mt-0.5">{displayUrl}</p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-zinc-600 group-hover:text-orange-400 transition-colors">
                  继续 →
                </span>
              </button>
            </div>
          )}

          <div className="grid gap-2.5 text-left pt-2">
            <StepCard step={1} title="搜索或输入网址" desc="在搜索框搜索影视或在上方直接输入播放链接" done={false} />
            <StepCard step={2} title="创建或加入房间" desc="在右侧面板创建房间并邀请好友加入" done={!!room} />
            <StepCard step={3} title="开始同步浏览" desc="页面中视频自动检测，毫秒级同步播放、暂停与进度" done={!!room?.playback.url && (room?.members.length ?? 0) > 1} />
          </div>
        </div>
      </div>
    </div>
  );
}

function StepCard({ step, title, desc, done }: { step: number; title: string; desc: string; done: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3.5 rounded-xl border p-3.5 transition-colors",
        done ? "border-orange-500/20 bg-orange-500/5" : "border-white/[0.06] bg-white/[0.02]",
      )}
    >
      <div
        className={cn(
          "shrink-0 w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold",
          done ? "bg-gradient-to-br from-orange-500 to-rose-500 text-white" : "bg-white/[0.08] text-zinc-400",
        )}
      >
        {done ? "✓" : step}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-white">{title}</p>
        <p className="text-[11px] text-zinc-400 mt-0.5">{desc}</p>
      </div>
    </div>
  );
}
