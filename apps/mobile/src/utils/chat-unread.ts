type ReadableMessage = { id: string; actorId?: string; kind?: string };

export function getUnreadChatCount(messages: ReadableMessage[], lastReadId: string | null, myUserId: string): number {
  const readIndex = lastReadId ? messages.findIndex(message => message.id === lastReadId) : -1;
  return messages.slice(readIndex + 1).filter(message => message.kind !== 'system' && message.actorId !== myUserId).length;
}
