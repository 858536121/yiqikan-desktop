import React, { useEffect } from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { AppState } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import AppNavigator from './src/navigation/AppNavigator';
import { mobileTelemetry } from './src/services/telemetry';
import { otaService } from './src/services/ota-service';
import { GlobalDialog } from './src/components/app/global-dialog';
import { siteRuleService } from './src/services/site-rules';

// 保持启动图常驻，避免在 JS Runtime 加载期间闪白屏
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  useEffect(() => {
    // 根组件挂载成功，说明 JS Runtime 与基础组件均已正常初始化，立即重置热更崩溃计数器
    otaService.markOtaSuccess().catch(() => {});

    mobileTelemetry.init().catch((err) => {
      console.log('Mobile telemetry init error:', err);
    });

    // 首屏渲染完毕，立刻移除启动图，0 毫秒额外延迟
    SplashScreen.hideAsync().catch(() => {});
  }, []);

  useEffect(() => {
    // Optional background enhancement; never gate startup, navigation or playback.
    void siteRuleService.start();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void siteRuleService.refresh();
    });
    return () => subscription.remove();
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer theme={DarkTheme}>
        <AppNavigator />
      </NavigationContainer>
      <GlobalDialog />
    </SafeAreaProvider>
  );
}

