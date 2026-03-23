const closeBtn = document.getElementById('close-btn');

if (closeBtn) {
  closeBtn.addEventListener('click', () => {
    window.close();
  });
}

// Adjust UI for macOS dragging
const isMac = navigator.userAgent.includes('Mac OS X');
if (!isMac) {
  document.querySelector('.header').style.paddingLeft = '24px';
} else {
  // Hide custom close button on mac because native traffic lights are used on the left
  if (closeBtn) {
    closeBtn.style.display = 'none';
  }
}

// Exit button logic
const btnExit = document.getElementById('btn-exit');
if (btnExit) {
  btnExit.addEventListener('click', () => {
    window.close();
  });
}
