import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, ToolCallInput, ToolCallResult } from 'claude-code'

import type { Recap } from '../types'

const PANE = 'in-simple-english'
const TITLE = 'In Simple English'
const MAX_ACTIONS_RAW = 40

const IDLE: Recap = { turnId: '', status: 'idle', actionCount: 0, isStopped: false, text: '' }
// Change the tag when Recap's fields change: it declines what an earlier
// version stored, which outlives a reload.
const recap = atom({ plugin: 'in-simple-english', key: 'recap' } as const, IDLE, {
  shape: 'recap-1',
})

type Action = { tool: string; target: string; outcome: 'ok' | 'failed' | 'denied' }

// The turn being recorded. Module variables start over on a reload; a turn
// that spans one simply loses its earlier actions.
let turnId = ''
let prompt = ''
let actions: Action[] = []
let pending: AbortController | undefined

const SYSTEM = `You write a short recap of one work turn of an AI coding assistant.
Write in ASD-STE100 Simplified Technical English:
- Use approved, simple words. Use one meaning for each word.
- Each sentence has 20 words or fewer. Use the active voice. One fact for each sentence.
- Do not use idioms, jokes or filler. Do not guess. Use only the data given.
Use exactly this layout and nothing else:
You asked: <one sentence>
Claude did:
- <3 to 6 bullets; group similar actions, for example "Read 3 files.">
Result: <one or two sentences>
Open items: <one sentence, or "None.">`

function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, ' ').trim()
  return line.length > max ? `${line.slice(0, max - 1)}…` : line
}

function targetOf(e: ToolCallInput): string {
  const a = e as unknown as Record<string, unknown>
  const pick = (key: string) => (typeof a[key] === 'string' ? (a[key] as string) : '')
  const target =
    pick('description') && e.tool === 'Agent'
      ? pick('description')
      : pick('file_path') ||
        pick('notebook_path') ||
        pick('command') ||
        pick('pattern') ||
        pick('url') ||
        pick('query') ||
        pick('description') ||
        pick('path')
  return clip(target, 100)
}

function outcomeOf(res: ToolCallResult): Action['outcome'] {
  if (res.deny !== undefined) return 'denied'
  return res.isError ? 'failed' : 'ok'
}

function formatActions(list: Action[]): string {
  if (list.length <= MAX_ACTIONS_RAW) {
    return list.map(a => `${a.tool} ${a.target} [${a.outcome}]`).join('\n')
  }
  // Long turns: one line per tool and outcome, with a count and a few targets.
  const groups = new Map<string, Action[]>()
  for (const a of list) {
    const key = `${a.tool} [${a.outcome}]`
    groups.set(key, [...(groups.get(key) ?? []), a])
  }
  return [...groups]
    .map(([key, group]) => {
      const targets = [...new Set(group.map(a => a.target).filter(Boolean))]
      const shown = targets.slice(0, 3).join('; ')
      const more = targets.length > 3 ? `; +${targets.length - 3} more` : ''
      return `${key} x${group.length}: ${shown}${more}`
    })
    .join('\n')
}

async function summarize(
  $: EngineInterface,
  id: string,
  userText: string,
  list: Action[],
  answer: string,
  isStopped: boolean,
): Promise<void> {
  pending?.abort()
  const stop = new AbortController()
  pending = stop
  const ask = [
    `User message:\n${clip(userText, 2000) || '(none)'}`,
    `Actions, in order (tool, target, outcome):\n${formatActions(list)}`,
    `Assistant final answer:\n${clip(answer, 3000) || '(none)'}`,
    isStopped ? 'Note: the user stopped this turn before it ended.' : '',
  ]
    .filter(Boolean)
    .join('\n\n')
  const r = await $.model.complete(
    { model: 'haiku', system: SYSTEM, prompt: ask, maxTokens: 400, timeoutMs: 60_000 },
    { signal: stop.signal },
  )
  // A newer turn started meanwhile: its recap owns the pane.
  if (pending !== stop) return
  pending = undefined
  await update($, recap, (cur): Recap => {
    if (cur.turnId !== id) return cur
    return r.isAnswered
      ? { ...cur, status: 'done', text: r.text.trim() }
      : { ...cur, status: 'error', text: `No recap: ${r.reason}.` }
  })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'simple-english',
      description: 'Open the In Simple English recap pane',
    })
    void $.ui.open({ id: PANE, title: TITLE })

    return next(e)
  })

  on('command.run', { command: 'simple-english' }, async $ => {
    const opened = await $.ui.open({ id: PANE, title: TITLE })

    return {
      text: opened.isPlaced
        ? 'In Simple English pane opened.'
        : `In Simple English pane not shown: ${opened.reason}.`,
    }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) return next(e)
    // Unasked, a surface places a pane only when it is wide; opened for the
    // person's own prompt, it is placed at any width.
    if (e.text !== '') void $.ui.open({ id: PANE, title: TITLE })
    // A continuation (empty text) keeps the user's message it continues.
    if (e.text !== '' || turnId === '') {
      prompt = e.text
      actions = []
    }
    turnId = e.turnId
    pending?.abort()
    pending = undefined
    await update($, recap, (): Recap => ({ ...IDLE, turnId: e.turnId, status: 'working' }))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const res = await next(e)
    if (e.agentId === undefined && turnId !== '') {
      actions.push({ tool: e.tool, target: targetOf(e), outcome: outcomeOf(res) })
      await update($, recap, cur => ({ ...cur, actionCount: actions.length }))
    }

    return res
  })

  on('turn.complete', async ($, e, next) => {
    const res = await next(e)
    if (e.agentId !== undefined || e.turnId !== turnId) return res

    const id = e.turnId
    const list = actions
    const userText = prompt
    const isStopped = e.isAborted
    turnId = ''

    if (list.length === 0) {
      await update($, recap, (cur): Recap => ({ ...cur, status: 'no-actions', isStopped }))
      return res
    }
    await update($, recap, (cur): Recap => ({ ...cur, status: 'summarizing', isStopped }))
    // Run outside this dispatch so the Haiku call neither delays the turn's
    // end nor is cut when the dispatch settles.
    $.clock.after(0, () => {
      void summarize($, id, userText, list, e.answer, isStopped)
    })

    return res
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const cur = await read($, recap)
    const count = `${cur.actionCount} action${cur.actionCount === 1 ? '' : 's'}`

    if (cur.status === 'idle') {
      return <Text dimColor>Send a message. A recap shows here when Claude stops.</Text>
    }
    if (cur.status === 'working') {
      return <Text dimColor>Working… ({count} so far)</Text>
    }
    if (cur.status === 'summarizing') {
      return <Text dimColor>Writing recap of {count}…</Text>
    }
    if (cur.status === 'no-actions') {
      return <Text dimColor>No actions this turn. See the answer.</Text>
    }

    return (
      <Box flexDirection="column">
        {cur.isStopped && <Text color="yellow">Stopped by user.</Text>}
        {cur.text.split('\n').map(line => {
          const label = /^(You asked|Claude did|Result|Open items):/.exec(line)
          return label ? (
            <Text>
              <Text bold>{label[0]}</Text>
              {line.slice(label[0].length)}
            </Text>
          ) : (
            <Text dimColor={cur.status === 'error'}>{line}</Text>
          )
        })}
      </Box>
    )
  })
}
