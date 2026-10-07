describe('update-service', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('queries this fork for release updates and opens its release page', async () => {
    const https = require('https');
    const { EventEmitter } = require('events');
    const originalGet = https.get;
    let requestOptions;
    https.get = (options, callback) => {
      requestOptions = options;
      const request = new EventEmitter();
      process.nextTick(() => {
        const response = new EventEmitter();
        response.statusCode = 200;
        callback(response);
        response.emit('data', '{"tag_name":"v1.2.12"}');
        response.emit('end');
      });
      return request;
    };
    try {
      const svc = require('../services/update-service');
      const result = await svc.checkForUpdates('1.2.11');
      expect(requestOptions.hostname).toBe('api.github.com');
      expect(requestOptions.path).toBe('/repos/afaminx/SMBActiveDirectoryDeployManager/releases/latest');
      expect(svc.RELEASE_PAGE_URL).toBe('https://github.com/afaminx/SMBActiveDirectoryDeployManager/releases/latest');
      expect(result).toMatchObject({ success: true, hasUpdate: true, latestVersion: '1.2.12' });
    } finally { https.get = originalGet; }
  });

  it('detects a newer GitHub release than the local app version', async () => {
    const svc = require('../services/update-service');
    const result = await svc.checkForUpdates('1.2.7', {
      fetchLatestRelease: async () => ({
        tag_name: 'v1.2.8',
        name: 'v1.2.8',
        published_at: '2026-04-20T10:00:00.000Z'
      })
    });

    expect(result.success).toBe(true);
    expect(result.latestVersion).toBe('1.2.8');
    expect(result.hasUpdate).toBe(true);
  });

  it('reports no update when the GitHub release matches the current version', async () => {
    const svc = require('../services/update-service');
    const result = await svc.checkForUpdates('1.2.7', {
      fetchLatestRelease: async () => ({
        tag_name: 'v1.2.7',
        name: 'v1.2.7'
      })
    });

    expect(result.success).toBe(true);
    expect(result.latestVersion).toBe('1.2.7');
    expect(result.hasUpdate).toBe(false);
  });

  it('reports no update when the remote release is older than the installed version', async () => {
    const svc = require('../services/update-service');
    const result = await svc.checkForUpdates('1.2.7', {
      fetchLatestRelease: async () => ({
        tag_name: 'v1.2.6',
        name: 'v1.2.6'
      })
    });

    expect(result.success).toBe(true);
    expect(result.latestVersion).toBe('1.2.6');
    expect(result.hasUpdate).toBe(false);
  });

  it('fails gracefully when the latest release tag does not contain a valid version', async () => {
    const svc = require('../services/update-service');
    const result = await svc.checkForUpdates('1.2.7', {
      fetchLatestRelease: async () => ({
        tag_name: 'stable-release',
        name: 'stable-release'
      })
    });

    expect(result.success).toBe(false);
    expect(result.latestVersion).toBe(null);
    expect(result.error).toMatch(/valid version/i);
  });

  it('fails gracefully when the GitHub request times out', async () => {
    const svc = require('../services/update-service');
    const result = await svc.checkForUpdates('1.2.7', {
      fetchLatestRelease: async () => {
        throw new Error('GitHub releases API request timed out');
      }
    });

    expect(result.success).toBe(false);
    expect(result.hasUpdate).toBe(false);
    expect(result.error).toMatch(/timed out/i);
  });
});
