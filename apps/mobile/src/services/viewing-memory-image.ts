import { requireOptionalNativeModule } from 'expo';
import { fetch } from 'expo/fetch';

const maxAvatarBytes = 192 * 1024;

function avatarContentType(bytes: Uint8Array) {
  const signature = String.fromCharCode(...bytes.subarray(0, 12));
  if (signature.startsWith('\xff\xd8\xff')) return 'image/jpeg';
  if (signature.startsWith('\x89PNG\r\n\x1a\n')) return 'image/png';
  if (signature.startsWith('GIF87a') || signature.startsWith('GIF89a')) return 'image/gif';
  if (signature.startsWith('RIFF') && signature.endsWith('WEBP')) return 'image/webp';
  return null;
}

export async function loadViewingMemoryAvatars(urls: readonly string[], signal: AbortSignal) {
  const images = await Promise.all(urls.map(async url => {
    try {
      const response = await fetch(url, { signal });
      if (!response.ok || Number(response.headers.get('content-length')) > maxAvatarBytes) return null;
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length > maxAvatarBytes) return null;
      // QQ avatars may redirect to a CDN with a generic or different Content-Type.
      const type = avatarContentType(bytes);
      if (!type) return null;
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 8192) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
      }
      return [url, `data:${type};base64,${btoa(binary)}`] as const;
    } catch {
      return null;
    }
  }));
  const avatars = new Map<string, string>();
  let remaining = 512 * 1024;
  for (const image of images) {
    if (!image || image[1].length > remaining) continue;
    avatars.set(...image);
    remaining -= image[1].length;
  }
  return avatars;
}

export async function pickViewingMemoryImage(): Promise<string | null> {
  if (!requireOptionalNativeModule('ExponentImagePicker') || !requireOptionalNativeModule('ExpoImageManipulator')) {
    throw new Error('请更新安装包后使用相册配图');
  }

  const { launchImageLibraryAsync } = await import('expo-image-picker');
  const result = await launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: false, exif: false });
  if (result.canceled) return null;
  const asset = result.assets[0];
  if (!asset || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) || asset.width < 1 || asset.height < 1) {
    throw new Error('无法读取这张照片，请更换图片');
  }

  const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
  const context = ImageManipulator.manipulate(asset.uri);
  let image: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  try {
    if (Math.max(asset.width, asset.height) > 1440) {
      context.resize(asset.width >= asset.height ? { width: 1440 } : { height: 1440 });
    }
    image = await context.renderAsync();
    const output = await image.saveAsync({ format: SaveFormat.JPEG, compress: 0.86, base64: true });
    try {
      if (!output.base64) throw new Error('无法读取这张照片，请更换图片');
      return `data:image/jpeg;base64,${output.base64}`;
    } finally {
      const { File } = await import('expo-file-system');
      try { new File(output.uri).delete(); } catch { /* The processed image is in the system cache. */ }
    }
  } finally {
    image?.release();
    context.release();
  }
}
