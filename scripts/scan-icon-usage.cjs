// Scans the renderer source for every IconName string reachable at runtime,
// used by build-icons.cjs (#593) to emit only referenced codicons instead of
// the full upstream set. Exported separately from build-icons.cjs so its
// scan logic can be unit-tested against source snippets directly.
//
// Covers four shapes — the issue that spawned this (#593) named three, but
// a literal-only `<Icon name="X">` grep would miss all of B/C/D and silently
// drop an icon that's still rendered at runtime:
//   A. <Icon name="X"> / <Icon name={cond ? 'a' : 'b'}> (any depth of nested
//      ternaries) — the direct, JSX-level usage.
//   B. Any object-literal property named exactly `icon` (e.g. EmptyTab's
//      card entries, Properties.tsx's PROP_TYPES_FOR_PICKER) — independent
//      of whether the enclosing declaration has an explicit type annotation.
//   C. Variable declarations whose type annotation identifies them as an
//      icon-name table: either the value type IS `IconName` directly (e.g.
//      `Record<string, IconName>`), or — since not every such table is
//      typed that way (PROP_ICON_BY_TYPE uses its own inline string-literal
//      union instead) — a `Record<K, V>` annotation whose value type V is a
//      union of only string-literal types. Every string-literal value
//      nested in that declaration's initializer (object or array literal)
//      is collected. Checks the value type directly, not a substring search
//      over the whole printed type — `Array<{ type: X; icon: IconName }>`
//      has "IconName" nested in one field, but that field's SIBLINGS aren't
//      icon names, and a substring match would sweep them in too.
//   D. `return` expressions inside a function whose declared return type is
//      `IconName` (e.g. fileIconFor's `?? 'file'` fallback) — not a variable
//      declaration at all, so C alone would miss it.
//
// A dropped-but-actually-used name becomes a `name: IconName`-typed value
// that no longer type-checks (IconName = keyof typeof ICONS), so the build
// fails loudly via tsc rather than rendering a blank icon — see the
// completeness check run alongside build-icons.cjs.

const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const SRC_DIR = path.join(__dirname, '..', 'src')
const GENERATED_ICON_FILE = path.join(SRC_DIR, 'components', 'Icon.tsx')

// Icon names are always kebab-case identifiers (matches src/icons/*.svg
// filenames) — used to filter out unrelated string literals that happen to
// sit in an "icon:"-named property or an IconName-typed table by coincidence
// (there are none today, but the filter costs nothing and guards drift).
const KEBAB_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/

function isIconLikeLiteral(text) {
  return KEBAB_RE.test(text)
}

/** Recursively collects string-literal values from an expression that may be
 * a plain literal, a (possibly nested) ternary over literals — the shape
 * `<Icon name={cond ? 'a' : 'b'}>` takes — or a `??`/`||` fallback — the
 * shape `EXTENSION_TO_ICON[ext] ?? 'file'` takes. Anything else (identifier,
 * member/call expression) can't be resolved here; its source table/function
 * is expected to be picked up independently by another rule instead. */
function collectConditionalLiterals(node, names) {
  if (ts.isStringLiteral(node)) {
    if (isIconLikeLiteral(node.text)) names.add(node.text)
    return
  }
  if (ts.isConditionalExpression(node)) {
    collectConditionalLiterals(node.whenTrue, names)
    collectConditionalLiterals(node.whenFalse, names)
    return
  }
  if (
    ts.isBinaryExpression(node) &&
    (node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
      node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    collectConditionalLiterals(node.left, names)
    collectConditionalLiterals(node.right, names)
    return
  }
  if (ts.isParenthesizedExpression(node)) {
    collectConditionalLiterals(node.expression, names)
  }
}

function isFunctionLikeNode(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  )
}

/** Rule D: collects string literals from every `return` inside `fn`'s body
 * (not descending into nested function-like bodies, which have their own
 * unrelated return type), or from the body directly for an arrow function
 * with an expression body (`(): IconName => 'check'`). */
function collectFunctionReturnLiterals(fn, names) {
  if (!fn.body) return
  if (!ts.isBlock(fn.body)) {
    collectConditionalLiterals(fn.body, names)
    return
  }
  function walk(node, isRoot) {
    if (!isRoot && isFunctionLikeNode(node)) return
    if (ts.isReturnStatement(node) && node.expression) {
      collectConditionalLiterals(node.expression, names)
    }
    ts.forEachChild(node, (child) => walk(child, false))
  }
  walk(fn.body, true)
}

