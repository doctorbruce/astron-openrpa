import type { StudioChatCard, StudioSessionDetail } from '../views/AIStudio/types'

type StreamingTextDeltaPayload = {
  messageId: string
  partId: string
  field: string
  delta: string
}

type StreamingTextPartPayload = {
  messageId: string
  text: string
}

export function applyStreamingTextDelta(
  session: StudioSessionDetail,
  payload: StreamingTextDeltaPayload,
): StudioSessionDetail {
  if (payload.field !== 'text' || !payload.delta)
    return session

  const existingCard = session.chatCards.find(
    (card): card is Extract<StudioChatCard, { type: 'text' }> =>
      card.id === payload.messageId && card.type === 'text',
  )

  const nextContent = `${existingCard?.content ?? ''}${payload.delta}`
  return upsertStreamingTextCard(session, payload.messageId, nextContent, existingCard)
}

export function applyStreamingTextPart(
  session: StudioSessionDetail,
  payload: StreamingTextPartPayload,
): StudioSessionDetail {
  const nextText = payload.text.trim()
  if (!nextText)
    return session

  const existingCard = session.chatCards.find(
    (card): card is Extract<StudioChatCard, { type: 'text' }> =>
      card.id === payload.messageId && card.type === 'text',
  )

  return upsertStreamingTextCard(session, payload.messageId, nextText, existingCard)
}

function upsertStreamingTextCard(
  session: StudioSessionDetail,
  messageId: string,
  content: string,
  existingCard?: Extract<StudioChatCard, { type: 'text' }>,
): StudioSessionDetail {
  if (existingCard) {
    return {
      ...session,
      chatCards: session.chatCards.map(card =>
        card.id === messageId && card.type === 'text'
          ? { ...card, content }
          : card,
      ),
    }
  }

  const nextOrder = Math.max(
    ...session.messages.map(message => message.order ?? 0),
    ...session.chatCards.map(card => card.order ?? 0),
    -1,
  ) + 1

  return {
    ...session,
    chatCards: [
      ...session.chatCards,
      {
        id: messageId,
        type: 'text',
        content,
        streaming: true,
        assistantName: session.assistantName,
        time: '刚刚',
        order: nextOrder,
      },
    ],
  }
}
