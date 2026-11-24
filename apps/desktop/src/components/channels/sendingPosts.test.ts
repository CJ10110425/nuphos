import assert from 'node:assert/strict'
import { test } from 'node:test'

import { atTheEnd, sendingPost, stillSending } from './sendingPosts.ts'

import type { AgentPersistedMessage } from '../../api/agent-types'
import type { UserInfo } from '../../types'

const user = { id: 'u1', name: 'Mei', username: 'mei', avatarURL: '' } as UserInfo

test('a sent post shows at once as the viewer’s own text', () => {
  const post = sendingPost('p1', 'hello', user)

  assert.equal(post.id, 'p1')
  assert.deepEqual(post.parts, [{ type: 'text', text: 'hello' }])
  assert.equal(post.metadata?.sender.id, 'u1')
  assert.equal(post.metadata?.sender.displayName, 'Mei')
})

test('a post leaves the sending list once the channel returns it', () => {
  const a = sendingPost('a', 'one', user)
  const b = sendingPost('b', 'two', user)
  const sending = [a, b]

  assert.equal(stillSending([], sending), sending)
  assert.deepEqual(stillSending([{ ...a, createdAt: 'now' }], sending), [b])
})

test('a post with files shows their uploading card, with or without words', () => {
  const card = { type: 'transfer-upload', groupId: '', status: 'uploading', files: [] }

  assert.deepEqual(sendingPost('p2', '', user, card).parts, [card])
  assert.deepEqual(sendingPost('p3', 'look', user, card).parts, [
    { type: 'text', text: 'look' },
    card,
  ])
})

const storedAt = (id: string, at: string): AgentPersistedMessage => ({
  id,
  role: 'user',
  parts: [{ type: 'text', text: id }],
  metadata: {
    version: 1,
    source: 'nuphos',
    sender: { type: 'user', id: 'u2', displayName: 'Jo' },
    sentAt: at,
  },
})
const timeOf = (post: AgentPersistedMessage) =>
  Date.parse(post.metadata?.sentAt ?? post.createdAt ?? '')

test('a post sent on a clock behind the server still sorts after every stored post', () => {
  const stored = [
    storedAt('s1', '2026-11-23T10:00:00.000Z'),
    storedAt('s2', '2026-11-23T10:01:00.000Z'),
  ]
  const a = {
    ...sendingPost('a', 'one', user),
    metadata: { ...storedAt('a', '2026-11-23T09:59:00.000Z').metadata! },
  }
  const b = {
    ...sendingPost('b', 'two', user),
    metadata: { ...storedAt('b', '2026-11-23T09:59:01.000Z').metadata! },
  }
  const [first, second] = atTheEnd(stored, [a, b])

  assert.ok(timeOf(first!) >= timeOf(stored[1]!))
  assert.ok(timeOf(second!) >= timeOf(first!))
  assert.deepEqual(first!.parts, a.parts)
  assert.equal(first!.id, 'a')
})

test('a post on a clock at or ahead of the server keeps its own time', () => {
  const stored = [storedAt('s1', '2026-11-23T10:00:00.000Z')]
  const post = sendingPost('a', 'one', user)

  assert.equal(atTheEnd(stored, [post])[0], post)
  assert.deepEqual(atTheEnd(stored, []), [])
})

test('a post sent before the viewer is known still sorts at the bottom', () => {
  const stored = [storedAt('s1', '2026-11-23T10:00:00.000Z')]
  const post = sendingPost('a', 'one', null as unknown as UserInfo)
  const [shown] = atTheEnd(stored, [post])

  assert.equal(timeOf(shown!), timeOf(stored[0]!))
})
