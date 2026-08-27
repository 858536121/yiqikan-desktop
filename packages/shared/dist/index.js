export const ROOM_EVENTS = {
    CreateRoom: "room:create",
    JoinRoom: "room:join",
    LeaveRoom: "room:leave",
    CloseRoom: "room:close",
    UpdateRoomPassword: "room:update_password",
    UpdateMemberName: "room:update_member_name",
    KickMember: "room:kick_member",
    TransferHost: "room:transfer_host",
    StateSnapshot: "room:state_snapshot",
    StateUpdate: "room:state:update",
    PlayerEvent: "player:event",
    PlaybackSyncRequest: "player:sync_request",
    PlaybackSyncResponse: "player:sync_response",
    ChatMessage: "chat:message",
    UpdatePublicRoom: "room:update_public",
    RuntimeNotice: "runtime:notice",
    Error: "room:error",
};
export const YIQIKAN_PROTOCOL_VERSION = 1;
export const ROOM_ID_MAX_LENGTH = 12;
function parseVersionPart(value) {
    const normalized = value.trim().split("-")[0] ?? "";
    return normalized
        .split(".")
        .map((part) => Number.parseInt(part, 10))
        .filter((part) => Number.isFinite(part));
}
export function compareVersions(left, right) {
    const leftParts = parseVersionPart(left);
    const rightParts = parseVersionPart(right);
    const length = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < length; index += 1) {
        const leftPart = leftParts[index] ?? 0;
        const rightPart = rightParts[index] ?? 0;
        if (leftPart > rightPart)
            return 1;
        if (leftPart < rightPart)
            return -1;
    }
    return 0;
}
export function isVersionAtLeast(version, minimumVersion) {
    return compareVersions(version, minimumVersion) >= 0;
}
export function normalizeRoomIdInput(value) {
    return value.trim().toLowerCase().slice(0, ROOM_ID_MAX_LENGTH);
}
export function createInitialPlaybackState() {
    return {
        url: null,
        pageTitle: null,
        paused: true,
        currentTime: 0,
        playbackRate: 1,
        duration: null,
        syncId: 0,
        updatedAt: Date.now(),
    };
}
export const DEFAULT_FEATURED_SITES = [
    {
        id: "libvio",
        name: "LIBVIO",
        url: "https://www.libvios.com/",
        publishUrl: "https://libviogroup.github.io/",
        tag: "LIBVIO",
        category: "movie_drama",
        color: "#F97316",
        desc: "4K高清电影、热门美剧与海外剧集无广告观看",
        badge: "主推",
    },
    {
        id: "czzy",
        name: "厂长资源",
        url: "https://czzy.top/",
        publishUrl: "https://czzy88.com/",
        tag: "厂长",
        category: "movie_drama",
        color: "#3B82F6",
        desc: "高清无水印优质影视，欧美日韩电影更新极速",
        badge: "精选",
    },
    {
        id: "ddys",
        name: "低端影视",
        url: "https://ddys.pro/",
        publishUrl: "https://ddys.art/",
        tag: "低端",
        category: "movie_drama",
        color: "#10B981",
        desc: "超清压制画质天花板，原盘高码率影视在线看",
        badge: "超清",
    },
    {
        id: "zxzj",
        name: "在线之家",
        url: "https://www.zxzj.pro/",
        publishUrl: "https://www.zxzj.site/",
        tag: "美剧",
        category: "movie_drama",
        color: "#8B5CF6",
        desc: "专精最新海外美剧、韩剧、大片无删减播放",
        badge: "美剧",
    },
    {
        id: "duboku",
        name: "独播库",
        url: "https://www.duboku.tv/",
        publishUrl: "https://www.duboku.tv/",
        tag: "独播",
        category: "movie_drama",
        color: "#EC4899",
        desc: "海量海外影视剧集，高清免VIP极速播放",
        badge: "免VIP",
    },
    {
        id: "4kvm",
        name: "4K影视",
        url: "https://www.4kvm.net/",
        publishUrl: "https://www.4kvm.net/",
        tag: "4K",
        category: "movie_drama",
        color: "#06B6D4",
        desc: "高码率4K超清电影，视觉震撼体验",
        badge: "4K",
    },
];
//# sourceMappingURL=index.js.map