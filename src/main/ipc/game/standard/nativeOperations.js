import {
  extractAndGetStructureByNodeApi,
  generateFileMD5ByNodeApi,
  generateFileSHA256ByNodeApi,
  inspectArchiveByNodeApi,
  listPackageRootCandidatesByNodeApi
} from '../../../api/file/index.js'
import { StagingManager } from '../../../utils/stagingManager.js'

export const standardNativeOperations = Object.freeze({
  inspectArchive: inspectArchiveByNodeApi,
  extractAndGetStructure: extractAndGetStructureByNodeApi,
  generateMD5: generateFileMD5ByNodeApi,
  generateSHA256: generateFileSHA256ByNodeApi,
  listPackageRootCandidates: listPackageRootCandidatesByNodeApi,
  buildManifest: StagingManager.buildManifest.bind(StagingManager),
  deploy: StagingManager.deploy.bind(StagingManager),
  undeploy: StagingManager.undeploy.bind(StagingManager),
  reconcileDeploy: StagingManager.reconcileDeploy.bind(StagingManager)
})
