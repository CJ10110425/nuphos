import { parseMessageMetadata } from '../agent/panel/messageMetadata.ts'
import { optimisticSenderMetadata } from '../agent/panel/optimisticSender.ts'

import type {
  AgentMessageMention,
  AgentMessageReply,
  AgentPersistedMessage,
} from '../../api/agent-types'
import type { UserInfo } from '../../types'

/**
 * A post as it shows the moment it is sent, under the id the channel will store
 * it by, with its files' uploading card if any.
 */
export function sendingPost(
  id: string,
  text: string,
  user: UserInfo,
  upload?: object,
  mentions?: AgentMessageMention[],
  replyTo?: AgentMessageReply,
): AgentPersistedMessage {
  const sender = optimisticSenderMetadata(user, Date.now())
  const metadata = sender && {
    ...sender,
    ...(mentions?.length ? { mentions } : {}),
    ...(replyTo ? { replyTo } : {}),
  }

  return {
    id,
    role: 'user',
    parts: [...(text.trim() ? [{ type: 'text', text }] : []), ...(upload ? [upload] : [])],
    ...(metadata ? { metadata } : {}),
  }
}

/** The posts still on their way: the channel has not returned them yet. */
export function stillSending(
  stored: readonly AgentPersistedMessage[],
  sending: AgentPersistedMessage[],
): AgentPersistedMessage[] {
  const ids = new Set(stored.map((message) => message.id))
  const left = sending.filter((post) => !ids.has(post.id))

  return left.length === sending.length ? sending : left
}

const postedAt = (message: AgentPersistedMessage) =>
  Date.parse(parseMessageMetadata(message.metadata)?.sentAt ?? message.createdAt ?? '') || 0

/**
 * The posts still on their way, timed no earlier than the newest stored post.
 *
 * A sending post is stamped by this computer's clock, while the channel's posts carry the
 * server's time. When this clock runs behind, the post sorted above posts already in the chat
 * and jumped to the bottom once the channel returned it under the server's time. It was just
 * sent, so it belongs after everything the channel has returned: it shows at the bottom from the
 * start, and the channel's copy takes its place there.
 */
export function atTheEnd(
  stored: readonly AgentPersistedMessage[],
  sending: AgentPersistedMessage[],
): AgentPersistedMessage[] {
  if (!sending.length) return sending
  let floor = stored.reduce((latest, message) => Math.max(latest, postedAt(message)), 0)

  return sending.map((post) => {
    const at = postedAt(post)

    if (at >= floor) {
      floor = at

      return post
    }
    const time = new Date(floor).toISOString()

    // A post sent without its sender yet has no time at all, and sorted to the very top.
    return {
      ...post,
      createdAt: time,
      ...(post.metadata ? { metadata: { ...post.metadata, sentAt: time } } : {}),
    }
  })
}
