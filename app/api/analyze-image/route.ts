import { NextRequest, NextResponse } from 'next/server'
import { createAnthropicClient } from '@/lib/anthropic'

export async function POST(req: NextRequest) {
  try {
    const { image, mimeType } = await req.json()

    if (!image) {
      return NextResponse.json({ error: 'Ingen bild skickad' }, { status: 400 })
    }

    const anthropic = createAnthropicClient()

    const response = await anthropic.messages.create({
      model: 'claude-opus-4-20250514',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: mimeType || 'image/jpeg',
                data: image,
              },
            },
            {
              type: 'text',
              text: `Du är en expert på sportfiske och fiskidentifiering. Analysera denna bild noggrant och returnera ENDAST ett JSON-objekt utan markdown-formatering.

Returnera:
{
  "species": "Artens svenska namn (t.ex. Gädda, Abborre, Öring) eller null om ingen fisk syns",
  "species_latin": "Latinskt namn eller null",
  "species_confidence": 0.0-1.0,
  "estimated_weight_kg": number eller null,
  "estimated_length_cm": number eller null,
  "fish_description": "Kort beskrivning av fisken, utmärkande drag",
  "weather_description": "Beskriv vädret på bilden: sol, moln, vind, regn etc.",
  "weather_condition": "Klart|Delvis molnigt|Mulet|Regn|Dimma",
  "environment_notes": "Miljö: hav, sjö, å, brygga, båt, is etc.",
  "season_guess": "Vår|Sommar|Höst|Vinter|Okänt",
  "water_type": "Saltvatten|Sötvatten|Bräckt vatten|Okänt"
}

Svara BARA med JSON, ingen annan text.`,
            },
          ],
        },
      ],
    })

    const textContent = response.content.find((c) => c.type === 'text')
    if (!textContent || textContent.type !== 'text') {
      return NextResponse.json({ error: 'Inget svar från AI' }, { status: 500 })
    }

    // Parse JSON - handle potential markdown wrapping
    let jsonStr = textContent.text.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    }

    const analysis = JSON.parse(jsonStr)
    return NextResponse.json(analysis)
  } catch (error) {
    console.error('AI analysis error:', error)
    return NextResponse.json({ error: 'Bildanalys misslyckades' }, { status: 500 })
  }
}
