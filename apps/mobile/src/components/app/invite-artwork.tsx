import React, { useMemo } from 'react';
import QRCode from 'qrcode';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, RadialGradient, Rect, Stop, Text as SvgText } from 'react-native-svg';

export type InviteChannel = 'friend' | 'moments' | 'notes';

export const INVITE_ARTWORK_WIDTH = 720;
export const inviteArtworkHeight = { friend: 826, moments: 868, notes: 960 } satisfies Record<InviteChannel, number>;

export function InviteEntryArtwork() {
  return (
    <Svg width={64} height={48} viewBox="0 0 86 65">
      <Rect x={1} y={1} width={84} height={63} rx={5} fill="#342632" stroke="#7a5554" />
      <Circle cx={64} cy={21} r={12} fill="#f3aa77" />
      <Path d="M2 41 24 31 42 38 60 33 84 39v19H2Z" fill="#67444c" />
      <Path d="M6 59c17-10 39-11 60-6l14 6" stroke="#a86b5e" strokeWidth={1.25} fill="none" />
      <Path d="M14 57v-8h2v-6a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v6h2v8zm23 0v-8h2v-6a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v6h2v8z" fill="#f2d6b1" />
      <Path d="M19 57v3m10-3v3m13-3v3m10-3v3" stroke="#f2d6b1" strokeWidth={1.4} />
    </Svg>
  );
}

const ink = '#ffeed8';
const paperInk = '#492a39';
const serif = 'serif';
const stars = [
  [83, 327, 2], [110, 384, 3], [141, 353, 1], [198, 343, 2], [215, 430, 2], [278, 358, 1],
  [337, 379, 3], [389, 338, 2], [467, 344, 2], [597, 344, 2], [624, 375, 3], [647, 409, 2],
  [150, 427, 1], [325, 467, 2], [396, 414, 2], [678, 349, 1], [81, 461, 2],
];

function QrStamp({ url, y }: { url: string; y: number }) {
  const { size, path } = useMemo(() => {
    const matrix = QRCode.create(url, { errorCorrectionLevel: 'M' }).modules;
    const segments: string[] = [];
    for (let row = 0; row < matrix.size; row++) {
      for (let col = 0; col < matrix.size; col++) {
        if (matrix.get(row, col)) segments.push(`M${col + 4} ${row + 4}h1v1h-1z`);
      }
    }
    return { size: matrix.size + 8, path: segments.join('') };
  }, [url]);
  const scale = Math.floor(185 / size);
  const x = 663 - size * scale;
  return (
    <G transform={`translate(${x} ${y}) scale(${scale})`}>
      <Rect width={size} height={size} fill="#fffaf0" />
      <Path d={path} fill="#211d28" />
    </G>
  );
}

function displayTitle(title: string) {
  const chars = Array.from(title);
  if (chars.length <= 12) return [title];
  return [chars.slice(0, 12).join(''), chars.slice(12, 24).join('') + (chars.length > 24 ? '…' : '')];
}

