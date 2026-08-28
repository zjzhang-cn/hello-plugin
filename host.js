export const name = 'dsh-hello-plugin'
export function apply(ctx) {
  const logger = ctx.logger('hello-plugin')
  logger.info('host loaded')
  console.log('hello-plugin/host.js loaded')
}