/**
 * Anexo IX PDF Editor — Renderer Process
 * Handles: screen transitions, PDF.js preview, dynamic form rendering,
 * drag-and-drop, page navigation, and save flow.
 */

import * as pdfjsLib from '../node_modules/pdfjs-dist/build/pdf.mjs';

// Set worker
pdfjsLib.GlobalWorkerOptions.workerSrc = '../node_modules/pdfjs-dist/build/pdf.worker.mjs';

/* ─── UI Mappings (Technical Name -> Display Label) ─────────────────────────
   APENAS os campos definidos aqui serão visíveis na interface do usuário.
   Formato: 'Nome Técnico PDF': { label: 'Rótulo Amigável', tooltip: 'Texto descritivo' (opcional) } */
const FIELD_LABEL_MAPPINGS = {
  'Caixa de texto 1': { label: 'N° da OS:' },
  'Caixa de texto 1_12': { label: 'Dias Uteis:' },
  'Caixa de texto 1_3': { label: 'Período Inicial:' },
  'Caixa de texto 1_4': { label: 'Período Final:' },
  'Caixa de texto 1_9': { label: 'Quantidade Sênior(s):', tooltip: 'Quantidade de funcionário(s) que trabalhou mês completo' },
  'VIRTUAL_DIAS_SENIOR_PARCIAL': { label: 'Dias Sênior Parcial:', tooltip: 'Dias trabalhados parcialmente por funcionário(s)' },
  'Caixa de texto 1_7': { label: 'Quantidade Pleno(s):', tooltip: 'Quantidade de funcionário(s) que trabalhou mês completo' },
  'VIRTUAL_DIAS_PLENO_PARCIAL': { label: 'Dias Pleno Parcial:', tooltip: 'Dias trabalhados parcialmente por funcionário(s)' },
  'Caixa de texto 1_5': { label: 'Data Recebimento:' },
  'Caixa de texto 1_20': { label: 'TPF:' },
  'Caixa de texto 1_24': { label: 'Linhas Código:' },
  'nome_product_owner': { label: 'Product Owner:' },
};

// ─── Fields to persist in localStorage (saved on input/change) ──────────────
const PERSIST_FIELDS = new Set([
  'nome_product_owner',
  'Caixa de texto 1',
]);

// ─── Fields that should use a date picker ─────────────────────────────────────
const DATE_FIELDS = new Set([
  'Caixa de texto 1_3',
  'Caixa de texto 1_4',
  'Caixa de texto 1_5',
]);

// ─── Fields that should only accept numbers ──────────────────────────────────
const NUMERIC_FIELDS = new Set([
  'Caixa de texto 1',
  'Caixa de texto 1_12',
  'Caixa de texto 1_20',
  'Caixa de texto 1_24',
  'Caixa de texto 1_39',
  'Caixa de texto 1_40',
  'Caixa de texto 1_63',
  'Caixa de texto 1_64',
]);

// ─── Fields that should be rendered as number incrementers ─────────────────
const NUMBER_FIELDS = new Set([
  'Caixa de texto 1_7',
  'Caixa de texto 1_9',
  'Caixa de texto 1_12',
  'VIRTUAL_DIAS_SENIOR_PARCIAL',
  'VIRTUAL_DIAS_PLENO_PARCIAL',
]);

/* ─── Default Overrides (Technical Name -> Default Value) ───────────────────
   Valores definidos aqui serão aplicados ao PDF mesmo que o campo esteja oculto. */
const FIELD_DEFAULT_OVERRIDES = {
  'Caixa de texto 1_2': '',
  'Caixa de texto 1_13': '1',
};

// ─── Tech Stack Financial Defaults ─────────────────────────────────────────────
const TECH_DEFAULTS = {
  Java: { senior: 25366.86, pleno: 17927.47 },
  FORMs: { senior: 25212.77, pleno: 17681.40 },
  GENEXUS: { senior: 25924.98, pleno: 17334.43 },
};

// ─── State ────────────────────────────────────────────────────────────────────
const state = {
  filePath: null,
  fields: [],
  pdfBytes: null,
  pdfDoc: null,       // PDF.js document
  currentPage: 1,
  totalPages: 1,
  renderTask: null,
  resizing: false,
  techConfig: null, // Will hold { stack: 'Java', senior: 0, pleno: 0 }
};

// Helper: get saved values for a specific tech stack
function getSavedTechValues(stack) {
  try {
    const saved = localStorage.getItem(`tech_values_${stack}`);
    if (saved) return JSON.parse(saved);
  } catch (e) { /* ignore */ }
  return null;
}

// Helper: save values for a specific tech stack
function saveTechValues(stack, senior, pleno) {
  localStorage.setItem(`tech_values_${stack}`, JSON.stringify({ senior, pleno }));
}

// Load saved Tech Config from localStorage
try {
  const saved = localStorage.getItem('tech_config');
  if (saved) state.techConfig = JSON.parse(saved);
} catch (e) {
  state.techConfig = null;
}
if (!state.techConfig) {
  state.techConfig = { stack: 'Java', senior: TECH_DEFAULTS['Java'].senior, pleno: TECH_DEFAULTS['Java'].pleno };
}

