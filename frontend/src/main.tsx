import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { registerPwaServiceWorker } from './utils/pwa';
import { installGlobalTelemetry } from './utils/telemetry';

installGlobalTelemetry();
void registerPwaServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
