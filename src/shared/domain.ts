/** Lowercase, strip a trailing dot, and turn Unicode into punycode when needed. */
export function normalizeDomain(raw: string): string | null {
  let domain = raw.trim().toLowerCase().replace(/\.$/, "");
  if (!domain || domain.includes("/") || /\s/.test(domain) || domain.includes("..")) return null;
  try {
    if (/[^\x00-\x7f]/.test(domain)) {
      domain = new URL(`http://${domain}`).hostname;
    }
  } catch {
    return null;
  }
  if (!/^[a-z0-9.-]+$/.test(domain)) return null;
  if (!domain.includes(".")) return null;
  if (domain.length > 253) return null;
  return domain;
}

export function normalizeKeyword(raw: string): string {
  let keyword = raw.trim().toLowerCase().replace(/\s+/g, "");
  if (!keyword) return "";
  if (/[^\x00-\x7f]/.test(keyword)) {
    const host = keyword.includes(".") ? keyword : `${keyword}.com`;
    try {
      const ascii = new URL(`http://${host}`).hostname;
      keyword = keyword.includes(".") ? ascii : ascii.replace(/\.com$/, "");
    } catch {
      /* keep the original and let validation reject it */
    }
  }
  return keyword;
}
