'use strict';

const { execFileSync } = require('node:child_process');

const REG_PATH = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';

function normalize(address) {
  if (!address || typeof address !== 'string') return null;
  let value = address.trim();
  if (!value) return null;
  // Per-protocol form ("http=...;https=...") is not supported without an explicit choice.
  if (value.includes('=')) return { address: null, unsupported: 'per-protocol proxy format' };
  if (!/^https?:\/\//i.test(value)) value = `http://${value}`;
  try {
    const url = new URL(value);
    if (url.username || url.password) return { address: `${url.protocol}//${url.host}`, hadCredentials: true };
    return { address: `${url.protocol}//${url.host}` };
  } catch {
    return { address: null, unsupported: 'unparseable proxy address' };
  }
}

function readRegistryValue(name) {
  try {
    const out = execFileSync('reg', ['query', REG_PATH, '/v', name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const line = out
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.toLowerCase().startsWith(name.toLowerCase()));
    if (!line) return null;
    const parts = line.split(/\s{2,}/);
    return parts.length >= 3 ? parts.slice(2).join('  ') : null;
  } catch {
    return null;
  }
}

/**
 * Detect the currently enabled system HTTP proxy without changing any global
 * setting. Environment variables win; otherwise the Windows registry is read.
 * The returned address is safe to place in a child process env and to print
 * (userinfo is stripped).
 */
function detectSystemProxy({ env = process.env, platform = process.platform } = {}) {
  const fromEnv = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy;
  if (fromEnv) {
    const norm = normalize(fromEnv);
    if (norm && norm.address) return { source: 'env', address: norm.address, enabled: true };
    return { source: 'env', address: null, enabled: false, reason: norm ? norm.unsupported : 'invalid' };
  }
  if (platform !== 'win32') return { source: 'none', address: null, enabled: false, reason: 'not windows' };
  const enabledRaw = readRegistryValue('ProxyEnable');
  const serverRaw = readRegistryValue('ProxyServer');
  const enabled = enabledRaw !== null && /0x0*1\b|^\s*1\s*$/.test(enabledRaw.trim());
  if (!enabled) return { source: 'registry', address: null, enabled: false, reason: 'ProxyEnable is off' };
  const norm = normalize(serverRaw);
  if (norm && norm.address) return { source: 'registry', address: norm.address, enabled: true };
  return { source: 'registry', address: null, enabled: false, reason: norm ? norm.unsupported : 'no ProxyServer' };
}

/** Env patch for a child process; never mutates process.env. */
function proxyEnv(proxy) {
  if (!proxy || !proxy.address) return {};
  return { HTTP_PROXY: proxy.address, HTTPS_PROXY: proxy.address };
}

module.exports = { detectSystemProxy, proxyEnv, normalize };