// ─── Element refs ──────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const landingScreen = $('landing-screen');
const loadingScreen = $('loading-screen');
const editorScreen = $('editor-screen');
const fieldsContainer = $('fields-container');
const pdfCanvas = $('pdf-canvas');
const ctx = pdfCanvas.getContext('2d');
const pageIndicator = $('page-indicator');
const fileNameBadge = $('file-name-badge');
const fieldsCountBadge = $('fields-count-badge');
const statusMsg = $('status-msg');
const toast = $('toast');
const dropZone = document.querySelector('.drop-zone');
const panelLeft = document.querySelector('.panel-left');
const divider = $('panel-divider');

// Tech Modal Refs
const techModal = $('tech-modal');
const techRadios = document.querySelectorAll('input[name="tech_stack"]');
const techValSenior = $('tech-val-senior');
const techValPleno = $('tech-val-pleno');
const btnConfirmTech = $('btn-confirm-tech');

// ─── Screen helpers ────────────────────────────────────────────────────────────
function showScreen(screen) {
  [landingScreen, loadingScreen, editorScreen].forEach((s) => s.classList.remove('active'));
  screen.classList.add('active');
}

// ─── Toast ─────────────────────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = '') {
  toast.textContent = msg;
  toast.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.className = 'toast'; }, 3500);
}

// ─── Status message ───────────────────────────────────────────────────────────
function setStatus(msg, type = '') {
  statusMsg.textContent = msg;
  statusMsg.className = `status-msg ${type}`;
}

// ─── Open file ────────────────────────────────────────────────────────────────
async function openFile(filePath = null) {
  if (!filePath) filePath = await window.api.openFile();
  if (!filePath) return;

  showScreen(loadingScreen);

  const result = await window.api.readFields(filePath);

  if (result.error) {
    showScreen(landingScreen);
    showToast('Erro ao ler o PDF: ' + result.error, 'error');
    return;
  }

  state.filePath = filePath;
  state.fields = result.fields;

  // Inject virtual fields (not in original PDF but needed for UI calculation)
  const virtual = [
    { name: 'VIRTUAL_DIAS_SENIOR_PARCIAL', type: 'PDFTextField', value: '' },
    { name: 'VIRTUAL_DIAS_PLENO_PARCIAL', type: 'PDFTextField', value: '' }
  ];
  state.fields = [...result.fields, ...virtual];

  state.pdfBytes = result.pdfBase64;

  // Update badges
  const fileName = filePath.split('/').pop().split('\\').pop();
  fileNameBadge.textContent = fileName;
  // Only show fields explicitly defined in FIELD_LABEL_MAPPINGS, in the mapped order
  const visibleFields = Object.keys(FIELD_LABEL_MAPPINGS).map((name) => {
    const fIdx = state.fields.findIndex((f) => f.name === name);
    if (fIdx === -1) return null;
    return { ...state.fields[fIdx], originalIdx: fIdx };
  }).filter(Boolean);

  const nFields = visibleFields.length;
  fieldsCountBadge.textContent = nFields === 0 ? 'Sem campos' : `${nFields} campo${nFields !== 1 ? 's' : ''}`;

  // Render fields (excluding hidden ones)
  renderFields(visibleFields);
  attachFieldListeners();

  // Load PDF.js
  await loadPdfPreview(result.pdfBase64);

  // Trigger initial calculation update to show background fields in preview
  await triggerPreviewUpdate();

  showScreen(editorScreen);
  setStatus('');

  // Show tech selection modal automatically when file is loaded
  showTechModal();
}

// ─── Tech Modal Logic ─────────────────────────────────────────────────────────
function showTechModal() {
  techModal.classList.add('active');
  const stack = state.techConfig.stack;
  const radio = document.querySelector(`input[name="tech_stack"][value="${stack}"]`);
  if (radio) radio.checked = true;
  // Load last-saved values for the current stack (may differ from confirmed config)
  const saved = getSavedTechValues(stack);
  const values = saved || { senior: state.techConfig.senior, pleno: state.techConfig.pleno };
  techValSenior.value = values.senior.toFixed(2);
  techValPleno.value = values.pleno.toFixed(2);
}

function hideTechModal() {
  techModal.classList.remove('active');
  triggerPreviewUpdate();
}

techRadios.forEach((radio) => {
  radio.addEventListener('change', (e) => {
    const stack = e.target.value;
    // Load last-saved values for this tech, or fall back to defaults
    const saved = getSavedTechValues(stack);
    const values = saved || TECH_DEFAULTS[stack];
    techValSenior.value = values.senior.toFixed(2);
    techValPleno.value = values.pleno.toFixed(2);
  });
});

// Save values for current tech whenever the user types (real-time)
[techValSenior, techValPleno].forEach((input) => {
  input.addEventListener('input', () => {
    const checkedRadio = document.querySelector('input[name="tech_stack"]:checked');
    const stack = checkedRadio ? checkedRadio.value : state.techConfig.stack;
    const senior = parseFloat(techValSenior.value) || 0;
    const pleno = parseFloat(techValPleno.value) || 0;
    saveTechValues(stack, senior, pleno);
  });
});

