// Autocomplete tokens for payment fields all start with cc- (cc-number,
// cc-exp, cc-csc). That prefix is only meaningful on the autocomplete
// attribute; on ids and names it is far too common to treat as sensitive.
const AUTOCOMPLETE_PATTERN = /^cc-|^new-password$|^current-password$|^one-time-code$/i;
const LABEL_PATTERN = /\bcard\b|cvc|cvv|\bssn\b|social security|passw|routing|account number|\bexpir/i;

type ValueElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

export function isSensitive(el: Element): boolean {
  if (el instanceof HTMLInputElement && el.type === "password") return true;
  if (el.closest("[data-pf-sensitive]")) return true;
  const autocomplete = el.getAttribute("autocomplete") ?? "";
  if (AUTOCOMPLETE_PATTERN.test(autocomplete.trim())) return true;
  const probe = [el.getAttribute("name"), el.getAttribute("id"), el.getAttribute("aria-label"), el.getAttribute("placeholder")]
    .filter(Boolean)
    .join(" ");
  return LABEL_PATTERN.test(probe);
}

// Sensitive fields are reported only as filled or empty. Everything else is
// sent as a short value so the agent can reason about progress.
export function maskValue(el: ValueElement): string {
  const raw = el.value ?? "";
  if (isSensitive(el)) return raw.length > 0 ? "[filled]" : "[empty]";
  const collapsed = raw.replace(/\s+/g, " ").trim();
  return collapsed.length > 40 ? collapsed.slice(0, 40) + "..." : collapsed;
}
