import { describe, expect, it } from 'vitest'
import { AI_PROVIDERS, clipboardText, toAiProvider } from './aiChat'

describe('clipboardText', () => {
  it('puts the prompt, a blank line, then the summary inside a lecture tag', () => {
    expect(clipboardText('Study this.', 'Physics', 'Lecture 1', '# Summary\nbody')).toBe(
      'Study this.\n\n<lecture course="Physics" title="Lecture 1">\n# Summary\nbody\n</lecture>',
    )
  })

  it("replaces double quotes in the course and lecture names with ' so the tag stays well-formed", () => {
    expect(clipboardText('P', 'תשפ"ה', 'say "hi"', 'a "quoted" summary')).toBe(
      'P\n\n<lecture course="תשפ\'ה" title="say \'hi\'">\na "quoted" summary\n</lecture>',
    )
  })
})

describe('toAiProvider', () => {
  it('keeps a known provider', () => {
    expect(toAiProvider('chatgpt')).toBe('chatgpt')
    expect(toAiProvider('gemini')).toBe('gemini')
    expect(toAiProvider('claude')).toBe('claude')
  })

  it('falls back to claude when nothing or something unknown is stored', () => {
    expect(toAiProvider(null)).toBe('claude')
    expect(toAiProvider(undefined)).toBe('claude')
    expect(toAiProvider('copilot')).toBe('claude')
    expect(toAiProvider('')).toBe('claude')
  })
})

describe('AI_PROVIDERS', () => {
  it('opens each provider at its fresh-chat URL', () => {
    expect(AI_PROVIDERS.claude.url).toBe('https://claude.ai/new')
    expect(AI_PROVIDERS.chatgpt.url).toBe('https://chatgpt.com/')
    expect(AI_PROVIDERS.gemini.url).toBe('https://gemini.google.com/app')
  })
})
