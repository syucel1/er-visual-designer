import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { useStore } from './store/store';
import './styles.css';

// Test hook for end-to-end tests: open the app with ?debug to expose the store.
if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __erdStore: typeof useStore }).__erdStore = useStore;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
