// =============================================================
// renderer/wizard/wizard-state.js — Estado centralizado del wizard
// =============================================================
// Propósito:
//   Almacén de estado para el wizard de 4 pasos (crear/editar app).
//   Ningún consumidor lee ni escribe _state directamente.
//   No toca DOM. No llama IPC. Solo gestiona datos.
//
// Secciones de estado:
//   template   — paso 1: selección de template, tabs, búsquedas, winget
//   basic      — paso 2: nombre, instalador, parámetros, desinstalación
//   detection  — paso 3: detección de instalación previa, dependencias
//   deployment — paso 4: OUs destino, GPO, notificación, modo simple
//
// API pública (disponible como window.WizardState):
//   get(section)    → copia profunda del subobjeto; nunca referencia viva
//   set(section, d) → merge parcial sobre la sección (un nivel de profundidad)
//   getStep()       → paso actual (1–4)
//   setStep(n)      → actualiza paso; ignora valores fuera de [1,4]
//   reset()         → limpia timer pendiente y restaura estado inicial
//   isComplete()    → true si template y nombre están presentes
//   snapshot()      → copia plana de los campos de datos (para IPC)
// =============================================================

// ─── Defaults ────────────────────────────────────────────────

const _DEFAULTS = {
  currentStep: 1,

  template: {
    template:              '',
    wingetId:              '',
    wingetSource:          'winget',
    catalogTab:            'catalog',
    catalogSearch:         '',
    catalogCat:            'Todo',
    plantillaSearch:       '',
    templateInstallers:    {},
    wizardWingetResults:   [],
    wizardWingetSearching: false,
    _wizardWingetTimer:    null,
    _catalogResolutionToken: 0
  },

  basic: {
    name:                    '',
    silentArgs:              '/S',
    version:                 '1.0.0',
    suggestedVersion:        '',
    installerPath:           '',
    configXmlPath:           '',
    customParams:            {},
    templateFiles:           {},
    templateDefinition:      null,
    odtConfig: {
      product:  'O365BusinessRetail',
      apps:     ['Word', 'Excel', 'PowerPoint', 'Outlook', 'OneNote', 'OneDrive'],
      language: 'es-es',
      channel:  'MonthlyEnterprise',
      arch:     '64'
    },
    uninstallMode:             'none',
    uninstallCommand:          '',
    uninstallArgs:             '',
    uninstallRegistryName:     '',
    uninstallRegistryPublisher:'',
    uninstallProductCode:      ''
  },

  detection: {
    detection: {
      type:                  'tracker',
      filePath:              '',
      fileCheck:             'exists',
      fileVersionOp:         '>=',
      fileVersionValue:      '',
      registryHive:          'HKLM',
      registryKey:           '',
      registryValueName:     '',
      registryCheck:         'exists',
      registryOp:            '>=',
      registryExpectedValue: ''
    },
    dependsOn: {
      appId:          '',
      appName:        '',
      timeoutMinutes: 30,
      behavior:       'skip'
    },
    availableApps: []
  },

  deployment: {
    selectedOUs:    [],
    ouDN:           '',
    gpoName:        '',
    createGPO:      false,
    notifyUser:     false,
    simpleModeFlow: false
  }
};

// ─── Internals ───────────────────────────────────────────────

// Deep copy via JSON — all state values are plain data, no functions or circular refs.
function _clone(obj) {
  try {
    return JSON.parse(JSON.stringify(obj));
  } catch (e) {
    console.warn('[WizardState] _clone failed, returning shallow copy:', e);
    return Object.assign({}, obj);
  }
}

// Returns a fresh state object built from defaults (no aliasing between instances).
function _fresh() {
  return {
    currentStep: _DEFAULTS.currentStep,
    template:    _clone(_DEFAULTS.template),
    basic:       _clone(_DEFAULTS.basic),
    detection:   _clone(_DEFAULTS.detection),
    deployment:  _clone(_DEFAULTS.deployment)
  };
}

let _state = _fresh();

const _VALID_SECTIONS = ['template', 'basic', 'detection', 'deployment'];

// ─── API pública ─────────────────────────────────────────────

