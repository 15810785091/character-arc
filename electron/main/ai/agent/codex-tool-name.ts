/** Resolve a model-returned Codex host tool name against the advertised catalog. */
export function resolveCodexHostToolName(
  requestedName: string,
  availableNames: ReadonlySet<string>
): string | null {
  const requested = requestedName.trim()
  if (availableNames.has(requested)) return requested

  // Codex occasionally applies Markdown escaping even inside the JSON protocol,
  // returning e.g. `stage\_outline\_volume`. Only accept the unescaped value
  // when it exactly matches a tool that the host actually advertised.
  const markdownUnescaped = requested.replace(/\\_/g, '_')
  return markdownUnescaped !== requested && availableNames.has(markdownUnescaped)
    ? markdownUnescaped
    : null
}
