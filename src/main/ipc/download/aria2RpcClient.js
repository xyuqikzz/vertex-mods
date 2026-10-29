import http from 'http'

function sleep(delayMs = 0) {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs)
  })
}

function createRpcError(message = 'aria2 RPC 调用失败', detail = {}) {
  const error = new Error(message)
  Object.assign(error, detail)
  return error
}

export class Aria2RpcClient {
  constructor(options = {}) {
    this.host = String(options.host || '127.0.0.1')
    this.port = Number(options.port || 0)
    this.secret = String(options.secret || '')
    this.timeoutMs = Math.max(1000, Number(options.timeoutMs || 5000))
  }

  buildParams(params = []) {
    const safeParams = Array.isArray(params) ? params : []
    if (!this.secret) {
      return safeParams
    }
    return [`token:${this.secret}`, ...safeParams]
  }

  call(method = '', params = []) {
    const safeMethod = String(method || '').trim()
    if (!safeMethod) {
      return Promise.reject(createRpcError('aria2 RPC 方法名为空'))
    }
    if (!this.port) {
      return Promise.reject(createRpcError('aria2 RPC 端口为空'))
    }

    const requestBody = JSON.stringify({
      jsonrpc: '2.0',
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      method: safeMethod,
      params: this.buildParams(params)
    })

    return new Promise((resolve, reject) => {
      let settled = false
      const req = http.request(
        {
          hostname: this.host,
          port: this.port,
          path: '/jsonrpc',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(requestBody)
          }
        },
        (res) => {
          let rawBody = ''
          res.setEncoding('utf8')
          res.on('data', (chunk) => {
            rawBody += chunk
          })
          res.on('end', () => {
            if (settled) {
              return
            }
            settled = true

            if (res.statusCode < 200 || res.statusCode >= 300) {
              reject(
                createRpcError(`aria2 RPC HTTP ${res.statusCode}`, { statusCode: res.statusCode })
              )
              return
            }

            try {
              const data = JSON.parse(rawBody || '{}')
              if (data.error) {
                reject(
                  createRpcError(data.error.message || 'aria2 RPC 返回错误', {
                    code: data.error.code,
                    data: data.error.data
                  })
                )
                return
              }
              resolve(data.result)
            } catch (error) {
              reject(createRpcError(`aria2 RPC 响应解析失败：${error?.message || error}`))
            }
          })
        }
      )

      req.setTimeout(this.timeoutMs, () => {
        req.destroy(createRpcError(`aria2 RPC 调用超时：${safeMethod}`))
      })

      req.on('error', (error) => {
        if (settled) {
          return
        }
        settled = true
        reject(error)
      })

      req.write(requestBody)
      req.end()
    })
  }

  async waitForReady(options = {}) {
    const timeoutMs = Math.max(1000, Number(options.timeoutMs || 10000))
    const intervalMs = Math.max(50, Number(options.intervalMs || 200))
    const deadline = Date.now() + timeoutMs
    let lastError = null

    while (Date.now() < deadline) {
      try {
        return await this.getVersion()
      } catch (error) {
        lastError = error
        await sleep(intervalMs)
      }
    }

    throw createRpcError(`aria2 RPC 启动超时：${lastError?.message || '未响应'}`)
  }

  getVersion() {
    return this.call('aria2.getVersion')
  }

  addUri(uriList = [], options = {}) {
    return this.call('aria2.addUri', [uriList, options])
  }

  tellStatus(gid = '', keys = []) {
    const safeKeys = Array.isArray(keys) ? keys : []
    return this.call('aria2.tellStatus', safeKeys.length ? [gid, safeKeys] : [gid])
  }

  remove(gid = '') {
    return this.call('aria2.remove', [gid])
  }

  forceRemove(gid = '') {
    return this.call('aria2.forceRemove', [gid])
  }

  removeDownloadResult(gid = '') {
    return this.call('aria2.removeDownloadResult', [gid])
  }

  changeGlobalOption(options = {}) {
    return this.call('aria2.changeGlobalOption', [options])
  }

  shutdown() {
    return this.call('aria2.shutdown')
  }
}
