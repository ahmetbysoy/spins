// Binance proxy path allowlist (REV-5/REV-8).
// Kept in lib/ so it can be unit-tested (Next.js route files may only export handlers).
export const BINANCE_PATH_REGEX = /^fapi\/v[12]\/[a-zA-Z0-9/]+$/;

export function isAllowedBinancePath(path: string): boolean {
  return BINANCE_PATH_REGEX.test(path);
}