btnConfirmTech.addEventListener('click', () => {
  const checkedRadio = document.querySelector('input[name="tech_stack"]:checked');
  const stack = checkedRadio ? checkedRadio.value : 'Java';
  const senior = parseFloat(techValSenior.value) || 0;
  const pleno = parseFloat(techValPleno.value) || 0;

  // Save per-tech values and the active config
  saveTechValues(stack, senior, pleno);
  state.techConfig = { stack, senior, pleno };
  localStorage.setItem('tech_config', JSON.stringify(state.techConfig));

  hideTechModal();
  showToast(`Configuração ${stack} ativa.`);
  window.api.openTutorial();
});

// ─── Render form fields ───────────────────────────────────────────────────────
function renderFields(fields) {
  fieldsContainer.innerHTML = '';

  if (fields.length === 0) {
    fieldsContainer.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M9 12h6m-3-3v6M4 6h16M4 12h1M4 18h1" stroke-linecap="round"/>
        </svg>
        <p>Nenhum campo editável encontrado neste PDF.</p>
      </div>`;
    return;
  }

  fields.forEach((field) => {
    const idx = field.originalIdx;
    const item = document.createElement('div');
    item.className = 'field-item';
    item.style.animationDelay = `${idx * 30}ms`;

    const typeLabel = friendlyType(field.type);

    // Check for persisted value
    let initialValue = field.value || '';
    if (PERSIST_FIELDS.has(field.name)) {
      const saved = localStorage.getItem('persist_' + field.name);
      if (saved !== null) initialValue = saved;
    }

    const mapping = FIELD_LABEL_MAPPINGS[field.name];
    const displayLabel = mapping ? mapping.label : labelFromName(field.name);
    const tooltipText = mapping && mapping.tooltip ? mapping.tooltip : null;

    let tooltipHtml = '';
    if (tooltipText) {
      tooltipHtml = `
        <span class="field-info-icon" title="${escHtml(tooltipText)}">
          <svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14">
            <path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clip-rule="evenodd"/>
          </svg>
        </span>
      `;
    }

    const labelHtml = `
      <div class="field-label-row">
        <span class="field-label">${escHtml(displayLabel)}</span>
        ${tooltipHtml}
      </div>`;

    let inputHtml = '';

    if (field.type === 'PDFTextField') {
      const isMultiline = field.name.toLowerCase().includes('obs') ||
        field.name.toLowerCase().includes('observa') ||
        field.name.toLowerCase().includes('descri') ||
        (typeof field.value === 'string' && field.value.length > 80);

      if (DATE_FIELDS.has(field.name)) {
        // Convert dd/mm/yyyy to yyyy-mm-dd for input type="date"
        let dateVal = '';
        if (initialValue && typeof initialValue === 'string' && initialValue.includes('/')) {
          const parts = initialValue.split('/');
          if (parts.length === 3) dateVal = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        } else if (initialValue && /^\d{4}-\d{2}-\d{2}$/.test(initialValue)) {
          dateVal = initialValue;
        }
        inputHtml = `<input class="field-input" type="date" id="f_${idx}" data-field-idx="${idx}" value="${dateVal}" />`;
      } else if (NUMBER_FIELDS.has(field.name)) {
        inputHtml = `<input class="field-input is-numeric" type="number" step="1" min="0" id="f_${idx}" data-field-idx="${idx}" value="${escHtml(initialValue)}" />`;
      } else if (isMultiline) {
        inputHtml = `<textarea class="field-textarea" id="f_${idx}" data-field-idx="${idx}">${escHtml(initialValue)}</textarea>`;
      } else if (NUMERIC_FIELDS.has(field.name)) {
        inputHtml = `<input class="field-input is-numeric" type="text" id="f_${idx}" data-field-idx="${idx}" value="${escHtml(initialValue)}" inputmode="numeric" pattern="[0-9]*" />`;
      } else {
        inputHtml = `<input class="field-input" type="text" id="f_${idx}" data-field-idx="${idx}" value="${escHtml(initialValue)}" />`;
      }
    } else if (field.type === 'PDFCheckBox') {
      const checked = initialValue ? 'checked' : '';
      inputHtml = `
        <label class="field-check-label">
          <input type="checkbox" id="f_${idx}" data-field-idx="${idx}" ${checked} />
          ${escHtml(labelFromName(field.name))}
        </label>`;
    } else if (field.type === 'PDFRadioGroup') {
      const opts = (field.options || []);
      inputHtml = `<div class="field-radio-group" role="radiogroup">` +
        opts.map((opt) => `
          <label class="field-check-label">
            <input type="radio" name="radio_${idx}" data-field-idx="${idx}" value="${escHtml(opt)}" ${initialValue === opt ? 'checked' : ''} />
            ${escHtml(opt)}
          </label>`).join('') + `</div>`;
    } else if (field.type === 'PDFDropdown') {
      const opts = (field.options || []);
      inputHtml = `<select class="field-select" id="f_${idx}" data-field-idx="${idx}">
        <option value="">— Selecione —</option>` +
        opts.map((opt) => `<option value="${escHtml(opt)}" ${initialValue === opt ? 'selected' : ''}>${escHtml(opt)}</option>`).join('') +
        `</select>`;
    } else if (field.type === 'PDFOptionList') {
      const opts = (field.options || []);
      inputHtml = `<select class="field-select" id="f_${idx}" data-field-idx="${idx}" size="4" multiple>` +
        opts.map((opt) => {
          const sel = Array.isArray(initialValue) && initialValue.includes(opt);
          return `<option value="${escHtml(opt)}" ${sel ? 'selected' : ''}>${escHtml(opt)}</option>`;
        }).join('') + `</select>`;
    } else if (field.type === 'PDFSignature') {
      inputHtml = `<div class="field-input" style="color:var(--text-3);font-size:0.8rem;cursor:default;">[Campo de assinatura — preenchido ao salvar]</div>`;
    } else {
      inputHtml = `<input class="field-input" type="text" id="f_${idx}" data-field-idx="${idx}" value="${escHtml(initialValue)}" />`;
    }

    item.innerHTML = labelHtml + inputHtml;
    fieldsContainer.appendChild(item);
  });
}

// ─── Collect form values ──────────────────────────────────────────────────────
function collectValues() {
  const values = {};
  state.fields.forEach((field, idx) => {
    try {
      const el = document.querySelector(`[data-field-idx="${idx}"]`);
      if (!el && field.type !== 'PDFRadioGroup') return; // Skip if not rendered

      if (field.type === 'PDFTextField') {
        let val = el.value;
        if (DATE_FIELDS.has(field.name) && val) {
          // Convert yyyy-mm-dd to dd/mm/yyyy
          const parts = val.split('-');
          if (parts.length === 3) val = `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
        if (field.name === 'nome_product_owner' && val) {
          val = val.toUpperCase();
          el.value = val; // Sync UI back just in case
        }
        values[field.name] = val;
      } else if (field.type === 'PDFCheckBox') {
        values[field.name] = el.checked;
      } else if (field.type === 'PDFRadioGroup') {
        const checkedEl = document.querySelector(`input[name="radio_${idx}"]:checked`);
        if (checkedEl) {
          values[field.name] = checkedEl.value;
        }
      } else if (field.type === 'PDFDropdown') {
        values[field.name] = el.value;
      } else if (field.type === 'PDFOptionList') {
        values[field.name] = Array.from(el.selectedOptions).map((o) => o.value);
      }
    } catch (e) {
      /* skip */
    }
  });

  // Apply default overrides (fields that are hidden but must have a specific value)
  for (const [name, val] of Object.entries(FIELD_DEFAULT_OVERRIDES)) {
    values[name] = val;
  }

  // Calculated fields math
  const getUiVal = (name) => {
    const fIdx = state.fields.findIndex((f) => f.name === name);
    if (fIdx === -1) return 0;
    const el = document.querySelector(`[data-field-idx="${fIdx}"]`);
    return el ? parseFloat(el.value || 0) : 0;
  };

  const diasUteis = getUiVal('Caixa de texto 1_12');
  const seniorVal = getUiVal('Caixa de texto 1_9');
  const seniorParcial = getUiVal('VIRTUAL_DIAS_SENIOR_PARCIAL');
  const plenoParcial = getUiVal('VIRTUAL_DIAS_PLENO_PARCIAL');
  const diasPleno = getUiVal('Caixa de texto 1_7');

  // 1. 1.6 - Quantidade de DIAS DO DESENVOLVEDOR – perfil SÊNIOR realizados no período:
  const totalSenior = (seniorVal * diasUteis) + seniorParcial;
  if (Object.prototype.hasOwnProperty.call(FIELD_LABEL_MAPPINGS, 'Caixa de texto 1_9')) {
    values['Caixa de texto 1_9'] = totalSenior.toString();
  }

  // 2. 1.7 - Quantidade de DIAS DO DESENVOLVEDOR – perfil SÊNIOR esperados no período: (b)
  values['Caixa de texto 1_8'] = totalSenior.toString();

  // 3. 1.8 - Quantidade de DIAS DO DESENVOLVEDOR – perfil PLENO realizados no período:
  const totalPleno = (diasPleno * diasUteis) + plenoParcial;
  if (Object.prototype.hasOwnProperty.call(FIELD_LABEL_MAPPINGS, 'Caixa de texto 1_7')) {
    values['Caixa de texto 1_7'] = totalPleno.toString();
  }

  // 4. 1.9 - Quantidade de DIAS DO DESENVOLVEDOR – perfil PLENO esperados no período: (c)
  values['Caixa de texto 1_6'] = totalPleno.toString();

  // 5. 1.4 - Quantidade de DIAS DO DESENVOLVEDOR realizados no período:
  values['Caixa de texto 1_11'] = totalSenior + totalPleno;

  // 6. 1.5 - Quantidade de DIAS DO DESENVOLVEDOR esperados no período: (a)
  values['Caixa de texto 1_10'] = totalSenior + totalPleno;

  // 7. 2. Taxa Efetiva de Ocupação dos Postos de Trabalho Previstos na OS (TEOPT) item 1.4
  values['Caixa de texto 1_14'] = values['Caixa de texto 1_11'];

  // 8. 2. Taxa Efetiva de Ocupação dos Postos de Trabalho Previstos na OS (TEOPT) item 1.5
  values['Caixa de texto 1_17'] = values['Caixa de texto 1_10'];

  // 9. 2. Taxa Efetiva de Ocupação dos Postos de Trabalho Previstos na OS (TEOPT) item 1.6
  values['Caixa de texto 1_15'] = values['Caixa de texto 1_9'];

  // 10. 2. Taxa Efetiva de Ocupação dos Postos de Trabalho Previstos na OS (TEOPT) item 1.7
  values['Caixa de texto 1_18'] = values['Caixa de texto 1_8'];

  // 11. 2. Taxa Efetiva de Ocupação dos Postos de Trabalho Previstos na OS (TEOPT) item 1.8
  values['Caixa de texto 1_16'] = values['Caixa de texto 1_7'];

  // 12. 2. Taxa Efetiva de Ocupação dos Postos de Trabalho Previstos na OS (TEOPT) item 1.9
  values['Caixa de texto 1_19'] = values['Caixa de texto 1_6'];

  // 13. 4. Índices de Produtividade (IP) item 4.1
  values['Caixa de texto 1_21'] = values['Caixa de texto 1_20'];

  // 14. 4. Índices de Produtividade (IP) item 4.1
  values['Caixa de texto 1_23'] = values['Caixa de texto 1_11'];

  // 15. 4. Índices de Produtividade (IP) item 4.1 resultado
  const val20 = parseFloat(values['Caixa de texto 1_20'] || 0);
  const val11 = parseFloat(values['Caixa de texto 1_11'] || 0);
  const res28 = val11 !== 0 ? (val20 / val11) : 0;
  values['Caixa de texto 1_28'] = res28.toFixed(2).replace('.', ',');

  // 16. 4. Índices de Produtividade (IP) item 4.2
  values['Caixa de texto 1_22'] = res28.toFixed(2).replace('.', ',');

  // 17. 4. Índices de Produtividade (IP) item 4.2 resultado
  const res29 = res28 / 0.56;
  values['Caixa de texto 1_29'] = res29.toFixed(2).replace('.', ',');

  // 18. 4. Índices de Produtividade (IP) item 4.4
  values['Caixa de texto 1_25'] = values['Caixa de texto 1_24'];

  // 19. 4. Índices de Produtividade (IP) item 4.4
  values['Caixa de texto 1_26'] = values['Caixa de texto 1_11'];

  // 20. 4. Índices de Produtividade (IP) item 4.4 resultado
  const val24 = parseFloat(values['Caixa de texto 1_24'] || 0);
  const res30 = val11 !== 0 ? (val24 / val11) : 0;
  values['Caixa de texto 1_30'] = res30.toFixed(2).replace('.', ',');

  // 21. 4. Índices de Produtividade (IP) item 4.5
  values['Caixa de texto 1_27'] = res30.toFixed(2).replace('.', ',');

  // 22. 4. Índices de Produtividade (IP) item 4.4 resultado
  const res31 = res30 / 33.33;
  values['Caixa de texto 1_31'] = res31.toFixed(2).replace('.', ',');

  // 23. 2. Taxa Efetiva de Ocupação dos Postos de Trabalho Previstos na OS (TEOPT) 2.1 - TEOPT
  values['Caixa de texto 1_32'] = values['Caixa de texto 1_29'];

  // 24. 2. Taxa Efetiva de Ocupação dos Postos de Trabalho Previstos na OS (TEOPT) 2.2 - TEOPT Sênior
  values['Caixa de texto 1_33'] = values['Caixa de texto 1_31'];

  // 25. 2. Taxa Efetiva de Ocupação dos Postos de Trabalho Previstos na OS (TEOPT) 2.3 - TEOPT Pleno
  // Formula: (0.25 * Prod) + (0.2 * Code) + (0.4 * Param1) + (0.15 * Param2)
  const p1 = parseFloat(values['Caixa de texto 1_65'] || 1);
  const p2 = parseFloat(values['Caixa de texto 1_66'] || 1);
  const IMS = (0.25 * res29) + (0.2 * res31) + (0.4 * p1) + (0.15 * p2);
  values['Caixa de texto 1_34'] = IMS.toFixed(2).replace('.', ',');

  // 26. Calcula (valor total senior)
  const techSeniorValue = state.techConfig ? state.techConfig.senior : 0;
  const valorTotalSenior = parseFloat(values['Caixa de texto 1_9'] || 0);
  let valorSenior = 0;
  if (diasUteis > 0) {
    valorSenior = (techSeniorValue / diasUteis) * valorTotalSenior;
  }

  // 27. Calcula (valor total pleno)
  const techPlenoValue = state.techConfig ? state.techConfig.pleno : 0;
  const valorTotalPleno = parseFloat(values['Caixa de texto 1_7'] || 0);
  let valorPleno = 0;
  if (diasUteis > 0) {
    valorPleno = (techPlenoValue / diasUteis) * valorTotalPleno;
  }

  // Helper for Brazilian currency format without 'R$' symbol (e.g. 1.234,56)
  const formatBRL = (val) => val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  values['Caixa de texto 1_36'] = formatBRL(valorSenior);
  values['Caixa de texto 1_37'] = formatBRL(valorPleno);

  // 29. Calcula valor total da OS, preenchendo os campos previsto e valor a pagar
  const valorTotalOS = valorSenior + valorPleno;
  values['Caixa de texto 1_38'] = formatBRL(valorTotalOS);
  values['Caixa de texto 1_35'] = formatBRL(valorTotalOS);

  // Remove virtual fields from the final object before returning
  delete values['VIRTUAL_DIAS_SENIOR_PARCIAL'];
  delete values['VIRTUAL_DIAS_PLENO_PARCIAL'];

  return values;
}

