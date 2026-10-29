import { clientI18n } from '../i18n/index.js'
const uiText = (key, params) => clientI18n.i18n.global.t(key, params)
import { uiMessage } from '../i18n/message.js'
import { h } from 'vue'
import { Modal } from 'ant-design-vue'
import { $message } from '@renderer/common/message.js'

function normalizeShareName(value = '') {
  return String(value || '').trim().slice(0, 150)
}

export function requestSourceModpackShareName(defaultName = '') {
  const fallbackName = normalizeShareName(defaultName) || '未命名整合包'
  let currentName = fallbackName

  return new Promise((resolve) => {
    const modal = Modal.confirm({
      get title() { return uiText('ui.nameSharedModpack') },
      get okText() { return uiText('ui.generateShareCode') },
      get cancelText() { return uiText('ui.cancel') },
      width: 460,
      content: () =>
        h(
          'div',
          {
            style: {
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              paddingTop: '4px'
            }
          },
          [
            h(
              'input',
              {
                value: currentName,
                maxlength: 150,
                get placeholder() { return uiText('ui.enterANameForTheSharedModpack') },
                style: {
                  width: '100%',
                  height: '38px',
                  padding: '0 12px',
                  border: '1px solid #dbe3ef',
                  borderRadius: '8px',
                  outline: 'none'
                },
                onInput: (event) => {
                  currentName = normalizeShareName(event?.target?.value)
                },
                onKeydown: (event) => {
                  if (event?.key !== 'Enter') return
                  event.preventDefault()
                  const name = normalizeShareName(currentName)
                  if (!name) {
                    $message.warning(uiMessage('ui.enterANameForTheSharedModpack'))
                    return
                  }
                  modal.destroy()
                  resolve(name)
                }
              }
            ),
            h(
              'div',
              {
                style: {
                  color: '#64748b',
                  fontSize: '12px',
                  lineHeight: '1.6'
                }
              },
              '该名称会显示在分享预览和外部来源整合包列表中。'
            )
          ]
        ),
      onOk: () => {
        const name = normalizeShareName(currentName)
        if (!name) {
          $message.warning(uiMessage('ui.enterANameForTheSharedModpack'))
          return Promise.reject()
        }
        resolve(name)
        return undefined
      },
      onCancel: () => {
        resolve('')
      }
    })
  })
}
