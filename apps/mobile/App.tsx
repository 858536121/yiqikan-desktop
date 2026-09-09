import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { mobileTelemetry } from './src/services/telemetry';
import { otaService } from './src/services/ota-service';

export default function App() {
  useEffect(() => {
    // 根组件挂载成功，说明 JS Runtime 与基础组件均已正常初始化，立即重置热更崩溃计数器
    otaService.markOtaSuccess().catch(() => {});

    mobileTelemetry.init().catch((err) => {
      console.log('Mobile telemetry init error:', err);
    });
  }, []);

  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <AppNavigator />
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