// ─── PDF.js preview ───────────────────────────────────────────────────────────
async function loadPdfPreview(base64) {
  try {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

    state.pdfDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
    state.totalPages = state.pdfDoc.numPages;
    state.currentPage = 1;
    await renderPage(state.currentPage);
    updatePageIndicator();
  } catch (e) {
    console.error('PDF.js load error:', e);
  }
}

async function renderPage(num) {
  if (!state.pdfDoc) return;
  if (state.renderTask) {
    state.renderTask.cancel();
    state.renderTask = null;
  }

  const page = await state.pdfDoc.getPage(num);
  const container = $('preview-container');
  const availW = container.clientWidth - 40;
  const viewport = page.getViewport({ scale: 1 });
  const scale = Math.min(availW / viewport.width, 1.8);
  const scaled = page.getViewport({ scale });

  pdfCanvas.width = scaled.width;
  pdfCanvas.height = scaled.height;

  state.renderTask = page.render({ canvasContext: ctx, viewport: scaled });
  await state.renderTask.promise;
  state.renderTask = null;
}

function updatePageIndicator() {
  pageIndicator.textContent = `Pág ${state.currentPage} / ${state.totalPages}`;
  $('btn-prev-page').disabled = state.currentPage <= 1;
  $('btn-next-page').disabled = state.currentPage >= state.totalPages;
}

