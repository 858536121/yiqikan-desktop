import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { ROOM_ID_MAX_LENGTH, type RoomState } from "@yiqikan/shared";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Film,
  LogOut,
  Maximize,
  Minus,
  Pause,
  Pencil,
  Play,
  Plus,
  Send,
  Users,
  Volume2,
  VolumeOff,
} from "lucide-react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";

interface VideoStatus {
  found: boolean;
  currentTime?: number;
  duration?: number;
  paused?: boolean;
  playbackRate?: number;
}

interface RightSidebarProps {
  status: string;
  socketId: string;
  room: RoomState | null;
  error: string;
  name: string;
  roomCode: string;
  password: string;
  roomPasswordVisible: boolean;
  copied: boolean;
  editingPassword: boolean;
  roomInfoCollapsed: boolean;
  currentUserId: string;
  pageTitle: string;
  memberLocalPause: boolean;
  showNoVideoHint: boolean;
  videoDetected: boolean;
  videoStatus: VideoStatus | null;
  videoSignalLost: boolean;
  isHost: boolean;
  localVolume: number;
  chatDraft: string;
  danmakuEnabled: boolean;
  ttsEnabled: boolean;
  chatScrollRef: MutableRefObject<HTMLDivElement | null>;
  onCollapse: () => void;
  onNameChange: (value: string) => void;
  onRoomCodeChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onToggleRoomPasswordVisibility: () => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onCloseRoom: () => void;
  onCopyRoomCode: () => void;
  onToggleRoomInfoCollapsed: () => void;
  onStartEditingPassword: () => void;
  onSaveRoomPassword: () => void;
  onTogglePlayPause: () => void;
  onSeekTo: (time: number) => void;
  onRequestFullscreen: () => void;
  setLocalVolume: Dispatch<SetStateAction<number>>;
  onChatDraftChange: (value: string) => void;
  onToggleDanmaku: () => void;
  onToggleTts: () => void;
  onSubmitChatMessage: () => void;
}

