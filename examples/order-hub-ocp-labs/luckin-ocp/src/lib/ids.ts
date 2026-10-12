/** id 生成（与 milk-tea-ocp 共享同一份实现）。 */
import { randomUUID } from 'node:crypto';

export const newId = (prefix: string): string => `${prefix}_${randomUUID()}`;
