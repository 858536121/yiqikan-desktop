import React from 'react';
import Svg, { G, Path, Text } from 'react-native-svg';

function SeekStepIcon({ forward, color = '#fff', size = 24 }: { forward: boolean; color?: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <G transform={forward ? 'translate(24 0) scale(-1 1)' : undefined} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        <Path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <Path d="M3 3v5h5" />
      </G>
      <Text x={12} y={15.5} textAnchor="middle" fill={color} fontSize={8.5} fontWeight="700">10</Text>
    </Svg>
  );
}

export const SeekBackward10Icon = (props: { color?: string; size?: number }) => <SeekStepIcon {...props} forward={false} />;
export const SeekForward10Icon = (props: { color?: string; size?: number }) => <SeekStepIcon {...props} forward />;
