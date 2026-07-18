import React from 'react';
import ReactDOM from 'react-dom/client';
import { MantineProvider, type MantineColorScheme } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import '@mantine/core/styles.css';

const queryClient = new QueryClient();

function getColorScheme(): MantineColorScheme {
  const stored = localStorage.getItem('glcert-color-scheme');
  if (stored === 'light' || stored === 'dark') return stored;
  return 'auto';
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider theme={{ primaryColor: 'teal' }} defaultColorScheme={getColorScheme()}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </MantineProvider>
    </QueryClientProvider>
  </React.StrictMode>
);
