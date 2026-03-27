const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  openFile: () => ipcRenderer.invoke('dialog:openFile'),
  readFields: (filePath) => ipcRenderer.invoke('pdf:readFields', filePath),
  writeFields: (filePath, fieldValues, customFileName) => ipcRenderer.invoke('pdf:writeFields', filePath, fieldValues, customFileName),
  previewWithFields: (filePath, fieldValues) => ipcRenderer.invoke('pdf:previewWithFields', filePath, fieldValues),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  openTutorial: () => ipcRenderer.invoke('tutorial:open'),
});
