export interface Profile {
  id: string
  username: string
  display_name: string | null
  avatar_url: string | null
  bio: string | null
  friend_code: string | null
  total_catches: number
  created_at: string
}

export interface Catch {
  id: string
  user_id: string
  caught_at: string
  is_public: boolean
  notes: string | null
  species: string | null
  species_confidence: number | null
  weight_kg: number | null
  length_cm: number | null
  location: unknown | null
  location_name: string | null
  water_body: string | null
  fishing_method: string | null
  lure_type: string | null
  lure_color: string | null
  depth_m: number | null
  bottom_structure: string | null
  water_temp_c: number | null
  weather_temp_c: number | null
  weather_condition: string | null
  wind_speed_ms: number | null
  wind_direction: string | null
  cloud_cover_pct: number | null
  precipitation_mm: number | null
  pressure_hpa: number | null
  humidity_pct: number | null
  visibility_km: number | null
  moon_phase: string | null
  moon_illumination_pct: number | null
  sunrise_time: string | null
  sunset_time: string | null
  is_golden_hour: boolean | null
  ai_weather_description: string | null
  ai_fish_description: string | null
  ai_environment_notes: string | null
  image_url: string | null
  image_path: string | null
  exif_captured_at: string | null
  exif_lat: number | null
  exif_lng: number | null
  likes_count: number
  created_at: string
  updated_at: string
}

export interface CatchLike {
  id: string
  catch_id: string
  user_id: string
  created_at: string
}

export interface CatchWithProfile extends Catch {
  profiles: Pick<Profile, 'username' | 'display_name' | 'avatar_url'> | null
}

export interface Friendship {
  id: string
  requester_id: string
  addressee_id: string
  status: 'pending' | 'accepted' | 'blocked'
  share_location: boolean
  created_at: string
  updated_at: string
}

export interface Team {
  id: string
  name: string
  created_by: string
  created_at: string
}

export interface TeamMember {
  id: string
  team_id: string
  user_id: string
  role: 'admin' | 'member'
  joined_at: string
}

export interface FriendWithProfile extends Friendship {
  friend_profile: {
    id: string
    username: string
    display_name: string | null
    avatar_url: string | null
    friend_code: string | null
  }
}

export interface ImageAnalysis {
  species: string | null
  species_latin: string | null
  species_confidence: number
  estimated_weight_kg: number | null
  estimated_length_cm: number | null
  fish_description: string
  weather_description: string
  weather_condition: string
  environment_notes: string
  season_guess: string
  water_type: string
}
