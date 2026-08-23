import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { rcedit } from 'rcedit'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const executableName = `${context.packager.appInfo.productFilename}.exe`
  const executablePath = path.join(context.appOutDir, executableName)
  const iconPath = path.join(projectRoot, 'src', 'renderer', 'assets', 'icon', 'app_icon.ico')

  await rcedit(executablePath, {
    icon: iconPath,
    'file-version': context.packager.appInfo.version,
    'product-version': context.packager.appInfo.version,
    'version-string': {
      CompanyName: 'Aurora Project',
      FileDescription: 'Aurora Player',
      InternalName: 'AuroraPlayer',
      OriginalFilename: executableName,
      ProductName: 'Aurora Player'
    }
  })
}
