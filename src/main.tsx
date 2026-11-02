import { createRoot } from 'react-dom/client';
import App from './App';
import { ThemeProvider } from './ui/theme';
import { installVenueBadgeIcons } from './venues/venueIcons';
import './index.css';

installVenueBadgeIcons();

createRoot(document.getElementById('root')!).render(
  <ThemeProvider>
    <App />
  </ThemeProvider>,
);
