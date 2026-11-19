import type { ConfigOptions, Settings } from '@/services/settings'

// The model the form shows: a stored one the options no longer list reads as the first, so Save sends
// it; with no options (the backend is down) the stored one stays as is, so Save leaves it alone.
export function formModel(stored: Settings, options: ConfigOptions | null): string {
  const model = stored.geminiModel
  if (!options) return model ?? ''
  const models = options.geminiModels.map((m) => m.id)
  return model !== null && models.includes(model) ? model : (models[0] ?? '')
}

/** The fallback rows the backend runs with: the saved list cleaned, else the derived default
 *  (docs/MIGRATIONS.md, "Derived summary model fallback list"). */
export function effectiveFallback(stored: Settings, options: ConfigOptions): string[] {
  const curated = options.geminiModels.map((m) => m.id)
  const main = formModel(stored, options)
  if (stored.geminiFallbackModels !== null) {
    return [...new Set(stored.geminiFallbackModels)].filter(
      (id) => curated.includes(id) && id !== main,
    )
  }
  if (stored.geminiAutoFallback === false) return []
  const at = curated.indexOf(main)
  return [...curated.slice(at + 1), ...curated.slice(0, Math.max(at, 0))]
}

export function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i])
}

/** `order` with the row at `from` moved one step; unchanged at either end. */
export function moveModel(order: string[], from: number, step: -1 | 1): string[] {
  const to = from + step
  if (to < 0 || to >= order.length) return order
  const next = [...order]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

/** `order` without `id`, or null when that would leave it empty — one model must stay. */
export function removeModel(order: string[], id: string): string[] | null {
  return order.length <= 1 ? null : order.filter((m) => m !== id)
}
