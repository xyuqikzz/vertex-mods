import path from 'node:path'

export function isRepairRequestPath(directory, target) {
  return path.dirname(path.resolve(target)) === path.resolve(directory) &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.json$/i.test(path.basename(target))
}

export function validateRepairRequest(request, now = Date.now()) {
  if (request?.version !== 1 || request.operation !== 'restore_writable' ||
      !Number.isFinite(request.createdAt) || now - request.createdAt > 120000 || request.createdAt > now + 5000 ||
      !Array.isArray(request.ids) || !request.ids.length || request.ids.length > 500 ||
      request.ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('source_protection_request_invalid')
  return [...new Set(request.ids)]
}
