const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { PDFDocument } = require('pdf-lib');

let mainWindow;
let lastSaveDir = null; // Último diretório de salvamento usado pelo usuário

const getConfigPath = () => path.join(app.getPath('userData'), 'config.json');

function loadLastSaveDir() {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf-8');
      const data = JSON.parse(content);
      if (data && data.lastSaveDir) {
        return data.lastSaveDir;
      }
    }
  } catch (e) {
    console.error('Failed to load config:', e);
  }
  return null;
}

function saveLastSaveDir(dir) {
  try {
    const configPath = getConfigPath();
    const data = { lastSaveDir: dir };
    fs.writeFileSync(configPath, JSON.stringify(data), 'utf-8');
  } catch (e) {
    console.error('Failed to save config:', e);
  }
}

function getNearestExistingDir(dir) {
  try {
    let currentDir = dir;
    while (currentDir) {
      if (fs.existsSync(currentDir)) {
        const stat = fs.statSync(currentDir);
        if (stat.isDirectory()) {
          return currentDir;
        }
      }
      const parent = path.dirname(currentDir);
      if (parent === currentDir) {
        break;
      }
      currentDir = parent;
    }
  } catch (e) {
    console.error('Error finding nearest existing directory:', e);
  }
  return null;
}

function createMenu() {
  const template = [
    {
      label: 'Arquivo',
      submenu: [
        { label: 'Sair', role: 'quit' }
      ]
    },
    {
      label: 'Editar',
      submenu: [
        { label: 'Desfazer', role: 'undo' },
        { label: 'Refazer', role: 'redo' },
        { type: 'separator' },
        { label: 'Recortar', role: 'cut' },
        { label: 'Copiar', role: 'copy' },
        { label: 'Colar', role: 'paste' },
        { label: 'Selecionar Tudo', role: 'selectAll' }
      ]
    },
    {
      label: 'Visualizar',
      submenu: [
        { label: 'Recarregar', role: 'reload' },
        { label: 'Alternar Tela Cheia', role: 'togglefullscreen' },
        { type: 'separator' },
        { label: 'Zoom +', role: 'zoomIn' },
        { label: 'Zoom -', role: 'zoomOut' },
        { label: 'Resetar Zoom', role: 'resetZoom' }
      ]
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Tutorial',
          click: () => openTutorialWindow()
        },
        {
          label: 'Sobre',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '',
              message: 'Anexo IX Plennus',
              detail: 'Autor: 1T Juliano\ne-mail: julianojri@fab.mil.br\nVersão: 1.1.0',
              buttons: ['OK'],
              icon: path.join(__dirname, 'src', 'assets', 'autor.png')
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

function openTutorialWindow() {
  let tutorialWin = new BrowserWindow({
    width: 800,
    height: 650,
    parent: mainWindow,
    modal: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'darwin',
    backgroundColor: '#0a0b10',
    show: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  tutorialWin.loadFile(path.join(__dirname, 'src', 'tutorial.html'));
  tutorialWin.once('ready-to-show', () => {
    tutorialWin.show();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1380,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    frame: process.platform !== 'darwin',
    backgroundColor: '#0f1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, 'src', 'assets', 'pdf.png'),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

app.whenReady().then(() => {
  createMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ─── IPC: Open file dialog ────────────────────────────────────────────────────
ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Selecionar PDF',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile'],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// ─── IPC: Open Tutorial window ────────────────────────────────────────────────
ipcMain.handle('tutorial:open', () => {
  openTutorialWindow();
});

// ─── IPC: Read PDF fields ─────────────────────────────────────────────────────
ipcMain.handle('pdf:readFields', async (_event, filePath) => {
  try {
    const bytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const form = pdfDoc.getForm();
    const fields = form.getFields();

    const result = fields.map((field) => {
      const name = field.getName();
      const type = field.constructor.name; // PDFTextField, PDFCheckBox, PDFRadioGroup, PDFDropdown, PDFOptionList, PDFSignature

      let value = null;
      let options = [];

      try {
        if (type === 'PDFTextField') {
          value = field.getText() || '';
        } else if (type === 'PDFCheckBox') {
          value = field.isChecked();
        } else if (type === 'PDFRadioGroup') {
          value = field.getSelected() || '';
          options = field.getOptions();
        } else if (type === 'PDFDropdown') {
          const selected = field.getSelected();
          value = Array.isArray(selected) ? selected[0] || '' : selected || '';
          options = field.getOptions();
        } else if (type === 'PDFOptionList') {
          value = field.getSelected() || [];
          options = field.getOptions();
        } else if (type === 'PDFSignature') {
          value = '[Assinatura]';
        }
      } catch (e) {
        value = '';
      }

      return { name, type, value, options };
    });

    // Also read the PDF as base64 for preview
    const pdfBase64 = bytes.toString('base64');

    return { fields: result, pdfBase64, error: null };
  } catch (err) {
    return { fields: [], pdfBase64: null, error: err.message };
  }
});

// ─── Shared: apply field values to a loaded PDFDocument ──────────────────────
async function applyFieldValues(pdfDoc, fieldValues) {
  const form = pdfDoc.getForm();
  for (const [name, value] of Object.entries(fieldValues)) {
    try {
      const field = form.getFieldMaybe(name);
      if (!field) continue; // Skip if field doesn't exist in this PDF

      const type = field.constructor.name;
      if (type === 'PDFTextField') {
        field.setText(String(value));
      } else if (type === 'PDFCheckBox') {
        if (value) field.check();
        else field.uncheck();
      } else if (type === 'PDFRadioGroup') {
        if (value) field.select(value);
      } else if (type === 'PDFDropdown') {
        if (value) field.select(value);
      } else if (type === 'PDFOptionList') {
        if (Array.isArray(value) && value.length > 0) field.select(value[0]);
      }
    } catch (e) {
      console.warn(`Could not set field "${name}":`, e.message);
    }
  }
}

// ─── IPC: Write PDF fields ────────────────────────────────────────────────────
ipcMain.handle('pdf:writeFields', async (_event, filePath, fieldValues, customFileName) => {
  try {
    const bytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    await applyFieldValues(pdfDoc, fieldValues);
    const savedBytes = await pdfDoc.save({ updateFieldAppearances: true });

    // Save dialog
    const ext = path.extname(filePath);
    const baseFileName = customFileName
      ? customFileName + ext
      : path.basename(filePath, ext) + '_preenchido' + ext;

    // Load lastSaveDir from persistent store if null
    if (lastSaveDir === null) {
      lastSaveDir = loadLastSaveDir();
    }

    // Usa o último diretório salvo pelo usuário; caso não exista, usa o diretório do PDF de origem
    let saveDir = lastSaveDir;
    if (saveDir) {
      saveDir = getNearestExistingDir(saveDir);
    }
    if (!saveDir) {
      saveDir = path.dirname(filePath);
      saveDir = getNearestExistingDir(saveDir);
    }
    if (!saveDir) {
      saveDir = app.getPath('documents');
    }
    const defaultPath = path.join(saveDir, baseFileName);

    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: 'Salvar PDF preenchido',
      defaultPath,
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });

    if (saveResult.canceled) return { success: false, message: 'Cancelado' };

    fs.writeFileSync(saveResult.filePath, savedBytes);
    // Memoriza o diretório onde o usuário salvou para a próxima vez
    lastSaveDir = path.dirname(saveResult.filePath);
    saveLastSaveDir(lastSaveDir);
    return { success: true, savedPath: saveResult.filePath };
  } catch (err) {
    return { success: false, message: err.message };
  }
});

// ─── IPC: Preview PDF with current field values (in-memory, no save) ──────────
ipcMain.handle('pdf:previewWithFields', async (_event, filePath, fieldValues) => {
  try {
    const bytes = fs.readFileSync(filePath);
    const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    await applyFieldValues(pdfDoc, fieldValues);
    const previewBytes = await pdfDoc.save({ updateFieldAppearances: true });
    return { pdfBase64: Buffer.from(previewBytes).toString('base64'), error: null };
  } catch (err) {
    return { pdfBase64: null, error: err.message };
  }
});
