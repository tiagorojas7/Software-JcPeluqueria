import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Imported first, and before `./App`: every other stylesheet in this app
// (PublicLayout, PanelLayout, HomePage, ...) reads CSS custom properties
// this file defines. Load order determines cascade order for same-
// specificity rules, so this must resolve before any component CSS does.
import './styles/tokens.css';
import { App } from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('Root element #root not found in index.html');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
