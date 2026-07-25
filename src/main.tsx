import React from 'react';
import ReactDOM from 'react-dom/client';
import { TooltipProvider } from '@shared/components/ui/tooltip';
import { Toaster } from '@shared/components/ui/sonner';
import App from './App';
import './styles/index.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <TooltipProvider delay={300}>
      <App />
      <Toaster richColors closeButton position="bottom-right" />
    </TooltipProvider>
  </React.StrictMode>,
);