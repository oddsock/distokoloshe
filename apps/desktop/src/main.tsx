import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';
import { App } from './App';
import './styles/globals.css';

// Route cross-origin HTTP requests through Tauri's Rust backend.
// This bypasses WebView2's CORS enforcement on Windows.
const originalFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  const url = typeof input === 'string'
    ? input
    : input instanceof URL
      ? input.toString()
      : (input as Request).url;

  // Cross-origin requests go through Rust (no CORS issues)
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return tauriFetch(url, init);
  }

  // Same-origin / relative requests use the browser's native fetch
  return originalFetch(input, init);
}) as typeof window.fetch;

// Initialize dark mode from localStorage
const theme = localStorage.getItem('distokoloshe_theme') || 'dark';
document.documentElement.classList.toggle('dark', theme === 'dark');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
