import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles/globals.css';

// Initialize dark mode from localStorage
const theme = localStorage.getItem('distokoloshe_theme') || 'dark';
document.documentElement.classList.toggle('dark', theme === 'dark');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
