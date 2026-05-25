const path = require('path')
const fs = require('fs')

exports.default = async function (context) {
  // Copy 安装指南.html for macOS
  if (context.electronPlatformName === 'darwin') {
    const guideFiles = ['安装指南.html']
    for (const name of guideFiles) {
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

  // Bundle the current renderer build into resources/renderer-hot/
  // Main process looks here as fallback when userData/renderer-hot/ is absent.
  const rendererSrc = path.join(context.packager.projectDir, 'out', 'renderer')
  if (!fs.existsSync(rendererSrc)) {
    console.warn('afterPack: renderer build not found at', rendererSrc, '— skipping bundled hot renderer')
    return
  }

  // Resolve the correct resources dir per platform
  let resourcesDir
  if (context.electronPlatformName === 'darwin') {
    resourcesDir = path.join(context.appOutDir, '异起看.app', 'Contents', 'Resources')
  } else {
    resourcesDir = path.join(context.appOutDir, 'resources')
  }

  const hotDest = path.join(resourcesDir, 'renderer-hot')
  fs.mkdirSync(hotDest, { recursive: true })

  copyDirSync(rendererSrc, hotDest)

  // Write version.txt — use package.json version as the bundled renderer version
  const pkg = require(path.join(context.packager.projectDir, 'package.json'))
  fs.writeFileSync(path.join(hotDest, 'version.txt'), pkg.version, 'utf-8')

  console.log('  • bundled renderer', pkg.version, '→', hotDest)
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}
