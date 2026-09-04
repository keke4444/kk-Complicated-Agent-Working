import { readdirSync } from 'node:fs'
import path from 'node:path'

const nodeVersionBins = (homeDirectory: string): string[] => {
  try {
    return readdirSync(path.join(homeDirectory, '.nvm', 'versions', 'node'), {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(homeDirectory, '.nvm', 'versions', 'node', entry.name, 'bin'))
  } catch {
    return []
  }
}

export const processPathEntries = (
  homeDirectory: string,
  environment: NodeJS.ProcessEnv = process.env,
): string[] => {
  const entries =
    process.platform === 'win32'
      ? [
          environment.APPDATA ? path.join(environment.APPDATA, 'npm') : '',
          environment.LOCALAPPDATA ? path.join(environment.LOCALAPPDATA, 'Programs') : '',
        ]
      : [
          path.join(homeDirectory, '.local', 'bin'),
          path.join(homeDirectory, 'bin'),
          path.join(homeDirectory, '.npm-global', 'bin'),
          path.join(homeDirectory, '.volta', 'bin'),
          path.join(homeDirectory, '.bun', 'bin'),
          ...nodeVersionBins(homeDirectory),
          '/opt/homebrew/bin',
          '/usr/local/bin',
          '/usr/bin',
          '/bin',
        ]
  return entries.filter(Boolean)
}

export const initializeProcessPath = (
  homeDirectory: string,
  environment: NodeJS.ProcessEnv = process.env,
): void => {
  const current = (environment.PATH ?? '').split(path.delimiter).filter(Boolean)
  environment.PATH = [...new Set([...current, ...processPathEntries(homeDirectory, environment)])].join(
    path.delimiter,
  )
}