export function RightSidebar({
  status,
  socketId,
  room,
  error,
  name,
  roomCode,
  password,
  roomPasswordVisible,
  copied,
  editingPassword,
  roomInfoCollapsed,
  currentUserId,
  pageTitle,
  memberLocalPause,
  showNoVideoHint,
  videoDetected,
  videoStatus,
  videoSignalLost,
  isHost,
  localVolume,
  chatDraft,
  danmakuEnabled,
  ttsEnabled,
  chatScrollRef,
  onCollapse,
  onNameChange,
  onRoomCodeChange,
  onPasswordChange,
  onToggleRoomPasswordVisibility,
  onCreateRoom,
  onJoinRoom,
  onCloseRoom,
  onCopyRoomCode,
  onToggleRoomInfoCollapsed,
  onStartEditingPassword,
  onSaveRoomPassword,
  onTogglePlayPause,
  onSeekTo,
  onRequestFullscreen,
  setLocalVolume,
  onChatDraftChange,
  onToggleDanmaku,
  onToggleTts,
  onSubmitChatMessage,
}: RightSidebarProps) {
  const connectionLabel = socketId ? "已连接实时服务" : status;

  return (
    <aside className="h-screen w-[340px] border-l border-white/[0.08] bg-[#111113] transition-all duration-300 flex flex-col shrink-0">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-white/[0.08] shrink-0">
        <div className="min-w-0 shrink-0">
          <p className="text-[10px] font-bold tracking-[0.2em] text-orange-500 uppercase">YiQiKan</p>
          <h1 className="text-sm font-bold text-white truncate">异起看</h1>
        </div>
        <div className="flex-1" />
        <Button variant="ghost" className="shrink-0 w-7 h-7 p-0 rounded-lg" onClick={onCollapse} title="折叠面板">
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-3 py-3">
        <div className="flex min-h-full flex-col gap-3">
          {!room ? (
            <>
              <Card className="shrink-0">
                <div className="flex items-center gap-2 mb-3">
                  <Users className="w-4 h-4 text-orange-500" />
                  <h2 className="text-sm font-semibold text-white">房间</h2>
                </div>
                <div className="space-y-2.5">
                  <Input
                    value={name}
                    onChange={(e) => onNameChange(e.target.value)}
                    placeholder="你的昵称"
                    className="placeholder:text-xs"
                  />
                  <Input
                    value={roomCode}
                    onChange={(e) => onRoomCodeChange(e.target.value.toLowerCase().slice(0, ROOM_ID_MAX_LENGTH))}
                    placeholder={`房间号（最多 ${ROOM_ID_MAX_LENGTH} 位，不填自动生成）`}
                    maxLength={ROOM_ID_MAX_LENGTH}
                    className="placeholder:text-xs"
                  />
                  <Input
                    value={password}
                    onChange={(e) => onPasswordChange(e.target.value)}
                    placeholder="房间密码（可选）"
                    type="password"
                    className="py-2 text-xs placeholder:text-xs"
                  />
                  <div className="flex gap-2">
                    <Button disabled={!name.trim()} onClick={onCreateRoom} className="flex-1 text-xs">创建房间</Button>
                    <Button variant="secondary" disabled={!name.trim() || !roomCode.trim()} onClick={onJoinRoom} className="flex-1 text-xs">加入房间</Button>
                  </div>
                </div>
                {error && <p className="mt-2 text-xs text-error">{error}</p>}
              </Card>
              <Card className="shrink-0">
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-white">聊天和成员列表会在进入房间后显示</p>
                  <p className="text-xs text-zinc-400">进入房间后，成员可以在右侧发送消息，也可以各自暂停本地视频，再次播放时会追上房主进度。</p>
                </div>
              </Card>
            </>
          ) : (
            <>
              {/* Room info card */}
              <Card className="shrink-0 p-4">
                <div className="mb-2.5 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={onToggleRoomInfoCollapsed}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    title={roomInfoCollapsed ? "展开房间信息" : "折叠房间信息"}
                  >
                    <Users className="w-4 h-4 text-orange-500" />
                    <h2 className="text-sm font-semibold text-white">房间信息</h2>
                    <ChevronDown className={cn("w-4 h-4 text-zinc-500 transition-transform", roomInfoCollapsed && "-rotate-90")} />
                  </button>
                  <div className="ml-2 flex items-center gap-2 shrink-0">
                    <div
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-2 py-1 text-[10px] leading-none",
                        socketId
                          ? "border-green-500/20 bg-green-500/10 text-green-400"
                          : "border-white/[0.08] bg-white/[0.04] text-zinc-400",
                      )}
                      title={connectionLabel}
                    >
                      <span
                        className={cn(
                          "h-1.5 w-1.5 rounded-full shrink-0",
                          socketId ? "bg-green-400 living-dot" : "bg-orange-500",
                        )}
                      />
                      <span className="whitespace-nowrap">{connectionLabel}</span>
                    </div>
                    <Button
                      variant="ghost"
                      className="w-7 h-7 p-0 text-rose-400 hover:text-rose-300"
                      onClick={onCloseRoom}
                      title={isHost ? "关闭房间" : "退出房间"}
                    >
                      <LogOut className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                {!roomInfoCollapsed && (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-1.5">
                        <p className="shrink-0 text-[11px] font-medium text-zinc-500">房间号</p>
                        <p className="min-w-0 select-all truncate font-mono text-sm font-semibold tracking-[0.12em] text-white">
                          {room.id}
                        </p>
                      </div>
                      <button onClick={onCopyRoomCode} className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors", copied ? "bg-green-500/15 border-green-500/25" : "bg-white/[0.04] border-white/[0.1] hover:bg-white/[0.08]")} title="复制房间号">
                        <Copy className={cn("w-3.5 h-3.5", copied ? "text-green-400" : "text-zinc-500")} />
                      </button>
                    </div>
                    {isHost && (
                      <div className="flex items-center gap-2">
                        <div className="relative flex-1">
                          <Input
                            value={password}
                            onChange={(e) => onPasswordChange(e.target.value)}
                            placeholder="房间密码（可选）"
                            type={editingPassword && roomPasswordVisible ? "text" : "password"}
                            disabled={!editingPassword}
                            className={cn(
                              "py-2 pr-9 text-xs placeholder:text-xs",
                              !editingPassword && "opacity-60",
                            )}
                          />
                          {editingPassword && (
                            <button
                              type="button"
                              onClick={onToggleRoomPasswordVisibility}
                              className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-white/[0.08] hover:text-white"
                              title={roomPasswordVisible ? "隐藏密码" : "显示密码"}
                            >
                              {roomPasswordVisible ? (
                                <EyeOff className="h-3.5 w-3.5" />
                              ) : (
                                <Eye className="h-3.5 w-3.5" />
                              )}
                            </button>
                          )}
                        </div>
                        <button
                          onClick={editingPassword ? onSaveRoomPassword : onStartEditingPassword}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.1] bg-white/[0.04] transition-colors hover:bg-white/[0.08]"
                          title={editingPassword ? "保存密码" : "修改密码"}
                        >
                          {editingPassword ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Pencil className="w-3.5 h-3.5 text-zinc-500" />}
                        </button>
                      </div>
                    )}
                    {room.playback.url && (
                      <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-2">
                        <p className="mb-1 text-[10px] uppercase tracking-[0.16em] text-zinc-500">当前页面</p>
                        <p className="text-xs text-zinc-400 truncate">{pageTitle}</p>
                      </div>
                    )}
                    <div className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-2.5 py-2.5">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 min-w-0">
                          <Users className="w-4 h-4 text-orange-500" />
                          <p className="text-sm font-semibold text-white">
                            成员列表<span className="ml-1.5 text-zinc-500 font-normal">{room.members.length}</span>
                          </p>
                        </div>
                        <p className="text-[10px] text-zinc-600">左右滑动查看</p>
                      </div>
                      <div className="flex overflow-x-auto pb-1 pr-1">
                        {room.members.map((member, index) => (
                          <div key={member.id} className="flex shrink-0 items-center">
                            <div className="min-w-[64px] px-1.5 text-center" title={member.name}>
                              <div className={cn(
                                "mx-auto mb-1.5 flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold",
                                member.isHost ? "bg-orange-500/15 text-orange-400" : "bg-white/[0.08] text-white",
                              )}>
                                {getMemberInitial(member.name)}
                              </div>
                              <p className="max-w-[60px] truncate text-center text-xs text-white">{member.name}</p>
                              <p className="mt-0.5 text-center text-[10px] text-zinc-500">
                                {member.id === currentUserId ? "你自己" : member.isHost ? "房主" : "成员"}
                              </p>
                            </div>
                            {index < room.members.length - 1 && (
                              <span className="px-1 text-xs text-zinc-700">|</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {error && <p className="mt-2 text-xs text-error">{error}</p>}
              </Card>

              {showNoVideoHint && (
                <Card className="shrink-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Film className="w-4 h-4 text-orange-500" />
                    <h2 className="text-sm font-semibold text-white">视频</h2>
                  </div>
                  <div className="space-y-1.5 text-xs text-zinc-400">
                    <p>当前页面暂未检测到可同步视频。</p>
                    <p>可能是纯网页、视频还没开始加载，或者该站点暂时不支持同步。</p>
                  </div>
                </Card>
              )}

              {videoDetected && videoStatus && (
                <Card className="shrink-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Film className="w-4 h-4 text-orange-500" />
                    <h2 className="text-sm font-semibold text-white">视频</h2>
                    {videoSignalLost && (
                      <span className="ml-auto rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] text-zinc-500">
                        显示上次检测状态
                      </span>
                    )}
                  </div>
                  <div className="space-y-2.5">
                    <div className="space-y-1">
                      <div className="flex justify-between text-xs">
                        <span className="text-zinc-500 font-mono">{formatTime(videoStatus.currentTime ?? 0)}</span>
                        <span className="text-zinc-500 font-mono">{formatTime(videoStatus.duration ?? 0)}</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={videoStatus.duration || 0}
                        step={1}
                        value={videoStatus.currentTime ?? 0}
                        onChange={(e) => { if (isHost) onSeekTo(Number(e.target.value)); }}
                        disabled={!isHost}
                        className="w-full h-1 accent-orange-500 cursor-pointer disabled:cursor-default disabled:opacity-70"
                        title={isHost ? "拖动调整进度" : "仅房主可调整进度"}
                      />
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        className="w-9 h-9 p-0 rounded-lg"
                        onClick={onTogglePlayPause}
                        title={isHost ? (videoStatus.paused ? "播放" : "暂停") : (memberLocalPause ? "继续跟播" : "暂停跟播")}
                      >
                        {isHost
                          ? (videoStatus.paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />)
                          : (memberLocalPause ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />)
                        }
                      </Button>
                      <div className="flex-1 flex items-center gap-1 text-xs text-zinc-400">
                        {isHost ? (
                          <span className={videoStatus.paused ? "text-orange-400" : "text-green-400"}>
                            {videoStatus.paused ? "已暂停" : "播放中"}
                          </span>
                        ) : (
                          <span className={memberLocalPause ? "text-orange-400" : "text-green-400"}>
                            {memberLocalPause ? "暂停跟播" : "跟播中"}
                          </span>
                        )}
                        <span className="text-zinc-600 ml-auto">{videoStatus.playbackRate ?? 1}x</span>
                      </div>
                      <Button
                        variant="secondary"
                        className="w-9 h-9 p-0 rounded-lg shrink-0"
                        onClick={onRequestFullscreen}
                        title="全屏播放"
                      >
                        <Maximize className="w-4 h-4" />
                      </Button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Volume2 className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
                      <button onClick={() => setLocalVolume((value) => Math.max(0, value - 10))} className="shrink-0 w-6 h-6 rounded-md bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center transition-colors" title="音量-10%">
                        <Minus className="w-3 h-3 text-zinc-500" />
                      </button>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={Math.min(localVolume, 100)}
                        onChange={(e) => setLocalVolume(Number(e.target.value))}
                        className="flex-1 h-1 accent-orange-500 cursor-pointer"
                        title={`音量 ${localVolume}%`}
                      />
                      <button onClick={() => setLocalVolume((value) => Math.min(800, value + 10))} className="shrink-0 w-6 h-6 rounded-md bg-white/[0.06] hover:bg-white/[0.12] flex items-center justify-center transition-colors" title="音量+10%（最大800%）">
                        <Plus className="w-3 h-3 text-zinc-500" />
                      </button>
                      <span className="text-[10px] text-zinc-500 w-10 text-right">{localVolume}%</span>
                    </div>

                    {!isHost && (
                      <p className="text-[10px] text-zinc-500">
                        你可以先暂停自己的视频；再次点播放时，会立刻同步到房主当前的暂停/播放状态和进度。
                      </p>
                    )}
                    {videoSignalLost && (
                      <p className="text-[10px] text-zinc-500">当前视频心跳中断，卡片已保留，恢复检测后会自动更新。</p>
                    )}
                  </div>
                </Card>
              )}

              {/* Chat card */}
              <Card className="flex h-[360px] max-h-[42vh] min-h-[280px] flex-col overflow-hidden p-0">
                <div className="flex items-center gap-2 border-b border-white/[0.08] px-4 py-3 shrink-0">
                  <Send className="w-4 h-4 text-orange-500" />
                  <h2 className="text-sm font-semibold text-white">聊天</h2>
                  <Button
                    type="button"
                    variant="ghost"
                    className="ml-auto h-[22px] rounded-full border border-white/[0.08] px-1.5 text-[10px] text-zinc-500 hover:border-orange-500/20 hover:text-white"
                    onClick={onToggleDanmaku}
                    title={danmakuEnabled ? "关闭弹幕" : "开启弹幕"}
                  >
                    {danmakuEnabled ? <Eye className="h-2.5 w-2.5" /> : <EyeOff className="h-2.5 w-2.5" />}
                    <span className="text-[10px]">弹幕</span>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="h-[22px] rounded-full border border-white/[0.08] px-1.5 text-[10px] text-zinc-500 hover:border-orange-500/20 hover:text-white"
                    onClick={onToggleTts}
                    title={ttsEnabled ? "关闭语音朗读" : "开启语音朗读"}
                  >
                    {ttsEnabled ? <Volume2 className="h-2.5 w-2.5" /> : <VolumeOff className="h-2.5 w-2.5" />}
                    <span className="text-[10px]">朗读</span>
                  </Button>
                  <span className="text-[10px] text-zinc-600">{room.chatMessages.length} 条消息</span>
                </div>
                <div
                  ref={(node) => {
                    chatScrollRef.current = node;
                  }}
                  className="min-h-0 flex-1 overflow-y-auto px-4 py-4 space-y-3"
                >
                  {room.chatMessages.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-white/[0.08] bg-white/[0.02] px-4 py-6 text-center text-xs text-zinc-500">
                      聊天区已就绪。成员的暂停、继续跟播等操作也会显示在这里。
                    </div>
                  ) : (
                    room.chatMessages.map((message) => (
                      message.kind === "system" ? (
                        <div key={message.id} className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-[11px] text-zinc-500">
                          <span>{message.message}</span>
                          <span className="ml-2 text-[10px] text-zinc-600">{formatDateTime(message.createdAt)}</span>
                        </div>
                      ) : (
                        <div key={message.id} className={cn("flex", message.actorId === currentUserId ? "justify-end" : "justify-start")}>
                          <div className={cn(
                            "max-w-[88%] rounded-xl px-3 py-2.5",
                            message.actorId === currentUserId ? "bg-orange-500/15 text-white" : "bg-white/[0.06] text-white",
                          )}>
                            <div className="mb-1 flex items-center gap-2 text-[10px] text-zinc-500">
                              <span className="truncate">{message.actorName}</span>
                              <span>{formatDateTime(message.createdAt)}</span>
                            </div>
                            <p className="text-xs leading-5 break-words">{message.message}</p>
                          </div>
                        </div>
                      )
                    ))
                  )}
                </div>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    onSubmitChatMessage();
                  }}
                  className="flex items-center gap-2 border-t border-white/[0.08] px-3 py-3 shrink-0"
                >
                  <Input
                    value={chatDraft}
                    onChange={(e) => onChatDraftChange(e.target.value)}
                    placeholder="输入消息，回车发送"
                    className="flex-1 py-2 text-xs placeholder:text-xs"
                  />
                  <Button type="submit" disabled={!chatDraft.trim()} className="h-9 px-3 text-xs shrink-0">
                    <Send className="w-3.5 h-3.5" />
                  </Button>
                </form>
              </Card>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function getMemberInitial(memberName: string) {
  const trimmed = memberName.trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 1).toUpperCase();
}

function formatDateTime(ts: number) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
      month: "numeric",
      day: "numeric",
    }).format(ts);
  } catch {
    return new Date(ts).toLocaleString();
  }
}

function formatTime(seconds: number) {
  if (!seconds || !isFinite(seconds)) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}
