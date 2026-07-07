import { marked } from 'marked';

// Render tN note / tW article markdown. rc:// links don't resolve in this PoC,
// so degrade them to plain emphasized text.
function cleanRcLinks(md) {
  return (md || '')
    .replace(/\[\[rc:\/\/[^\]]*\/([^/\]]+)\]\]/g, '*$1*')
    .replace(/\[([^\]]+)\]\(rc:\/\/[^)]*\)/g, '*$1*');
}

export function Markdown({ text }) {
  const html = marked.parse(cleanRcLinks(text), { async: false });
  return <div class="note-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
