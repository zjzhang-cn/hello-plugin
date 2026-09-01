import type { Context } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { HelloPill } from './components/HelloPill'

export const inject = ['slots', 'connection']

export function apply(ctx: Context): void {
  const connection = ctx.get('connection') as ConnectionHandle
  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'hello-pill', inject: () => ({ connection }) },
    HelloPill,
  )))
}
