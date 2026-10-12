export type Theme = 'light' | 'dark';

export const DEFAULT_THEME: Theme = 'light';

/**
 * 解析当前应生效的主题。
 * @param declared 当前已挂载页面显式声明的主题；未声明传 null（默认浅色）。
 */
export function resolveTheme(declared: Theme | null): Theme {
  return declared ?? DEFAULT_THEME;
}
