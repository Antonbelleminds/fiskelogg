'use client'

import { useState, useRef, useEffect } from 'react'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'Vilken är min största fisk?',
  'När fiskar jag bäst?',
  'Vad tar gäddan på?',
  'Visa mina 5 tyngsta fångster',
]

export default function ChattPage() {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  async function sendMessage(text: string) {
    if (!text.trim() || loading) return

    const userMsg: Message = { role: 'user', content: text }
    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setLoading(true)

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          history: messages.slice(-10),
        }),
      })

      if (!res.ok) throw new Error('Chat failed')

      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let assistantContent = ''

      setMessages((prev) => [...prev, { role: 'assistant', content: '' }])

      if (reader) {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          assistantContent += decoder.decode(value, { stream: true })
          setMessages((prev) => {
            const updated = [...prev]
            updated[updated.length - 1] = { role: 'assistant', content: assistantContent }
            return updated
          })
        }
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Ursäkta, något gick fel. Försök igen.' },
      ])
    } finally {
      setLoading(false)
    }
  }

  function renderContent(content: string) {
    // Replace [FÅNGST:uuid] with clickable links
    const parts = content.split(/\[FÅNGST:([a-f0-9-]+)\]/g)
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        return (
          <a
            key={i}
            href={`/fangst/${part}`}
            className="inline-flex items-center gap-1 px-2 py-0.5 bg-primary-100 dark:bg-primary-900/30 text-primary-700 dark:text-primary-300 rounded-md text-xs font-medium hover:bg-primary-200 transition"
          >
            🐟 Visa fångst
          </a>
        )
      }
      return <span key={i}>{part}</span>
    })
  }

  return (
    <div className="flex flex-col h-[calc(100dvh-5rem)] max-w-lg mx-auto">
      <div className="px-4 pt-6 pb-2">
        <h1 className="text-xl font-semibold">FiskeBot 🤖</h1>
        <p className="text-xs text-slate-500">AI-assistent som kan dina fångster</p>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 space-y-3 pb-4">
        {messages.length === 0 && (
          <div className="pt-8 text-center">
            <div className="text-5xl mb-4">🎣</div>
            <p className="text-slate-500 text-sm mb-6">
              Fråga mig vad som helst om dina fångster!
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => sendMessage(s)}
                  className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                msg.role === 'user'
                  ? 'bg-primary-700 text-white rounded-br-md'
                  : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-bl-md'
              }`}
            >
              {msg.role === 'assistant' ? (
                <div className="whitespace-pre-wrap">{renderContent(msg.content)}</div>
              ) : (
                msg.content
              )}
              {msg.role === 'assistant' && msg.content === '' && loading && (
                <div className="flex gap-1">
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            sendMessage(input)
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Fråga om dina fångster..."
            className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-4 py-2.5 bg-primary-700 text-white rounded-xl font-medium text-sm hover:bg-primary-800 disabled:opacity-50 transition"
          >
            Skicka
          </button>
        </form>
      </div>
    </div>
  )
}
