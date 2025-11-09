export function fileUrl(p?: string | null): string | null {
  if (!p) return null;
  // We’ll pass absolute paths via host "by-abs" so the protocol handler can validate/sanitize.
  let s = String(p).trim().replace(/\\/g, '/');
  if (/^[a-zA-Z]:\//.test(s)) s = '/' + s; // ensure /C:/... form
  return `appimg://by-abs${encodeURI(s)}`;
}