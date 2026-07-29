import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  createAdminClient,
  createServerSupabaseClient,
} from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 45

const RequestSchema = z.object({
  points: z.array(
    z.object({
      catchId: z.string().uuid(),
      lon: z.number().finite().min(-180).max(180),
      lat: z.number().finite().min(-90).max(90),
    })
  ).min(1).max(100),
})

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function levelOrUnknown(value: unknown): 'low' | 'medium' | 'high' | 'unknown' {
  return value === 'low' || value === 'medium' || value === 'high'
    ? value
    : 'unknown'
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerSupabaseClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()

    if (!user) {
      return NextResponse.json({ error: 'Ej inloggad' }, { status: 401 })
    }

    const parsed = RequestSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Ogiltiga fångstpositioner' }, { status: 400 })
    }

    const admin = createAdminClient()
    const pointById = new Map(
      parsed.data.points.map((point) => [point.catchId, point])
    )
    const { data: catches, error: catchesError } = await admin
      .from('catches')
      .select('id, species, weight_kg, length_cm, caught_at')
      .eq('user_id', user.id)
      .in('id', [...pointById.keys()])

    if (catchesError) throw catchesError

    const results: Array<Record<string, unknown>> = []
    const ownedCatches = catches ?? []

    for (let start = 0; start < ownedCatches.length; start += 8) {
      const batch = ownedCatches.slice(start, start + 8)
      const batchResults = await Promise.all(
        batch.map(async (caught) => {
          const point = pointById.get(caught.id)
          if (!point) return null

          const { data, error } = await admin.rpc('sonar_inspect_point', {
            p_user_id: user.id,
            p_lon: point.lon,
            p_lat: point.lat,
          })

          if (error) {
            console.error('Catch sonar context failed:', caught.id, error.message)
            return null
          }

          const context = (
            data && typeof data === 'object' ? data : {}
          ) as Record<string, unknown>

          return {
            catchId: caught.id,
            species: caught.species,
            weightKg: finiteOrNull(caught.weight_kg),
            lengthCm: finiteOrNull(caught.length_cm),
            caughtAt: caught.caught_at,
            found: context.found === true,
            depthM: finiteOrNull(context.depthM),
            minDepthM: finiteOrNull(context.minDepthM),
            maxDepthM: finiteOrNull(context.maxDepthM),
            coverageConfidence: finiteOrNull(context.coverageConfidence),
            cellDistanceM: finiteOrNull(context.cellDistanceM),
            signalDistanceM: finiteOrNull(context.signalDistanceM),
            hardnessClass: levelOrUnknown(context.hardnessClass),
            vegetationClass: levelOrUnknown(context.vegetationClass),
            vendorChannelA: finiteOrNull(context.vendorChannelA),
            vendorChannelB: finiteOrNull(context.vendorChannelB),
          }
        })
      )
      const validBatchResults = batchResults.filter(
        (result) => result !== null
      )
      results.push(...validBatchResults)
    }

    return NextResponse.json(
      {
        contexts: results,
        requested: parsed.data.points.length,
        owned: ownedCatches.length,
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (error) {
    console.error('Catch sonar contexts failed:', error)
    return NextResponse.json(
      { error: 'Kunde inte analysera fångsterna mot ekolodsdata' },
      { status: 500 }
    )
  }
}
