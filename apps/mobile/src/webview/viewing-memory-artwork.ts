import QRCode from 'qrcode';

export type ViewingMemoryFormat = 'chat' | 'card' | 'poster';

export type ViewingMemorySource =
  | { kind: 'chat'; title?: string; date?: number; messages: readonly {
      sender: string; senderId: string; mine: boolean; avatarUrl?: string; text: string;
    }[] }
  | { kind: 'history'; title: string; date: number };

export interface ViewingMemoryArtwork {
  format: ViewingMemoryFormat;
  title: string;
  date: string;
  companions: string;
  cover: string | null;
  participants: { name: string; letter: string; mine: boolean; avatar?: string }[];
  messages: { participant: number; text: string }[];
}

export const MEMORY_IMAGE_WIDTH = 760;
export const MEMORY_IMAGE_MAX_HEIGHT = 7600;
export const MEMORY_PREVIEW_TILE_HEIGHT = 1024;
const MEMORY_IMAGE_MAX_PIXELS = 12_000_000;

// A local canvas measures and wraps text with the device's emoji and CJK font fallback.
export function viewingMemoryArtworkDocument(artwork: ViewingMemoryArtwork, downloadUrl: string): string {
  const data = JSON.stringify(artwork).replace(/</g, '\\u003c');
  const modules = QRCode.create(downloadUrl, { errorCorrectionLevel: 'M' }).modules;
  const qr = { size: modules.size, data: Array.from(modules.data) };
  return String.raw`<!doctype html><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; img-src data:">
<canvas width="1" height="1"></canvas>
<script>
(() => {
  const artwork = ${data};
  const qr = ${JSON.stringify(qr)};
  const width = ${MEMORY_IMAGE_WIDTH};
  const maxHeight = ${MEMORY_IMAGE_MAX_HEIGHT};
  const previewTileHeight = ${MEMORY_PREVIEW_TILE_HEIGHT};
  const maxPixels = ${MEMORY_IMAGE_MAX_PIXELS};
  const canvas = document.querySelector('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const segmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : null;
  const post = result => window.ReactNativeWebView.postMessage(JSON.stringify(result));
  const pad = 56;
  const innerWidth = width - 2 * pad;

  function setFont(size, weight) {
    ctx.font = weight + ' ' + size + 'px -apple-system, system-ui, sans-serif';
  }

  function wrap(text, maxWidth) {
    const lines = [];
    for (const paragraph of text.replace(/\r\n?/g, '\n').replace(/\t/g, '    ').split('\n')) {
      const characters = segmenter ? Array.from(segmenter.segment(paragraph), part => part.segment) : Array.from(paragraph);
      let line = '';
      for (const character of characters) {
        if (line && ctx.measureText(line + character).width > maxWidth) {
          lines.push(line);
          line = '';
        }
        line += character;
      }
      lines.push(line);
    }
    return lines;
  }

  function picture(image, x, y, w, h) {
    const scale = Math.max(w / image.width, h / image.height);
    const sw = w / scale, sh = h / scale;
    ctx.drawImage(image, (image.width - sw) / 2, (image.height - sh) / 2, sw, sh, x, y, w, h);
  }

  function layout(draw, cover, avatars, height) {
    const { format, title, date, companions, participants, messages } = artwork;
    const poster = format === 'poster';
    const card = format === 'card';
    const paper = poster ? '#19151D' : card ? '#F5EADB' : '#F2EDE7';
    const ink = poster ? '#FBECDE' : '#262129';
    const muted = poster ? '#E0B6A0' : '#71594F';
    const own = poster
      ? { bubble: '#523327', text: '#FFF0E4', avatar: '#764835' }
      : { bubble: '#F6DCC8', text: '#442A21', avatar: '#DEC0AA' };
    const other = poster
      ? { bubble: '#2E3546', text: '#F0F1F6', avatar: '#46516A' }
      : { bubble: '#E3E7EE', text: '#283140', avatar: '#C7D0DF' };
    let y = pad;

    function fill(color, x, top, w, h) {
      if (!draw) return;
      ctx.fillStyle = color;
      ctx.fillRect(x, top, w, h);
    }

    function text(value, { size, weight = 400, color = ink, leading = Math.ceil(size * 1.42) }) {
      if (!value) return;
      setFont(size, weight);
      const lines = wrap(value, innerWidth);
      if (draw) {
        ctx.fillStyle = color;
        ctx.textBaseline = 'alphabetic';
        lines.forEach((line, index) => ctx.fillText(line, pad, y + size + index * leading));
      }
      y += lines.length * leading;
    }

    fill(paper, 0, 0, width, height);
    if (cover && (card || poster)) {
      const coverHeight = poster ? 570 : 390;
      if (draw) picture(cover, 0, 0, width, coverHeight);
      y = coverHeight + 44;
    } else if (poster) {
      // A film-ticket motif also works when the user chooses a text-only poster.
      fill('#2D222C', 0, 0, width, 298);
      fill('#D39473', pad, 80, 78, 6);
      fill('#6F4744', pad, 113, innerWidth, 1);
      fill('#6F4744', pad, 234, innerWidth, 1);
      y = 165;
    }

    if (poster || card) {
      text(date ? '观影留念  /  ' + date : '观影留念', { size: 23, weight: 650, color: muted });
      y += 14;
      text(title || '这次一起看', { size: poster ? 62 : 48, weight: 750 });
      if (poster && companions) {
        y += 12;
        text('和 ' + companions + ' 一起看', { size: 25, color: muted });
      }
    } else {
      text('房间聊天', { size: 48, weight: 750 });
      text(date, { size: 23, color: muted });
    }

    if (messages.length) y += 32;
    for (const message of messages) {
      const sender = participants[message.participant];
      const theme = sender.mine ? own : other;
      const avatar = avatars[message.participant];
      const avatarSize = 52, gap = 14, padding = 18, fontSize = 32, leading = 44;
      const maxBubbleWidth = innerWidth - avatarSize - gap - 76;
      setFont(fontSize, 500);
      const lines = wrap(message.text, maxBubbleWidth - padding * 2);
      const textWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
      const bubbleWidth = Math.min(maxBubbleWidth, Math.max(86, Math.ceil(textWidth) + padding * 2));
      const bubbleHeight = lines.length * leading + padding * 2;
      const avatarX = sender.mine ? width - pad - avatarSize : pad;
      const bubbleX = sender.mine ? avatarX - gap - bubbleWidth : avatarX + avatarSize + gap;
      const bubbleY = y + 33;

      if (draw) {
        const midX = avatarX + avatarSize / 2;
        const midY = y + 5 + avatarSize / 2;
        ctx.save();
        ctx.beginPath();
        ctx.arc(midX, midY, avatarSize / 2, 0, 2 * Math.PI);
        ctx.clip();
        if (avatar) picture(avatar, avatarX, y + 5, avatarSize, avatarSize);
        else {
          fill(theme.avatar, avatarX, y + 5, avatarSize, avatarSize);
          setFont(23, 700);
          ctx.fillStyle = theme.text;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(sender.letter, midX, midY, avatarSize - 10);
        }
        ctx.restore();

        setFont(24, 650);
        ctx.fillStyle = muted;
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = sender.mine ? 'right' : 'left';
        ctx.fillText(sender.name, sender.mine ? avatarX - gap : bubbleX, y + 26, maxBubbleWidth);

        const r = 20, right = bubbleX + bubbleWidth, bottom = bubbleY + bubbleHeight;
        ctx.beginPath();
        ctx.moveTo(bubbleX + r, bubbleY);
        ctx.arcTo(right, bubbleY, right, bottom, r);
        ctx.arcTo(right, bottom, bubbleX, bottom, r);
        ctx.arcTo(bubbleX, bottom, bubbleX, bubbleY, r);
        ctx.arcTo(bubbleX, bubbleY, right, bubbleY, r);
        ctx.closePath();
        ctx.fillStyle = theme.bubble;
        ctx.fill();

        setFont(fontSize, 500);
        ctx.fillStyle = theme.text;
        ctx.textAlign = 'left';
        lines.forEach((line, index) => ctx.fillText(line, bubbleX + padding, bubbleY + padding + fontSize + index * leading));
      }
      y = bubbleY + bubbleHeight + 18;
    }
    y = Math.max(y + 20, poster ? 820 : 0);
    fill(poster ? '#463537' : '#DDD1C7', pad, y, innerWidth, 1);
    const footerTop = y + 12;
    const side = 84;
    const x = width - pad - side;
    if (draw) {
      const quietZone = 2;
      const stamp = document.createElement('canvas');
      stamp.width = stamp.height = qr.size + 2 * quietZone;
      const stampContext = stamp.getContext('2d');
      stampContext.fillStyle = poster ? '#F5E9D9' : paper;
      stampContext.fillRect(0, 0, stamp.width, stamp.height);
      stampContext.fillStyle = '#1B1720';
      for (let row = 0; row < qr.size; row++) {
        for (let col = 0; col < qr.size; col++) {
          if (qr.data[row * qr.size + col]) {
            stampContext.fillRect(col + quietZone, row + quietZone, 1, 1);
          }
        }
      }
      ctx.save();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(stamp, x, footerTop, side, side);
      ctx.restore();
    }
    const brandLineHeight = 27;
    y = footerTop + Math.floor((side - brandLineHeight) / 2);
    text('异起看', { size: 19, leading: brandLineHeight, weight: 600, color: muted });
    return Math.ceil(footerTop + side + 26);
  }

  function makePreviewTiles(height) {
    const tile = document.createElement('canvas');
    tile.width = canvas.width;
    const tileContext = tile.getContext('2d', { alpha: false });
    const previewTiles = [];
    for (let y = 0; y < height; y += previewTileHeight) {
      const tileHeight = Math.min(previewTileHeight, height - y);
      const top = Math.round(y / height * canvas.height);
      const bottom = Math.round((y + tileHeight) / height * canvas.height);
      tile.height = bottom - top;
      tileContext.drawImage(canvas, 0, top, tile.width, tile.height, 0, 0, tile.width, tile.height);
      previewTiles.push({ height: tileHeight, png: tile.toDataURL('image/png') });
    }
    return previewTiles;
  }

  function render(cover, avatars) {
    try {
      const height = layout(false, cover, avatars, 0);
      if (!Number.isFinite(height) || height > maxHeight) {
        post({ error: '图片太长，请返回少选几条消息' });
        return;
      }
      // Keep the same logical layout while bounding the backing canvas on WebKit.
      const scale = Math.min(2, Math.sqrt(maxPixels / (width * height)));
      canvas.width = Math.floor(width * scale);
      canvas.height = Math.floor(height * scale);
      ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      layout(true, cover, avatars, height);
      const png = canvas.toDataURL('image/png');
      if (!png.startsWith('data:image/png;base64,')) throw new Error('PNG unavailable');
      const previewTiles = height > previewTileHeight ? makePreviewTiles(height) : undefined;
      post({ height, png, previewTiles });
    } catch {
      post({ error: '图片生成失败，请重试' });
    }
  }

  function loadImage(src) {
    if (!src) return Promise.resolve(null);
    return new Promise(resolve => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = src;
    });
  }
  Promise.all([
    loadImage(artwork.cover),
    Promise.all(artwork.participants.map(sender => loadImage(sender.avatar))),
  ]).then(([cover, avatars]) => {
    if (artwork.cover && !cover) post({ error: '配图读取失败，请更换图片' });
    else render(cover, avatars);
  });
})();
</script>`;
}
