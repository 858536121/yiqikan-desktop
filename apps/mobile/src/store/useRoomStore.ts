import { create } from 'zustand';
import { RoomState, ChatMessage, PlayerEventPayload } from '@yiqikan/shared';

interface RoomStoreState {
  isConnected: boolean;
  error: string | null;
  roomState: RoomState | null;
  isHost: boolean;
  savedPassword: string;
  memberLocalPause: boolean;
  currentPlaybackRate: number;
  chatMessages: ChatMessage[];
  lastRemotePlayerEvent: PlayerEventPayload | null;
  
  setConnected: (connected: boolean) => void;
  setError: (error: string | null) => void;
  setRoomState: (state: RoomState) => void;
  setIsHost: (isHost: boolean) => void;
  setSavedPassword: (password: string) => void;
  setMemberLocalPause: (paused: boolean) => void;
  setCurrentPlaybackRate: (rate: number) => void;
  addChatMessage: (message: ChatMessage) => void;
  handleRemotePlayerEvent: (event: PlayerEventPayload) => void;
  reset: () => void;
}

export const useRoomStore = create<RoomStoreState>((set) => ({
  isConnected: false,
  error: null,
  roomState: null,
  isHost: false,
  savedPassword: '',
  memberLocalPause: false,
  currentPlaybackRate: 1,
  chatMessages: [],
  lastRemotePlayerEvent: null,

  setConnected: (connected) => set({ isConnected: connected }),
  setError: (error) => set({ error }),
  setIsHost: (isHost) => set({ isHost }),
  setSavedPassword: (savedPassword) => set({ savedPassword }),
  setMemberLocalPause: (memberLocalPause) => set({ memberLocalPause }),
  setCurrentPlaybackRate: (currentPlaybackRate) => set({ currentPlaybackRate }),
  setRoomState: (state) => set((prev) => {
    return { 
      roomState: state,
      chatMessages: state.chatMessages || prev.chatMessages
    };
  }),
  addChatMessage: (message) => set((state) => ({ 
    chatMessages: [...state.chatMessages, message] 
  })),
  handleRemotePlayerEvent: (event) => set({ lastRemotePlayerEvent: event }),
  reset: () => set((state) => ({
    isConnected: state.isConnected,
    error: null,
    roomState: null,
    isHost: false,
    savedPassword: '',
    memberLocalPause: false,
    currentPlaybackRate: 1,
    chatMessages: [],
    lastRemotePlayerEvent: null,
  })),
}));
