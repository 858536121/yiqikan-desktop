import React, { useEffect } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { mobileTelemetry } from './src/services/telemetry';

export default function App() {
  useEffect(() => {
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

