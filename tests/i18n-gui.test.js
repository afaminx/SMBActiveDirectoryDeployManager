const fs = require('fs');
const path = require('path');
const vm = require('vm');
const acorn = require('acorn');
const i18n = require('../services/i18n');
const additions = require('../services/gui-translations');
const root = path.join(__dirname, '..', 'renderer');
function get(dictionary, key) { return key.split('.').reduce((value, part) => value?.[part], dictionary); }
function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(item => item.isDirectory()
    ? files(path.join(directory, item.name)) : [path.join(directory, item.name)]);
}
function visit(node, callback) {
  if (!node?.type) return;
  callback(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => visit(child, callback));
    else if (value?.type) visit(value, callback);
  }
}

describe('GUI language coverage', () => {
  it('provides both languages for every static translation key used by the renderer', () => {
    const missing = [];
    for (const file of files(root).filter(file => file.endsWith('.js'))) {
      visit(acorn.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest' }), node => {
        if (node.type !== 'CallExpression' || node.callee.name !== 't' || node.arguments[0]?.type !== 'Literal') return;
        const key = node.arguments[0].value;
        for (const language of ['en', 'es']) {
          if (typeof get(i18n.getTranslations(language), key) !== 'string') missing.push(`${language}: ${key} (${path.basename(file)})`);
        }
      });
    }
    expect(missing).toEqual([]);
  });

  it('preserves interpolation placeholders in the added translations', () => {
    const placeholders = text => [...String(text).matchAll(/\{\w+\}|\$[A-Za-z]\w*/g)].map(match => match[0]).sort();
    for (const key of Object.keys(additions.additional.english)) {
      expect(placeholders(get(i18n.getTranslations('en'), key)), key).toEqual(placeholders(get(i18n.getTranslations('es'), key)));
    }
  });

  async function render(language, pageFile, name, available = true) {
    const controls = new Map();
    const control = id => {
      if (!controls.has(id)) controls.set(id, { innerHTML: '', appendChild() {}, style: {}, classList: { add() {}, remove() {} } });
      return controls.get(id);
    };
    const title = { title: '', getAttribute: () => 'gui.close' };
    const context = {
      console: { warn() {} },
      document: {
        documentElement: { lang: '' },
        querySelectorAll: selector => selector === '[data-i18n-title]' ? [title] : [],
        getElementById: control,
        createElement: () => ({})
      },
      App: { rsatAvailable: available, rsatMissingGPMC: false, rsatWarningHTML: () => '',
        _esc: value => String(value || ''), formatDate: value => value },
      api: {
        config: { get: async () => ({ language, baseOUs: [], networkSharePath: '\\\\server.example.test\\share' }) },
        i18n: { getTranslations: async lang => i18n.getTranslations(lang), getAvailable: async () => i18n.getAvailableLanguages() },
        apps: { getAll: async () => [] }, files: { listDeployed: async () => ({ success: true, data: [] }) },
        bundles: { getAll: async () => [] }, activity: { getRecent: async () => [] },
        logs: { query: async () => ({ items: [] }), status: async () => ({ mode: 'local' }) },
        updates: { getCurrent: async () => ({ currentVersion: '1.2.11' }) }
      }
    };
    context.window = context;
    vm.createContext(context);
    const appPrelude = fs.readFileSync(path.join(root, 'app.js'), 'utf8').split('const App = {')[0];
    vm.runInContext(appPrelude, context);
    await context.initI18n();
    vm.runInContext(fs.readFileSync(path.join(root, 'pages', pageFile), 'utf8') + `\nthis.page = ${name};`, context);
    // Keep actual HTML generation while isolating domain lookups/event wiring.
    for (const method of ['bindEvents', 'renderUpdateSection', 'loadGPOs', 'loadOUs', '_renderLogsBlock', 'checkNetworkShare', 'checkLogBackend']) context.page[method] = () => {};
    const container = { innerHTML: '' };
    await context.page.render(container);
    return { html: container.innerHTML, lang: context.document.documentElement.lang, title: title.title };
  }

  it('renders the screenshot telemetry cards and tooltips in English', async () => {
    const result = await render('en', 'dashboard.js', 'DashboardPage');
    expect(result.html).toContain('Deployment telemetry (last 24 hours)');
    expect(result.html).toContain('title="Successful installations"');
    expect(result.html).toContain('title="Failed installations"');
    expect(result.html).not.toMatch(/Telemetría|Instalaciones|Últimas/);
    expect(result.lang).toBe('en');
    expect(result.title).toBe('Close');
  });

  it('keeps Spanish telemetry when Spanish is selected', async () => {
    const result = await render('es', 'dashboard.js', 'DashboardPage');
    expect(result.html).toContain('Telemetría de Despliegues (Últimas 24h)');
    expect(result.html).toContain('title="Instalaciones Fallidas"');
    expect(result.lang).toBe('es');
    expect(result.title).toBe('Cerrar');
  });

  it('renders English warnings and Settings with directory services unavailable', async () => {
    const dashboard = await render('en', 'dashboard.js', 'DashboardPage', false);
    expect(dashboard.html).toContain('Active Directory unavailable');
    expect(dashboard.html).not.toContain('Instala RSAT');
    const settings = await render('en', 'settings.js', 'SettingsPage', false);
    expect(settings.html).toContain('Test AD Connection');
    expect(settings.html).toContain('Check Group Policy tools');
    expect(settings.html).not.toMatch(/Estado de RSAT|Comprobar RSAT|Conexión|deshabilitadas/);
  });
});
