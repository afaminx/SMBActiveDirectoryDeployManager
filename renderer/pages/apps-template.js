// =============================================================
// renderer/pages/apps-template.js — Gestor de plantillas
// =============================================================
// Depende de: AppUtils, AppsPage coordinator
// Expone: window.AppsTemplateModule
// =============================================================

const AppsTemplateModule = {

  describeTemplateFile(fileField) {
    const parts = [];
    if (AppUtils.isInstallerTemplateFile(fileField)) {
      parts.push(t('apps.customTemplateFileTypeInstaller', 'Instalador adjunto'));
    }
    const extensions = Array.isArray(fileField?.extensions) ? fileField.extensions : [];
    if (extensions.length > 0) {
      parts.push(t('apps.customTemplateExtensions', 'Extensiones') + ': ' + extensions.join(', '));
    }
    if (fileField?.argumentName) {
      parts.push(t('apps.customTemplateArgLabel', 'Argumento') + ': ' + fileField.argumentName);
    }
    if (fileField?.destinationName) {
      parts.push(t('apps.customTemplateTargetName', 'Destino') + ': ' + fileField.destinationName);
    }
    return parts.join(' | ') || t('apps.customTemplateConfigFile', 'Archivo de configuración auxiliar');
  },

  isXmlTemplateFile(fileField) {
    const extensions = Array.isArray(fileField?.extensions) ? fileField.extensions : [];
    return extensions.some(item => String(item || '').trim().toLowerCase() === 'xml');
  },

  normalizeTemplateViewFileFields(definition) {
    const fileFields = (definition?.files || []).map(field => ({
      key: field.key,
      label: field.label,
      hint: field.hint || '',
      storageKind: field.storageKind === 'installer' ? 'installer' : 'file',
      required: field.required === true,
      extensions: Array.isArray(field.extensions)
        ? field.extensions
        : (typeof field.extensions === 'string'
            ? field.extensions.split(/[\s,;]+/).map(item => item.replace(/^\./, '').trim().toLowerCase()).filter(Boolean)
            : ['*']),
      destinationName: field.destinationName || '',
      argumentName: field.argumentName || '',
      joiner: field.joiner === 'space' ? 'space' : '=',
      quoteValue: field.quoteValue !== false
    }));

    const needsLegacyXml = definition?.requiresConfigXml === true && !fileFields.some(field => this.isXmlTemplateFile(field));
    if (needsLegacyXml) {
      let key = 'config_xml';
      const usedKeys = new Set(fileFields.map(field => field.key));
      let counter = 2;
      while (usedKeys.has(key)) {
        key = `config_xml_${counter++}`;
      }
      fileFields.push({
        key,
        label: t('apps.customTemplateXmlLabel', 'Archivo XML'),
        hint: t('apps.customTemplateXmlHint', 'XML solicitado por la plantilla. Se copiará al caché del equipo cliente y el script podrá usar $ConfigXmlPath.'),
        storageKind: 'file',
        required: true,
        extensions: ['xml'],
        destinationName: 'config.xml',
        argumentName: '',
        joiner: '=',
        quoteValue: true
      });
    }

    return fileFields;
  },

  reconcileLegacyTemplateXmlSelection(templateView, templateFiles, configXmlPath) {
    const normalizedTemplateFiles = templateFiles && typeof templateFiles === 'object'
      ? { ...templateFiles }
      : {};
    const legacyXmlPath = String(configXmlPath || '').trim();

    if (!templateView?.isUserDefined || !legacyXmlPath) {
      return { templateFiles: normalizedTemplateFiles, configXmlPath };
    }

    const xmlField = (templateView.fileFields || []).find(field => this.isXmlTemplateFile(field));
    if (!xmlField?.key) {
      return { templateFiles: normalizedTemplateFiles, configXmlPath };
    }

    const currentValue = normalizedTemplateFiles[xmlField.key];
    const currentPath = typeof currentValue === 'object' ? currentValue?.sourcePath : currentValue;
    if (!String(currentPath || '').trim()) {
      normalizedTemplateFiles[xmlField.key] = { sourcePath: legacyXmlPath };
    }

    return {
      templateFiles: normalizedTemplateFiles,
      configXmlPath: ''
    };
  },

  async fetchTemplateDefinition(templateId) {
    if (!templateId) return null;
    try {
      const template = await window.api.templates.get(templateId);
      return template && template.kind === 'user-template' ? template : null;
    } catch {
      return null;
    }
  },

  buildTemplateViewFromDefinition(templateId, definition) {
    if (!definition || definition.kind !== 'user-template') return null;
    return {
      id: templateId || definition.id,
      category: definition.category || 'Custom',
      name: definition.name,
      description: definition.description || t('apps.customTemplateDefaultDesc', 'Plantilla definida por el administrador'),
      noInstaller: false,
      source: 'user',
      isUserDefined: true,
      fields: (definition.arguments || []).map(field => ({
        key: field.key,
        label: field.label,
        default: field.defaultValue || '',
        hint: field.hint || '',
        required: field.required === true
      })),
      fileFields: this.normalizeTemplateViewFileFields(definition),
      hasCustomScript: !!definition.script
    };
  },

  createEmptyTemplateDraft() {
    return {
      name: '',
      description: '',
      arguments: [{
        label: '',
        token: '',
        joiner: '=',
        quoteValue: true,
        required: false,
        hint: '',
        defaultValue: ''
      }],
      files: [],
      script: ''
    };
  },

  cloneTemplateDraft(template) {
    if (!template) return this.createEmptyTemplateDraft();
    return {
      id: template.id,
      name: template.name || '',
      description: template.description || '',
      arguments: Array.isArray(template.arguments) && template.arguments.length > 0
        ? template.arguments.map(item => ({
            label: item.label || '',
            token: item.token || '',
            joiner: item.joiner === 'space' ? 'space' : '=',
            quoteValue: item.quoteValue !== false,
            required: item.required === true,
            hint: item.hint || '',
            defaultValue: item.defaultValue || ''
          }))
        : [{
            label: '',
            token: '',
            joiner: '=',
            quoteValue: true,
            required: false,
            hint: '',
            defaultValue: ''
          }],
      files: Array.isArray(template.files)
        ? template.files.map(item => ({
            label: item.label || '',
            storageKind: item.storageKind === 'installer' ? 'installer' : 'file',
            argumentName: item.argumentName || '',
            joiner: item.joiner === 'space' ? 'space' : '=',
            quoteValue: item.quoteValue !== false,
            required: item.required === true,
            hint: item.hint || '',
            destinationName: item.destinationName || '',
            extensions: Array.isArray(item.extensions) ? item.extensions.join(',') : ''
          }))
        : [],
      script: template.script || ''
    };
  },

  readTemplateDraftFromDom(state) {
    const current = state?.draft ? this.cloneTemplateDraft(state.draft) : this.createEmptyTemplateDraft();
    const nameInput = document.getElementById('tmpl-name');
    const descInput = document.getElementById('tmpl-description');
    const scriptInput = document.getElementById('tmpl-script');

    if (nameInput) current.name = nameInput.value;
    if (descInput) current.description = descInput.value;
    if (scriptInput) current.script = scriptInput.value;

    const argRows = [...document.querySelectorAll('.tmpl-arg-row')];
    current.arguments = argRows.map(row => ({
      label: row.querySelector('[data-field="label"]')?.value || '',
      token: row.querySelector('[data-field="token"]')?.value || '',
      joiner: row.querySelector('[data-field="joiner"]')?.value === 'space' ? 'space' : '=',
      quoteValue: row.querySelector('[data-field="quote"]')?.checked ?? true,
      required: row.querySelector('[data-field="required"]')?.checked ?? false,
      hint: row.querySelector('[data-field="hint"]')?.value || '',
      defaultValue: row.querySelector('[data-field="default"]')?.value || ''
    }));

    const fileRows = [...document.querySelectorAll('.tmpl-file-row')];
    current.files = fileRows.map(row => ({
      label: row.querySelector('[data-field="label"]')?.value || '',
      storageKind: row.querySelector('[data-field="storageKind"]')?.value === 'installer' ? 'installer' : 'file',
      argumentName: row.querySelector('[data-field="argument"]')?.value || '',
      joiner: row.querySelector('[data-field="joiner"]')?.value === 'space' ? 'space' : '=',
      quoteValue: row.querySelector('[data-field="quote"]')?.checked ?? true,
      required: row.querySelector('[data-field="required"]')?.checked ?? false,
      hint: row.querySelector('[data-field="hint"]')?.value || '',
      destinationName: row.querySelector('[data-field="destination"]')?.value || '',
      extensions: row.querySelector('[data-field="extensions"]')?.value || ''
    }));

    return current;
  },

  getTemplateArgPreview(arg = {}) {
    const token = String(arg.token || 'ARGUMENT').trim() || 'ARGUMENT';
    const separator = arg.joiner === 'space' ? ' ' : '=';
    const value = arg.quoteValue === false ? 'VALOR' : '"VALOR"';
    return `${token}${separator}${value}`;
  },

  getTemplateFilePreview(file = {}) {
    if (!file.argumentName) return AppUtils.isInstallerTemplateFile(file) ? 'setup_auxiliar.exe' : 'archivo.xml';
    const separator = file.joiner === 'space' ? ' ' : '=';
    const sampleName = AppUtils.isInstallerTemplateFile(file) ? 'setup_auxiliar.exe' : 'archivo.xml';
    const value = file.quoteValue === false ? sampleName : `"${sampleName}"`;
    return `${file.argumentName}${separator}${value}`;
  },

  refreshTemplateDraftPreview() {
    document.querySelectorAll('.tmpl-arg-row').forEach(row => {
      const preview = row.querySelector('.tmpl-arg-preview');
      if (!preview) return;
      const token = row.querySelector('[data-field="token"]')?.value || '';
      const joiner = row.querySelector('[data-field="joiner"]')?.value === 'space' ? 'space' : '=';
      const quoteValue = row.querySelector('[data-field="quote"]')?.checked ?? true;
      preview.textContent = this.getTemplateArgPreview({ token, joiner, quoteValue });
    });

    document.querySelectorAll('.tmpl-file-row').forEach(row => {
      const preview = row.querySelector('.tmpl-file-preview');
      if (!preview) return;
      const argumentName = row.querySelector('[data-field="argument"]')?.value || '';
      const joiner = row.querySelector('[data-field="joiner"]')?.value === 'space' ? 'space' : '=';
      const quoteValue = row.querySelector('[data-field="quote"]')?.checked ?? true;
      const storageKind = row.querySelector('[data-field="storageKind"]')?.value === 'installer' ? 'installer' : 'file';
      preview.textContent = this.getTemplateFilePreview({ argumentName, joiner, quoteValue, storageKind });
    });
  },

  buildTemplateManagerRestoreState(extra = {}) {
    const modalBody = document.getElementById('modal-body');
    return {
      scrollTop: modalBody ? modalBody.scrollTop : 0,
      ...extra
    };
  },

  restoreTemplateManagerAfterRender(state) {
    const restore = state?.templateManagerRestore || null;
    const shouldFocusName = state?.focusTemplateNameOnRender === true;
    state.templateManagerRestore = null;
    state.focusTemplateNameOnRender = false;

    if (!restore && !shouldFocusName) return;

    requestAnimationFrame(() => {
      const modalBody = document.getElementById('modal-body');
      if (modalBody && restore && Number.isFinite(restore.scrollTop)) {
        modalBody.scrollTop = restore.scrollTop;
      }

      if (restore?.anchorSelector) {
        const anchor = document.querySelector(restore.anchorSelector);
        if (anchor) {
          anchor.scrollIntoView({ block: restore.block || 'nearest', inline: 'nearest' });
        }
      }

      const focusTarget = restore?.focusSelector ? document.querySelector(restore.focusSelector) : null;
      if (focusTarget && typeof focusTarget.focus === 'function') {
        focusTarget.focus({ preventScroll: true });
        if (restore.selectText && typeof focusTarget.select === 'function') {
          focusTarget.select();
        }
        return;
      }

      if (shouldFocusName) {
        document.getElementById('tmpl-name')?.focus({ preventScroll: true });
      }
    });
  },

  rerenderTemplateManager(state, onClose, restore = {}) {
    state.templateManagerRestore = this.buildTemplateManagerRestoreState(restore);
    this.renderTemplateManager(state, onClose);
  },

  getConfiguredTemplateInstallerPath(state) {
    const activeTemplateId = state?.selectedBuiltIn || state?.selectedId || null;
    return activeTemplateId ? (state?.templateInstallers?.[activeTemplateId] || '') : '';
  },

  getPendingTemplateInstallerPath(state) {
    const activeTemplateId = state?.selectedBuiltIn || state?.selectedId || null;
    if (activeTemplateId) {
      return state?.pendingTemplateInstallers?.[activeTemplateId] || '';
    }
    return state?.pendingNewInstallerPath || '';
  },

  setPendingTemplateInstallerPath(state, localPath) {
    const normalizedPath = typeof localPath === 'string' ? localPath.trim() : '';
    const activeTemplateId = state?.selectedBuiltIn || state?.selectedId || null;
    if (activeTemplateId) {
      state.pendingTemplateInstallers = { ...(state.pendingTemplateInstallers || {}) };
      if (normalizedPath) {
        state.pendingTemplateInstallers[activeTemplateId] = normalizedPath;
      } else {
        delete state.pendingTemplateInstallers[activeTemplateId];
      }
      return;
    }
    state.pendingNewInstallerPath = normalizedPath;
  },

  clearPendingTemplateInstallerPath(state) {
    this.setPendingTemplateInstallerPath(state, '');
  },

  renderTemplateManager(state, onClose) {
    const draft = state.draft || this.createEmptyTemplateDraft();
    const templates = Array.isArray(state.templates) ? state.templates : [];
    const builtInTemplates = Array.isArray(state.builtInTemplates) ? state.builtInTemplates : [];
    const templateInstallers = state.templateInstallers || {};
    const deleteUsageCount = Number.isFinite(state.deleteUsageCount) ? state.deleteUsageCount : 0;
    const isSavingTemplate = state.isSavingTemplate === true;
    const activeTemplateId = state.selectedBuiltIn || state.selectedId || null;
    const configuredInstallerPath = this.getConfiguredTemplateInstallerPath(state);
    const pendingInstallerPath = this.getPendingTemplateInstallerPath(state);
    const currentInstallerPath = pendingInstallerPath || configuredInstallerPath;
    const installerFileName = currentInstallerPath ? currentInstallerPath.replace(/.*[\\/]/, '') : '';
    const hasPendingInstaller = !!pendingInstallerPath;
    const installerStatus = state.installerStatus && typeof state.installerStatus.message === 'string'
      ? state.installerStatus
      : null;
    const installerStatusTone = installerStatus?.type === 'error'
      ? 'background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);color:#dc2626;'
      : installerStatus?.type === 'success'
        ? 'background:rgba(34,197,94,0.1);border:1px solid rgba(34,197,94,0.3);color:#16a34a;'
        : 'background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.3);color:var(--text-primary);';
    const installerBadgeTone = hasPendingInstaller
      ? 'background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.35);color:var(--accent-info);'
      : 'background:rgba(34,197,94,0.12);border:1px solid rgba(34,197,94,0.35);color:#16a34a;';

    const builtInListHtml = builtInTemplates.map(tmpl => {
      const hasInstaller = !!templateInstallers[tmpl.id];
      const isActive = state.selectedBuiltIn === tmpl.id;
      return `
        <button class="template-manager-item ${isActive ? 'active' : ''}" type="button" data-builtin-id="${App._esc(tmpl.id)}">
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="font-size:14px;">${AppUtils.templateIcon(tmpl.id)}</span>
            <div style="font-weight:600;color:var(--text-primary);font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${App._esc(tmpl.name)}</div>
            ${hasInstaller ? `<span style="font-size:9px;background:rgba(34,197,94,.15);color:var(--accent-success,#22c55e);padding:1px 5px;border-radius:3px;flex-shrink:0;">&#10003;</span>` : ''}
          </div>
        </button>`;
    }).join('');

    const userListHtml = templates.length > 0
      ? templates.map(template => {
          const hasInstaller = !!templateInstallers[template.id];
          return `
          <button class="template-manager-item ${state.selectedId === template.id ? 'active' : ''}" type="button" data-template-id="${App._esc(template.id)}">
            <div style="display:flex;align-items:center;gap:6px;">
              <div style="font-weight:600;color:var(--text-primary);font-size:13px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${App._esc(template.name)}</div>
              ${hasInstaller ? `<span style="font-size:9px;background:rgba(34,197,94,.15);color:var(--accent-success,#22c55e);padding:1px 5px;border-radius:3px;flex-shrink:0;">&#10003;</span>` : ''}
            </div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:3px;">${App._esc(template.description || t('apps.customTemplateDefaultDesc', 'Plantilla definida por el administrador'))}</div>
          </button>`;
        }).join('')
      : `<div style="padding:14px;border:1px dashed var(--border-color);border-radius:8px;color:var(--text-muted);font-size:12px;">${t('apps.customTemplatesEmpty', 'Todavía no hay plantillas personalizadas.')}</div>`;

    const argumentRows = draft.arguments.map((arg, index) => `
      <div class="tmpl-arg-row" data-index="${index}" style="border:1px solid var(--border-color);border-radius:8px;padding:12px;margin-bottom:10px;background:var(--bg-secondary);">
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">${t('apps.customTemplateFieldLabel', 'Etiqueta')}</label>
            <input class="form-input" data-field="label" value="${App._esc(arg.label)}" placeholder="${t('gui.configurationValue')}">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">${t('apps.customTemplateArgLabel', 'Argumento')}</label>
            <input class="form-input" data-field="token" value="${App._esc(arg.token)}" placeholder="CONFIG_ID">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">${t('apps.customTemplateHintLabel', 'Ayuda')}</label>
            <input class="form-input" data-field="hint" value="${App._esc(arg.hint)}" placeholder="${App._esc(t('apps.customTemplateHintPlaceholder', 'Texto mostrado al operador'))}">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">${t('apps.customTemplateDefaultValue', 'Valor por defecto')}</label>
            <input class="form-input" data-field="default" value="${App._esc(arg.defaultValue)}" placeholder="">
          </div>
        </div>
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:10px;">
          <label class="checkbox-wrapper" style="margin:0;">
            <input type="checkbox" class="checkbox-select" data-field="quote" ${arg.quoteValue !== false ? 'checked' : ''}>
            <span>${t('apps.customTemplateQuoteValue', 'Entrecomillar valor')}</span>
          </label>
          <label class="checkbox-wrapper" style="margin:0;">
            <input type="checkbox" class="checkbox-select" data-field="required" ${arg.required ? 'checked' : ''}>
            <span>${t('apps.customTemplateRequired', 'Obligatorio')}</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;color:var(--text-secondary);font-size:12px;">
            <span>${t('apps.customTemplateJoiner', 'Separador')}</span>
            <select class="form-select" data-field="joiner" style="width:auto;min-width:110px;">
              <option value="=" ${arg.joiner !== 'space' ? 'selected' : ''}>=</option>
              <option value="space" ${arg.joiner === 'space' ? 'selected' : ''}>espacio</option>
            </select>
          </label>
          <button class="btn btn-ghost btn-sm btn-remove-template-arg" type="button" data-index="${index}">${t('common.delete', 'Borrar')}</button>
        </div>
        <div style="margin-top:8px;font-size:11px;color:var(--text-muted);">${t('apps.customTemplateArgExample', 'Resultado')}: <code class="tmpl-arg-preview">${App._esc(this.getTemplateArgPreview(arg))}</code></div>
      </div>
    `).join('');

    const fileRows = draft.files.map((file, index) => `
      <div class="tmpl-file-row" data-index="${index}" style="border:1px solid var(--border-color);border-radius:8px;padding:12px;margin-bottom:10px;background:var(--bg-secondary);">
        <div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;">
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">${t('apps.customTemplateFieldLabel', 'Etiqueta')}</label>
            <input class="form-input" data-field="label" value="${App._esc(file.label)}" placeholder="${App._esc(AppUtils.isInstallerTemplateFile(file) ? t('gui.additionalInstaller') : t('gui.configurationFile'))}">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">${t('apps.customTemplateExtensions', 'Extensiones')}</label>
            <input class="form-input" data-field="extensions" value="${App._esc(file.extensions)}" placeholder="${App._esc(AppUtils.isInstallerTemplateFile(file) ? 'exe,msi,ps1' : 'xml,json')}">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">${t('apps.customTemplateFileType', 'Tipo')}</label>
            <select class="form-select" data-field="storageKind">
              <option value="file" selected>${t('apps.customTemplateFileTypeFile', 'Archivo auxiliar')}</option>
            </select>
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">${t('apps.customTemplateInstallArg', 'Argumento de instalación')}</label>
            <input class="form-input" data-field="argument" value="${App._esc(file.argumentName)}" placeholder="/configure">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">${t('apps.customTemplateTargetName', 'Nombre destino')}</label>
            <input class="form-input" data-field="destination" value="${App._esc(file.destinationName)}" placeholder="${App._esc(AppUtils.isInstallerTemplateFile(file) ? 'helper_setup.exe' : 'config_app.xml')}">
          </div>
          <div class="form-group" style="margin-bottom:0;grid-column:1 / -1;">
            <label class="form-label">${t('apps.customTemplateHintLabel', 'Ayuda')}</label>
            <input class="form-input" data-field="hint" value="${App._esc(file.hint)}" placeholder="${App._esc(AppUtils.isInstallerTemplateFile(file)
              ? t('apps.customTemplateInstallerHintPlaceholder', 'Ejemplo: instalador auxiliar que se copiará al share sin sustituir al principal')
              : t('apps.customTemplateFileHintPlaceholder', 'Ejemplo: XML o CFG exportado desde la herramienta original'))}">
          </div>
        </div>
        <div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:10px;">
          <label class="checkbox-wrapper" style="margin:0;">
            <input type="checkbox" class="checkbox-select" data-field="quote" ${file.quoteValue !== false ? 'checked' : ''}>
            <span>${t('apps.customTemplateQuotePath', 'Entrecomillar ruta')}</span>
          </label>
          <label class="checkbox-wrapper" style="margin:0;">
            <input type="checkbox" class="checkbox-select" data-field="required" ${file.required ? 'checked' : ''}>
            <span>${t('apps.customTemplateRequired', 'Obligatorio')}</span>
          </label>
          <label style="display:flex;align-items:center;gap:8px;color:var(--text-secondary);font-size:12px;">
            <span>${t('apps.customTemplateJoiner', 'Separador')}</span>
            <select class="form-select" data-field="joiner" style="width:auto;min-width:110px;">
              <option value="=" ${file.joiner !== 'space' ? 'selected' : ''}>=</option>
              <option value="space" ${file.joiner === 'space' ? 'selected' : ''}>espacio</option>
            </select>
          </label>
          <button class="btn btn-ghost btn-sm btn-remove-template-file" type="button" data-index="${index}">${t('common.delete', 'Borrar')}</button>
        </div>
        <div style="margin-top:8px;font-size:11px;color:var(--text-muted);">${AppUtils.isInstallerTemplateFile(file)
          ? t('apps.customTemplateInstallerExample', 'El instalador adjunto se copiará al share en una carpeta separada y el script recibirá su ruta en caché en el equipo cliente.')
          : t('apps.customTemplateFileExample', 'Si defines un argumento, recibirá la ruta en caché del archivo en el equipo cliente.')}: <code class="tmpl-file-preview">${App._esc(this.getTemplateFilePreview(file))}</code></div>
      </div>
    `).join('');

    const deletePanel = state.deleteConfirm && state.selectedId ? `
      <div class="card template-builder-section" style="border-color:rgba(220,38,38,0.28);background:rgba(220,38,38,0.08);">
        <div style="font-weight:700;color:var(--text-primary);margin-bottom:8px;">${t('apps.customTemplateDeleteTitle', 'Borrar plantilla')}</div>
        <p class="form-hint" style="margin:0 0 10px 0;color:var(--text-secondary);">
          ${t('apps.customTemplateDeleteConfirm', '¿Seguro que quieres borrar esta plantilla personalizada?')}
        </p>
        ${deleteUsageCount > 0 ? `<p class="form-hint" style="margin:0 0 12px 0;color:var(--accent-warning);">${t('apps.customTemplateDeleteWarning', 'Hay apps usando esta plantilla:')} ${deleteUsageCount}. ${t('apps.customTemplateDeleteSnapshotHint', 'Las apps ya creadas conservarán su configuración guardada, pero la plantilla dejará de estar disponible para nuevas apps.')}</p>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          <button class="btn btn-secondary" type="button" id="btn-cancel-delete-template">${t('common.cancel', 'Cancelar')}</button>
          <button class="btn btn-danger" type="button" id="btn-confirm-delete-template">${t('apps.customTemplateDeleteAction', 'Eliminar plantilla')}</button>
        </div>
      </div>
    ` : '';

    // Shared installer config panel
    const installerPanel = `
      <div class="card template-builder-section" style="border-color:rgba(30,144,255,0.25);background:rgba(30,144,255,0.04);">
        <div style="font-weight:700;color:var(--text-primary);margin-bottom:6px;">${t('gui.preconfiguredInstaller')}</div>
        <p class="form-hint" style="margin:0 0 10px 0;">${t('gui.attachAnInstallerHereToSelectItAutomatically')}</p>
        ${currentInstallerPath ? `<div style="display:inline-flex;align-items:center;gap:6px;${installerBadgeTone}border-radius:6px;padding:4px 10px;margin-bottom:10px;font-size:12px;max-width:100%;overflow:hidden;">
          <span style="flex-shrink:0;">${hasPendingInstaller ? '&#8599;' : '&#10003;'}</span>
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:monospace;" title="${App._esc(currentInstallerPath)}">${App._esc(installerFileName)}</span>
        </div>` : ''}
        <div style="display:flex;gap:8px;align-items:center;">
          <input class="form-input" id="tmpl-installer-path" value="${App._esc(currentInstallerPath)}" placeholder="${t('gui.noPreconfiguredInstaller')}" readonly style="flex:1;font-family:monospace;font-size:12px;">
          <button class="btn btn-secondary btn-sm" type="button" id="btn-browse-tmpl-installer" ${isSavingTemplate ? 'disabled' : ''}>${t('gui.select2')}</button>
          ${currentInstallerPath ? `<button class="btn btn-ghost btn-sm" type="button" id="btn-clear-tmpl-installer" ${isSavingTemplate ? 'disabled' : ''}>&times;</button>` : ''}
        </div>
        <div id="tmpl-installer-status" style="display:${installerStatus ? 'block' : 'none'};margin-top:10px;padding:8px 12px;border-radius:6px;font-size:13px;${installerStatusTone}">${installerStatus ? App._esc(installerStatus.message) : ''}</div>
      </div>`;

    // Built-in template view (read-only, just installer config)
    const selectedBuiltInInfo = state.selectedBuiltIn ? builtInTemplates.find(t => t.id === state.selectedBuiltIn) : null;
    const builtInView = selectedBuiltInInfo ? `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;padding:12px;background:var(--bg-secondary);border-radius:8px;border:1px solid var(--border-color);">
        <span style="font-size:32px;">${AppUtils.templateIcon(selectedBuiltInInfo.id)}</span>
        <div>
          <div style="font-size:16px;font-weight:700;color:var(--text-primary);">${App._esc(selectedBuiltInInfo.name)}</div>
          <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">${App._esc(selectedBuiltInInfo.description || '')}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:4px;opacity:.7;">${t('gui.systemTemplateReadOnly')}</div>
        </div>
      </div>
      ${installerPanel}
    ` : '';

    const body = `
      <div class="template-manager-shell">
        <div class="template-manager-sidebar">
          ${builtInTemplates.length > 0 ? `
            <button type="button" id="btn-toggle-system-section" style="display:flex;align-items:center;justify-content:space-between;width:100%;background:none;border:none;cursor:pointer;padding:4px 4px 6px;margin-bottom:2px;" ${isSavingTemplate ? 'disabled' : ''}>
              <span style="font-size:10px;text-transform:uppercase;color:var(--text-muted);letter-spacing:.06em;font-weight:600;">Sistema</span>
              <svg id="icon-system-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="color:var(--text-muted);transform:${state.systemExpanded ? 'rotate(180deg)' : 'rotate(0deg)'};transition:transform .2s;"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div id="system-section-list" style="display:${state.systemExpanded ? 'block' : 'none'};">
              ${builtInListHtml}
            </div>
            <div style="height:1px;background:var(--border-color);margin:8px 0;"></div>
          ` : ''}
          <div style="font-size:10px;text-transform:uppercase;color:var(--text-muted);letter-spacing:.06em;padding:4px 4px 6px;font-weight:600;">Personalizadas</div>
          <button class="btn btn-primary" type="button" id="btn-new-template" style="width:100%;margin-bottom:8px;" ${isSavingTemplate ? 'disabled' : ''}>${t('apps.newCustomTemplate', 'Nueva plantilla')}</button>
          ${userListHtml}
        </div>
        <div class="template-manager-main">
          ${state.selectedBuiltIn ? builtInView : `
          ${deletePanel}
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">${t('apps.customTemplateName', 'Nombre de la plantilla')}</label>
            <input class="form-input" id="tmpl-name" value="${App._esc(draft.name)}" placeholder="${t('gui.customTemplate')}">
          </div>
          <div class="form-group" style="margin-bottom:0;">
            <label class="form-label">${t('apps.customTemplateDescription', 'Descripción')}</label>
            <textarea class="form-input" id="tmpl-description" rows="2" placeholder="${App._esc(t('apps.customTemplateDescriptionPlaceholder', 'Explica qué hace esta plantilla y qué espera del operador.'))}">${App._esc(draft.description)}</textarea>
          </div>
          ${installerPanel}
          <div class="card template-builder-section">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;">
              <div style="font-weight:700;color:var(--text-primary);">${t('apps.customTemplateArgsTitle', 'Argumentos')}</div>
              <button class="btn btn-secondary btn-sm" type="button" id="btn-add-template-arg" ${isSavingTemplate ? 'disabled' : ''}>${t('apps.customTemplateAddArg', 'Añadir argumento')}</button>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">${t('apps.customTemplateArgsHint', 'Cada argumento crea un campo de texto en la app y se traduce a `ARGUMENTO=\"valor\"` o `ARGUMENTO valor`.')}</div>
            ${argumentRows || `<div style="color:var(--text-muted);font-size:12px;">${t('apps.customTemplateArgsEmpty', 'No hay argumentos definidos.')}</div>`}
          </div>
          <div class="card template-builder-section">
            <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:10px;">
              <div style="font-weight:700;color:var(--text-primary);">${t('apps.customTemplateFilesTitle', 'Archivos auxiliares')}</div>
              <button class="btn btn-secondary btn-sm" type="button" id="btn-add-template-file" ${isSavingTemplate ? 'disabled' : ''}>${t('apps.customTemplateAddFile', 'Añadir archivo')}</button>
            </div>
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">${t('apps.customTemplateFilesHint', 'Sirve para XML, CFG, JSON o instaladores adjuntos. Si añades aquí un XML, se pedirá al crear la app y el script podrá usar $ConfigXmlPath. Los instaladores adjuntos se guardan en el share sin sustituir al instalador principal. Si defines un argumento de instalación, se pasará la ruta del archivo copiado al caché de despliegue.')}</div>
            ${fileRows || `<div style="color:var(--text-muted);font-size:12px;">${t('apps.customTemplateFilesEmpty', 'No hay archivos definidos.')}</div>`}
          </div>
          <div class="card template-builder-section">
            <div style="font-weight:700;color:var(--text-primary);margin-bottom:10px;">${t('apps.customTemplateScriptTitle', 'Script opcional post-instalación')}</div>
            <textarea class="form-input" id="tmpl-script" rows="8" style="font-family:monospace;" placeholder="${App._esc(t('apps.customTemplateScriptPlaceholder', 'Ejemplo:\nWrite-Host "Configuración adicional aplicada"'))}">${App._esc(draft.script)}</textarea>
            <p class="form-hint" style="margin-top:8px;">${t('apps.customTemplateScriptHint', 'Variables disponibles: $TemplateValues.<clave>, $TemplateFiles.<clave>, $TemplateFileNames.<clave>, $ConfigXmlPath (si la plantilla incluye un XML), $Instalador y $CacheDir. Este script se ejecuta después del instalador.')}</p>
          </div>
          `}
        </div>
      </div>
    `;

    const footer = `
      <button class="btn btn-secondary" type="button" id="btn-close-template-manager" ${isSavingTemplate ? 'disabled' : ''}>${t('common.close', 'Cerrar')}</button>
      <div style="flex:1"></div>
      ${!state.selectedBuiltIn && state.selectedId ? `<button class="btn btn-danger" type="button" id="btn-delete-template" ${isSavingTemplate ? 'disabled' : ''}>${t('common.delete', 'Borrar')}</button>` : ''}
      ${!state.selectedBuiltIn ? `<button class="btn btn-success" type="button" id="btn-save-template" ${isSavingTemplate ? 'disabled' : ''}>${isSavingTemplate ? t('gui.saving') : t('common.save', 'Guardar')}</button>` : ''}
      ${state.selectedBuiltIn ? `<button class="btn ${state.installerSaved ? 'btn-secondary' : 'btn-success'}" type="button" id="btn-save-tmpl-installer" ${isSavingTemplate ? 'disabled' : ''}>${isSavingTemplate ? t('gui.saving') : (state.installerSaved ? t('common.close', 'Cerrar') : t('gui.saveInstaller'))}</button>` : ''}
    `;

    App.openModal(t('apps.manageTemplates', 'Plantillas'), body, footer, { size: 'full' });
    App._modalLocked = isSavingTemplate;
    this.bindTemplateManagerEvents(state, onClose);
    this.restoreTemplateManagerAfterRender(state);
  },

  bindTemplateManagerEvents(state, onClose) {
    document.getElementById('btn-close-template-manager')?.addEventListener('click', async () => {
      if (state.isSavingTemplate) return;
      App.closeModal();
      if (typeof onClose === 'function') await onClose();
    });

    document.getElementById('btn-new-template')?.addEventListener('click', () => {
      state.draft = this.createEmptyTemplateDraft();
      state.selectedId = null;
      state.selectedBuiltIn = null;
      state.deleteConfirm = false;
      state.deleteUsageCount = 0;
      state.pendingNewInstallerPath = '';
      state.installerStatus = null;
      state.isSavingTemplate = false;
      state.installerSaved = false;
      state.focusTemplateNameOnRender = true;
      this.renderTemplateManager(state, onClose);
    });

    // Toggle Sistema section
    document.getElementById('btn-toggle-system-section')?.addEventListener('click', () => {
      state.systemExpanded = !state.systemExpanded;
      const list = document.getElementById('system-section-list');
      const chevron = document.getElementById('icon-system-chevron');
      if (list) list.style.display = state.systemExpanded ? 'block' : 'none';
      if (chevron) chevron.style.transform = state.systemExpanded ? 'rotate(180deg)' : 'rotate(0deg)';
    });

    // Built-in template selection
    document.querySelectorAll('[data-builtin-id]').forEach(item => {
      item.addEventListener('click', () => {
        state.selectedBuiltIn = item.dataset.builtinId;
        state.selectedId = null;
        state.deleteConfirm = false;
        state.installerStatus = null;
        state.isSavingTemplate = false;
        state.installerSaved = false;
        state.focusTemplateNameOnRender = false;
        this.rerenderTemplateManager(state, onClose);
      });
    });

    // User template selection
    document.querySelectorAll('[data-template-id]').forEach(item => {
      item.addEventListener('click', async () => {
        state.draft = this.readTemplateDraftFromDom(state);
        const templateId = item.dataset.templateId;
        const template = state.templates.find(entry => entry.id === templateId);
        state.selectedId = templateId;
        state.selectedBuiltIn = null;
        state.draft = this.cloneTemplateDraft(template);
        state.deleteConfirm = false;
        state.deleteUsageCount = 0;
        state.installerStatus = null;
        state.isSavingTemplate = false;
        state.installerSaved = false;
        state.focusTemplateNameOnRender = false;
        this.rerenderTemplateManager(state, onClose);
      });
    });

    // Browse installer button (for both built-in and user templates)
    document.getElementById('btn-browse-tmpl-installer')?.addEventListener('click', async () => {
      if (state.isSavingTemplate) return;
      const file = await window.api.config.selectFile([{ name: t('gui.installerExeMsi'), extensions: ['exe', 'msi'] }]);
      if (!file) return;
      state.installerSaved = false; // new file selected â€” re-enable save button
      this.setPendingTemplateInstallerPath(state, file);
      state.installerStatus = {
        type: 'info',
        message: state.selectedBuiltIn
          ? t('gui.installerSelectedClickSaveInstallerToUploadIt')
          : t('gui.installerSelectedItWillBeUploadedWhenThe')
      };
      state.focusTemplateNameOnRender = false;
      this.rerenderTemplateManager(state, onClose);
    });

    document.getElementById('btn-clear-tmpl-installer')?.addEventListener('click', async () => {
      if (state.isSavingTemplate) return;
      const activeId = state.selectedBuiltIn || state.selectedId;
      if (this.getPendingTemplateInstallerPath(state)) {
        this.clearPendingTemplateInstallerPath(state);
        state.installerStatus = null;
        state.installerSaved = false;
        state.focusTemplateNameOnRender = false;
        this.rerenderTemplateManager(state, onClose);
        return;
      }
      const configuredInstallerPath = this.getConfiguredTemplateInstallerPath(state).trim();
      if (!activeId || !configuredInstallerPath) return;
      state.isSavingTemplate = true;
      state.installerStatus = {
        type: 'info',
        message: 'Deleting installer from the share...'
      };
      state.focusTemplateNameOnRender = false;
      this.rerenderTemplateManager(state, onClose);
      try {
        const deleteResult = await window.api.templates.deleteInstaller(activeId);
        if (!deleteResult?.success) {
          state.isSavingTemplate = false;
          state.installerStatus = {
            type: 'error',
            message: `Could not delete the installer: ${deleteResult?.error || 'Unknown error'}`
          };
          App.toast(`Error: ${deleteResult?.error || 'Could not delete the installer'}`, 'error');
          this.rerenderTemplateManager(state, onClose);
          return;
        }

        const nextTemplateInstallers = { ...state.templateInstallers };
        delete nextTemplateInstallers[activeId];
        const saveConfigResult = await window.api.config.set({ templateInstallers: nextTemplateInstallers });
        if (saveConfigResult?.success === false) {
          throw new Error(saveConfigResult.error || 'Could not update configuration');
        }

        state.templateInstallers = nextTemplateInstallers;
        state.isSavingTemplate = false;
        state.installerStatus = {
          type: 'success',
          message: 'Preconfigured installer deleted.'
        };
        state.installerSaved = !!state.selectedBuiltIn;
        App.toast('Preconfigured installer deleted.', 'success');
        this.rerenderTemplateManager(state, onClose);
      } catch (err) {
        state.isSavingTemplate = false;
        state.installerStatus = {
          type: 'error',
          message: `Could not delete the installer: ${err?.message || 'Unknown error'}`
        };
        App.toast(`Error: ${err?.message || 'Could not delete the installer'}`, 'error');
        this.rerenderTemplateManager(state, onClose);
      }
    });

    // Save installer for built-in template (also acts as "Cerrar" after a successful save)
    document.getElementById('btn-save-tmpl-installer')?.addEventListener('click', async () => {
      if (state.installerSaved) {
        App.closeModal();
        if (onClose) await onClose();
        return;
      }
      if (state.isSavingTemplate) return;
      const activeId = state.selectedBuiltIn;
      if (!activeId) return;
      const localPath = this.getPendingTemplateInstallerPath(state).trim()
        || document.getElementById('tmpl-installer-path')?.value?.trim()
        || '';
      if (!localPath) {
        App.toast('Select an installer first', 'warning');
        return;
      }
      state.isSavingTemplate = true;
      state.installerStatus = {
        type: 'info',
        message: 'Copying installer to the share. Please wait...'
      };
      state.focusTemplateNameOnRender = false;
      this.rerenderTemplateManager(state, onClose);
      try {
        const result = await window.api.templates.saveInstaller(activeId, localPath);
        if (!result?.success) {
          state.isSavingTemplate = false;
          state.installerStatus = {
            type: 'error',
            message: `Could not copy the installer: ${result?.error || 'Could not copy to the share'}`
          };
          App.toast(`Error: ${result?.error || 'Could not copy to the share'}`, 'error');
          this.rerenderTemplateManager(state, onClose);
          return;
        }
        state.templateInstallers = { ...state.templateInstallers, [activeId]: result.sharePath };
        const saveConfigResult = await window.api.config.set({ templateInstallers: state.templateInstallers });
        if (saveConfigResult?.success === false) {
          throw new Error(saveConfigResult.error || 'Could not update configuration');
        }
        this.clearPendingTemplateInstallerPath(state);
        state.installerSaved = true;
        state.isSavingTemplate = false;
        state.installerStatus = {
          type: 'success',
          message: 'Installer saved to the share.'
        };
        App.toast('Installer saved to the share', 'success');
        state.focusTemplateNameOnRender = false;
        this.rerenderTemplateManager(state, onClose);
      } catch (err) {
        state.isSavingTemplate = false;
        state.installerStatus = {
          type: 'error',
          message: `Could not copy the installer: ${err?.message || 'Could not copy to the share'}`
        };
        App.toast(`Error: ${err?.message || 'Could not copy to the share'}`, 'error');
        this.rerenderTemplateManager(state, onClose);
      }
    });
    document.getElementById('btn-add-template-arg')?.addEventListener('click', () => {
      state.draft = this.readTemplateDraftFromDom(state);
      state.deleteConfirm = false;
      const newIndex = state.draft.arguments.push({
        label: '',
        token: '',
        joiner: '=',
        quoteValue: true,
        required: false,
        hint: '',
        defaultValue: ''
      }) - 1;
      state.focusTemplateNameOnRender = false;
      this.rerenderTemplateManager(state, onClose, {
        anchorSelector: `.tmpl-arg-row[data-index="${newIndex}"]`,
        focusSelector: `.tmpl-arg-row[data-index="${newIndex}"] [data-field="label"]`,
        block: 'nearest'
      });
    });

    document.querySelectorAll('.btn-remove-template-arg').forEach(btn => {
      btn.addEventListener('click', () => {
        state.draft = this.readTemplateDraftFromDom(state);
        state.deleteConfirm = false;
        state.draft.arguments.splice(Number(btn.dataset.index), 1);
        state.focusTemplateNameOnRender = false;
        this.rerenderTemplateManager(state, onClose);
      });
    });

    document.getElementById('btn-add-template-file')?.addEventListener('click', () => {
      state.draft = this.readTemplateDraftFromDom(state);
      state.deleteConfirm = false;
      const newIndex = state.draft.files.push({
        label: '',
        storageKind: 'file',
        argumentName: '',
        joiner: 'space',
        quoteValue: true,
        required: false,
        hint: '',
        destinationName: '',
        extensions: 'xml'
      }) - 1;
      state.focusTemplateNameOnRender = false;
      this.rerenderTemplateManager(state, onClose, {
        anchorSelector: `.tmpl-file-row[data-index="${newIndex}"]`,
        focusSelector: `.tmpl-file-row[data-index="${newIndex}"] [data-field="label"]`,
        block: 'nearest'
      });
    });

    document.querySelectorAll('.btn-remove-template-file').forEach(btn => {
      btn.addEventListener('click', () => {
        state.draft = this.readTemplateDraftFromDom(state);
        state.deleteConfirm = false;
        state.draft.files.splice(Number(btn.dataset.index), 1);
        state.focusTemplateNameOnRender = false;
        this.rerenderTemplateManager(state, onClose);
      });
    });

    document.querySelectorAll('.tmpl-arg-row [data-field="token"], .tmpl-arg-row [data-field="joiner"], .tmpl-arg-row [data-field="quote"]').forEach(input => {
      input.addEventListener('input', () => this.refreshTemplateDraftPreview());
      input.addEventListener('change', () => this.refreshTemplateDraftPreview());
    });

    document.querySelectorAll('.tmpl-file-row [data-field="argument"], .tmpl-file-row [data-field="joiner"], .tmpl-file-row [data-field="quote"]').forEach(input => {
      input.addEventListener('input', () => this.refreshTemplateDraftPreview());
      input.addEventListener('change', () => this.refreshTemplateDraftPreview());
    });

    // storageKind is now always 'file' â€” no change handler needed

    this.refreshTemplateDraftPreview();

    document.getElementById('btn-delete-template')?.addEventListener('click', async () => {
      if (!state.selectedId) return;
      state.draft = this.readTemplateDraftFromDom(state);
      if (state.deleteConfirm) {
        state.deleteConfirm = false;
        state.deleteUsageCount = 0;
        state.focusTemplateNameOnRender = false;
        this.rerenderTemplateManager(state, onClose);
        return;
      }
      const apps = await window.api.apps.getAll().catch(() => []);
      state.deleteUsageCount = apps.filter(app => app.template === state.selectedId).length;
      state.deleteConfirm = true;
      state.focusTemplateNameOnRender = false;
      this.rerenderTemplateManager(state, onClose);
    });

    document.getElementById('btn-cancel-delete-template')?.addEventListener('click', () => {
      state.draft = this.readTemplateDraftFromDom(state);
      state.deleteConfirm = false;
      state.deleteUsageCount = 0;
      state.focusTemplateNameOnRender = false;
      this.rerenderTemplateManager(state, onClose);
    });

    document.getElementById('btn-confirm-delete-template')?.addEventListener('click', async () => {
      if (!state.selectedId) return;
      const result = await window.api.templates.delete(state.selectedId);
      if (!result?.success) {
        App.toast((result?.error || t('common.error', 'Error')), 'error');
        return;
      }

      state.templates = await window.api.templates.getAll();
      state.selectedId = null;
      state.draft = this.createEmptyTemplateDraft();
      state.deleteConfirm = false;
      state.deleteUsageCount = 0;
      state.focusTemplateNameOnRender = true;
      App.toast(t('apps.customTemplateDeleted', 'Plantilla borrada correctamente'), 'success');
      this.renderTemplateManager(state, onClose);
    });

    document.getElementById('btn-save-template')?.addEventListener('click', async () => {
      if (state.isSavingTemplate) return;
      state.draft = this.readTemplateDraftFromDom(state);
      state.deleteConfirm = false;
      if (!state.draft.name.trim()) {
        App.toast(t('apps.customTemplateNameRequired', 'Indica un nombre para la plantilla.'), 'warning');
        document.getElementById('tmpl-name')?.focus();
        return;
      }

      const wasNewTemplate = !state.selectedId;
      const pendingInstallerPath = this.getPendingTemplateInstallerPath(state).trim();
      const payload = {
        name: state.draft.name,
        description: state.draft.description,
        arguments: state.draft.arguments,
        files: state.draft.files,
        script: state.draft.script
      };

      state.isSavingTemplate = true;
      state.installerStatus = {
        type: 'info',
        message: pendingInstallerPath
          ? t('gui.savingTemplateAndUploadingInstallerToTheShare')
          : t('gui.savingTemplate')
      };
      state.focusTemplateNameOnRender = false;
      this.rerenderTemplateManager(state, onClose);

      let saved;
      try {
        saved = state.selectedId
          ? await window.api.templates.update(state.selectedId, payload)
          : await window.api.templates.create(payload);
      } catch (err) {
        state.isSavingTemplate = false;
        state.installerStatus = {
          type: 'error',
          message: `Could not save the template: ${err?.message || 'Unknown error'}`
        };
        App.toast(t('apps.customTemplateSaveError', 'Could not save the template.'), 'error');
        this.rerenderTemplateManager(state, onClose);
        return;
      }

      if (!saved?.id) {
        state.isSavingTemplate = false;
        state.installerStatus = {
          type: 'error',
          message: 'Could not save the template.'
        };
        App.toast(t('apps.customTemplateSaveError', 'Could not save the template.'), 'error');
        this.rerenderTemplateManager(state, onClose);
        return;
      }

      if (wasNewTemplate && pendingInstallerPath) {
        state.pendingNewInstallerPath = '';
        state.pendingTemplateInstallers = { ...(state.pendingTemplateInstallers || {}), [saved.id]: pendingInstallerPath };
      }

      let installerUploadError = '';
      if (pendingInstallerPath) {
        try {
          const result = await window.api.templates.saveInstaller(saved.id, pendingInstallerPath);
          if (result?.success) {
            state.templateInstallers = { ...state.templateInstallers, [saved.id]: result.sharePath };
            state.pendingTemplateInstallers = { ...(state.pendingTemplateInstallers || {}) };
            delete state.pendingTemplateInstallers[saved.id];
          } else {
            installerUploadError = result?.error || 'Could not copy to the share';
          }
        } catch (err) {
          installerUploadError = err?.message || 'Could not copy to the share';
        }
      }

      const saveConfigResult = await window.api.config.set({ templateInstallers: state.templateInstallers });
      if (saveConfigResult?.success === false) {
        state.isSavingTemplate = false;
        state.installerStatus = {
          type: 'error',
          message: `Template saved, but configuration could not be updated: ${saveConfigResult.error || 'Unknown error'}`
        };
        App.toast(`Error: ${saveConfigResult.error || 'Could not update configuration'}`, 'error');
        this.rerenderTemplateManager(state, onClose);
        return;
      }

      state.templates = await window.api.templates.getAll();
      state.selectedId = saved.id;
      state.selectedBuiltIn = null;
      state.draft = this.cloneTemplateDraft(saved);
      state.deleteUsageCount = 0;
      state.installerSaved = false;
      state.isSavingTemplate = false;
      state.focusTemplateNameOnRender = false;

      if (installerUploadError) {
        state.installerStatus = {
          type: 'error',
          message: `Template saved, but the installer could not be uploaded: ${installerUploadError}`
        };
        App.toast(`Template saved, but the installer could not be uploaded: ${installerUploadError}`, 'warning');
      } else {
        state.installerStatus = {
          type: 'success',
          message: pendingInstallerPath
            ? t('gui.templateSavedAndInstallerUploadedToTheShare')
            : t('gui.templateSavedSuccessfully')
        };
        App.toast(t('apps.customTemplateSaved', 'Plantilla guardada correctamente'), 'success');
      }

      this.rerenderTemplateManager(state, onClose);
    });
  },

  async openTemplateManager(onClose = null) {
    const config = await window.api.config.get().catch(() => ({}));
    if (String(config?.uiMode || '').trim().toLowerCase() !== 'advanced') {
      App.toast(t('apps.manageTemplatesAdvancedOnly', 'Cambia al modo avanzado para gestionar plantillas.'), 'info');
      return;
    }
    const [templates, allTemplates] = await Promise.all([
      window.api.templates.getAll().catch(() => []),
      window.api.scripts.getTemplates().catch(() => [])
    ]);
    const builtInTemplates = allTemplates.filter(t => !t.isUserDefined && !t.noInstaller && t.id !== 'generic' && t.id !== 'custom' && t.id !== 'office');
    const state = {
      templates,
      builtInTemplates,
      templateInstallers: config.templateInstallers || {},
      pendingTemplateInstallers: {},
      pendingNewInstallerPath: '',
      installerStatus: null,
      isSavingTemplate: false,
      selectedId: null,
      selectedBuiltIn: null,
      systemExpanded: false,
      installerSaved: false,
      draft: this.createEmptyTemplateDraft(),
      deleteConfirm: false,
      deleteUsageCount: 0,
      focusTemplateNameOnRender: true,
      templateManagerRestore: null
    };
    this.renderTemplateManager(state, onClose);
  },

};

window.AppsTemplateModule = AppsTemplateModule;
