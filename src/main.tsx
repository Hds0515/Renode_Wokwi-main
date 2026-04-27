/**
 * React renderer bootstrap.
 *
 * The interesting application logic starts in App.tsx; this file only mounts
 * the root component into Electron's browser window.
 */
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
