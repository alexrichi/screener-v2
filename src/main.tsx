import { createRoot } from 'react-dom/client';
import App from './App';
import { BUILD_VERSION } from './lib/buildVersion';
import { ThemeProvider } from './ui/theme';
import { installVenueBadgeIcons } from './venues/venueIcons';
import './index.css';

document.documentElement.dataset.buildVersion = BUILD_VERSION;

installVenueBadgeIcons();

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
);
