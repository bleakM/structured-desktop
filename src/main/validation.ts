export interface SizeValidation { ok: boolean; width: number; height: number; message?: string }

export function validateWindowSize(widthValue: unknown, heightValue: unknown): SizeValidation {
  const width = typeof widthValue === 'number' ? widthValue : Number(widthValue);
  const height = typeof heightValue === 'number' ? heightValue : Number(heightValue);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return { ok: false, width, height, message: '窗口宽度和高度必须是有限数字。' };
  if (!Number.isInteger(width) || !Number.isInteger(height)) return { ok: false, width, height, message: '窗口宽度和高度必须是整数 DIP。' };
  if (width < 320 || width > 3840 || height < 240 || height > 2160) return { ok: false, width, height, message: '窗口尺寸超出允许范围。' };
  return { ok: true, width, height };
}
