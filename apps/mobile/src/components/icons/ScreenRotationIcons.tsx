import React from 'react';
import Svg, { Rect, Path } from 'react-native-svg';

export const RotateToLandscapeIcon = ({ color = '#fff', size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {/* Vertical phone outline (faded/dashed) */}
    <Rect x="9" y="3" width="10" height="16" rx="2" ry="2" strokeDasharray="3 3" opacity={0.5} />
    {/* Horizontal phone outline (solid) */}
    <Rect x="2" y="8" width="16" height="10" rx="2" ry="2" fill="#141416" />
    {/* Curved arrow from vertical to horizontal */}
    <Path d="M20 18c0 1.5-1 3-3 3H7" />
    <Path d="M9 23l-3-2 3-2" />
  </Svg>
);

export const RotateToPortraitIcon = ({ color = '#fff', size = 24 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {/* Horizontal phone outline (faded/dashed) */}
    <Rect x="3" y="9" width="16" height="10" rx="2" ry="2" strokeDasharray="3 3" opacity={0.5} />
    {/* Vertical phone outline (solid) */}
    <Rect x="8" y="2" width="10" height="16" rx="2" ry="2" fill="#141416" />
    {/* Curved arrow from horizontal to vertical */}
    <Path d="M6 21c-1.5 0-3-1-3-3V7" />
    <Path d="M1 9l2-3 2 3" />
  </Svg>
);
