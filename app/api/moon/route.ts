import { NextRequest, NextResponse } from 'next/server'
import { fetchMoonData } from '@/lib/moon'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')

  if (!date) {
    return NextResponse.json({ error: 'date krävs' }, { status: 400 })
  }

  try {
    const moon = await fetchMoonData(new Date(date))
    return NextResponse.json(moon)
  } catch (error) {
    console.error('Moon API error:', error)
    return NextResponse.json({ error: 'Kunde inte hämta måndata' }, { status: 500 })
  }
}
