import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import Portal from './portal/Portal.jsx';
import { I18nProvider } from './i18n.jsx';
import { FeedbackProvider } from './ui.jsx';
import './styles.css';

// Deux applications au même endroit : le panel d'administration, et le portail des joueurs sous /portail.
const isPortal = /^\/(portail|portal)\b/.test(window.location.pathname);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <I18nProvider>
      {isPortal ? (
        <Portal />
      ) : (
        <BrowserRouter>
          <FeedbackProvider>
            <App />
          </FeedbackProvider>
        </BrowserRouter>
      )}
    </I18nProvider>
  </StrictMode>,
);
