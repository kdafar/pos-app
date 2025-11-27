/**
 * Transforms a local filename into a protocol URL that Electron can serve.
 * Example: "burger-123.jpg" -> "appimg://burger-123.jpg"
 */
export function fileUrl(pathOrName: string | null | undefined): string | null {
  if (!pathOrName) return null;

  // 1. If it's already a web URL, return it as is.
  if (/^https?:\/\//i.test(pathOrName)) {
    return pathOrName;
  }

  // 2. If it's already formatted, return it.
  if (pathOrName.startsWith('appimg://')) {
    return pathOrName;
  }

  // 3. Strip any directory paths (just in case full path was stored) to get clean filename
  //    Splits by forward slash (/) or backslash (\) and takes the last part.
  const filename = pathOrName.split(/[/\\]/).pop();

  if (!filename) return null;

  // 4. Return custom protocol format
  return `appimg://${filename}`;
}
