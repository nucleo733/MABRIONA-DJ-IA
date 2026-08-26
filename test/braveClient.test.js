'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { isBraveInstalled, launchBraveTo, windowsExeCandidates, linuxExeCandidates, MAC_APP_PATH } = require('../braveClient')

function withPlatform(platform, fn) {
  const original = Object.getOwnPropertyDescriptor(process, 'platform')
  Object.defineProperty(process, 'platform', { value: platform })
  try {
    return fn()
  } finally {
    Object.defineProperty(process, 'platform', original)
  }
}

function withExistsSync(existingPaths, fn) {
  const original = fs.existsSync
  fs.existsSync = (p) => existingPaths.includes(p)
  try {
    return fn()
  } finally {
    fs.existsSync = original
  }
}

test('windowsExeCandidates real: usa LOCALAPPDATA/PROGRAMFILES reales del entorno', () => {
  const candidates = windowsExeCandidates()
  assert.equal(candidates.length, 3)
  assert.ok(candidates.every((p) => p.includes('BraveSoftware') && p.includes('brave.exe')))
})

test('linuxExeCandidates real: rutas reales conocidas de instalación de Brave en Linux', () => {
  const candidates = linuxExeCandidates()
  assert.ok(candidates.includes('/usr/bin/brave-browser'))
  assert.ok(candidates.includes('/opt/brave.com/brave/brave'))
})

test('isBraveInstalled (mac): true real cuando existe /Applications/Brave Browser.app', () => {
  withPlatform('darwin', () => {
    withExistsSync([MAC_APP_PATH], () => {
      assert.equal(isBraveInstalled(), true)
    })
    withExistsSync([], () => {
      assert.equal(isBraveInstalled(), false)
    })
  })
})

test('isBraveInstalled (win): true real cuando cualquiera de las rutas candidatas existe', () => {
  withPlatform('win32', () => {
    const candidate = windowsExeCandidates()[1]
    withExistsSync([candidate], () => {
      assert.equal(isBraveInstalled(), true)
    })
    withExistsSync([], () => {
      assert.equal(isBraveInstalled(), false)
    })
  })
})

test('isBraveInstalled (linux): true real cuando cualquiera de las rutas candidatas existe', () => {
  withPlatform('linux', () => {
    withExistsSync(['/usr/bin/brave-browser'], () => {
      assert.equal(isBraveInstalled(), true)
    })
    withExistsSync([], () => {
      assert.equal(isBraveInstalled(), false)
    })
  })
})

test('launchBraveTo real: false honesto si Brave no está instalado (nunca inventa un lanzamiento)', () => {
  withPlatform('linux', () => {
    withExistsSync([], () => {
      assert.equal(launchBraveTo('https://www.mabriona.com/dj-ia-buscar?q=test'), false)
    })
  })
})
