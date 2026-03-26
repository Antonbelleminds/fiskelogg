import { NextRequest, NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { createAnthropicClient } from '@/lib/anthropic'

interface CatchSearchItem {
  id: string
  species: string | null
  weight_kg: number | null
  length_cm: number | null
  caught_at: string
  water_body: string | null
  fishing_method: string | null
  lure_type: string | null
  weather_condition: string | null
  moon_phase: string | null
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const { data: { user } } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
    }

    const body = await req.json()
    const { query, catches } = body as { query: string; catches: CatchSearchItem[] }

    if (!query || !catches || !Array.isArray(catches)) {
      return NextResponse.json({ error: 'Ogiltig förfrågan' }, { status: 400 })
    }

    const anthropic = createAnthropicClient()

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Du är en fiskeassistent. Användaren söker bland sina fångster.
Här är alla fångster (JSON): ${JSON.stringify(catches)}
Användarens sökfråga: "${query}"
Returnera BARA en JSON-array med ID:n för de fångster som matchar sökningen.
Exempel: ["uuid1", "uuid2"]
Om ingen matchar, returnera [].`,
        },
      ],
    })

    const textBlock = message.content.find((block) => block.type === 'text')
    if (!textBlock || textBlock.type !== 'text') {
      return NextResponse.json({ matchingIds: [] })
    }

    // Extract JSON array from response
    const jsonMatch = textBlock.text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      return NextResponse.json({ matchingIds: [] })
    }

    const matchingIds: string[] = JSON.parse(jsonMatch[0])
    return NextResponse.json({ matchingIds })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json({ error: 'Sökfel' }, { status: 500 })
  }
}
