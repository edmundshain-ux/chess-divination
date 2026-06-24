import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)

// ===== 紀錄相關 =====
export async function saveRecordToSupabase(record) {
  const { error } = await supabase.from('records').insert([record])
  if (error) console.error('saveRecord error:', error)
  return !error
}

export async function loadRecordsFromSupabase(userId) {
  const { data, error } = await supabase
    .from('records')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) console.error('loadRecords error:', error)
  return error ? [] : data
}

export async function loadAllRecordsFromSupabase() {
  const { data, error } = await supabase
    .from('records')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(500)
  if (error) console.error('loadAllRecords error:', error)
  return error ? [] : data
}

export async function updateTeacherNoteInSupabase(id, teacherNote) {
  const { error } = await supabase
    .from('records')
    .update({ teacher_note: teacherNote, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) console.error('updateTeacherNote error:', error)
  return !error
}

// ===== AI設定 =====
export async function saveAIConfigToSupabase(userId, config) {
  const { error } = await supabase
    .from('settings')
    .upsert([{ user_id: userId, key: 'ai_config', value: JSON.stringify(config) }], { onConflict: 'user_id,key' })
  if (error) console.error('saveAIConfig error:', error)
  return !error
}

export async function loadAIConfigFromSupabase(userId) {
  const { data, error } = await supabase
    .from('settings')
    .select('value')
    .eq('user_id', userId)
    .eq('key', 'ai_config')
    .maybeSingle()
  if (error) console.error('loadAIConfig error:', error)
  return data ? JSON.parse(data.value) : { provider: 'deepseek', enabled: true, deepseekKey: '' }
}
