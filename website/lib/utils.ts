// Minimal `cn` — the project has no Tailwind, so this is a plain class joiner
// (no tailwind-merge needed). Used by the MagicUI ProgressiveBlur component.
export function cn(
  ...inputs: Array<string | undefined | null | false>
): string {
  return inputs.filter(Boolean).join(" ");
}
