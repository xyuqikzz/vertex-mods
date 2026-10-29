export const steamAccountMessages = {
  'zh-CN': {
    label: 'Steam 账号授权', title: '账号', signedOut: '未登录 Steam', avatar: '{name} 的 Steam 头像',
    accountName: '账号：{name}', saved: '已保存登录', sessionOnly: '本次会话已登录', expired: '需要重新授权',
    authorizing: '请在 Steam 登录窗口中完成扫码或账号验证…',
    expiredHint: '登录状态已失效，请重新授权。',
    savedHint: '登录状态已在本机加密保存，重启后可继续使用。',
    sessionHint: '登录状态仅保留到本次客户端退出。',
    signInHint: '在 Steam 登录窗口中扫码或输入账号验证。',
    reauthorize: '重新授权', signIn: '登录 Steam', cancel: '取消授权', clear: '清除登录状态', signOut: '退出登录',
    signOutTitle: '退出 Steam 账号？',
    signOutHint: '将清除本机保存的 Steam 登录状态，并停止正在使用此账号的授权和下载。已安装模组不受影响。',
    errors: {
      read: '无法读取 Steam 账号状态，请重试。', action: 'Steam 账号操作失败，请重试。',
      storage: '无法读取或保存 Steam 登录状态，请检查系统凭据存储后重试。',
      busy: '已有 Steam 授权正在进行。', network: '连接 Steam 失败，请检查网络后重试。',
      login: 'Steam 授权未完成，请重新登录。', tool: 'Steam 下载内核无法使用，请检查客户端安装后重试。'
    }
  },
  'en-US': {
    label: 'Steam account authorization', title: 'Account', signedOut: 'Not signed in to Steam', avatar: '{name}’s Steam avatar',
    accountName: 'Account: {name}', saved: 'Sign-in saved', sessionOnly: 'Signed in for this session', expired: 'Authorization required',
    authorizing: 'Complete the QR code or account verification in the Steam sign-in window…',
    expiredHint: 'Your sign-in has expired. Please authorize again.',
    savedHint: 'Your sign-in is encrypted on this device and will be available after restarting.',
    sessionHint: 'Your sign-in will be kept only until you exit the client.',
    signInHint: 'Scan the QR code or verify your account in the Steam sign-in window.',
    reauthorize: 'Authorize again', signIn: 'Sign in to Steam', cancel: 'Cancel authorization', clear: 'Clear sign-in', signOut: 'Sign out',
    signOutTitle: 'Sign out of Steam?',
    signOutHint: 'This clears your saved Steam sign-in on this device and stops authorization and downloads using this account. Installed mods are unaffected.',
    errors: {
      read: 'Unable to read your Steam account status. Please try again.', action: 'The Steam account operation failed. Please try again.',
      storage: 'Unable to read or save your Steam sign-in. Check the system credential storage and try again.',
      busy: 'Steam authorization is already in progress.', network: 'Unable to connect to Steam. Check your connection and try again.',
      login: 'Steam authorization did not complete. Please sign in again.', tool: 'The Steam download tool is unavailable. Check your client installation and try again.'
    }
  }
}
