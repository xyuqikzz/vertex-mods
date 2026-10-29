export function standaloneDownloads(downloads = []) {
  return downloads.filter(task => !task.managedByInstallTask && !task.sourceInstallJobId && !task.source_install_job_id)
}
export function taskCenterBadgeCount(installCount, downloads = []) {
  return Math.max(0, Number(installCount) || 0) + standaloneDownloads(downloads).length
}
