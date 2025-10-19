// Markdown and text rendering utilities

export const renderMarkdown = (text: string) => {
  if (!text) return "";
  let html = text;
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');
  html = html.replace(/`(.+?)`/g, '<code style="background:#f3f4f6;padding:2px 4px;border-radius:3px;font-family:monospace;font-size:0.9em">$1</code>');
  html = html.replace(/\n/g, '<br>');
  return html;
};

export function escapeXML(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

