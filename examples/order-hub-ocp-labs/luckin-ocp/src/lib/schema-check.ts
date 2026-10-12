/**
 * 极简 JSON Schema（2020-12 子集）校验器。
 *
 * 为什么不装 ajv：本机 npm registry 不可达（自签名证书），装不了任何依赖。
 * 这里只实现官方 schema **实际用到**的关键字——这个清单是用脚本统计出来的，
 * 不是猜的：type / const / enum / required / properties / additionalProperties /
 * items / minItems / uniqueItems / minLength / maxLength / minimum / maximum /
 * format(uri,date-time,email) / pattern / oneOf / $ref / $defs。
 *
 * 支持跨文档 $ref，因为官方 schema 之间是用绝对 URL 互相引用的。
 */

export type SchemaDoc = Record<string, any>;
export type ValidationError = { path: string; message: string };
export type Registry = { docs: Map<string, SchemaDoc> };

export function createRegistry(docs: SchemaDoc[]): Registry {
  const registry: Registry = { docs: new Map() };
  for (const doc of docs) {
    if (typeof doc.$id === 'string') registry.docs.set(doc.$id, doc);
  }
  return registry;
}

/** 解析 JSON Pointer，例如 "/$defs/Endpoint"。 */
function pointer(doc: SchemaDoc, pointerText: string): SchemaDoc | undefined {
  if (pointerText === '' || pointerText === '/') return doc;
  let current: any = doc;
  for (const rawSeg of pointerText.split('/').slice(1)) {
    const seg = rawSeg.replace(/~1/g, '/').replace(/~0/g, '~');
    if (current === undefined || current === null) return undefined;
    current = current[seg];
  }
  return current as SchemaDoc;
}

type Ctx = { registry: Registry; doc: SchemaDoc };

/** 跟随 $ref 直到拿到真实 schema（同时切到所在文档，保证文档内 $ref 可解析）。 */
function deref(schema: SchemaDoc, ctx: Ctx): { schema: SchemaDoc; ctx: Ctx } {
  let current = schema;
  let currentCtx = ctx;
  for (let guard = 0; guard < 32; guard += 1) {
    const ref = current.$ref;
    if (typeof ref !== 'string') return { schema: current, ctx: currentCtx };
    if (ref.startsWith('#')) {
      const target = pointer(currentCtx.doc, ref.slice(1));
      if (target === undefined) throw new Error(`无法解析文档内 $ref: ${ref}`);
      current = target;
      continue;
    }
    const [url, fragment] = ref.split('#');
    const doc = ctx.registry.docs.get(url as string);
    if (doc === undefined) throw new Error(`$ref 指向未注册的 schema: ${url}`);
    const target = fragment === undefined ? doc : pointer(doc, `#${fragment}`.slice(1));
    if (target === undefined) throw new Error(`无法解析 $ref: ${ref}`);
    current = target;
    currentCtx = { registry: ctx.registry, doc };
  }
  throw new Error(`$ref 层数过深（疑似循环）: ${JSON.stringify(schema.$ref)}`);
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

function typeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case 'object':
      return isObject(value);
    case 'array':
      return Array.isArray(value);
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      return true;
  }
}

function formatOk(value: unknown, format: string): boolean {
  if (typeof value !== 'string') return true; // format 只约束字符串
  switch (format) {
    case 'uri':
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    case 'date-time':
      return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value);
    case 'email':
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
    default:
      return true;
  }
}

/**
 * 校验一个值。
 * @param value 待校验的值
 * @param schema schema（可含 $ref）
 * @param ctx 当前文档与注册表
 * @param path 出错时的位置前缀，例如 "$.entries[0]"
 */
