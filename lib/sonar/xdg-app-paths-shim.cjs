'use strict'

const os = require('node:os')
const path = require('node:path')

function normalizeOptions(options, isolatedDefault) {
  const value =
    typeof options === 'object' && options !== null
      ? options
      : { isolated: options }
  const isolated =
    value.isolated === undefined || value.isolated === null
      ? isolatedDefault
      : value.isolated

  if (typeof isolated !== 'boolean') {
    throw new TypeError(
      `Expected boolean for "isolated" argument, got ${typeof isolated}`
    )
  }

  return isolated
}

function append(base, name, options, isolatedDefault) {
  return path.join(
    base,
    normalizeOptions(options, isolatedDefault) ? name : ''
  )
}

module.exports = function xdgAppPaths(options = {}) {
  const value =
    typeof options === 'object' && options !== null
      ? options
      : { name: options }
  let name = value.name || ''

  if (typeof name !== 'string') {
    throw new TypeError(`Expected string for "name" argument, got ${typeof name}`)
  }

  if (!name) {
    name = path.parse(process.argv[0] || process.execPath).name
  }

  const suffix = value.suffix || ''
  if (typeof suffix !== 'string') {
    throw new TypeError(
      `Expected string for "suffix" argument, got ${typeof suffix}`
    )
  }
  name += suffix

  const isolatedDefault =
    value.isolated === undefined || value.isolated === null
      ? true
      : value.isolated
  const home = os.homedir()
  const env = process.env
  const dataHome =
    env.XDG_DATA_HOME ||
    (process.platform === 'darwin'
      ? path.join(home, 'Library', 'Application Support')
      : path.join(home, '.local', 'share'))
  const configHome =
    env.XDG_CONFIG_HOME ||
    (process.platform === 'darwin'
      ? path.join(home, 'Library', 'Preferences')
      : path.join(home, '.config'))
  const cacheHome =
    env.XDG_CACHE_HOME ||
    (process.platform === 'darwin'
      ? path.join(home, 'Library', 'Caches')
      : path.join(home, '.cache'))
  const stateHome =
    env.XDG_STATE_HOME || path.join(home, '.local', 'state')

  return {
    $name: () => name,
    $isolated: () => isolatedDefault,
    cache: (options) => append(cacheHome, name, options, isolatedDefault),
    config: (options) => append(configHome, name, options, isolatedDefault),
    data: (options) => append(dataHome, name, options, isolatedDefault),
    runtime: (options) =>
      env.XDG_RUNTIME_DIR
        ? append(env.XDG_RUNTIME_DIR, name, options, isolatedDefault)
        : undefined,
    state: (options) => append(stateHome, name, options, isolatedDefault),
    configDirs: (options) => [
      append(configHome, name, options, isolatedDefault),
    ],
    dataDirs: (options) => [append(dataHome, name, options, isolatedDefault)],
  }
}
