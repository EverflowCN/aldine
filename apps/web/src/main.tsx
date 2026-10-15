import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import BrowserWorkspace from './pages/BrowserWorkspace';
import './theme.css';
import './app.css';
const ServerApp = lazy(() => import('./ServerApp'));

// GitHub Pages has no Node/Fastify service: open the native Aldine Chinese
// editor with local BusyTeX by default. Real Aldine server HTML doesn't carry
// this meta marker and continues to use normal server routes.
const params = new URLSearchParams(window.location.search);
const isStaticSite = document.querySelector('meta[name="aldine-static-pages"]')?.getAttribute('content') === '1';
const localBrowserMode = params.get('local') === '1' || (isStaticSite && params.get('server') !== '1');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {localBrowserMode ? <BrowserWorkspace /> : <Suspense fallback={<div className="browser-editor-loading">正在打开页面…</div>}><ServerApp /></Suspense>}
  </React.StrictMode>,
);
