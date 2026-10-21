import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, localStorageColorSchemeManager } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { theme, cssVariablesResolver } from './theme/theme';
import './theme/global.css';
import App from './App';

const queryClient = new QueryClient();

// Same key and values ('light' | 'dark' | 'auto') the app has always stored, so saved choices
// carry over.
const colorSchemeManager = localStorageColorSchemeManager({ key: 'glcert-color-scheme' });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider
        theme={theme}
        cssVariablesResolver={cssVariablesResolver}
        colorSchemeManager={colorSchemeManager}
        defaultColorScheme="auto"
      >
        <Notifications position="top-right" />
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </MantineProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
