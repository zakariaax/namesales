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

/** Exclusive upper bound so `domain >= low AND domain < high` is a prefix range. */
export function prefixBounds(prefix: string): { low: string; high: string } {
  return { low: prefix, high: prefixUpperBound(prefix) };
}

/** Every domain with this sld: `example.com`, `example.co.uk`, and resales of each. */
export function sldDomainBounds(sld: string): { low: string; high: string } {
  return { low: `${sld}.`, high: `${sld}/` };
}

function prefixUpperBound(prefix: string): string {
  const codes = [...prefix].map((char) => char.charCodeAt(0));
  for (let index = codes.length - 1; index >= 0; index--) {
    if (codes[index] < 0x7f) {
      codes[index] += 1;
      return String.fromCharCode(...codes.slice(0, index + 1));
    }
  }
  return `${prefix}\u007f`;
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
