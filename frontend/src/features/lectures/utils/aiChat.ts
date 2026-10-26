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

export interface AssignmentClipboardInput {
  prompt: string
  course: string
  assignment: string
  lectures: { kind: string; title: string; summary: string }[]
  intuition: string | null
  solution: string | null
}

/** The prompt, a blank line, then an `<assignment>` tag holding each chosen summary and the guides that exist. */
export function assignmentClipboardText(input: AssignmentClipboardInput): string {
  const parts = input.lectures.map(
    (l) => `<lecture kind="${attr(l.kind)}" title="${attr(l.title)}">\n${l.summary}\n</lecture>`,
  )
  if (input.intuition !== null)
    parts.push(`<intuition_guide>\n${input.intuition}\n</intuition_guide>`)
  if (input.solution !== null) parts.push(`<solution>\n${input.solution}\n</solution>`)
  return `${input.prompt}\n\n<assignment course="${attr(input.course)}" title="${attr(input.assignment)}">\n${parts.join('\n')}\n</assignment>`
}
