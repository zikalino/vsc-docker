/**
 * Minimal JSONPath resolver for the limited subset of JSONPath expressions
 * used in docker-runner YAML tree definitions.
 *
 * Supported patterns:
 *   $                     → root object (in array)
 *   $.prop                → root.prop
 *   $.prop.sub            → root.prop.sub
 *   $.[0]                 → first array element
 *   $.[0].prop            → first element's property
 *   $.[0].prop.sub        → nested
 *   $.[0].prop[0]         → nested array index
 *   $[::]                 → all array elements
 *   $[::].prop            → all elements → .prop
 *   $.state               → simple property
 *   prop                  → simple property (no $)
 *   prop.sub              → nested (no $)
 */
export function resolveJsonPath(obj: any, pathStr: string): any[] {
  if (pathStr === '$' || pathStr === '') {
    return [obj];
  }

  // Normalize: strip leading $[.]? if present
  let normalized = pathStr;
  if (normalized.startsWith('$')) {
    normalized = normalized.slice(1);
    // Skip optional . after $
    if (normalized.startsWith('.')) {
      normalized = normalized.slice(1);
    }
  }

  // Tokenize into segments: .prop or [n] or [::]
  const tokens: string[] = [];
  let i = 0;
  while (i < normalized.length) {
    const c = normalized[i];
    if (c === '.') {
      // property access: .propname
      i++;
      const start = i;
      while (i < normalized.length && normalized[i] !== '.' && normalized[i] !== '[') { i++; }
      tokens.push(normalized.slice(start, i));
    } else if (c === '[') {
      // bracket access: [n] or [::]
      const close = normalized.indexOf(']', i);
      if (close === -1) break;
      tokens.push(normalized.slice(i + 1, close));
      i = close + 1;
    } else {
      // bare property (no leading .)
      const start = i;
      while (i < normalized.length && normalized[i] !== '.' && normalized[i] !== '[') { i++; }
      tokens.push(normalized.slice(start, i));
    }
  }

  // Evaluate tokens against obj
  let results: any[] = [obj];

  for (const token of tokens) {
    if (token === '::') {
      // Wildcard: expand all array elements
      const expanded: any[] = [];
      for (const r of results) {
        if (Array.isArray(r)) {
          expanded.push(...r);
        }
      }
      results = expanded;
    } else if (/^\d+$/.test(token)) {
      // Numeric index
      const idx = parseInt(token, 10);
      const expanded: any[] = [];
      for (const r of results) {
        if (Array.isArray(r) && idx < r.length) {
          expanded.push(r[idx]);
        }
      }
      results = expanded;
    } else {
      // Property access
      const expanded: any[] = [];
      for (const r of results) {
        if (r && typeof r === 'object' && token in r) {
          expanded.push(r[token]);
        }
      }
      results = expanded;
    }
  }

  return results;
}
