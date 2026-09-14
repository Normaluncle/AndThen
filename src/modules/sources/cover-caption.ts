const FILLER = /对我来说|并不轻松|值得记录|值得分享|值得一试|这件事[，,]|原回答/;

function characterWindows(value: string): string[] {
  const chars = [...value.replace(/[^\u4e00-\u9fff]/g, '')];
  const windows: string[] = [];
  for (let index = 0; index < chars.length - 1; index += 1) windows.push(chars[index]! + chars[index + 1]!);
  return windows;
}

export function coverCaptionAcceptable(
  sourceText: string,
  caption: string,
  year: number | null,
  publishedAt?: Date | null,
): boolean {
  const text = sourceText.normalize('NFKC');
  const line = caption.normalize('NFKC').trim();
  const length = Array.from(line).length;
  if (length < 4 || length > 28) return false;
  if (FILLER.test(line)) return false;
  if (characterWindows(line).filter((window) => text.includes(window)).length < 2) return false;
  if (year == null) return true;
  if (text.includes(String(year)) || text.includes(`${year}年`)) return true;
  const publishedYear = publishedAt instanceof Date && !Number.isNaN(publishedAt.getTime())
    ? publishedAt.getUTCFullYear()
    : null;
  return publishedYear === year;
}
