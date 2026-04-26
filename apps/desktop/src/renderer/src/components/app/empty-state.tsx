import type { RoomState } from "@yiqikan/shared";
import { ExternalLink, History } from "lucide-react";
import { cn } from "../../lib/utils";

interface EmptyStateProps {
  room: RoomState | null;
  lastUrl: string;
  lastTitle: string;
  onOpenLastUrl: () => void;
}

export function EmptyState({ room, lastUrl, lastTitle, onOpenLastUrl }: EmptyStateProps) {
  const displayTitle = lastTitle || lastUrl;
  const displayUrl = lastUrl ? (lastUrl.length > 60 ? lastUrl.slice(0, 60) + "…" : lastUrl) : "";

  return (
    <div className="h-full flex items-center justify-center p-8 bg-[#111113]">
      <div className="max-w-lg w-full text-center space-y-8">
        <div className="space-y-2">
          <p className="text-orange-500 text-xs uppercase tracking-[0.2em] font-semibold">YiQiKan · 异起看</p>
          <h2 className="text-2xl font-bold text-white">异地开启同步观影</h2>
          <p className="text-zinc-400 text-sm">在地址栏输入网址开始浏览，随时可以创建房间邀请朋友</p>
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

        <div className="grid gap-3 text-left">
          <StepCard step={1} title="输入网址开始浏览" desc="上方地址栏输入想看的网页地址，点击「前往」" done={false} />
          <StepCard step={2} title="创建或加入房间" desc="在右侧面板填写昵称，创建一个新房间或输入房间号加入" done={!!room} />
          <StepCard step={3} title="开始同步浏览" desc="页面中的视频会自动检测并同步播放进度、暂停和倍速" done={!!room?.playback.url && (room?.members.length ?? 0) > 1} />
        </div>
      </div>
    </div>
  );
}

function StepCard({ step, title, desc, done }: { step: number; title: string; desc: string; done: boolean }) {
  return (
    <div
      className={cn(
        "flex items-start gap-4 rounded-xl border p-4 transition-colors",
        done ? "border-orange-500/20 bg-orange-500/5" : "border-white/[0.08] bg-white/[0.03]",
      )}
    >
      <div
        className={cn(
          "shrink-0 w-8 h-8 rounded-lg flex items-center justify-center text-sm font-bold",
          done ? "bg-gradient-to-br from-orange-500 to-rose-500 text-white" : "bg-white/[0.08] text-zinc-400",
        )}
      >
        {done ? "✓" : step}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white">{title}</p>
        <p className="text-xs text-zinc-400 mt-0.5">{desc}</p>
      </div>
    </div>
  );
}
