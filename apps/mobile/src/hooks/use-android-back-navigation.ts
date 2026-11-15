import { useEffect } from 'react';
import { BackHandler, Keyboard, Platform } from 'react-native';
import type { AppTab } from '../components/app/module-shell';

interface AndroidBackNavigation {
  fullscreen: boolean;
  keyboardVisible: boolean;
  addressEditing: boolean;
  quickChatOpen: boolean;
  activeTab: AppTab;
  historyVisible: boolean;
  floatingPlayer: boolean;
  canNavigate: boolean;
  canGoBack: () => boolean;
  closeQuickChat: () => void;
  closeHistory: () => void;
  profileBack: () => boolean;
  watch: () => void;
  browserBack: () => void;
  requestExit: () => void;
}

export function useAndroidBackNavigation(options: AndroidBackNavigation) {
  // Register after each parent commit: the kept-alive player's listener must
  // not consume Back while the room/profile layer is covering it. In watch
  // mode, fullscreen and floating-player Back remain owned by that listener.
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (options.fullscreen) return false;
      if (options.keyboardVisible || options.addressEditing) { Keyboard.dismiss(); return true; }
      if (options.quickChatOpen) { options.closeQuickChat(); return true; }
      if (options.activeTab === 'profile' && options.historyVisible) { options.closeHistory(); return true; }
      if (options.activeTab === 'profile' && options.profileBack()) return true;
      if (options.activeTab !== 'watch') { options.watch(); return true; }
      if (options.floatingPlayer) return false;
      if (options.canNavigate && options.canGoBack()) { options.browserBack(); return true; }
      options.requestExit();
      return true;
    });
    return () => subscription.remove();
  });
}