export function validate(
  value: unknown,
  schema: SchemaDoc,
  ctx: Ctx,
  path = '$',
): ValidationError[] {
  const { schema: s, ctx: c } = deref(schema, ctx);
  const errors: ValidationError[] = [];
  const push = (message: string): void => {
    errors.push({ path, message });
  };

  if (Array.isArray(s.type)) {
    if (!s.type.some((t: string) => typeMatches(value, t))) {
      push(`类型应为 ${s.type.join(' | ')}，实际是 ${Array.isArray(value) ? 'array' : typeof value}`);
      return errors;
    }
  } else if (typeof s.type === 'string' && !typeMatches(value, s.type)) {
    push(`类型应为 ${s.type}，实际是 ${Array.isArray(value) ? 'array' : typeof value}`);
    return errors;
  }

  if (s.const !== undefined && value !== s.const) {
    push(`应为常量 ${JSON.stringify(s.const)}，实际是 ${JSON.stringify(value)}`);
  }
  if (Array.isArray(s.enum) && !s.enum.includes(value)) {
    push(`应为 ${s.enum.map((x: unknown) => JSON.stringify(x)).join(' | ')} 之一，实际是 ${JSON.stringify(value)}`);
  }

  if (typeof value === 'string') {
    if (typeof s.minLength === 'number' && value.length < s.minLength) push(`长度应 >= ${s.minLength}，实际 ${value.length}`);
    if (typeof s.maxLength === 'number' && value.length > s.maxLength) push(`长度应 <= ${s.maxLength}，实际 ${value.length}`);
    if (typeof s.pattern === 'string' && !new RegExp(s.pattern).test(value)) push(`不匹配 pattern ${s.pattern}`);
  }
  if (typeof value === 'number') {
    if (typeof s.minimum === 'number' && value < s.minimum) push(`应 >= ${s.minimum}，实际 ${value}`);
    if (typeof s.maximum === 'number' && value > s.maximum) push(`应 <= ${s.maximum}，实际 ${value}`);
  }

  if (Array.isArray(value)) {
    if (typeof s.minItems === 'number' && value.length < s.minItems) push(`元素数应 >= ${s.minItems}，实际 ${value.length}`);
    if (typeof s.maxItems === 'number' && value.length > s.maxItems) push(`元素数应 <= ${s.maxItems}，实际 ${value.length}`);
    if (s.uniqueItems === true) {
      const seen = new Set(value.map((v) => JSON.stringify(v)));
      if (seen.size !== value.length) push('元素应唯一，存在重复');
    }
    if (isObject(s.items)) {
      value.forEach((item, i) => errors.push(...validate(item, s.items, c, `${path}[${i}]`)));
    }
  }

  if (isObject(value)) {
    for (const key of Array.isArray(s.required) ? s.required : []) {
      if (!(key in value)) push(`缺少必填字段 "${key}"`);
    }
    const props: Record<string, SchemaDoc> = isObject(s.properties) ? s.properties : {};
    for (const [key, sub] of Object.entries(props)) {
      if (key in value) errors.push(...validate(value[key], sub, c, `${path}.${key}`));
    }
    if (s.additionalProperties === false) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) push(`不允许的额外字段 "${key}"`);
      }
    } else if (isObject(s.additionalProperties)) {
      for (const key of Object.keys(value)) {
        if (!(key in props)) errors.push(...validate(value[key], s.additionalProperties, c, `${path}.${key}`));
      }
    }
  }

  if (Array.isArray(s.oneOf)) {
    let matched = 0;
    let firstError = '';
    for (const sub of s.oneOf) {
      const subErrors = validate(value, sub, c, path);
      if (subErrors.length === 0) matched += 1;
      else if (firstError === '') firstError = subErrors[0]?.message ?? '';
    }
    if (matched !== 1) push(`oneOf 应恰好匹配 1 个分支，实际匹配 ${matched} 个（首个错误：${firstError}）`);
  }

  if (typeof s.format === 'string' && !formatOk(value, s.format)) {
    push(`不符合 format "${s.format}"：${JSON.stringify(value)}`);
  }

  return errors;
}

/** 校验入口：给定文档、$ref 片段与值。 */
export function check(registry: Registry, doc: SchemaDoc, ref: string, value: unknown): ValidationError[] {
  const target = pointer(doc, ref.slice(1));
  if (target === undefined) return [{ path: '$', message: `schema 内不存在 ${ref}` }];
  return validate(value, target, { registry, doc });
}
