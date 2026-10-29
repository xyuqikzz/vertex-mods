import os from 'os'
import path from 'path'
import fs from 'fs'

const { VITE_LOCAL_NAME, VITE_LOCAL_ID } = import.meta.env

const homedir = os.homedir()
const localAppDataPath = path.join(homedir, 'AppData', 'Local')
let userPath = path.join(
  localAppDataPath,
  `${VITE_LOCAL_NAME}${VITE_LOCAL_ID ? `_${VITE_LOCAL_ID}` : ''}`
)
if (!fs.existsSync(userPath)) {
  fs.mkdirSync(userPath, { recursive: true })
}
console.log('App数据路径', userPath)

export default userPath