// ─── Real-time preview ───────────────────────────────────────────────────────
let previewDebounceTimer = null;

async function triggerPreviewUpdate() {
  if (!state.filePath) return;
  setStatus('Atualizando prévia…', '');

  const values = collectValues();
  const result = await window.api.previewWithFields(state.filePath, values);

  if (result.error) {
    setStatus('', '');
    return;
  }

  // Re-load PDF.js with the updated bytes (keeps same page)
  const savedPage = state.currentPage;
  await loadPdfPreview(result.pdfBase64);
  // Restore page if multi-page
  if (savedPage > 1 && savedPage <= state.totalPages) {
    state.currentPage = savedPage;
    await renderPage(state.currentPage);
    updatePageIndicator();
  }
  setStatus('', '');
}

function schedulePreviewUpdate() {
  savePersistentFields();
  clearTimeout(previewDebounceTimer);
  previewDebounceTimer = setTimeout(triggerPreviewUpdate, 600);
}

function savePersistentFields() {
  const values = collectValues();
  for (const name in values) {
    if (PERSIST_FIELDS.has(name)) {
      localStorage.setItem('persist_' + name, values[name]);
    }
  }
}

function attachFieldListeners() {
  fieldsContainer.querySelectorAll('input, textarea, select').forEach((el) => {
    el.addEventListener('input', () => {
      el.classList.remove('field-error-shake');
      schedulePreviewUpdate();
    });
    el.addEventListener('change', () => {
      el.classList.remove('field-error-shake');
      schedulePreviewUpdate();
    });

    // Numeric enforcement (No negative numbers)
    if (el.classList.contains('is-numeric')) {
      el.addEventListener('keypress', (e) => {
        // Only 0-9 allowed
        if (!/[0-9]/.test(e.key) && e.key !== 'Enter' && !e.ctrlKey && !e.altKey) {
          e.preventDefault();
        }
      });
      el.addEventListener('paste', (e) => {
        const pasteData = e.clipboardData.getData('text');
        if (!/^\d+$/.test(pasteData)) {
          e.preventDefault();
        }
      });
      el.addEventListener('input', () => {
        if (el.value < 0) el.value = 0;
      });
    }

    // Force Uppercase for Product Owner
    if (el.dataset.fieldIdx !== undefined) {
      const field = state.fields[el.dataset.fieldIdx];
      if (field && field.name === 'nome_product_owner') {
        el.addEventListener('input', () => {
          el.value = el.value.toUpperCase();
        });
      }
    }

    // Real-time Date Range Validation (Initial vs Final)
    if (el.dataset.fieldIdx !== undefined) {
      const field = state.fields[el.dataset.fieldIdx];
      if (field && (field.name === 'Caixa de texto 1_3' || field.name === 'Caixa de texto 1_4')) {
        el.addEventListener('change', () => {
          const f3Idx = state.fields.findIndex(f => f.name === 'Caixa de texto 1_3');
          const f4Idx = state.fields.findIndex(f => f.name === 'Caixa de texto 1_4');
          const el3 = document.querySelector(`[data-field-idx="${f3Idx}"]`);
          const el4 = document.querySelector(`[data-field-idx="${f4Idx}"]`);

          if (el3 && el4 && el3.value && el4.value) {
            const d1 = new Date(el3.value);
            const d2 = new Date(el4.value);
            
            let error = null;
            if (d1 >= d2) {
              error = 'A data inicial deve ser menor que a data final';
            } else {
              const diff = Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
              if (diff > 30) error = 'O período não pode ultrapassar 30 dias';
            }

            if (error) {
              [el3, el4].forEach(target => {
                target.classList.remove('field-error-shake');
                void target.offsetWidth;
                target.classList.add('field-error-shake');
              });
              showToast(error, 'error');
            } else {
              el3.classList.remove('field-error-shake');
              el4.classList.remove('field-error-shake');
            }
          }
        });
      }

      // Real-time Validation: Emission Date (1_5) must be > Final Period (1_4)
      if (field && (field.name === 'Caixa de texto 1_5' || field.name === 'Caixa de texto 1_4')) {
        el.addEventListener('change', () => {
          const f4Idx = state.fields.findIndex(f => f.name === 'Caixa de texto 1_4');
          const f5Idx = state.fields.findIndex(f => f.name === 'Caixa de texto 1_5');
          const el4 = document.querySelector(`[data-field-idx="${f4Idx}"]`);
          const el5 = document.querySelector(`[data-field-idx="${f5Idx}"]`);

          if (el4 && el5 && el4.value && el5.value) {
            const dFinal = new Date(el4.value);
            const dEmissao = new Date(el5.value);

            if (dEmissao <= dFinal) {
              el5.classList.remove('field-error-shake');
              void el5.offsetWidth;
              el5.classList.add('field-error-shake');
              showToast('A Data de Emissão deve ser maior que a data do Período Final', 'error');
            } else {
              el5.classList.remove('field-error-shake');
            }
          }
        });
      }
    }
  });
}

