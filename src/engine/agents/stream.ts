/**
 * Lecture du flux `--output-format stream-json` de la CLI : une ligne JSON par
 * événement (init, messages, outils, résultat). Tolérant : une ligne illisible
 * (tour en cours d'écriture) est ignorée.
 */
export interface ParsedStream {
  sessionId: string | null;
  model: string | null;
  messages: string[];
  tools: string[];
  result: { text: string; cost: number | null; isError: boolean; subtype: string } | null;
}

export function parseStream(text: string): ParsedStream {
  const out: ParsedStream = { sessionId: null, model: null, messages: [], tools: [], result: null };
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof e.session_id === 'string') out.sessionId = e.session_id;
    if (e.type === 'system' && e.subtype === 'init' && typeof e.model === 'string') out.model = e.model;
    if (e.type === 'assistant') {
      const content = ((e.message as { content?: unknown[] } | undefined)?.content ?? []) as { type?: string; text?: string; name?: string }[];
      for (const c of content) {
        if (c.type === 'text' && c.text?.trim()) out.messages.push(c.text.trim());
        if (c.type === 'tool_use' && c.name) out.tools.push(c.name);
      }
    }
    if (e.type === 'result') {
      const cost = typeof e.total_cost_usd === 'number' ? e.total_cost_usd : typeof e.cost_usd === 'number' ? e.cost_usd : null;
      out.result = { text: typeof e.result === 'string' ? e.result : '', cost, isError: e.is_error === true, subtype: String(e.subtype ?? '') };
    }
  }
  return out;
}

/** Questions posées par l'agent : lignes d'un bloc « QUESTIONS » ou finissant par « ? » dans le dernier message. */
export function questionsOf(message: string | undefined): string[] {
  if (!message) return [];
  const block = /(?:^|\n)#*\s*QUESTIONS?\s*:?\s*\n([\s\S]+)$/i.exec(message)?.[1];
  const lines = (block ?? message).split('\n').map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim());
  return lines.filter((l) => l.endsWith('?') && l.length > 3).slice(0, 8);
}
