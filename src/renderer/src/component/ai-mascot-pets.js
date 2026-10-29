import nonoPetMeta from '@renderer/assets/pets/nono/pet.json'
import nonoPetSpritesheet from '@renderer/assets/pets/nono/spritesheet.webp'

export const AI_MASCOT_DEFAULT_CONFIG = {
  enabled: true,
  selectedPetId: 'nono',
  version: 2
}

export const AI_MASCOT_SPRITESHEET_LAYOUT = {
  columns: 8,
  rows: 9,
  frameWidth: 192,
  frameHeight: 208
}

export const AI_MASCOT_PET_ROWS = {
  idle: 0,
  runningRight: 1,
  runningLeft: 2,
  pressed: 3,
  waving: 3,
  hover: 4,
  jumping: 4,
  failed: 5,
  waiting: 6,
  running: 7,
  review: 8
}

export const AI_MASCOT_ROW_FRAME_COUNTS = {
  [AI_MASCOT_PET_ROWS.idle]: 6,
  [AI_MASCOT_PET_ROWS.runningRight]: 8,
  [AI_MASCOT_PET_ROWS.runningLeft]: 8,
  [AI_MASCOT_PET_ROWS.waving]: 4,
  [AI_MASCOT_PET_ROWS.jumping]: 5,
  [AI_MASCOT_PET_ROWS.failed]: 8,
  [AI_MASCOT_PET_ROWS.waiting]: 6,
  [AI_MASCOT_PET_ROWS.running]: 6,
  [AI_MASCOT_PET_ROWS.review]: 6
}

export const AI_MASCOT_PETS = [
  {
    ...nonoPetMeta,
    spritesheetUrl: nonoPetSpritesheet,
    row: AI_MASCOT_PET_ROWS.idle
  }
]

export function normalizeAiMascotPet(pet = {}) {
  const id = String(pet?.id || '').trim()
  if (!id) return null

  return {
    ...pet,
    id,
    displayName: String(pet.displayName || id).trim(),
    description: String(pet.description || '').trim(),
    spritesheetUrl: String(pet.spritesheetUrl || '').trim(),
    row: Number.isFinite(pet.row) ? pet.row : AI_MASCOT_PET_ROWS.idle,
    source: String(pet.source || 'builtin').trim() || 'builtin'
  }
}

export function getAllAiMascotPets(extraPets = []) {
  const builtinPets = AI_MASCOT_PETS.map((pet) =>
    normalizeAiMascotPet({
      ...pet,
      source: 'builtin'
    })
  ).filter(Boolean)
  const usedIds = new Set(builtinPets.map((pet) => pet.id))
  const customPets = (Array.isArray(extraPets) ? extraPets : [])
    .map((pet) => normalizeAiMascotPet(pet))
    .filter((pet) => pet && !usedIds.has(pet.id))

  return [...builtinPets, ...customPets]
}

export function normalizeAiMascotConfig(config = {}, availablePets = null) {
  const target = config && typeof config === 'object' ? config : {}
  const selectedPetId = String(
    target.selectedPetId || AI_MASCOT_DEFAULT_CONFIG.selectedPetId
  ).trim()
  const selectedId = selectedPetId || AI_MASCOT_DEFAULT_CONFIG.selectedPetId
  const shouldValidate = Array.isArray(availablePets)
  const hasPet = !shouldValidate || availablePets.some((pet) => pet.id === selectedId)

  return {
    enabled: target.enabled !== false,
    selectedPetId: hasPet ? selectedId : AI_MASCOT_DEFAULT_CONFIG.selectedPetId,
    version: AI_MASCOT_DEFAULT_CONFIG.version
  }
}

export function getAiMascotPet(petId = '', pets = AI_MASCOT_PETS) {
  const availablePets = Array.isArray(pets) && pets.length > 0 ? pets : AI_MASCOT_PETS

  return (
    availablePets.find((pet) => pet.id === petId) ||
    availablePets.find((pet) => pet.id === AI_MASCOT_DEFAULT_CONFIG.selectedPetId) ||
    availablePets[0]
  )
}
