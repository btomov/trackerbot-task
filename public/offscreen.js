import { inspectHtml } from './parser.js';

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target !== 'offscreen') return;
  try {
    respond({ facts: inspectHtml(message.html) });
  } catch {
    respond({ error: 'Could not parse the Amazon response.' });
  }
});
