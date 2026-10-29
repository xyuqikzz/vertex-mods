import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useLocalDatastore = defineStore(
  'localDataStore',
  () => {
    const localGameList = ref([])
    const localModList = ref([])
    const flingTrainerLocalRecords = ref([])

    function normalizeFlingTrainerKey(record = {}) {
      return String(record?.key || record?.detailUrl || record?.id || record?.title || '').trim()
    }

    function upsertFlingTrainerLocalRecord(record = {}) {
      const safeRecord = record && typeof record === 'object' ? record : {}
      const key = normalizeFlingTrainerKey(safeRecord)
      if (!key) return false

      const now = new Date().toISOString()
      const nextRecord = {
        ...safeRecord,
        key,
        source: 'fling',
        status: 'downloaded',
        updatedAt: now,
        downloadedAt: safeRecord.downloadedAt || now
      }
      const list = Array.isArray(flingTrainerLocalRecords.value)
        ? [...flingTrainerLocalRecords.value]
        : []
      const index = list.findIndex((item) => normalizeFlingTrainerKey(item) === key)

      if (index === -1) {
        list.unshift(nextRecord)
      } else {
        list.splice(index, 1, {
          ...list[index],
          ...nextRecord,
          downloadedAt: list[index]?.downloadedAt || nextRecord.downloadedAt
        })
      }

      flingTrainerLocalRecords.value = list
      return true
    }

    function removeFlingTrainerLocalRecord(record = {}) {
      const key = normalizeFlingTrainerKey(record)
      if (!key) return false

      const beforeLength = Array.isArray(flingTrainerLocalRecords.value)
        ? flingTrainerLocalRecords.value.length
        : 0
      flingTrainerLocalRecords.value = (flingTrainerLocalRecords.value || []).filter(
        (item) => normalizeFlingTrainerKey(item) !== key
      )
      return flingTrainerLocalRecords.value.length !== beforeLength
    }

    return {
      localGameList,
      localModList,
      flingTrainerLocalRecords,
      upsertFlingTrainerLocalRecord,
      removeFlingTrainerLocalRecord
    }
  },
  {
    persist: true
  }
)
