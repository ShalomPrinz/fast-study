// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { scan, scrollToMatch } from './searchDom'

describe('scrollToMatch', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function mount(html: string) {
    const root = document.createElement('div')
    root.innerHTML = html
    document.body.append(root)
    Element.prototype.scrollIntoView = () => {}
    return root
  }

  it('opens every closed details around the current match', () => {
    const root = mount(
      '<details id="a"><summary>Guide</summary><details id="b"><summary>Shot</summary><a>Get a key</a></details></details>',
    )
    scrollToMatch(scan(root, 'get a key')[0])
    expect(root.querySelector<HTMLDetailsElement>('#a')!.open).toBe(true)
    expect(root.querySelector<HTMLDetailsElement>('#b')!.open).toBe(true)
  })

  it('leaves a details closed when the match is in its summary', () => {
    const root = mount('<details><summary>Show screenshot</summary><p>body</p></details>')
    scrollToMatch(scan(root, 'screenshot')[0])
    expect(root.querySelector('details')!.open).toBe(false)
  })
})
