import AdmZip from 'adm-zip'

// 仅供已通过固定 SHA-256 校验的工具包使用；用户模组继续走安装引擎的预检和限额。
// 复用受维护的解压依赖，避免保留存在未修复路径穿越问题的 extract-zip。
export async function extractZip(archivePath, { dir }) {
  await new Promise((resolve, reject) => {
    new AdmZip(archivePath).extractAllToAsync(dir, true, false, (error) => {
      if (error) reject(error)
      else resolve()
    })
  })
}
