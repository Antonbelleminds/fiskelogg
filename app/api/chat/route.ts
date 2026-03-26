import { NextRequest } from 'next/server'
import { createAnthropicClient } from '@/lib/anthropic'
import { createServerSupabaseClient, createAdminClient } from '@/lib/supabase/server'

export const maxDuration = 30

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return new Response('Ej inloggad', { status: 401 })
    }

    const { message, history } = await req.json()

    // Fetch user's catches for context
    const admin = createAdminClient()
    const { data: catches } = await admin
      .from('catches')
      .select('id, species, weight_kg, length_cm, caught_at, location_name, water_body, fishing_method, lure_type, lure_color, weather_condition, weather_temp_c, moon_phase, notes')
      .eq('user_id', user.id)
      .order('caught_at', { ascending: false })
      .limit(100)

    const catchSummary = catches?.map(c => ({
      id: c.id,
      art: c.species,
      vikt: c.weight_kg ? `${c.weight_kg} kg` : null,
      längd: c.length_cm ? `${c.length_cm} cm` : null,
      datum: c.caught_at,
      plats: c.location_name || c.water_body,
      metod: c.fishing_method,
      bete: c.lure_type ? `${c.lure_type} ${c.lure_color || ''}`.trim() : null,
      väder: c.weather_condition ? `${c.weather_condition}, ${c.weather_temp_c}°C` : null,
      månfas: c.moon_phase,
      noteringar: c.notes,
    })) || []

    const systemPrompt = `Du är en hjälpsam fiskeassistent som heter FiskeBot. Du har tillgång till användarens fångsthistorik.
Svara på svenska. Var konkret och hjälpsam.

Användarens fångstdata (${catchSummary.length} fångster):
${JSON.stringify(catchSummary, null, 2)}

Regler:
- Om du refererar till specifika fångster, markera dem med [FÅNGST:uuid] så att UI kan visa kort
- Ge konkreta tips baserat på deras data
- Om de frågar om mönster, analysera tider, väder, beten etc.
- Om de inte har någon data, uppmuntra dem att börja logga`

    const anthropic = createAnthropicClient()

    const messages = [
      ...(history || []).map((h: { role: string; content: string }) => ({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      })),
      { role: 'user' as const, content: message },
    ]

    const stream = anthropic.messages.stream({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages,
    })

    const encoder = new TextEncoder()
    const readable = new ReadableStream({
      async start(controller) {
        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            controller.enqueue(encoder.encode(event.delta.text))
          }
        }
        controller.close()
      },
    })

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
      },
    })
  } catch (error) {
    console.error('Chat error:', error)
    return new Response('Chatfel', { status: 500 })
  }
}
