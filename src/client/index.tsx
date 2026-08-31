import * as React from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'

interface HelloEvent {
  event: string
  args: unknown[]
}

interface JiraIssueType {
  id: string
  name: string
  color: string
  iconUrl: string
}

interface HelloPillProps {
  connection: ConnectionHandle
}

function HelloPill({ connection }: HelloPillProps): React.ReactElement {
  const [count, setCount] = React.useState(0)
  const [reply, setReply] = React.useState<string | null>(null)
  const [events, setEvents] = React.useState<string[]>([])
  const [issueTypes, setIssueTypes] = React.useState<JiraIssueType[] | null>(null)
  const [issueTypesError, setIssueTypesError] = React.useState<string | null>(null)

  const onClick = (): void => {
    setCount((currentCount) => currentCount + 1)
    void connection.rpc
      .call('/hello', 'ping', { args: { name: 'browser' } })
      .then((result) => {
        if (result.ok) setReply(String(result.value))
        else setReply(`error: ${result.error.code}: ${result.error.message}`)
      })
      .catch((error: unknown) => setReply(`error: ${String(error)}`))
    void loadIssueTypes()
  }

  const loadIssueTypes = (): void => {
    setIssueTypesError(null)
    void connection.rpc
      .call('/hello', 'jira/issue-types', { args: {} })
      .then((result) => {
        if (result.ok) {
          setIssueTypes(result.value as JiraIssueType[])
        } else {
          setIssueTypesError(`${result.error.code}: ${result.error.message}`)
        }
      })
      .catch((error: unknown) => setIssueTypesError(String(error)))
  }

  React.useEffect(() => {
    let cancelled = false
    let inflight = false
    async function poll(): Promise<void> {
      if (cancelled || inflight) return
      inflight = true
      try {
        const result = await connection.rpc.call('/hello', 'events/poll', { args: {} })
        inflight = false
        if (!cancelled && result.ok && Array.isArray(result.value)) {
          const incoming = (result.value as HelloEvent[]).map((item) => `${item.event}: ${item.args.join(' ')}`)
          if (incoming.length > 0) setEvents((previousEvents) => [...incoming.reverse(), ...previousEvents].slice(0, 5))
        }
      } catch {
        inflight = false
        if (!cancelled) {
          setTimeout(poll, 3_000)
          return
        }
      }
      if (!cancelled) void poll()
    }
    void poll()
    return () => { cancelled = true }
  }, [connection])

  return React.createElement(
    'div',
    {
      style: {
        position: 'fixed', right: '16px', bottom: '16px', zIndex: 1000,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '8px',
        fontFamily: 'system-ui, sans-serif',
      },
    },
    ...events.map((text, index) => React.createElement('div', {
      key: text + index,
      style: {
        background: index === 0 ? 'rgba(79,124,255,0.12)' : 'rgba(0,0,0,0.06)',
        border: '1px solid rgba(79,124,255,0.35)', borderRadius: '8px', padding: '6px 10px',
        fontSize: '12px', color: index === 0 ? '#4f7cff' : '#6a7c99', maxWidth: '260px',
      },
    }, text)),
    ...(issueTypesError !== null
      ? [React.createElement('div', {
          key: 'jira-error',
          style: {
            background: 'rgba(214,69,64,0.1)', border: '1px solid rgba(214,69,64,0.35)',
            borderRadius: '8px', padding: '6px 10px', fontSize: '12px',
            color: '#d64540', maxWidth: '260px', textAlign: 'right',
          },
        }, `Jira: ${issueTypesError}`)]
      : []),
    ...(issueTypes !== null
      ? [React.createElement('div', {
          key: 'jira-types',
          style: {
            display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end',
            gap: '6px', maxWidth: '280px',
          },
        },
        ...issueTypes.map((issueType) => React.createElement('div', {
          key: issueType.id,
          title: issueType.name,
          style: {
            display: 'flex', alignItems: 'center', gap: '5px',
            background: 'rgba(0,0,0,0.06)', border: '1px solid rgba(0,0,0,0.12)',
            borderRadius: '999px', padding: '3px 9px', fontSize: '12px',
            color: '#334155',
          },
        },
        issueType.iconUrl !== ''
          ? React.createElement('img', {
              src: issueType.iconUrl,
              alt: '',
              style: { width: '14px', height: '14px', objectFit: 'contain' },
            })
          : React.createElement('span', {
              style: {
                width: '10px', height: '10px', borderRadius: '50%',
                background: issueType.color, flexShrink: 0,
              },
            }),
        issueType.name)))]
      : []),
    React.createElement('button', {
      onClick,
      style: {
        border: 'none', borderRadius: '999px', padding: '8px 14px', fontSize: '13px',
        color: '#fff', background: '#4f7cff', cursor: 'pointer',
      },
    }, reply === null ? `hello world x${count}` : reply),
  )
}

export const inject = ['slots', 'connection']

export function apply(ctx: Context): void {
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'hello-pill', inject: () => ({ connection }) },
    HelloPill,
  )))
}