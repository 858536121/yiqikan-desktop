import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import RoomScreen from '../screens/RoomScreen';
import { VoiceProvider } from '../services/voice-service';

export type RootStackParamList = {
  Home: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <VoiceProvider>
      <Stack.Navigator
        initialRouteName="Home"
        screenOptions={{
          headerStyle: {
            backgroundColor: '#222',
          },
          headerTintColor: '#fff',
          headerTitleStyle: {
            fontWeight: 'bold',
          },
          contentStyle: {
            backgroundColor: '#111',
          },
        }}
      >
        <Stack.Screen
          name="Home"
          component={RoomScreen}
          options={{ headerShown: false }}
        />
      </Stack.Navigator>
    </VoiceProvider>
  );
}
