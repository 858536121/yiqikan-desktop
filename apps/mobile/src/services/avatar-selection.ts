import { requireOptionalNativeModule } from 'expo';

/** Modules are loaded only after checking the installed binary, keeping older shells usable. */
export async function selectProfileAvatar(): Promise<string | null> {
  if (!requireOptionalNativeModule('ExponentImagePicker') || !requireOptionalNativeModule('ExpoImageManipulator')) {
    throw new Error('请更新安装包后使用相册头像');
  }
  const picker = await import('expo-image-picker');
  let result: Awaited<ReturnType<typeof picker.launchImageLibraryAsync>>;
  try {
    result = await picker.launchImageLibraryAsync({
      mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], shape: 'oval',
      allowsMultipleSelection: false, quality: 0.9, exif: false, base64: false,
    });
  } catch { throw new Error('无法完成照片选择，请重新选择'); }
  if (result.canceled) return null;
  const asset = result.assets?.[0];
  if (!asset || typeof asset.uri !== 'string' || !asset.uri.startsWith('file://') || !Number.isFinite(asset.width) || !Number.isFinite(asset.height) ||
      asset.width < 1 || asset.height < 1 || asset.width > 8192 || asset.height > 8192 || (asset.fileSize ?? 0) > 10 * 1024 * 1024) {
    throw new Error('这张图片无法处理，请选择 10 MB 以内的其他照片');
  }
  const { ImageManipulator, SaveFormat } = await import('expo-image-manipulator');
  const context = ImageManipulator.manipulate(asset.uri);
  let image: Awaited<ReturnType<typeof context.renderAsync>> | undefined;
  try {
    // Native editors return squares; a defensive center crop also handles platform rounding.
    const side = Math.min(asset.width, asset.height);
    context.crop({originX: Math.floor((asset.width-side)/2), originY: Math.floor((asset.height-side)/2), width:side, height:side});
    context.resize({width:256,height:256});
    image = await context.renderAsync();
    const output = await image.saveAsync({format:SaveFormat.JPEG, compress:0.82, base64:true});
    if (output.width !== 256 || output.height !== 256 || !output.base64 || output.base64.length > 262144 || !/^[A-Za-z0-9+/]+={0,2}$/.test(output.base64)) {
      throw new Error('头像处理失败，请选择其他照片');
    }
    return output.base64;
  } catch { throw new Error('头像处理失败，请选择其他照片'); } finally {
    image?.release();
    context.release();
  }
}
