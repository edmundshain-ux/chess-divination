// ===== 資料庫抽象層 =====
import {
  saveRecordToSupabase, loadRecordsFromSupabase, loadAllRecordsFromSupabase,
  updateTeacherNoteInSupabase, saveAIConfigToSupabase, loadAIConfigFromSupabase
} from './supabase.js'

// 產生/取得用戶ID（之後接帳號系統時會替換成真實 user id）
function getUserId() {
  let id = localStorage.getItem('chess_user_id')
  if (!id) {
    id = 'user_' + Math.random().toString(36).substr(2, 9) + Date.now()
    localStorage.setItem('chess_user_id', id)
  }
  return id
}

export function getCurrentUserId() {
  return getUserId()
}

export async function saveRecord(record) {
  const userId = getUserId()
  return saveRecordToSupabase({
    id: record.id,
    user_id: userId,
    date: record.date,
    qtype: record.qtype,
    question: record.question,
    pieces: record.pieces,
    self_color: record.selfColor,
    score: record.score,
    note: record.note,
    teacher_note: record.teacherNote || ''
  })
}

export async function loadRecords(isTeacher = false) {
  const raw = isTeacher ? await loadAllRecordsFromSupabase() : await loadRecordsFromSupabase(getUserId())
  // 轉換欄位名稱對應前端使用習慣
  return raw.map(r => ({
    id: r.id,
    date: r.date,
    qtype: r.qtype,
    question: r.question,
    pieces: r.pieces,
    selfColor: r.self_color,
    score: r.score,
    note: r.note,
    teacherNote: r.teacher_note,
  }))
}

export async function updateTeacherNote(id, note) {
  return updateTeacherNoteInSupabase(id, note)
}

export async function saveAIConfig(config) {
  return saveAIConfigToSupabase(getUserId(), config)
}

export async function loadAIConfig() {
  return loadAIConfigFromSupabase(getUserId())
}

export async function saveTeacherMode(val) {
  localStorage.setItem('teacher_mode', val ? '1' : '0')
  return true
}

export async function loadTeacherMode() {
  return localStorage.getItem('teacher_mode') === '1'
}
