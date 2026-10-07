const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Window Controls (frameless)
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close')
  },

  // Share Health
  share: {
    checkHealth: () => ipcRenderer.invoke('share:checkHealth'),
    getStatus: () => ipcRenderer.invoke('share:getStatus'),
    detectLoggingConfig: () => ipcRenderer.invoke('share:detectLoggingConfig'),
    enrollFromConfig: () => ipcRenderer.invoke('share:enrollFromConfig'),
    publishLoggingConfig: (options) => ipcRenderer.invoke('share:publishLoggingConfig', options)
  },

  // Logging backend (local vs dedicated)
  logs: {
    query: (filters) => ipcRenderer.invoke('logs:query', filters),
    recent: (count) => ipcRenderer.invoke('logs:recent', count),
    statsSummary: (win) => ipcRenderer.invoke('logs:statsSummary', win),
    equipos: (search) => ipcRenderer.invoke('logs:equipos', search),
    status: () => ipcRenderer.invoke('logs:status'),
    reload: () => ipcRenderer.invoke('logs:reload'),
    useLocal: () => ipcRenderer.invoke('logs:useLocal')
  },

  // TLS cert inspection / install into Windows user trust store
  cert: {
    inspect: (baseUrl) => ipcRenderer.invoke('cert:inspect', baseUrl),
    trust:   (baseUrl) => ipcRenderer.invoke('cert:trust',   baseUrl)
  },

  // Admin API (key/token/share-secret management)
  admin: {
    status: () => ipcRenderer.invoke('admin:status'),
    login:  (payload) => ipcRenderer.invoke('admin:login', payload),
    logout: () => ipcRenderer.invoke('admin:logout'),
    listKeys:           () => ipcRenderer.invoke('admin:listKeys'),
    createKey:          (p) => ipcRenderer.invoke('admin:createKey', p),
    revokeKey:          (id) => ipcRenderer.invoke('admin:revokeKey', id),
    listShareSecrets:   () => ipcRenderer.invoke('admin:listShareSecrets'),
    createShareSecret:  (id) => ipcRenderer.invoke('admin:createShareSecret', id),
    listEnrollTokens:   () => ipcRenderer.invoke('admin:listEnrollTokens'),
    createEnrollToken:  (p) => ipcRenderer.invoke('admin:createEnrollToken', p),
    provisionIngestKey: (name) => ipcRenderer.invoke('admin:provisionIngestKey', name)
  },

  // Config
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (data) => ipcRenderer.invoke('config:set', data),
    selectFolder: () => ipcRenderer.invoke('config:selectFolder'),
    selectFile: (filters) => ipcRenderer.invoke('config:selectFile', filters)
  },

  // Active Directory
  ad: {
    checkRSAT: () => ipcRenderer.invoke('ad:checkRSAT'),
    testADConnection: () => ipcRenderer.invoke('ad:testADConnection'),
    getOUs: (ignoreBaseOU = false) => ipcRenderer.invoke('ad:getOUs', ignoreBaseOU),
    getGPOs: () => ipcRenderer.invoke('ad:getGPOs'),
    getGPOLinkCounts: () => ipcRenderer.invoke('ad:getGPOLinkCounts'),
    createGPO: (name, path, ouDN) => ipcRenderer.invoke('ad:createGPO', name, path, ouDN),
    linkGPOtoOU: (gpoName, ouDN) => ipcRenderer.invoke('ad:linkGPOtoOU', gpoName, ouDN),
    bulkLinkGPO: (gpoName, ouDNs) => ipcRenderer.invoke('ad:bulkLinkGPO', gpoName, ouDNs),
    deleteGPO: (gpoName) => ipcRenderer.invoke('ad:deleteGPO', gpoName),
    unlinkGPOfromOU: (gpoName, ouDN) => ipcRenderer.invoke('ad:unlinkGPOfromOU', gpoName, ouDN),
    removeGPOStartupScript: (gpoName) => ipcRenderer.invoke('ad:removeGPOStartupScript', gpoName),
    checkGPOConflicts: (ouDN) => ipcRenderer.invoke('ad:checkGPOConflicts', ouDN),
    checkGPOExists: (gpoName) => ipcRenderer.invoke('ad:checkGPOExists', gpoName),
    getManagedGPOLinks: (gpoNames, ouDNs = []) => ipcRenderer.invoke('ad:getManagedGPOLinks', gpoNames, ouDNs)
  },

  // Apps
  apps: {
    getAll: () => ipcRenderer.invoke('apps:getAll'),
    get: (id) => ipcRenderer.invoke('apps:get', id),
    create: (data) => ipcRenderer.invoke('apps:create', data),
    update: (id, data) => ipcRenderer.invoke('apps:update', id, data),
    delete: (id, deleteFiles) => ipcRenderer.invoke('apps:delete', id, deleteFiles),
    bulkAssignGPO: (ids, gpoName) => ipcRenderer.invoke('apps:bulkAssignGPO', ids, gpoName),
    applyAssignmentPlan: (plan, allVisibleOUs = []) => ipcRenderer.invoke('apps:applyAssignmentPlan', plan, allVisibleOUs),
    reconcileManagedAssignments: (ouDNs = []) => ipcRenderer.invoke('apps:reconcileManagedAssignments', ouDNs),
    getInstallerVersion: (filePath) => ipcRenderer.invoke('apps:getInstallerVersion', filePath),
    computeHash: (filePath) => ipcRenderer.invoke('apps:computeHash', filePath),
    detectInstallerSignature: (filePath) => ipcRenderer.invoke('apps:detectInstallerSignature', filePath)
  },

  // Scripts
  scripts: {
    generate: (appConfig) => ipcRenderer.invoke('scripts:generate', appConfig),
    deploy: (appConfig) => ipcRenderer.invoke('scripts:deploy', appConfig),
    regenerate: (appConfig) => ipcRenderer.invoke('scripts:regenerate', appConfig),
    generateUninstall: (appConfig) => ipcRenderer.invoke('scripts:generateUninstall', appConfig),
    deployUninstall: (appConfig) => ipcRenderer.invoke('scripts:deployUninstall', appConfig),
    getTemplates: () => ipcRenderer.invoke('scripts:getTemplates')
  },

  scriptUpdates: {
    getStatus: () => ipcRenderer.invoke('scriptUpdates:getStatus')
  },

  templates: {
    getAll: () => ipcRenderer.invoke('templates:getAll'),
    get: (id) => ipcRenderer.invoke('templates:get', id),
    create: (data) => ipcRenderer.invoke('templates:create', data),
    update: (id, data) => ipcRenderer.invoke('templates:update', id, data),
    delete: (id) => ipcRenderer.invoke('templates:delete', id),
    saveInstaller: (templateId, localPath) => ipcRenderer.invoke('templates:saveInstaller', templateId, localPath),
    deleteInstaller: (templateId) => ipcRenderer.invoke('templates:deleteInstaller', templateId)
  },

  // Files
  files: {
    listDeployed: () => ipcRenderer.invoke('files:listDeployed'),
    getContents: (name) => ipcRenderer.invoke('files:getContents', name),
    createFolder: (name) => ipcRenderer.invoke('files:createFolder', name)
  },

  // Bundles
  bundles: {
    getAll: () => ipcRenderer.invoke('bundles:getAll'),
    get: (id) => ipcRenderer.invoke('bundles:get', id),
    create: (data) => ipcRenderer.invoke('bundles:create', data),
    update: (id, data) => ipcRenderer.invoke('bundles:update', id, data),
    delete: (id) => ipcRenderer.invoke('bundles:delete', id),
    deploy: (id) => ipcRenderer.invoke('bundles:deploy', id),
    deployUninstall: (id) => ipcRenderer.invoke('bundles:deployUninstall', id),
    generateScript: (id) => ipcRenderer.invoke('bundles:generateScript', id),
    generateUninstallScript: (id) => ipcRenderer.invoke('bundles:generateUninstallScript', id)
  },

  // Activity Log
  activity: {
    getRecent: (count) => ipcRenderer.invoke('activity:getRecent', count),
    add: (action, details) => ipcRenderer.invoke('activity:add', action, details)
  },

  // Export / Import
  exportAll: () => ipcRenderer.invoke('apps:exportAll'),
  importAll: (data) => ipcRenderer.invoke('apps:importAll', data),
  saveFile: (content, name) => ipcRenderer.invoke('config:saveFile', content, name),
  loadFile: () => ipcRenderer.invoke('config:loadFile'),

  // I18n
  i18n: {
    getAvailable: () => ipcRenderer.invoke('i18n:getAvailable'),
    getTranslations: (langCode) => ipcRenderer.invoke('i18n:getTranslations', langCode)
  },

  updates: {
    getCurrent: () => ipcRenderer.invoke('updates:getCurrent'),
    check: () => ipcRenderer.invoke('updates:check'),
    openReleasePage: () => ipcRenderer.invoke('updates:openReleasePage')
  },

  // Catalog service (used by catalog page and apps wizard)
  catalog: {
    getCatalog: () => ipcRenderer.invoke('catalog:getCatalog'),
    search: (query, category) => ipcRenderer.invoke('catalog:search', query, category),
    searchCLI: (query) => ipcRenderer.invoke('catalog:searchCLI', query),
    checkVersions: (ids) => ipcRenderer.invoke('catalog:checkVersions', ids),
    checkSingle: (wingetId, wingetSource, name) => ipcRenderer.invoke('catalog:checkSingle', wingetId, wingetSource, name),
    resolvePackage: (reference) => ipcRenderer.invoke('catalog:resolvePackage', reference)
  }
});
