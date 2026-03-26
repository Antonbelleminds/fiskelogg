import exifr from 'exifr'

interface ExifData {
  captured_at: Date | null
  lat: number | null
  lng: number | null
}

export async function extractExif(file: File): Promise<ExifData> {
  try {
    const data = await exifr.parse(file, {
      pick: ['DateTimeOriginal', 'CreateDate', 'GPSLatitude', 'GPSLongitude'],
      gps: true,
    })

    if (!data) return { captured_at: null, lat: null, lng: null }

    return {
      captured_at: data.DateTimeOriginal || data.CreateDate || null,
      lat: data.latitude ?? null,
      lng: data.longitude ?? null,
    }
  } catch {
    return { captured_at: null, lat: null, lng: null }
  }
}
