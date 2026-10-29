import { registerAccountIpc } from '../security/accounts.js'
import { registerNetworkIpc } from '../security/network.js'
import { registerNexusAccountIpc } from '../services/nexus/account.js'
// 统一注册ipc
export async function startRegistration() {
  registerAccountIpc()
  registerNetworkIpc()
  registerNexusAccountIpc()
  const [
    { fileIndex },
    { scriptIndex },
    { imageIndex },
    { systemIndex },
    { storeIndex },
    { downloadIndex },
    { gameIndex },
    { updateIndex },
    { dataIndex },
    { modBrowserIndex },
    { gameToolsIndex }
  ] = await Promise.all([
    import('./file/index.js'),
    import('./script/index.js'),
    import('./image/index.js'),
    import('./system/index.js'),
    import('./store/index.js'),
    import('./download/index.js'),
    import('./game/index.js'),
    import('./update/index.js'),
    import('./data/index.js'),
    import('./modBrowser/index.js'),
    import('./gameTools/index.js')
  ])

  fileIndex()
  scriptIndex()
  imageIndex()
  systemIndex()
  storeIndex()
  downloadIndex()
  gameIndex()
  updateIndex()
  dataIndex()
  modBrowserIndex()
  gameToolsIndex()
}
