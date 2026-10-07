const fs = require('fs');
const path = require('path');
const vm = require('vm');
function page(file, name) {
  const context = { App: { _esc: text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', 'renderer/pages', file), 'utf8') + `\nthis.result = ${name};`, context);
  return context.result;
}
describe('English activity messages', () => {
  it('renders app creation and deployment in English in the logs and recent activity views', () => {
    const logs = page('logs.js', 'LogsPage');
    expect(logs._formatMessage({ message: 'app_create', context: { appName: '<Test>', version: '1.0' } }).primary).toBe('App created: <strong>&lt;Test&gt;</strong> <span class="logs-ctx-ver">v1.0</span>');
    expect(logs._formatMessage({ message: 'script_deploy' }).primary).toBe('Script deployed');
    expect(logs._formatMessage({ message: 'install_failed', context: { error: '<Access denied>' } }).secondary).toContain('&lt;Access denied&gt;');
    const dashboard = page('dashboard.js', 'DashboardPage');
    expect(dashboard.getActivityText({ action: 'app_create', appName: '<Test>' })).toBe('App created: <strong>&lt;Test&gt;</strong> v1.0.0');
    expect(dashboard.getActivityText({ action: 'install_failed', appName: 'Test' })).toBe('Installation failed: <strong>Test</strong>');
  });
});
