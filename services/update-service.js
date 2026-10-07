const https = require('https');

const GITHUB_REPO = 'afaminx/SMBActiveDirectoryDeployManager';
const RELEASES_API_PATH = `/repos/${GITHUB_REPO}/releases/latest`;
const RELEASE_PAGE_URL = `https://github.com/${GITHUB_REPO}/releases/latest`;

function normalizeVersion(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const withoutPrefix = trimmed.replace(/^[vV]/, '');
  const match = withoutPrefix.match(/\d+(?:\.\d+)*/);
  return match ? match[0] : null;
}

function toVersionParts(raw) {
  const normalized = normalizeVersion(raw);
  if (!normalized) return null;

  return normalized
    .split('.')
    .map(part => parseInt(part, 10))
    .filter(part => Number.isFinite(part));
}

function compareVersions(a, b) {
  const left = toVersionParts(a);
  const right = toVersionParts(b);

  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;

  const maxLength = Math.max(left.length, right.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftPart = left[index] || 0;
    const rightPart = right[index] || 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  return 0;
}

function fetchLatestRelease(timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const request = https.get({
      hostname: 'api.github.com',
      path: RELEASES_API_PATH,
      headers: {
        'User-Agent': 'ADDeployManager/1.0',
        'Accept': 'application/vnd.github+json'
      },
      timeout: timeoutMs
    }, (response) => {
      let raw = '';

      response.on('data', chunk => {
        raw += chunk;
      });

      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`GitHub API responded with status ${response.statusCode || 'unknown'}`));
          return;
        }

        try {
          resolve(JSON.parse(raw));
        } catch {
          reject(new Error('Invalid JSON received from GitHub releases API'));
        }
      });
    });

    request.on('error', err => {
      reject(err);
    });

    request.on('timeout', () => {
      request.destroy(new Error('GitHub releases API request timed out'));
    });
  });
}

async function checkForUpdates(currentVersion, options = {}) {
  const fetchRelease = typeof options.fetchLatestRelease === 'function'
    ? options.fetchLatestRelease
    : fetchLatestRelease;
  const normalizedCurrentVersion = normalizeVersion(currentVersion) || String(currentVersion || '').trim() || '0.0.0';
  const baseResult = {
    success: false,
    currentVersion: normalizedCurrentVersion,
    latestVersion: null,
    hasUpdate: false,
    tagName: null,
    releaseName: null,
    publishedAt: null,
    checkedAt: new Date().toISOString(),
    error: null
  };

  try {
    const release = await fetchRelease();
    const latestVersion = normalizeVersion(release?.tag_name || '') || normalizeVersion(release?.name || '');

    if (!latestVersion) {
      return {
        ...baseResult,
        tagName: release?.tag_name || null,
        releaseName: release?.name || null,
        publishedAt: release?.published_at || null,
        error: 'Latest release does not contain a valid version tag'
      };
    }

    return {
      ...baseResult,
      success: true,
      latestVersion,
      hasUpdate: compareVersions(latestVersion, normalizedCurrentVersion) > 0,
      tagName: release?.tag_name || null,
      releaseName: release?.name || null,
      publishedAt: release?.published_at || null,
      error: null
    };
  } catch (err) {
    return {
      ...baseResult,
      error: err?.message || 'Unable to check the latest GitHub release'
    };
  }
}

module.exports = {
  GITHUB_REPO,
  RELEASE_PAGE_URL,
  normalizeVersion,
  compareVersions,
  fetchLatestRelease,
  checkForUpdates
};
