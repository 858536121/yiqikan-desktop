import React, { useEffect, useRef } from 'react';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { AppState, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import AppNavigator from './src/navigation/AppNavigator';
import { mobileTelemetry } from './src/services/telemetry';
import { otaService } from './src/services/ota-service';
import { GlobalDialog } from './src/components/app/global-dialog';
import { RegistrationVerificationDialog } from './src/components/app/registration-verification-dialog';
import { siteRuleService } from './src/services/site-rules';
import { AutomaticUpdateManager } from './src/components/app/automatic-update-manager';
import { automaticUpdates } from './src/services/automatic-updates';

// 保持启动图常驻，避免在 JS Runtime 加载期间闪白屏
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  const splashHidden = useRef(false);
  useEffect(() => {
    otaService.getCurrentBundleVersion().then(bundleVersion => mobileTelemetry.init({
      appVersion: otaService.getBaseAppVersion(), bundleVersion,
    })).catch((err) => {
      console.log('Mobile telemetry init error:', err);
    });

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
      <AutomaticUpdateManager />
      <View style={{ flex: 1 }} onTouchStart={() => automaticUpdates.interaction()} onLayout={() => {
        if (!splashHidden.current) {
          splashHidden.current = true;
          void SplashScreen.hideAsync().catch(() => {});
        }
      }}>
        <NavigationContainer theme={DarkTheme}>
          <AppNavigator />
        </NavigationContainer>
        <GlobalDialog />
        <RegistrationVerificationDialog />
      </View>
    </SafeAreaProvider>
  );
}