export function InviteArtwork({ artworkRef, channel, width, title, episode, note, link, roomId }: {
  artworkRef: React.RefObject<Svg | null>;
  channel: InviteChannel;
  width: number;
  title: string;
  episode?: string;
  note: string;
  link?: string;
  roomId?: string;
}) {
  const height = inviteArtworkHeight[channel];
  const lines = displayTitle(title);
  const footer = channel === 'friend' ? 614 : 654;
  const night = channel === 'friend';
  const accessibleLabel = channel === 'notes' ? '异地也能一起看电影，小红书封面'
    : night ? `${title}，${roomId ? '入房电影票' : '观影邀请票'}` : '今晚一起看点什么，朋友圈海报';
  return (
    <Svg ref={artworkRef} width={width} height={width * height / INVITE_ARTWORK_WIDTH}
      viewBox={`0 0 ${INVITE_ARTWORK_WIDTH} ${height}`} accessible accessibilityLabel={accessibleLabel}>
      <Defs>
        <LinearGradient id="night" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#18223e" />
          <Stop offset=".64" stopColor="#563a57" />
          <Stop offset="1" stopColor="#b4676b" />
        </LinearGradient>
        <LinearGradient id="sunset" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#662d49" />
          <Stop offset=".58" stopColor="#a75159" />
          <Stop offset="1" stopColor="#de8866" />
        </LinearGradient>
        <RadialGradient id="moonlight">
          <Stop offset="0" stopColor="#ffe1ab" stopOpacity=".56" />
          <Stop offset="1" stopColor="#ffd398" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      {channel === 'notes' ? (
        <>
          <Rect width={720} height={960} fill="#f3e6d7"/>
          <Rect x={40} y={41} width={640} height={878} fill="none" stroke="#a77576" strokeWidth={1}/>
          <SvgText x={66} y={99} fill={paperInk} fontSize={32} fontWeight="600">异起看</SvgText>
          <SvgText x={64} y={222} fill={paperInk} fontSize={74} fontFamily={serif} fontWeight="700">异地也能</SvgText>
          <SvgText x={64} y={320} fill={paperInk} fontSize={74} fontFamily={serif} fontWeight="700">一起看电影</SvgText>
          <SvgText x={68} y={385} fill="#784756" fontSize={34}>远距离的观影小约会</SvgText>
          <Rect x={65} y={435} width={590} height={376} rx={7} fill="#3f293f"/>
          <Rect x={81} y={451} width={558} height={344} fill="url(#sunset)"/>
          <Circle cx={492} cy={561} r={75} fill="#ffd5a3"/>
          <Path d="M81 710 Q238 581 381 663 Q494 724 639 616 V795 H81Z" fill="#753d56"/>
          <Path d="M81 751 Q284 663 455 724 Q539 750 639 716 V795 H81Z" fill="#533047"/>
          <Circle cx={234} cy={664} r={39} fill="#291e32"/>
          <Path d="M174 795V749a60 60 0 0 1 120 0v46z" fill="#291e32"/>
          <Circle cx={374} cy={664} r={39} fill="#3e2339"/>
          <Path d="M314 795V749a60 60 0 0 1 120 0v46z" fill="#3e2339"/>
          <SvgText x={68} y={873} fill={paperInk} fontSize={28}>同步播放  /  边看边聊</SvgText>
        </>
      ) : (
        <>
          <Rect width={720} height={height} fill={night ? '#ecdbc0' : '#f2dac1'}/>
          <Rect width={720} height={footer} fill={night ? 'url(#night)' : 'url(#sunset)'}/>
          <Rect x={27} y={27} width={666} height={footer - 55} fill="none" stroke="#f4cdbb" strokeOpacity=".41"/>
          <SvgText x={56} y={88} fontSize={32} fill={ink} fontWeight="600">异起看</SvgText>
          <SvgText x={664} y={87} textAnchor="end" fontSize={25} fill={ink}>{night ? '双人电影票' : '观影邀约'}</SvgText>
          <Line x1={56} x2={664} y1={112} y2={112} stroke="#f4cdbb" strokeOpacity=".38"/>
          {night ? (
            <>
              {stars.map(([x, y, r]) => <Circle key={x} cx={x} cy={y} r={r} fill="#ffe0ae" opacity=".55" />)}
              <Circle cx={538} cy={437} r={162} fill="url(#moonlight)"/>
              <Circle cx={538} cy={437} r={64} fill="#ffce98"/>
              <Path d="M0 520 L111 479 L234 519 L339 461 L468 532 L629 483 L720 514 V614 H0Z" fill="#262b48"/>
              <Path d="M0 554 L107 539 L207 555 L308 530 L490 556 L614 525 L720 545 V614 H0Z" fill="#1d213a"/>
              {lines.map((line, index) => <SvgText key={index} x={56} y={220 + index * 62} fontSize={Array.from(line).length > 9 ? 49 : 66}
                fontFamily={serif} fontWeight="700" fill={ink}>{line}</SvgText>)}
              <SvgText x={58} y={lines.length > 1 ? 330 : 275} fontSize={27} fill="#f6cdb9">{Array.from(episode || '一起看喜欢的故事').slice(0, 21).join('')}</SvgText>
              <SvgText x={56} y={571} fontSize={29} fontFamily={serif} fill={ink}>{Array.from(note).slice(0, 21).join('')}</SvgText>
            </>
          ) : (
            <>
              <SvgText x={54} y={231} fontSize={77} fontFamily={serif} fontWeight="700" fill={ink}>今晚，</SvgText>
              <SvgText x={54} y={331} fontSize={77} fontFamily={serif} fontWeight="700" fill={ink}>一起看点什么？</SvgText>
              <SvgText x={58} y={395} fontSize={31} fill={ink}>隔着屏幕，也可以像坐在一起。</SvgText>
              <Circle cx={542} cy={556} r={159} fill="#f5ab8180" />
              <Path d="M426 654a116 116 0 0 1 232 0Z" fill="#ffce96"/>
              <Path d="M89 654v-55h14v-49a33 33 0 0 1 33-33h44a33 33 0 0 1 33 33v49h14v55z" fill="#51263f"/>
              <Path d="M236 654v-55h14v-49a33 33 0 0 1 33-33h44a33 33 0 0 1 33 33v49h14v55z" fill="#51263f"/>
            </>
          )}
          <Line x1={24} x2={696} y1={footer + 1} y2={footer + 1} stroke="#9a6759" strokeDasharray="9 9" />
          <Circle cx={0} cy={footer} r={17} fill="#17171e" />
          <Circle cx={720} cy={footer} r={17} fill="#17171e" />
          <SvgText x={57} y={footer + 78} fontSize={36} fontWeight="700" fill={paperInk}>
            {roomId ? '扫码进房' : '扫码打开异起看'}
          </SvgText>
          <SvgText x={58} y={footer + 132} fontSize={27} fill="#745563">
            {roomId ? `房间 ${roomId}` : '异地同步观影'}
          </SvgText>
          {link && <QrStamp url={link} y={footer + 23} />}
        </>
      )}
    </Svg>
  );
}
