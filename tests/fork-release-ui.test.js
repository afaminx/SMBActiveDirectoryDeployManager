const fs = require('fs');
const path = require('path');
const vm = require('vm');
const i18n = require('../services/i18n');
const versions = require('../services/app-version');
const updater = require('../services/update-service');
const renderer = path.join(__dirname, '..', 'renderer');

describe('fork release identity', () => {
  it('keeps the fork release and upstream generator version separate', () => {
    expect(versions.getCurrentForkVersion()).toBe('2.1');
    expect(versions.getCurrentAppVersion()).toBe('1.2.11');
    expect(versions.getCurrentGeneratorRevision()).toBe('mod-rev-2.1');
  });
  it.each([
    ['v1.8', false], ['v2.0', false], ['v2.1', false], ['mod-rev-2.1', false],
    ['v2.1.0', false], ['v2.2', true], ['mod-rev-2.10', true],
    ['v1.2.11-mod-rev-2.0', false], ['v1.2.11-mod-rev-2.2', true]
  ])('compares the installed fork with release %s', async (tag, expected) => {
    const result = await updater.checkForUpdates(versions.getCurrentForkVersion(), {
      fetchLatestRelease: async () => ({ tag_name: tag, name: tag })
    });
    expect(result).toMatchObject({ success: true, currentVersion: '2.1', hasUpdate: expected });
  });
});

function appContext(language, initialLanguage) {
  const elements = new Map();
  const element = () => ({
    style: {}, children: [], textContent: '', innerHTML: '',
    appendChild(child) { this.children.push(child); if (child.id) elements.set(child.id, child); },
    replaceChildren() { this.children = []; },
    remove() { elements.delete(this.id); }, addEventListener() {}
  });
  const context = {
    console: { warn() {} },
    document: { documentElement: {}, querySelectorAll: () => [], getElementById: id => elements.get(id),
      createElement: element, body: element(), addEventListener() {} },
    api: { config: { get: async () => ({ language }) },
      i18n: { getTranslations: async lang => i18n.getTranslations(lang) },
      updates: { check: async () => ({ success: true, currentVersion: '2.1', latestVersion: '2.2', hasUpdate: true }) } }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(renderer, 'app.js'), 'utf8') + '\nthis.app = App;', context);
  context.langDict = i18n.getTranslations(initialLanguage);
  context.app._esc = String;
  context.app.openModal = (...args) => { context.modal = args.join('\n'); };
  return { context, elements };
}

describe('updater language refresh', () => {
  it.each(['en', 'es'])('uses configured %s after a stale opposite-language dictionary', async language => {
    const { context, elements } = appContext(language, language === 'en' ? 'es' : 'en');
    await context.app.checkAppUpdates();
    const banner = elements.get('app-update-banner');
    expect(banner.children[1].textContent).toBe(i18n.getTranslations(language).updates.bannerMessage
      .replace('{current}', '2.1').replace('{latest}', '2.2'));
    const actions = banner.children[2].children;
    expect(actions.map(button => button.textContent)).toEqual([
      i18n.getTranslations(language).updates.openRelease, i18n.getTranslations(language).updates.dismissButton
    ]);
    context.langDict = i18n.getTranslations(language === 'en' ? 'es' : 'en');
    await context.app.promptAppUpdateDismissal();
    const dictionary = i18n.getTranslations(language);
    for (const key of ['dismissTitle', 'dismissOnce', 'dismissOnceDescription', 'dismissVersion']) {
      expect(context.modal).toContain(dictionary.updates[key]);
    }
    expect(context.modal).toContain(dictionary.common.cancel);
    expect(context.document.documentElement.lang).toBe(language);
  });
});

describe('application and bundle action menus', () => {
  function menu(viewport, button, menuSize) {
    const listeners = new Map();
    const add = (name, callback) => listeners.set(name, callback);
    const remove = (name, callback) => { if (listeners.get(name) === callback) listeners.delete(name); };
    const dropdown = { style: {}, classList: { add() {} }, removed: false,
      getBoundingClientRect() { return {
        width: Math.min(menuSize.width, parseFloat(this.style.width)),
        height: Math.min(menuSize.height, parseFloat(this.style.maxHeight))
      }; },
      contains: target => target === dropdown, remove() { this.removed = true; } };
    const btn = { nextElementSibling: { cloneNode: () => dropdown },
      getBoundingClientRect: () => button, contains: target => target === btn };
    const context = { console, innerWidth: viewport.width, innerHeight: viewport.height,
      addEventListener: add, removeEventListener: remove,
      document: { body: { appendChild() {} }, addEventListener: add, removeEventListener: remove } };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(renderer, 'pages/apps-list.js'), 'utf8') + '\nthis.page = AppsListModule;', context);
    vm.runInContext(fs.readFileSync(path.join(renderer, 'pages/bundles.js'), 'utf8') + '\nthis.bundles = BundlesPage;', context);
    return { context, dropdown, btn, listeners };
  }
  it.each([
    [{ width: 800, height: 600 }, { top: 550, bottom: 580, right: 790 }, { width: 190, height: 220 }, true],
    [{ width: 800, height: 600 }, { top: 20, bottom: 50, right: 60 }, { width: 190, height: 220 }, false],
    [{ width: 160, height: 180 }, { top: 120, bottom: 150, right: 155 }, { width: 190, height: 500 }, true]
  ])('keeps all actions inside viewport %j', (viewport, button, size, above) => {
    const { context, dropdown, btn } = menu(viewport, button, size);
    context.bundles.toggleMenu(btn);
    const measured = dropdown.getBoundingClientRect();
    const top = parseFloat(dropdown.style.top), left = parseFloat(dropdown.style.left);
    expect(top).toBeGreaterThanOrEqual(8);
    expect(left).toBeGreaterThanOrEqual(8);
    expect(top + measured.height).toBeLessThanOrEqual(viewport.height - 8);
    expect(left + measured.width).toBeLessThanOrEqual(viewport.width - 8);
    if (above) expect(top).toBeLessThan(button.top);
    else expect(top).toBeGreaterThan(button.bottom);
    expect(dropdown.style.overflowY).toBe('auto');
  });
  it('allows menu scrolling and removes stale menus/listeners on resize or page scroll', () => {
    const { context, dropdown, btn, listeners } = menu({ width: 800, height: 600 },
      { top: 550, bottom: 580, right: 790 }, { width: 190, height: 220 });
    context.page.toggleMenu(btn);
    listeners.get('scroll')({ target: dropdown });
    expect(dropdown.removed).toBe(false);
    listeners.get('resize')();
    expect(dropdown.removed).toBe(true);
    expect(listeners.size).toBe(0);
    context.page.toggleMenu(btn);
    listeners.get('scroll')({ target: {} });
    expect(listeners.size).toBe(0);
    expect(context.page._closeFloatingMenu).toBe(null);
  });
});
