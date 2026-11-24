/**
 * Évaluateur FEEL minimal (§5.1) : littéraux, concaténations, contextes,
 * conditionnels simples. L'inconnu reste inconnu : une variable n'est jamais
 * devinée, elle rend l'expression `unknown` avec les noms qu'elle cite.
 *
 * Limite assumée : les noms FEEL contenant des espaces (« string length ») ne
 * sont pas reconnus comme un seul nom.
 */

export type FeelScalar = string | number | boolean | null;

export type FeelValue =
  /** Une ou plusieurs valeurs possibles (plusieurs : branches d'un `if`). */
  | { kind: 'values'; values: FeelScalar[] }
  | { kind: 'context'; entries: Record<string, FeelValue> }
  | { kind: 'unknown'; names: string[] };

/** Au-delà, une concaténation de variantes devient inconnue (explosion combinatoire). */
const MAX_ALTERNATIVES = 16;

const KEYWORDS = new Set(['if', 'then', 'else', 'and', 'or', 'not', 'null', 'true', 'false', 'in', 'for', 'some', 'every', 'satisfies', 'return']);

type Token =
  | { t: 'str'; v: string }
  | { t: 'num'; v: number }
  | { t: 'name'; v: string }
  | { t: 'op'; v: string };

export class FeelSyntaxError extends Error {}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (c === '"') {
      let s = '';
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length) {
          const n = src[i + 1]!;
          s += n === 'n' ? '\n' : n === 't' ? '\t' : n;
          i += 2;
        } else s += src[i++];
      }
      if (src[i] !== '"') throw new FeelSyntaxError('chaîne non fermée');
      i++;
      out.push({ t: 'str', v: s });
    } else if (/[0-9]/.test(c)) {
      const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i))!;
      out.push({ t: 'num', v: Number(m[0]) });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i))!;
      out.push({ t: 'name', v: m[0] });
      i += m[0].length;
    } else {
      const two = src.slice(i, i + 2);
      if (['!=', '<=', '>=', '..'].includes(two)) {
        out.push({ t: 'op', v: two });
        i += 2;
      } else if ('+-*/=<>(){}[],:.'.includes(c)) {
        out.push({ t: 'op', v: c });
        i++;
      } else throw new FeelSyntaxError(`caractère inattendu : ${c}`);
    }
  }
  return out;
}

const unknown = (...groups: string[][]): FeelValue => ({ kind: 'unknown', names: [...new Set(groups.flat())] });
const namesOf = (v: FeelValue): string[] =>
  v.kind === 'unknown' ? v.names : v.kind === 'context' ? Object.values(v.entries).flatMap(namesOf) : [];

class Parser {
  private i = 0;
  constructor(private readonly toks: Token[]) {}

  private peek(): Token | undefined {
    return this.toks[this.i];
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t?.t === 'op' && t.v === v;
  }
  private isKw(v: string): boolean {
    const t = this.peek();
    return t?.t === 'name' && t.v === v;
  }
  private expectOp(v: string): void {
    if (!this.isOp(v)) throw new FeelSyntaxError(`« ${v} » attendu`);
    this.i++;
  }
  private expectKw(v: string): void {
    if (!this.isKw(v)) throw new FeelSyntaxError(`« ${v} » attendu`);
    this.i++;
  }

  parseAll(): FeelValue {
    const v = this.expr();
    if (this.i < this.toks.length) throw new FeelSyntaxError('fin d’expression attendue');
    return v;
  }

  expr(): FeelValue {
    if (this.isKw('if')) {
      this.i++;
      const cond = this.expr();
      this.expectKw('then');
      const a = this.expr();
      this.expectKw('else');
      const b = this.expr();
      if (a.kind === 'values' && b.kind === 'values') {
        return { kind: 'values', values: [...new Set([...a.values, ...b.values])] };
      }
      return unknown(namesOf(cond), namesOf(a), namesOf(b));
    }
    return this.logical();
  }

  private logical(): FeelValue {
    let left = this.comparison();
    while (this.isKw('and') || this.isKw('or')) {
      this.i++;
      left = unknown(namesOf(left), namesOf(this.comparison()));
    }
    return left;
  }

  private comparison(): FeelValue {
    const left = this.additive();
    if (['=', '!=', '<', '>', '<=', '>='].some((o) => this.isOp(o)) || this.isKw('in')) {
      this.i++;
      return unknown(namesOf(left), namesOf(this.additive()));
    }
    return left;
  }

  private additive(): FeelValue {
    let left = this.multiplicative();
    while (this.isOp('+') || this.isOp('-')) {
      const op = (this.toks[this.i++] as { v: string }).v;
      const right = this.multiplicative();
      left = combine(left, right, op);
    }
    return left;
  }

  private multiplicative(): FeelValue {
    let left = this.unary();
    while (this.isOp('*') || this.isOp('/')) {
      this.i++;
      left = unknown(namesOf(left), namesOf(this.unary()));
    }
    return left;
  }

