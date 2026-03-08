import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';

// Initialize dark mode from localStorage
const theme = localStorage.getItem('distokoloshe_theme') || 'dark';
document.documentElement.classList.toggle('dark', theme === 'dark');

// Clear webview cache on version change (preserves localStorage with tokens/settings)
if ('__TAURI_INTERNALS__' in window) {
  import('@tauri-apps/api/app').then(({ getVersion }) =>
    getVersion().then((v) => {
      const key = 'distokoloshe_app_version';
      const prev = localStorage.getItem(key);
      if (prev && prev !== v) {
        caches.keys().then((names) => names.forEach((n) => caches.delete(n)));
      }
      localStorage.setItem(key, v);
    }),
  ).catch(() => {});
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
