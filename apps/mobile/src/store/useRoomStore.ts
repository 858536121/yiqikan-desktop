import { create } from 'zustand';
import { RoomState, ChatMessage } from '@yiqikan/shared';
import type { MobilePlayerEvent } from '../utils/playback-sync';

interface RoomStoreState {
  isConnected: boolean;
  error: string | null;
  errorCode: string | null;
  roomState: RoomState | null;
  isHost: boolean;
  savedPassword: string;
  memberLocalPause: boolean;
  memberMediaPending: boolean;
  currentPlaybackRate: number;
  chatMessages: ChatMessage[];
  lastRemotePlayerEvent: MobilePlayerEvent | null;
  toastMessage: string;
  
  setConnected: (connected: boolean) => void;
  setError: (error: string | null, code?: string | null) => void;
  setRoomState: (state: RoomState) => void;
  setIsHost: (isHost: boolean) => void;
  setSavedPassword: (password: string) => void;
  setMemberLocalPause: (paused: boolean) => void;
  setMemberMediaPending: (pending: boolean) => void;
  setCurrentPlaybackRate: (rate: number) => void;
  addChatMessage: (message: ChatMessage) => void;
  handleRemotePlayerEvent: (event: MobilePlayerEvent) => void;
  showToast: (message: string) => void;
  reset: () => void;
}

export const useRoomStore = create<RoomStoreState>((set) => ({
  isConnected: false,
  error: null,
  errorCode: null,
  roomState: null,
  isHost: false,
  savedPassword: '',
  memberLocalPause: false,
  memberMediaPending: false,
  currentPlaybackRate: 1,
  chatMessages: [],
  lastRemotePlayerEvent: null,
  toastMessage: '',

  setConnected: (connected) => set({ isConnected: connected }),
  setError: (error, code = null) => set({ error, errorCode: code }),
  setIsHost: (isHost) => set({ isHost }),
  setSavedPassword: (savedPassword) => set({ savedPassword }),
  setMemberLocalPause: (memberLocalPause) => set({ memberLocalPause }),
  setMemberMediaPending: (memberMediaPending) => set({ memberMediaPending }),
  setCurrentPlaybackRate: (currentPlaybackRate) => set({ currentPlaybackRate }),
  showToast: (message: string) => set({ toastMessage: message }),
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
    errorCode: null,
    roomState: null,
    isHost: false,
    savedPassword: '',
    memberLocalPause: false,
    memberMediaPending: false,
    currentPlaybackRate: 1,
    chatMessages: [],
    lastRemotePlayerEvent: null,
  })),
}));

