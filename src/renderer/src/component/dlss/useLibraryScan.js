import { clientI18n } from '../../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { ref } from 'vue'

export function useLibraryScan(readGames) {
  const games = ref([])
  const scanning = ref(false)
  const error = ref('')
  let pending = null

  function scan() {
    if (pending) return pending
    scanning.value = true
    error.value = ''
    pending = Promise.resolve()
      .then(readGames)
      .then((result) => {
        games.value = result
      })
      .catch((reason) => {
        error.value = reason?.message || uiText('tools.couldNotScanTheGameLibraryTryAgain')
      })
      .finally(() => {
        scanning.value = false
        pending = null
      })
    return pending
  }

  return { games, scanning, error, scan }
}
