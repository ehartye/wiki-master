import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { extractHtml, extractionRuntime } from './lib/html-extract.mjs';

// Keep Defuddle's bounded, charset-aware, proxy-aware fetch and bot retry.
export async function extractSource(payload, userAgent, { runtime = extractionRuntime(), extract = extractHtml } = {}) {
  const remote = /^https?:\/\//.test(payload.source);
  const url = payload.sourceUrl ?? (remote ? payload.source : undefined);
  if (!url) throw new Error('A source URL is required for local HTML');
  const transport = runtime.fetch;
  const html = remote ? await transport.fetchPage(payload.source, userAgent || transport.getInitialUA(payload.source), 'en') : readFileSync(payload.source, 'utf8');
  let data = await extract(html, url);
  if (remote && data.wordCount === 0 && !userAgent) {
    try {
      const botHtml = await transport.fetchPage(payload.source, transport.BOT_UA, 'en');
      const raw = transport.extractRawMarkdown(botHtml);
      const bot = await extract(botHtml, url);
      if (raw) {
        const markdown = transport.cleanMarkdownContent(raw);
        data = { ...bot, content: markdown, contentMarkdown: markdown, wordCount: markdown.trim().split(/\s+/).length,
          fidelityWarnings: [], fidelityAssessment: { checked: 0, missing: 0, scope: 'raw Markdown; HTML structure not assessed' } };
      } else if (bot.wordCount > 0) data = bot;
    } catch { /* retain the original extraction when the bot is blocked */ }
  }
  if (!(data.contentMarkdown || data.content || '').trim()) throw new Error('No content could be extracted');
  return data;
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    payload: { type: 'string' }, lang: { type: 'string', default: 'en' }, 'user-agent': { type: 'string' }, 'check-runtime': { type: 'boolean' },
  } });
  if (values['check-runtime']) { extractionRuntime(); return; }
  if (values.lang !== 'en') throw new Error('Extraction language must be en');
  const payload = JSON.parse(Buffer.from(values.payload ?? '', 'base64url').toString('utf8'));
  if (typeof payload.source !== 'string') throw new Error('Missing extraction source');
  const data = await extractSource(payload, values['user-agent']);
  console.log(JSON.stringify(data));
  return data;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => { console.error(`extract-page: ${err.message}`); process.exitCode = 1; });
}
