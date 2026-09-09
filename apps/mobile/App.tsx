import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import AppNavigator from './src/navigation/AppNavigator';
import { mobileTelemetry } from './src/services/telemetry';
import { otaService } from './src/services/ota-service';

// 保持启动图常驻，避免在 JS Runtime 加载期间闪白屏
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  useEffect(() => {
    // 根组件挂载成功，说明 JS Runtime 与基础组件均已正常初始化，立即重置热更崩溃计数器
    otaService.markOtaSuccess().catch(() => {});

    mobileTelemetry.init().catch((err) => {
      console.log('Mobile telemetry init error:', err);
    });

    // 基础准备就绪后，优雅平滑隐藏启动画面
    const timer = setTimeout(() => {
      SplashScreen.hideAsync().catch(() => {});
    }, 150);

    return () => clearTimeout(timer);
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

