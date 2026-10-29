export function formatChinaTime(date = new Date(), format = 'YYYY-MM-DD HH:mm:ss') {
  const chinaTime = new Date(date.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }))

  const pad = (num) => num.toString().padStart(2, '0')

  const replacements = {
    YYYY: chinaTime.getFullYear(),
    MM: pad(chinaTime.getMonth() + 1),
    DD: pad(chinaTime.getDate()),
    HH: pad(chinaTime.getHours()),
    mm: pad(chinaTime.getMinutes()),
    ss: pad(chinaTime.getSeconds())
  }

  return format.replace(/YYYY|MM|DD|HH|mm|ss/g, (match) => replacements[match])
}