  private unary(): FeelValue {
    if (this.isKw('not')) {
      this.i++;
      this.expectOp('(');
      const v = this.expr();
      this.expectOp(')');
      return unknown(namesOf(v));
    }
    return this.postfix(this.primary());
  }

  /** Accès `a.b` sur un contexte connu, sinon inconnu. Appels de fonction : inconnus. */
  private postfix(base: FeelValue): FeelValue {
    let v = base;
    for (;;) {
      if (this.isOp('.')) {
        this.i++;
        const t = this.toks[this.i++];
        if (t?.t !== 'name') throw new FeelSyntaxError('nom attendu après « . »');
        v = v.kind === 'context' ? (v.entries[t.v] ?? unknown()) : unknown(namesOf(v));
      } else if (this.isOp('[')) {
        this.i++;
        const idx = this.expr();
        this.expectOp(']');
        v = unknown(namesOf(v), namesOf(idx));
      } else return v;
    }
  }

  private primary(): FeelValue {
    const t = this.toks[this.i++];
    if (!t) throw new FeelSyntaxError('expression incomplète');
    if (t.t === 'str') return { kind: 'values', values: [t.v] };
    if (t.t === 'num') return { kind: 'values', values: [t.v] };
    if (t.t === 'op' && t.v === '(') {
      const v = this.expr();
      this.expectOp(')');
      return v;
    }
    if (t.t === 'op' && t.v === '{') return this.context();
    if (t.t === 'op' && t.v === '[') {
      const items: FeelValue[] = [];
      while (!this.isOp(']')) {
        items.push(this.expr());
        if (!this.isOp(']')) this.expectOp(',');
      }
      this.i++;
      return unknown(...items.map(namesOf));
    }
    if (t.t === 'name') {
      if (t.v === 'null') return { kind: 'values', values: [null] };
      if (t.v === 'true' || t.v === 'false') return { kind: 'values', values: [t.v === 'true'] };
      if (KEYWORDS.has(t.v)) throw new FeelSyntaxError(`mot-clé inattendu : ${t.v}`);
      if (this.isOp('(')) {
        this.i++;
        const args: FeelValue[] = [];
        while (!this.isOp(')')) {
          args.push(this.expr());
          if (!this.isOp(')')) this.expectOp(',');
        }
        this.i++;
        return unknown(...args.map(namesOf));
      }
      return unknown([t.v]);
    }
    throw new FeelSyntaxError(`symbole inattendu : ${t.v}`);
  }

  private context(): FeelValue {
    const entries: Record<string, FeelValue> = {};
    while (!this.isOp('}')) {
      const k = this.toks[this.i++];
      if (!k || (k.t !== 'name' && k.t !== 'str')) throw new FeelSyntaxError('clé de contexte attendue');
      this.expectOp(':');
      entries[String(k.v)] = this.expr();
      if (!this.isOp('}')) this.expectOp(',');
    }
    this.i++;
    return { kind: 'context', entries };
  }
}

function combine(a: FeelValue, b: FeelValue, op: string): FeelValue {
  if (a.kind !== 'values' || b.kind !== 'values') return unknown(namesOf(a), namesOf(b));
  if (a.values.length * b.values.length > MAX_ALTERNATIVES) return unknown();
  const out: FeelScalar[] = [];
  for (const x of a.values) {
    for (const y of b.values) {
      if (op === '+' && typeof x === 'string' && typeof y === 'string') out.push(x + y);
      else if (typeof x === 'number' && typeof y === 'number') out.push(op === '+' ? x + y : x - y);
      else return unknown();
    }
  }
  return { kind: 'values', values: [...new Set(out)] };
}

/** Évalue une expression Zeebe (avec ou sans `=` initial). Sans `=` : littéral texte. */
export function evaluateFeel(source: string): FeelValue {
  const s = source.trim();
  if (!s.startsWith('=')) return { kind: 'values', values: [source] };
  try {
    return new Parser(tokenize(s.slice(1))).parseAll();
  } catch (e) {
    if (e instanceof FeelSyntaxError) return unknown();
    throw e;
  }
}

/** Noms de variables cités par l'expression (hors mots-clés et clés de contexte). */
export function feelNames(source: string): string[] {
  const s = source.trim();
  if (!s.startsWith('=')) return [];
  let toks: Token[];
  try {
    toks = tokenize(s.slice(1));
  } catch {
    return [];
  }
  const names = new Set<string>();
  toks.forEach((t, i) => {
    if (t.t !== 'name' || KEYWORDS.has(t.v)) return;
    const next = toks[i + 1];
    const prev = toks[i - 1];
    if (next?.t === 'op' && next.v === ':') return; // clé de contexte
    if (next?.t === 'op' && next.v === '(') return; // fonction
    if (prev?.t === 'op' && prev.v === '.') return; // accès de propriété
    names.add(t.v);
  });
  return [...names];
}

/** Valeurs texte possibles, ou null si l'expression n'est pas entièrement connue. */
export function feelStrings(v: FeelValue | undefined): string[] | null {
  if (!v || v.kind !== 'values') return null;
  return v.values.every((x) => typeof x === 'string') ? (v.values as string[]) : null;
}
