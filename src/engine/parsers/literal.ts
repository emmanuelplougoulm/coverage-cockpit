import { Node, SyntaxKind, type Expression } from 'ts-morph';

/** Valeur littérale lue dans un AST TypeScript, sans exécuter le code. */
export type Literal = string | number | boolean | null | Literal[] | { [k: string]: Literal };

/**
 * Évalue une expression littérale (chaînes, nombres, objets, tableaux, `as const`,
 * `satisfies`). Rend `undefined` pour tout le reste : jamais de devinette.
 * `refs` résout les accès `GROUP.key` (clés calculées des cartes d'étapes).
 */
export function readLiteral(node: Node | undefined, refs?: (text: string) => string | undefined): Literal | undefined {
  if (!node) return undefined;
  if (Node.isAsExpression(node) || Node.isSatisfiesExpression(node) || Node.isParenthesizedExpression(node)) {
    return readLiteral(node.getExpression(), refs);
  }
  if (Node.isStringLiteral(node) || Node.isNoSubstitutionTemplateLiteral(node)) return node.getLiteralValue();
  if (Node.isNumericLiteral(node)) return node.getLiteralValue();
  if (node.getKind() === SyntaxKind.TrueKeyword) return true;
  if (node.getKind() === SyntaxKind.FalseKeyword) return false;
  if (node.getKind() === SyntaxKind.NullKeyword) return null;
  if (Node.isPrefixUnaryExpression(node) && node.getOperatorToken() === SyntaxKind.MinusToken) {
    const v = readLiteral(node.getOperand(), refs);
    return typeof v === 'number' ? -v : undefined;
  }
  if (Node.isArrayLiteralExpression(node)) {
    const out: Literal[] = [];
    for (const e of node.getElements()) {
      const v = readLiteral(e, refs);
      if (v === undefined) return undefined;
      out.push(v);
    }
    return out;
  }
  if (Node.isObjectLiteralExpression(node)) {
    const out: Record<string, Literal> = {};
    for (const p of node.getProperties()) {
      if (!Node.isPropertyAssignment(p)) continue;
      const key = propertyKey(p.getNameNode(), refs);
      if (key === undefined) continue;
      const v = readLiteral(p.getInitializer(), refs);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  if (refs && Node.isPropertyAccessExpression(node)) return refs(node.getText());
  return undefined;
}

/** Nom d'une propriété : identifiant, chaîne, ou clé calculée résolue par `refs`. */
export function propertyKey(name: Node, refs?: (text: string) => string | undefined): string | undefined {
  if (Node.isIdentifier(name) || Node.isPrivateIdentifier(name)) return name.getText();
  if (Node.isStringLiteral(name) || Node.isNoSubstitutionTemplateLiteral(name)) return name.getLiteralValue();
  if (Node.isNumericLiteral(name)) return String(name.getLiteralValue());
  if (Node.isComputedPropertyName(name)) {
    const e: Expression = name.getExpression();
    if (Node.isStringLiteral(e)) return e.getLiteralValue();
    return refs?.(e.getText());
  }
  return undefined;
}

export const isRecord = (v: Literal | undefined): v is Record<string, Literal> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