const WizardState = {

  // Returns a deep copy of the named section. Caller gets a snapshot, not a live ref.
  get(section) {
    if (!_VALID_SECTIONS.includes(section)) {
      console.warn(t('gui.wizardstateGetUnknownSection') + section + '"');
      return {};
    }
    return _clone(_state[section]);
  },

  // Merges data into the named section. Plain sub-objects are merged one level deep;
  // arrays and primitives are replaced wholesale.
  set(section, data) {
    if (!_VALID_SECTIONS.includes(section)) {
      console.warn(t('gui.wizardstateSetUnknownSection') + section + '"');
      return;
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      console.warn('[WizardState] set: data debe ser un objeto plano');
      return;
    }
    const target = _state[section];
    for (const key of Object.keys(data)) {
      const incoming = data[key];
      const existing = target[key];
      if (
        incoming !== null &&
        typeof incoming === 'object' &&
        !Array.isArray(incoming) &&
        existing !== null &&
        typeof existing === 'object' &&
        !Array.isArray(existing)
      ) {
        // One-level deep merge for nested plain objects (e.g. detection.*, odtConfig)
        target[key] = Object.assign({}, existing, incoming);
      } else {
        target[key] = incoming;
      }
    }
  },

  // Returns the current wizard step.
  getStep() {
    return _state.currentStep;
  },

  // Sets the wizard step. Clamps silently to [1, 4]; ignores non-integer input.
  setStep(n) {
    const parsed = Number(n);
    if (!Number.isInteger(parsed)) {
      console.warn(t('gui.wizardstateSetstepInvalidValue') + n + '"');
      return;
    }
    _state.currentStep = Math.min(4, Math.max(1, parsed));
  },

  // Clears any pending winget debounce timer, then resets all state to defaults.
  reset() {
    const timer = _state.template._wizardWingetTimer;
    if (timer !== null) {
      clearTimeout(timer);
    }
    _state = _fresh();
  },

  // Returns true if the minimum required data for a valid submission is present.
  isComplete() {
    const tpl   = _state.template;
    const basic = _state.basic;
    if (!tpl.template) return false;
    if (!basic.name.trim()) return false;
    // winget, odt, and custom (script) templates don't require a local installer file
    const noInstallerTemplates = ['winget', 'odt', 'custom'];
    if (!noInstallerTemplates.includes(tpl.template) && !basic.installerPath) return false;
    return true;
  },

  // Returns a flat deep copy of all data fields — suitable for passing to IPC or
  // building appData in performWizardCreate. Excludes ephemeral UI fields (timer,
  // search strings, abort tokens) that are never read by the IPC layer.
  snapshot() {
    const tpl = _state.template;
    const basic = _state.basic;
    const det = _state.detection;
    const dep = _state.deployment;

    return {
      step: _state.currentStep,

      // ── template ──
      template:           tpl.template,
      wingetId:           tpl.wingetId,
      wingetSource:       tpl.wingetSource,
      catalogTab:         tpl.catalogTab,
      templateInstallers: _clone(tpl.templateInstallers),

      // ── basic ──
      name:                    basic.name,
      silentArgs:              basic.silentArgs,
      version:                 basic.version,
      suggestedVersion:        basic.suggestedVersion,
      installerPath:           basic.installerPath,
      configXmlPath:           basic.configXmlPath,
      customParams:            _clone(basic.customParams),
      templateFiles:           _clone(basic.templateFiles),
      templateDefinition:      _clone(basic.templateDefinition),
      odtConfig:               _clone(basic.odtConfig),
      uninstallMode:           basic.uninstallMode,
      uninstallCommand:        basic.uninstallCommand,
      uninstallArgs:           basic.uninstallArgs,
      uninstallRegistryName:   basic.uninstallRegistryName,
      uninstallRegistryPublisher: basic.uninstallRegistryPublisher,
      uninstallProductCode:    basic.uninstallProductCode,

      // ── detection ──
      detection:     _clone(det.detection),
      dependsOn:     _clone(det.dependsOn),
      availableApps: _clone(det.availableApps),

      // ── deployment ──
      selectedOUs:    _clone(dep.selectedOUs),
      ouDN:           dep.ouDN,
      gpoName:        dep.gpoName,
      createGPO:      dep.createGPO,
      notifyUser:     dep.notifyUser,
      simpleModeFlow: dep.simpleModeFlow
    };
  }

};

window.WizardState = WizardState;
