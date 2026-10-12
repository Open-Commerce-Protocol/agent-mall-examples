/** Strip a leading YAML frontmatter block (--- ... ---) from markdown. */
export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '');
}
