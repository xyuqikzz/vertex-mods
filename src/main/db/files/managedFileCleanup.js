function toSafeText(value = '') {
  return String(value ?? '').trim()
}

export function deleteManagedAssetSqlRecords(database, assetId = '') {
  const safeAssetId = toSafeText(assetId)
  if (!database?.run || !database?.transaction || !safeAssetId) {
    return {
      ownerRecordsDeleted: 0,
      assetRecordsDeleted: 0
    }
  }

  let ownerRecordsDeleted = 0
  let assetRecordsDeleted = 0
  database.transaction(() => {
    ownerRecordsDeleted = Number(
      database.run('DELETE FROM managed_file_asset_owners WHERE asset_id = ?', [safeAssetId])
        ?.changes || 0
    )
    assetRecordsDeleted = Number(
      database.run('DELETE FROM managed_file_assets WHERE asset_id = ?', [safeAssetId])?.changes ||
        0
    )
  })

  return {
    ownerRecordsDeleted,
    assetRecordsDeleted
  }
}
