<script setup>
import { ref, computed } from 'vue'
import FileIcons from 'file-icons-vue'
import VxModal from '@renderer/component/vertex-ui/VxModal.vue'
import common from '../../../../common/index.js'
import ipcRenderer from '@renderer/common/ipcRenderer.js'

const modelValue = ref(false)
const fileData = ref([])
const title = ref('')
const rootPath = ref('')

// 转换数据结构为树形结构（默认全部展开）
const buildTreeStructure = (data) => {
  const processNode = (node, depth = 0, parentPath = '') => {
    const path = parentPath ? `${parentPath}/${node.name}` : node.name
    const isFolder = node.type === 0

    const treeNode = {
      id: path,
      name: node.name,
      type: isFolder ? 'folder' : 'file',
      path: node.path,
      depth,
      size: node.size || 0
    }

    if (isFolder && node.sub && node.sub.length > 0) {
      treeNode.children = node.sub.map((child) => processNode(child, depth + 1, path))
    }

    return treeNode
  }

  // 排除第一个元素（下标为0），只处理其子内容
  return data.length > 0 && data[0].sub ? data[0].sub.map((item) => processNode(item, 0)) : []
}

// 扁平化树结构用于渲染（默认全部展开）
const renderNodes = computed(() => {
  const flatten = (nodes) => {
    return nodes.flatMap((node) => {
      const visibleNode = {
        ...node,
        isFolder: node.type === 'folder',
        hasChildren: node.children && node.children.length > 0
      }

      const result = [visibleNode]

      if (visibleNode.hasChildren) {
        return [...result, ...flatten(visibleNode.children)]
      }

      return result
    })
  }

  return fileData.value ? flatten(buildTreeStructure(fileData.value)) : []
})

const openFileBrowser = (json, name) => {
  console.log('原始输入:', json)
  try {
    // 参数验证
    if (!json || typeof json !== 'string') {
      console.error('无效的JSON字符串')
      return
    }

    // 去除外层多余的引号
    let processedJson = json.trim()

    // 检查是否是双重引号的JSON字符串
    if (processedJson.startsWith('"') && processedJson.endsWith('"')) {
      processedJson = processedJson.slice(1, -1)
      console.log('去除外层引号后的字符串:', processedJson)

      // 处理转义字符
      processedJson = processedJson.replace(/\\"/g, '"')
      processedJson = processedJson.replace(/\\\\/g, '\\')
    }

    // 设置标题
    title.value = name || '文件浏览器'

    // 解析JSON
    fileData.value = JSON.parse(processedJson)
    console.log('解析后的文件数据:', fileData.value)

    // 设置根路径
    if (fileData.value?.length > 0 && typeof fileData.value[0]?.path === 'string') {
      rootPath.value = fileData.value[0].path
    } else {
      rootPath.value = '' // 或设置默认路径
    }
    console.log(fileData.value[0])
    // 打开对话框
    modelValue.value = true
  } catch (e) {
    console.error('JSON解析错误:', e)
    modelValue.value = false // 确保出错时关闭对话框
  }
}

function goToPath(node) {
  ipcRenderer.send('openSpecifyPath', node.path)
}

defineExpose({
  openFileBrowser
})
</script>

<template>
  <VxModal v-model="modelValue" plain>
    <div class="file-browser">
      <div class="browser-header">
        <div class="browser-title">Mod {{ title }} {{ $t('ui.installationStructure') }}</div>
        <div class="root-path">{{ $t('ui.rootFolder') }} {{ rootPath }}</div>
      </div>

      <div class="browser-container">
        <div class="tree-view">
          <div
            v-for="node in renderNodes"
            :key="node.id"
            :class="['tree-item', node.type]"
            :style="{
              paddingLeft: `${node.depth * 18 + 12}px`,
              position: 'relative'
            }"
          >
            <!-- 引导线 -->
            <div
              v-for="level in node.depth"
              :key="level"
              class="tree-guide-line"
              :style="{
                left: `${(level - 1) * 18 + 15}px`
              }"
            ></div>

            <div class="item-content" @click="goToPath(node)">
              <span class="item-icon">
                <!-- 文件夹图标 -->
                <template v-if="node.isFolder">
                  <FileIcons
                    is-folder
                    :name="node.name"
                    class="file-icon"
                    :width="24"
                    :height="24"
                    :item-style="{ display: 'flex', alignItems: 'center' }"
                  />
                </template>

                <!-- 文件图标 -->
                <template v-else>
                  <FileIcons
                    :name="node.name"
                    class="file-icon"
                    :width="24"
                    :height="24"
                    :item-style="{ display: 'flex', alignItems: 'center' }"
                  />
                </template>
              </span>

              <span class="item-name">
                {{ node.name }}
                <span v-if="node.isFolder && !node.hasChildren" class="empty-folder"> {{ $t('ui.empty') }} </span>
              </span>

              <span v-if="!node.isFolder" class="item-size">
                {{ node.size > 0 ? common.formatBytes(node.size) : '' }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </VxModal>
</template>

<style scoped>
/* 样式保持不变 */
.file-browser {
  display: flex;
  flex-direction: column;
  padding: 16px;
  background: #1e1e1e;
  width: 60vw;
  height: 65vh;
  border-radius: 8px;
  color: #d4d4d4;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}

.browser-header {
  margin-bottom: 15px;
  flex-shrink: 0;
  padding-bottom: 10px;
  border-bottom: 1px solid #3c3c3c;
}

.browser-title {
  font-size: 17px;
  font-weight: 600;
  color: #e5e5e5;
  letter-spacing: 0.3px;
}

.root-path {
  font-size: 13px;
  color: #888;
  margin-top: 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.browser-container {
  flex: 1;
  overflow: hidden;
  border-radius: 6px;
  background: #252526;
  border: 1px solid #3c3c3c;
}

.tree-view {
  padding: 12px 0;
  height: 100%;
  overflow-y: auto;
  position: relative;
}

.tree-item {
  padding: 4px 0;
  position: relative;
  transition: background-color 0.15s;
}

.tree-item:hover {
  background-color: rgba(90, 93, 94, 0.3);
}

.tree-guide-line {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: #404040;
}

.item-content {
  display: flex;
  align-items: center;
  padding: 6px 10px;
  min-height: 28px;
  cursor: pointer;
}

.item-icon {
  margin-right: 8px;
  width: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.item-name {
  flex: 1;
  font-size: 13.5px;
  color: #d4d4d4;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: 0.2px;
}

.tree-item.folder .item-name {
  font-weight: 500;
  color: #c5c5c5;
}

.tree-item.file .item-name {
  color: #d4d4d4;
}

.item-size {
  font-size: 12px;
  color: #9e9e9e;
  margin-left: 12px;
  white-space: nowrap;
}

.empty-folder {
  font-size: 12px;
  color: #888;
  margin-left: 6px;
  font-style: italic;
}

/* VSCode 风格滚动条 */
.tree-view::-webkit-scrollbar {
  width: 10px;
}

.tree-view::-webkit-scrollbar-track {
  background: #1e1e1e;
  border-radius: 0 0 5px 0;
}

.tree-view::-webkit-scrollbar-thumb {
  background: #3d3d3d;
  border-radius: 5px;
  border: 2px solid #1e1e1e;
}

.tree-view::-webkit-scrollbar-thumb:hover {
  background: #555;
}
</style>
