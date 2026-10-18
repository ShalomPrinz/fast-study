// The "Study with AI" card's pure half: which chats it can open, and what it puts on the clipboard.
export const AI_PROVIDER_IDS = ['claude', 'chatgpt', 'gemini'] as const
export type AiProvider = (typeof AI_PROVIDER_IDS)[number]

// Names are brands, the same in every language, so they are not catalog entries. Each URL is the
// provider's fresh-chat page: nothing is prefilled, the user pastes.
export const AI_PROVIDERS: Record<AiProvider, { name: string; url: string }> = {
  claude: { name: 'Claude', url: 'https://claude.ai/new' },
  chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/' },
  gemini: { name: 'Gemini', url: 'https://gemini.google.com/app' },
}

/** Unset or unknown means Claude. */
export function toAiProvider(stored: string | null | undefined): AiProvider {
  return (AI_PROVIDER_IDS as readonly string[]).includes(stored ?? '')
    ? (stored as AiProvider)
    : 'claude'
}

// A `"` in a name would close the attribute early, so it becomes `'`.
const attr = (value: string) => value.replace(/"/g, "'")

/** The prompt, a blank line, then the summary wrapped in a `<lecture>` tag naming its course and title. */
export function clipboardText(
  prompt: string,
  course: string,
  lecture: string,
  summary: string,
): string {
  return `${prompt}\n\n<lecture course="${attr(course)}" title="${attr(lecture)}">\n${summary}\n</lecture>`
}
