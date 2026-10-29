export const DLSS_RENDER_APIS = ['', 'D3D9', 'D3D10', 'D3D11', 'D3D12', 'OpenGL', 'Vulkan']
export function buildDlssPlan(binding, catalog, hardware = binding.hardware || []) {
  const inspection = binding.inspection || {},
    selected = binding.config?.components || []
  const findings = []
  const add = (code, severity, message) => findings.push({ code, severity, message })
  const observed = inspection.apis || []
  const override = binding.config?.api || ''
  const installMode = binding.config?.installMode || 'files'
  const directoryInstall = installMode === 'files'
  const api =
    override ||
    (observed.includes('D3D12')
      ? 'D3D12'
      : observed.includes('D3D11')
        ? 'D3D11'
        : observed.length === 1
          ? observed[0]
          : '')
  const models = hardware.join(' ')
  const family = /RTX\s*50\d\d/i.test(models)
    ? 50
    : /RTX\s*40\d\d/i.test(models)
      ? 40
      : /RTX\s*30\d\d/i.test(models)
        ? 30
        : /RTX\s*20\d\d/i.test(models)
          ? 20
          : null
  const runtime =
    binding.config?.runtimeVariant === 'signed'
      ? 'nr-runtime'
      : binding.config?.runtimeVariant === 'community'
        ? 'nr-community'
        : family === 50
          ? 'nr-runtime'
          : 'nr-community'
  const wanted = binding.config?.route || (selected.includes('feeder') ? 'feeder' : 'auto')
  const backend =
    wanted === 'auto'
      ? api === 'D3D12' && inspection.nativeDlss?.length
        ? 'native'
        : 'feeder'
      : wanted
  const route = directoryInstall
    ? ['D3D11', 'D3D12'].includes(api)
      ? 'file-proxy'
      : 'unverified'
    : api === 'Vulkan'
      ? 'vulkan-layer'
      : ['D3D11', 'D3D12'].includes(api)
        ? 'process-loader'
        : 'unverified'
  if (binding.pathValid === false)
    add('location_invalid', 'blocker', '游戏路径已失效，请重新定位实际渲染 EXE')
  if (!inspection.selected?.valid && inspection.selected?.valid !== undefined)
    add('invalid_executable', 'unsupported', '所选文件不是有效的 Windows 可执行程序')
  if (inspection.selected?.architecture !== 'x64')
    add(
      'architecture_unverified',
      'review',
      directoryInstall
        ? '当前组件包为 x64，所选程序架构需要对应版本的组件'
        : '此版本的独立加载助手支持 x64；当前程序架构需要其他加载适配'
    )
  if (inspection.selected?.role !== 'game')
    add('render_executable_required', 'review', '当前目标像是启动器或辅助程序，请选择实际渲染 EXE')
  if (!directoryInstall && binding.launchMode !== 'direct')
    add(
      'launcher_handoff_unverified',
      'review',
      'Steam / 启动器转交不能保证会话继承，请选择可直接运行的渲染 EXE'
    )
  if (!api)
    add(
      'render_api_unknown',
      'review',
      '尚未识别渲染 API。请根据游戏设置选择 DirectX 11 或 DirectX 12，再准备安装'
    )
  else if (route === 'unverified')
    add(
      'loader_route_unverified',
      'review',
      directoryInstall && api === 'Vulkan'
        ? 'Vulkan 不能仅通过复制 DLL 自动加载。本安装方式支持 DirectX 11/12；只有游戏实际使用该 API 时才可切换，不能靠修改标签启用。'
        : `${api} 的当前安装路线尚未验证；不代表游戏本身不能使用增强组件`
    )
  if (override && !observed.includes(override))
    add(
      'manual_api',
      'info',
      `本次使用手动选择的 ${override}；静态检测结果仍保留，启动参数需与游戏设置一致`
    )
  const conflicts = inspection.conflicts || []
  // Our configuration names VertexPreset.ini explicitly. Old ReShade presets
  // can remain untouched; executable proxies and add-ons need a reviewed backup.
  const existingLoaders = directoryInstall
    ? conflicts.filter((file) => !/^reshade.*\.ini$/i.test(file.split(/[\\/]/).at(-1)))
    : []
  if (directoryInstall && existingLoaders.length)
    add(
      'existing_loaders',
      'consent',
      '检测到已有加载器或插件。安装前会列出清单：同名组件备份后替换，额外加载器备份后停用；相关模组可能暂时不可用，还原时恢复旧文件。'
    )
  if (!directoryInstall && conflicts.length)
    add(
      'loader_conflict',
      'blocker',
      '目标目录存在已有图形加载器或配置，请先核实冲突；Vertex 不覆盖它们'
    )
  if (directoryInstall)
    add(
      'persistent_install',
      'consent',
      '将组件安装到实际 EXE 所在目录，已有同名文件先备份。安装后从 Steam、快捷方式等入口启动也会加载；Vertex 不注入、不代为启动，直到手动卸载才恢复。'
    )
  if (inspection.protection?.length)
    add(
      'anti_cheat_detected',
      'consent',
      '检测到反作弊相关文件。仅在确认当前离线/单人启动允许图形增强时继续；不会关闭、移除或绕过保护机制'
    )
  if (inspection.truncated || inspection.warnings?.length)
    add(
      'scan_incomplete',
      'consent',
      '部分目录未扫描完成。已保留检测证据，继续前请确认游戏目录和目标程序'
    )
  if (!selected.includes('nr'))
    add('no_neural_component', 'review', '请选择神经渲染组件，或只进行组件准备')
  if (!family)
    add(
      'gpu_unverified',
      /RTX/i.test(models) || !models ? 'review' : 'unsupported',
      '尚未确认可用的 NVIDIA RTX 20/30/40/50 显卡，不能据此承诺神经渲染可用'
    )
  if (runtime === 'nr-runtime' && family && family !== 50)
    add(
      'signed_runtime_gpu',
      'review',
      '当前原版运行库路线只验证到 RTX 50；请改用来源已核验的社区适配版，而不是替换显卡型号判断'
    )
  if (runtime === 'nr-community')
    add(
      'community_runtime',
      'consent',
      '使用 ShortFuse 社区适配运行库，已核对发布包和文件指纹，实际游戏效果与驱动兼容性仍需验证'
    )
  if (backend === 'native' && (api !== 'D3D12' || !inspection.nativeDlss?.length))
    add(
      'native_requirements',
      'review',
      '原生路线需要 DirectX 12 与游戏原生 DLSS；其他情况请选择 Feeder 路线'
    )
  if (selected.includes('sr'))
    add(
      'sr_private_runtime',
      'info',
      directoryInstall
        ? '仅安装所列目录中的运行库；同名文件先备份，不按文件存在宣称超分已经生效'
        : '超分运行库准备在独立会话内；不替换游戏原有的 DLL，也不声称原生超分已升级'
    )
  if (
    selected.includes('mfg40') &&
    (family !== 40 || api !== 'D3D12' || !inspection.nativeFrameGeneration?.length)
  )
    add(
      'mfg_requirements',
      'review',
      'RTX 40 多帧生成组件需要 RTX 40、D3D12 和原生帧生成证据；当前条件尚未确认'
    )
  if (selected.includes('sm86'))
    add(
      'sm86_loader_unverified',
      'review',
      'SM86 与当前组件组合尚未验证，当前可管理组件缓存，不能自动启用'
    )
  const components = [
    ...new Set([
      'reshade',
      ...selected.filter((id) => id !== 'feeder'),
      ...(selected.includes('nr') ? [runtime] : []),
      ...(backend === 'feeder' ? ['feeder', 'sr'] : [])
    ])
  ]
  const missing = components.filter((id) => !catalog.find((c) => c.id === id)?.ready)
  const blockers = findings.filter((f) => ['unsupported', 'blocker', 'review'].includes(f.severity))
  const support = findings.some((f) => f.severity === 'unsupported')
    ? 'unsupported'
    : blockers.length
      ? 'unverified'
      : 'experimental'
  const statusLabel = findings.find((f) => f.code === 'loader_conflict')
    ? '加载器冲突'
    : findings.find((f) => f.code === 'location_invalid')
      ? '需要重新定位'
      : findings.find((f) => f.code === 'render_api_unknown')
        ? '需要确认 API'
        : support === 'unverified'
          ? '方案待确认'
          : support === 'unsupported'
            ? '当前条件不满足'
            : '实验性支持'
  return {
    api,
    installMode,
    existingLoaders,
    detectedApis: observed,
    backend,
    runtime,
    gpuFamily: family,
    route,
    isolation: directoryInstall
      ? 'persistent-files'
      : route === 'process-loader'
        ? 'new-process-only'
        : 'process-environment',
    support,
    statusLabel,
    findings,
    reasons: blockers.map((f) => f.message),
    warnings: findings.filter((f) => ['consent', 'info'].includes(f.severity)),
    consentCodes: findings.filter((f) => f.severity === 'consent').map((f) => f.code),
    components,
    missing,
    canDeploy: !blockers.length && !missing.length,
    effect: 'unverified',
    capabilities: [
      {
        name: '超分辨率',
        status: 'unverified',
        detail:
          backend === 'feeder'
            ? 'Feeder 使用配套运行库建立输入；实际分辨率与效果需游戏内验证'
            : '使用游戏原生 DLSS 输入，不通过 DLL 文件存在判定已生效'
      },
      {
        name: '神经渲染',
        status: support,
        detail: `${api || 'API 待确认'} · ${backend === 'native' ? '原生 DLSS' : 'Feeder'} · ${directoryInstall ? '文件安装后自行启动' : '独立启动'}，运行效果待验证`
      },
      {
        name: '帧生成',
        status: 'unverified',
        detail: '按 RTX 40 MFG / RTX 20、30 SM86 分别检查；不把神经渲染可启动等同于帧生成已支持'
      }
    ]
  }
}
