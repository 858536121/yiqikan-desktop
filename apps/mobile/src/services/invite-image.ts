import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

type ArtworkDirectory = 'invite-artwork' | 'viewing-memory-artwork';

function writeArtworkImage(base64: string, directoryName: ArtworkDirectory) {
  const directory = new Directory(Paths.cache, directoryName);
  directory.create({ idempotent: true, intermediates: true });
  // A receiver can still be importing an earlier image after the share sheet closes.
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const item of directory.list()) {
    if (item instanceof File && (item.modificationTime ?? Date.now()) < cutoff) {
      try { item.delete(); } catch { /* A cache cleanup failure can wait. */ }
    }
  }
  const image = new File(directory, `yiqikan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`);
  image.write(base64, { encoding: 'base64' });
  return image;
}

export async function shareArtworkImage(base64: string, title: string, validate: () => void, directory: ArtworkDirectory) {
  if (!await Sharing.isAvailableAsync()) throw new Error('无法打开图片分享，请复制图片或保存到相册');
  validate();
  await Sharing.shareAsync(writeArtworkImage(base64, directory).uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: title });
}

export async function saveArtworkImage(base64: string, validate: () => void, directory: ArtworkDirectory) {
  const { Asset, requestPermissionsAsync } = await import('expo-media-library');
  if (Platform.OS === 'ios' || (Platform.OS === 'android' && Number(Platform.Version) < 29)) {
    const permission = await requestPermissionsAsync(true, ['photo']);
    if (!permission.granted) throw new Error('请允许添加照片，或使用分享图片');
  }
  validate();
  const image = writeArtworkImage(base64, directory);
  try {
    await Asset.create(image.uri);
  } finally {
    try { image.delete(); } catch { /* The cache cleanup will retry later. */ }
  }
}

export function shareInviteImage(base64: string, title: string, validate: () => void) {
  return shareArtworkImage(base64, title, validate, 'invite-artwork');
}

export function saveInviteImage(base64: string, validate: () => void) {
  return saveArtworkImage(base64, validate, 'invite-artwork');
}
