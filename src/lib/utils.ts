export const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

export function deepMerge<T extends Record<string, any>, U extends Record<string, any>>(target: T, source: U): T & U {
  const out: any = { ...target };
  Object.keys(source).forEach((key) => {
    if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
      out[key] = deepMerge(out[key] || {}, source[key]);
    } else {
      out[key] = source[key];
    }
  });
  return out;
}
