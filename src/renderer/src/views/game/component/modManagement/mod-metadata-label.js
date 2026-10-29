// Legacy rows retain their original label. New rows carry a stable field identity.
const legacyLabels = {
  "版本": "tools.version",
  "当前版本": "ui.currentVersion",
  "安装位置": "ui.installationLocation",
  "文件数": "ui.fileCount",
  "作者": "localMod.author",
  "上传者": "ui.uploadedBy",
  "来源": "taskCenter.toolbar.sourceLabel",
  "来源平台": "ui.sourcePlatform",
  "安装时间": "tools.installedOn",
  "导入时间": "ui.importedOn"
}
export function matchesModMetadataLabel(row, labels) {
  return labels.some(label => row?.labelKey ? row.labelKey === legacyLabels[label] : row?.label === label)
}
