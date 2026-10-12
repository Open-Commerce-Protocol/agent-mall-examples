const sensitiveKey =
  /authorization|api[-_]?key|token|cookie|secret|password|session|auth_requirements/i;
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [
        key,
        sensitiveKey.test(key) ? "[REDACTED]" : redact(v),
      ]),
    );
  if (typeof value === "string") {
    // Strip URL credentials and query/fragment values from all evidence and exports.
    return value.replace(/https?:\/\/[^\s"<>]+/gi, (text) => {
      try {
        const u = new URL(text);
        u.username = "";
        u.password = "";
        u.search = "";
        u.hash = "";
        return u.href;
      } catch {
        return "[invalid URL]";
      }
    });
  }
  return value;
}
export function assertAllowedUrl(value: string, allowedOrigins: string[]) {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !allowedOrigins.includes(url.origin)
  ) {
    throw new Error(
      "Catalog URL must use an explicitly allowed HTTP(S) origin with no credentials, query or fragment. Set X_RAY_CATALOG_ORIGINS locally.",
    );
  }
  return url;
}
export function safeActionUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) &&
      !u.username &&
      !u.password
      ? u.href
      : undefined;
  } catch {
    return undefined;
  }
}
