import { expect, mock, test } from 'claude-code/testing'

const BAND = {
  plugin: 'axel-ui',
  component: 'AbovePrompt',
  requestId: 'band',
  props: { hasSurvey: false, isWorking: true, maxRows: 5, bodyColumns: 120, scroll: { top: 0, bodyRows: 5 }, view: {} },
} as const

const HINT = {
  plugin: 'axel-ui',
  component: 'PromptHint',
  requestId: 'hint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

test('idle: band passes to the engine', async ($, on) => {
  mock.clock(on)
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface, props: { ...BAND.props, isWorking: false } })
    expect(await ui.find({ type: 'Text', text: /engine/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /thinking|✓/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('working: band counts the finished tool', async ($, on) => {
  mock.clock(on)
  on('ui.render', ($, e) => { const { Text } = $.ui.resolve(e); return <Text>engine</Text> })
  on('prompt.submit', () => ({ text: 'hi' }))
  on('tool.call', () => ({ result: 'ok', text: 'ok' }))
  await $.prompt.submit({ text: 'hi' })
  await $.tool.call({ tool: 'Bash', command: 'ls', description: 'List files' })
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /✓1/ })).toBeDefined()
  await ui.unmount()
})

test('hint: tail is appended to the engine line', async ($, on) => {
  mock.clock(on)
  let seenTail = ''
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    if (e.component === 'PromptHint') seenTail = e.props.tail ?? ''
    return <Text>engine</Text>
  })
  const ui = await $.ui.mount({ ...HINT, surface: 'terminal' })
  await ui.unmount()
  expect(seenTail).toBe('')
})