// ─── Clear fields ─────────────────────────────────────────────────────────────
function clearFields() {
  fieldsContainer.querySelectorAll('input, textarea, select').forEach((el) => {
    const idx = el.dataset.fieldIdx;
    if (idx !== undefined) {
      const field = state.fields[idx];
      if (field && PERSIST_FIELDS.has(field.name)) return;
    }

    if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked = false;
    } else if (el.tagName === 'SELECT') {
      el.selectedIndex = 0;
    } else {
      el.value = '';
    }
  });
  setStatus('Campos limpos (salvo campos fixos).', '');
  schedulePreviewUpdate();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function labelFromName(name) {
  // Convert camelCase, underscored or dotted names to human-readable
  return name
    .replace(/[._]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function friendlyType(type) {
  const map = {
    PDFTextField: 'Texto',
    PDFCheckBox: 'Check',
    PDFRadioGroup: 'Radio',
    PDFDropdown: 'Lista',
    PDFOptionList: 'Opções',
    PDFSignature: 'Assinatura',
  };
  return map[type] || type;
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

// Landing — choose button
$('btn-choose-landing').addEventListener('click', () => openFile());

// Global drag-and-drop prevention + handle drop anywhere on landing
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  // If we are on landing screen, allow dropping anywhere on the window
  if (landingScreen.classList.contains('active')) {
    handleDrop(e.dataTransfer.files);
  }
});

function handleDrop(files) {
  if (files.length === 0) return;

  const file = files[0];
  const name = file.name || '';
  const type = file.type || '';

  const isPdf = type === 'application/pdf' || name.toLowerCase().endsWith('.pdf');

  if (isPdf) {
    const path = window.api.getPathForFile(file);
    if (path) {
      openFile(path);
    } else {
      showToast('Não foi possível obter o caminho do arquivo.', 'error');
    }
  } else {
    showToast(`Arquivo não suportado. Tipo: ${type || 'desconhecido'}. Por favor, use um PDF.`, 'error');
  }
}

// Drag-and-drop on landing (visual feedback only, drop handled by window)
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  // Logic handled by window listener
});

