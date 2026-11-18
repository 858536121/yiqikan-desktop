import { requireOptionalNativeModule } from 'expo';

export async function loadViewingMemoryAvatars(urls: readonly string[], signal: AbortSignal) {
  const images = await Promise.all(urls.map(async url => {
    try {
      const response = await fetch(url, { signal });
      if (!response.ok || !response.headers.get('content-type')?.toLowerCase().startsWith('image/jpeg')) return null;
      const blob = await response.blob();
      if (!blob.size || blob.size > 192 * 1024) return null;
      const data = await new Promise<string | null>(resolve => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(typeof reader.result === 'string' ? reader.result : null);
        reader.readAsDataURL(blob);
      });
      return data?.startsWith('data:image/jpeg;base64,') ? [url, data] as const : null;
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
