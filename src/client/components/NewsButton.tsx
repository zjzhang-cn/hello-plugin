import * as React from 'react'

interface NewsButtonProps {
  newsLoading: boolean
  onStartNews: () => void
}

export function NewsButton({ newsLoading, onStartNews }: NewsButtonProps): React.ReactElement {
  return React.createElement('button', {
    onClick: onStartNews,
    disabled: newsLoading,
    title: '获取 Google 最新新闻并总结（新会话）',
    style: {
      border: 'none', borderRadius: '999px', padding: '8px 14px', fontSize: '13px',
      color: '#fff', background: newsLoading ? '#0e7a8c' : '#0e93ab', cursor: 'pointer',
    },
  }, newsLoading ? '获取中…' : '📰 获取新闻')
}