// New PDF
$('btn-new-pdf').addEventListener('click', () => {
  state.filePath = null;
  state.fields = [];
  state.pdfDoc = null;
  fieldsContainer.innerHTML = '';
  ctx.clearRect(0, 0, pdfCanvas.width, pdfCanvas.height);
  setStatus('');
  showScreen(landingScreen);
});

// Save PDF
$('btn-save-pdf').addEventListener('click', async () => {
  if (!state.filePath) return;
  const btn = $('btn-save-pdf');
  btn.disabled = true;
  setStatus('Salvando…', '');

  const values = collectValues();

  // Validate required fields
  const requiredFields = [
    'Caixa de texto 1',
    'Caixa de texto 1_3',
    'Caixa de texto 1_4',
    'Caixa de texto 1_12',
    'Caixa de texto 1_5',
    'Caixa de texto 1_20',
    'Caixa de texto 1_24',
    'nome_product_owner'
  ];

  const missingFields = [];
  const missingElements = [];
  for (const fieldName of requiredFields) {
    if (!values[fieldName] || values[fieldName].trim() === '') {
      const mapping = FIELD_LABEL_MAPPINGS[fieldName];
      const label = mapping ? mapping.label.replace(':', '') : labelFromName(fieldName);
      missingFields.push(label);

      const idx = state.fields.findIndex(f => f.name === fieldName);
      if (idx !== -1) {
        const el = document.querySelector(`[data-field-idx="${idx}"]`);
        if (el) missingElements.push(el);
      }
    }
  }

  if (missingFields.length > 0) {
    missingElements.forEach(el => {
      el.classList.remove('field-error-shake');
      void el.offsetWidth; // trigger reflow to reset CSS animation
      el.classList.add('field-error-shake');
    });

    const errorMsg = `Campos obrigatórios: ${missingFields.join(', ')}`;
    setStatus('Erro ao salvar: campos obrigatórios vazios.', 'error');
    showToast(errorMsg, 'error');
    btn.disabled = false;
    return;
  }

  // Validate at least one role duration field is filled
  const roleFields = [
    'Caixa de texto 1_9',
    'VIRTUAL_DIAS_SENIOR_PARCIAL',
    'Caixa de texto 1_7',
    'VIRTUAL_DIAS_PLENO_PARCIAL'
  ];

  const hasAtLeastOneRole = roleFields.some(fieldName => {
    const val = values[fieldName];
    return val && val.trim() !== '' && parseFloat(val) > 0;
  });
  if (!hasAtLeastOneRole) {
    roleFields.forEach(fieldName => {
      const idx = state.fields.findIndex(f => f.name === fieldName);
      if (idx !== -1) {
        const el = document.querySelector(`[data-field-idx="${idx}"]`);
        if (el) {
          el.classList.remove('field-error-shake');
          void el.offsetWidth;
          el.classList.add('field-error-shake');
        }
      }
    });

    setStatus('Erro ao salvar: nenhuma quantidade alocada.', 'error');
    showToast('Preencha ao menos uma Quantidade ou Dias Parciais (Sênior ou Pleno)', 'error');
    btn.disabled = false;
    return;
  }

  // Validate date range: Caixa de texto 1_3 (Start) < Caixa de texto 1_4 (End) and diff <= 30 days
  const valStart = values['Caixa de texto 1_3'];
  const valEnd = values['Caixa de texto 1_4'];
  
  const parseBRDate = (s) => {
    if (!s) return null;
    const parts = s.split('/');
    if (parts.length !== 3) return null;
    return new Date(parts[2], parts[1] - 1, parts[0]);
  };

  const dStart = parseBRDate(valStart);
  const dEnd = parseBRDate(valEnd);

  if (dStart && dEnd) {
    let dateError = null;
    if (dStart >= dEnd) {
      dateError = 'A data inicial deve ser menor que a data final';
    } else {
      const diffDays = Math.round((dEnd - dStart) / (1000 * 60 * 60 * 24));
      if (diffDays > 30) {
        dateError = 'O período não pode ultrapassar 30 dias';
      }
    }

    if (dateError) {
      ['Caixa de texto 1_3', 'Caixa de texto 1_4'].forEach(name => {
        const idx = state.fields.findIndex(f => f.name === name);
        if (idx !== -1) {
          const el = document.querySelector(`[data-field-idx="${idx}"]`);
          if (el) {
            el.classList.remove('field-error-shake');
            void el.offsetWidth;
            el.classList.add('field-error-shake');
          }
        }
      });
      setStatus('Erro ao salvar: data inválida.', 'error');
      showToast(dateError, 'error');
      btn.disabled = false;
      return;
    }
  }

  // Validate Emission Date (1_5) > Final Period (1_4)
  const dEmissao = parseBRDate(values['Caixa de texto 1_5']);
  if (dEmissao && dEnd && dEmissao <= dEnd) {
    const idx = state.fields.findIndex(f => f.name === 'Caixa de texto 1_5');
    if (idx !== -1) {
      const el = document.querySelector(`[data-field-idx="${idx}"]`);
      if (el) {
        el.classList.remove('field-error-shake');
        void el.offsetWidth;
        el.classList.add('field-error-shake');
      }
    }
    setStatus('Erro ao salvar: data de emissão inválida.', 'error');
    showToast('A Data de Emissão deve ser maior que a data do Período Final', 'error');
    btn.disabled = false;
    return;
  }

  let customFileName = undefined;
  const inputOS = values['Caixa de texto 1'];
  if (inputOS && inputOS.trim() !== '') {
    customFileName = `ANEXO 9 - OS${inputOS.trim()}`;
  }

  const result = await window.api.writeFields(state.filePath, values, customFileName);

  btn.disabled = false;
  if (result.success) {
    setStatus('PDF salvo com sucesso!', 'success');
    showToast(`✓ Salvo em: ${result.savedPath.split('/').pop()}`, 'success');
  } else {
    setStatus('Erro ao salvar: ' + result.message, 'error');
    showToast('Erro: ' + result.message, 'error');
  }
});

