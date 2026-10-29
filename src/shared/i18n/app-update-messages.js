export const appUpdateMessages = {
  'zh-CN': {
    checking: '正在获取最新正式版本，请稍候。',
    description: '你可以现在更新，也可以稍后在设置中再次检测。',
    downloadAndInstall: '下载并安装',
    downloading: '下载并校验成功后将自动退出并安装。关闭此弹窗可改为稍后安装。',
    ready: '安装包已通过校验，可以重启并安装。',
    installing: '正在安装更新',
    installingDescription: '正在退出 Vertex 并启动安装，完成后会重新打开。',
    postpone: '稍后安装',
    available: '发现新版本，可下载并安装。',
    manualOnly: '此版本尚未提供完整的自动更新文件，可前往发布页查看。',
    current: '当前版本无需更新。',
    errors: {
      unavailable: '暂未找到公开的正式版本，仓库可能是私有的或暂时无法访问。',
      rate_limited: 'GitHub 暂时限制了访问，请稍后再试。',
      check_failed: '暂时无法检测更新，请检查网络后重试。',
      invalid_current_version: '无法识别当前应用版本，请前往发布页确认。',
      invalid_release_version: '发布标签不是有效版本号，请前往发布页确认。',
      invalid_release: '发布信息格式异常，请稍后重试。',
      untrusted_update_metadata: '更新来源、版本或校验信息不可信，已停止更新。',
      updates_development_only: '开发环境不能安装更新，请使用打包后的客户端。',
      update_download_failed: '更新下载失败，请重新检查更新后重试。',
      update_signature_rejected: '更新包签名或发布者验证失败，未执行安装。',
      update_not_verified: '安装包尚未通过校验，请重新检查并下载更新。',
      update_install_failed: '无法启动安装，请重新检查更新后重试。'
    }
  },
  'en-US': {
    checking: 'Checking for the latest stable release. Please wait.',
    description: 'Update now, or check again later in Settings.',
    downloadAndInstall: 'Download and install',
    downloading: 'Vertex will exit and install after the download is verified. Close this dialog to install later instead.',
    ready: 'The installer has been verified and is ready to install.',
    installing: 'Installing update',
    installingDescription: 'Vertex is closing to start installation and will reopen when it finishes.',
    postpone: 'Install later',
    available: 'A new version is available to download and install.',
    manualOnly: 'This release does not include complete automatic update files. Visit its release page for details.',
    current: 'Your version is up to date.',
    errors: {
      unavailable: 'No public stable release is available. The repository may be private or temporarily inaccessible.',
      rate_limited: 'GitHub has temporarily limited access. Try again later.',
      check_failed: 'Could not check for updates. Check your connection and try again.',
      invalid_current_version: 'The current app version is invalid. Check the release page.',
      invalid_release_version: 'The release tag is not a valid version. Check the release page.',
      invalid_release: 'The release information is invalid. Try again later.',
      untrusted_update_metadata: 'The update source, version, or integrity metadata is not trusted. The update was stopped.',
      updates_development_only: 'Updates cannot be installed in development mode. Use a packaged client.',
      update_download_failed: 'The update download failed. Check for updates again and retry.',
      update_signature_rejected: 'The installer signature or publisher could not be verified. Nothing was installed.',
      update_not_verified: 'The installer has not been verified. Check for updates and download it again.',
      update_install_failed: 'Could not start installation. Check for updates again and retry.'
    }
  }
}
