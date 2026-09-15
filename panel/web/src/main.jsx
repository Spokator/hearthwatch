import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { I18nProvider } from './i18n.jsx';
import { FeedbackProvider } from './ui.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <I18nProvider>
        <FeedbackProvider>
          <App />
        </FeedbackProvider>
      </I18nProvider>
    </BrowserRouter>
  </StrictMode>,
);
