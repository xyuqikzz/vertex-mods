import fs from 'fs-extra'
import { verifyFileMD5ByNodeApi } from '../api/file/index.js'

export async function verifyFileMD5(filePath, expectedMD5) {
  try {
    return await verifyFileMD5ByNodeApi(filePath, expectedMD5)
  } catch (error) {
    console.error('校验 MD5 失败:', error)
    throw error
  }
}

export function deleteFileSync(filePath) {
  try {
    fs.accessSync(filePath)
    fs.unlinkSync(filePath)
    console.log(`文件删除成功: ${filePath}`)
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.warn(`文件不存在: ${filePath}`)
    } else {
      console.error(`删除文件失败: ${filePath}`, error)
      throw error
    }
  }
}
