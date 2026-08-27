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
//# sourceMappingURL=index.js.map