/** Walks an object/array literal (or a plain string literal, as the base
 * case), collecting every string-literal VALUE nested inside — used for
 * whole tables identified by looksLikeIconNameType, regardless of which
 * property key holds each value. */
function collectTableValues(node, names) {
  if (ts.isStringLiteral(node)) {
    if (isIconLikeLiteral(node.text)) names.add(node.text)
    return
  }
  if (ts.isObjectLiteralExpression(node)) {
    for (const prop of node.properties) {
      if (ts.isPropertyAssignment(prop)) collectTableValues(prop.initializer, names)
    }
    return
  }
  if (ts.isArrayLiteralExpression(node)) {
    for (const element of node.elements) collectTableValues(element, names)
    return
  }
  if (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) {
    collectTableValues(node.expression, names)
  }
}

function isIconNameTypeRef(typeNode, sourceFile) {
  return ts.isTypeReferenceNode(typeNode) && typeNode.typeName.getText(sourceFile) === 'IconName'
}

/** True if a type annotation identifies its declaration as an icon-name
 * table — see the module doc comment's rule C for the two matched shapes.
 * Deliberately checks the record's VALUE type directly rather than searching
 * the whole printed type text for the substring "IconName": a table like
 * `Array<{ type: PropertyType; label: string; icon: IconName }>` has that
 * substring nested in one field, but its OTHER fields (`type`, `label`)
 * aren't icon names — a whole-text search would sweep those values in too.
 * Rule B (the `icon:` property-name match) already covers that shape. */
function looksLikeIconNameType(typeNode, sourceFile) {
  if (!typeNode) return false
  if (isIconNameTypeRef(typeNode, sourceFile)) return true
  if (ts.isTypeReferenceNode(typeNode) && typeNode.typeName.getText(sourceFile) === 'Record') {
    const valueType = typeNode.typeArguments?.[1]
    if (!valueType) return false
    if (isIconNameTypeRef(valueType, sourceFile)) return true
    if (ts.isUnionTypeNode(valueType)) {
      return valueType.types.every((t) => ts.isLiteralTypeNode(t) && ts.isStringLiteral(t.literal))
    }
    return ts.isLiteralTypeNode(valueType) && ts.isStringLiteral(valueType.literal)
  }
  return false
}

/** Scans one source file's text for every reachable IconName, adding results
 * into `names`. `fileName` only affects TSX vs TS parsing mode. */
function scanSourceForIconNames(sourceText, fileName, names) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  )

  function visit(node) {
    // Rule A
    if (ts.isJsxAttribute(node) && node.name.getText(sourceFile) === 'name' && node.initializer) {
      const openingElement = node.parent.parent
      const tagName =
        ts.isJsxOpeningElement(openingElement) || ts.isJsxSelfClosingElement(openingElement)
          ? openingElement.tagName.getText(sourceFile)
          : null
      if (tagName === 'Icon') {
        if (ts.isStringLiteral(node.initializer)) {
          if (isIconLikeLiteral(node.initializer.text)) names.add(node.initializer.text)
        } else if (ts.isJsxExpression(node.initializer) && node.initializer.expression) {
          collectConditionalLiterals(node.initializer.expression, names)
        }
      }
    }

    // Rule B
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'icon') {
      collectConditionalLiterals(node.initializer, names)
    }

    // Rule C
    if (ts.isVariableDeclaration(node) && node.type && node.initializer) {
      if (looksLikeIconNameType(node.type, sourceFile)) {
        collectTableValues(node.initializer, names)
      }
    }

    // Rule D
    if (isFunctionLikeNode(node) && node.type && isIconNameTypeRef(node.type, sourceFile)) {
      collectFunctionReturnLiterals(node, names)
    }

    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
}

function listSourceFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      listSourceFiles(full, out)
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      // The generated file's own ICONS keys aren't a "usage" to scan.
      if (full === GENERATED_ICON_FILE) continue
      out.push(full)
    }
  }
  return out
}

/** Scans every renderer source file under src/ (excluding tests and the
 * generated Icon.tsx itself) and returns the set of reachable icon names. */
function scanIconUsage() {
  const names = new Set()
  for (const file of listSourceFiles(SRC_DIR)) {
    scanSourceForIconNames(fs.readFileSync(file, 'utf8'), file, names)
  }
  return names
}

module.exports = { scanIconUsage, scanSourceForIconNames, isIconLikeLiteral }

if (require.main === module) {
  const names = [...scanIconUsage()].sort()
  console.log(names.join('\n'))
  console.log(`\n${names.length} icon names referenced`)
}
