import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'in-simple-english',
  component: 'Pane',
  requestId: 'in-simple-english',
  props: {
    title: 'In Simple English',
    isFocused: false,
    bodyColumns: 50,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const RECAP = [
  'You asked: Fix the login test.',
  'Claude did:',
  '- Read 1 file.',
  '- Ran the tests.',
  'Result: The tests pass.',
  'Open items: None.',
].join('\n')

test('one recap per turn, from all its tool calls', async ($, on) => {
  const clock = mock.clock(on)
  const asks: string[] = []
  on('tool.call', () => ({ result: {} }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('model.complete', (_, e) => {
    asks.push(e.prompt)
    return { value: { isAnswered: true, text: RECAP, usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }
  })

  await $.turn.start({ text: 'Fix the login test', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: '/src/auth.ts' })
  await $.tool.call({ tool: 'Bash', command: 'npm test' })

  const working = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await working.find({ type: 'Text' }))?.text).toBe('Working… (2 actions so far)')
  await working.unmount()

  await $.turn.complete({ answer: 'Done.', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.settle()

  expect(asks.length).toBe(1)
  expect(asks[0]).toContain('Read /src/auth.ts [ok]')
  expect(asks[0]).toContain('Bash npm test [ok]')

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Read 1 file/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /The tests pass/ })).toBeDefined()
    await ui.unmount()
  }
})

test('a turn with no tool calls makes no model call', async ($, on) => {
  const clock = mock.clock(on)
  let calls = 0
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('model.complete', () => {
    calls++
    return { value: { isAnswered: false, reason: 'empty-reply', usage: { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } }
  })

  await $.turn.start({ text: 'Hi', turnId: 't2' })
  await $.turn.complete({ answer: 'Hello.', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  await clock.settle()

  expect(calls).toBe(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('No actions this turn. See the answer.')
  await ui.unmount()
})

test('a prompt opens the pane, a continuation does not', async ($, on) => {
  const opened: string[] = []
  on('ui.open', (_, e) => {
    opened.push(e.id)
    return { value: { isPlaced: true } }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))

  await $.turn.start({ text: 'Fix it', turnId: 't3' })
  await $.turn.start({ text: '', turnId: 't4' })

  expect(opened).toEqual(['in-simple-english'])
})
