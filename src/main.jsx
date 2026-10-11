import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import App from './App';
import './styles.css';

flushSync(() => createRoot(document.getElementById('root')).render(<App />));

// The Node-enabled desktop controller is deliberately not bundled by Vite.
// A browser-only preview shows the UI without touching real sessions or files.
if (typeof window.require === 'function') {
  const script = document.createElement('script');
  script.src = new URL('../renderer.js', window.location.href).href;
  script.onerror = () => {
    document.getElementById('authStatus').textContent = 'Desktop controller could not load. Run npm start from the project folder.';
  };
  document.body.appendChild(script);
} else {
  document.getElementById('authStatus').textContent = 'UI preview only. Run npm start to connect WhatsApp.';
}
