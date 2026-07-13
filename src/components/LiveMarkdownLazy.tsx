// Thin default-export wrapper so Editor.tsx can React.lazy()-load the
// Milkdown/ProseMirror stack instead of statically importing it (#583).
// LiveMarkdown itself stays a named export — several specs import it (and
// misspelledWordRange) directly for synchronous testing — so this wrapper
// exists purely as the dynamic-import() boundary, not a behavior change.
export { LiveMarkdown as default } from './LiveMarkdown'