// Clear fields
$('btn-clear-fields').addEventListener('click', clearFields);

// Page navigation
$('btn-prev-page').addEventListener('click', async () => {
  if (state.currentPage > 1) {
    state.currentPage--;
    await renderPage(state.currentPage);
    updatePageIndicator();
  }
});
$('btn-next-page').addEventListener('click', async () => {
  if (state.currentPage < state.totalPages) {
    state.currentPage++;
    await renderPage(state.currentPage);
    updatePageIndicator();
  }
});

// Resizable divider
divider.addEventListener('mousedown', (e) => {
  e.preventDefault();
  state.resizing = true;
  divider.classList.add('dragging');
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
});
document.addEventListener('mousemove', (e) => {
  if (!state.resizing) return;
  const editorRect = editorScreen.getBoundingClientRect();
  const newWidth = Math.max(260, Math.min(600, e.clientX - editorRect.left));
  panelLeft.style.width = newWidth + 'px';
});
document.addEventListener('mouseup', () => {
  if (!state.resizing) return;
  state.resizing = false;
  divider.classList.remove('dragging');
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
  // Re-render current page to fit new width
  if (state.pdfDoc) renderPage(state.currentPage);
});

// Window resize → re-render
window.addEventListener('resize', () => {
  if (state.pdfDoc) renderPage(state.currentPage);
});
