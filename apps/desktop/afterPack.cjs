const path = require('path')
const fs = require('fs')

exports.default = async function (context) {
  if (context.electronPlatformName !== 'darwin') return

  const files = ['安装指南.html']

  for (const name of files) {
    const src = path.join(context.packager.projectDir, 'build', name)
    const dst = path.join(context.appOutDir, name)
    if (!fs.existsSync(src)) {
      console.warn('afterPack: not found:', src)
      continue
    }
    fs.copyFileSync(src, dst)
    console.log('  • copied', name, '→', context.appOutDir)
  }
}
