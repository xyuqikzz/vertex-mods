import crypto from 'crypto'

const PROFILE_PATH_ID_PATTERN = /^p-[a-z0-9]{6,10}-[a-f0-9]{4}$/

export function createSourceProfilePathId(timestamp = Date.now(), randomHex = '') {
  const timePart = Math.max(0, Number(timestamp) || 0)
    .toString(36)
    .slice(-10)
    .padStart(6, '0')
  const randomPart = String(randomHex || crypto.randomBytes(2).toString('hex'))
    .toLowerCase()
    .replace(/[^a-f0-9]/g, '')
    .slice(0, 4)
    .padEnd(4, '0')
  return `p-${timePart}-${randomPart}`
}

export function isSourceProfilePathId(value = '') {
  return PROFILE_PATH_ID_PATTERN.test(
    String(value || '')
      .trim()
      .toLowerCase()
  )
}
