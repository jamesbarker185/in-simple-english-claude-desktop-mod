# In Simple English: a Claude Code mod

A side pane that shows **one** recap per turn, written in
ASD-STE100 Simplified Technical English (STE). The recap covers what Claude
did between your latest message and its answer.

v1 summarized every message and tool call, so the pane filled up with
updates. This version stays quiet while Claude works and writes one recap
when the turn ends.

## How it works

1. **Turn starts** (`turn.start`): the mod saves your message and clears its action log.
2. **Each tool call** (`tool.call`): the mod adds one line to the log, for example
   `Edit src/auth.ts [ok]`. This step makes no model call.
3. **Turn ends** (`turn.complete`): one Haiku call gets your message, the
   action log and Claude's final answer. It returns a recap in a fixed layout:

   ```
   You asked: Fix the login test.
   Claude did:
   - Read 3 files.
   - Changed the token check in auth.ts.
   - Ran the tests.
   Result: All tests pass.
   Open items: None.
   ```

How it stays quiet:

- No toasts and no status-line messages. Only the pane changes.
- A turn with no tool calls (a plain chat reply) gets no Haiku call.
- A turn of more than 40 tool calls is grouped by tool before it goes to Haiku.
- A turn you interrupt still gets a recap, labelled "Stopped by user".
- Subagent turns are ignored. Only the main conversation counts.

## Install

In the desktop app (Code tab): click **+** next to the prompt box, then
**Plugins** → **Add marketplace**, enter
`jamesbarker185/in-simple-english-claude-desktop-mod`, then **Add plugin**.

At the prompt of a terminal session:

```
/plugin install in-simple-english --marketplace jamesbarker185/in-simple-english-claude-desktop-mod
```

From a shell:

```sh
claude plugin install in-simple-english --marketplace jamesbarker185/in-simple-english-claude-desktop-mod
```

The pane opens on your first message. To open it again, use `/simple-english`.
The pane needs a local session (terminal or the desktop app's Code tab).
A cloud session has no drawing surface for mod panes.

To run it from a clone while you develop it:

```sh
claude --plugin-dir ./in-simple-english
```

## Develop

```sh
claude plugin validate ./in-simple-english
claude plugin test ./in-simple-english
```
