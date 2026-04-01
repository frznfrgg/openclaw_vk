/**
 * Strip lightweight markdown formatting from text while preserving readable
 * plain-text structure for TTS and channel fallbacks.
 */
export function stripMarkdown(text: string): string {
  let result = text;

  // Fenced blocks render poorly on plain-text chat surfaces. Keep the block
  // content, drop the fences and language hints.
  result = result.replace(/(^|\n)(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\2(?=\n|$)/g, "$1$3");
  result = result.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, url: string) =>
    alt.trim() ? alt.trim() : url,
  );
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)");
  result = result.replace(/\*\*(.+?)\*\*/g, "$1");
  result = result.replace(/__(.+?)__/g, "$1");

  result = result.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, "$1");
  result = result.replace(/(?<![\p{L}\p{N}])_(?!_)(.+?)(?<!_)_(?![\p{L}\p{N}])/gu, "$1");

  result = result.replace(/~~(.+?)~~/g, "$1");
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "$1");
  result = result.replace(/^>\s?(.*)$/gm, "$1");
  result = result.replace(/^[-*_]{3,}$/gm, "");
  result = result.replace(/^\s*[-+*]\s+/gm, "• ");
  result = result.replace(/`([^`]+)`/g, "$1");
  result = result.replace(/[ \t]+\n/g, "\n");
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}
