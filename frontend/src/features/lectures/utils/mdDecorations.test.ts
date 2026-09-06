import { describe, it, expect } from 'vitest'
import { scanCallouts, scanCodeFences, scanMath } from './mdDecorations'

// Offsets are easier to read as the substring they cover.
const slice = (text: string, r: { from: number; to: number }) => text.slice(r.from, r.to)

describe('scanCallouts', () => {
  it('spans the opening line through the closing one', () => {
    const text = 'before\n::: definition\nגוף\n:::\nafter'
    const [callout] = scanCallouts(text)
    expect(callout.cls).toBe('definition')
    expect(slice(text, callout)).toBe('::: definition\nגוף\n:::')
  })

  it('finds each of the three classes', () => {
    const text = '::: definition\na\n:::\n\n::: warning\nb\n:::\n\n::: insight\nc\n:::'
    expect(scanCallouts(text).map((c) => c.cls)).toEqual(['definition', 'warning', 'insight'])
  })

  it('ignores an unknown class so a typo renders plain', () => {
    expect(scanCallouts('::: definitio\nx\n:::')).toEqual([])
  })

  it('ignores an unclosed block', () => {
    expect(scanCallouts('::: warning\nx\ny')).toEqual([])
  })

  it('treats an opener inside a block as content and closes at the first bare :::', () => {
    const text = '::: insight\n::: warning\nx\n:::\nafter\n:::'
    const found = scanCallouts(text)
    expect(found).toHaveLength(1)
    expect(found[0].cls).toBe('insight')
    expect(slice(text, found[0])).toBe('::: insight\n::: warning\nx\n:::')
  })

  it('ignores ::: lines inside a code fence', () => {
    expect(scanCallouts('```\n::: definition\nx\n:::\n```')).toEqual([])
  })
})

describe('scanMath', () => {
  it('marks inline math inside an RTL line', () => {
    const text = 'הנוסחה היא $E = mc^2$ וזהו'
    const [math] = scanMath(text)
    expect(slice(text, math)).toBe('$E = mc^2$')
    expect(math.display).toBe(false)
  })

  it('marks display math spanning lines', () => {
    const text = 'לפני\n$$\n\\int_0^1 x\\,dx\n$$\nאחרי'
    const [math] = scanMath(text)
    expect(slice(text, math)).toBe('$$\n\\int_0^1 x\\,dx\n$$')
    expect(math.display).toBe(true)
  })

  it('ignores an unbalanced $', () => {
    expect(scanMath('עלות של 40$ בלבד')).toEqual([])
  })

  it('does not let inline math cross a line break', () => {
    expect(scanMath('$פתוח\nסגור$')).toEqual([])
  })

  it('ignores $ inside a code fence', () => {
    expect(scanMath('```bash\necho $HOME $PATH\n```')).toEqual([])
  })

  it('still finds math after a code fence', () => {
    const text = '```\n$x$\n```\nולכן $y$ קטן'
    const found = scanMath(text)
    expect(found).toHaveLength(1)
    expect(slice(text, found[0])).toBe('$y$')
  })
})

describe('scanCodeFences', () => {
  it('runs an unclosed fence to the end of the document', () => {
    const text = 'a\n```\nb'
    expect(scanCodeFences(text)).toEqual([{ from: 2, to: text.length }])
  })
})
