import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home';
import BrowserWorkspace from './pages/BrowserWorkspace';
import Editor from './pages/Editor';
import OAuthConsent from './pages/OAuthConsent';
import Admin from './pages/Admin';
import { BASE_PATH } from './basePath';

function NotFound() {
  return (
    <div className="notfound">
      <h1>Page not found</h1>
      <p>That page doesn’t exist.</p>
      <Link className="btn btn--primary" to="/">Back to your projects</Link>
    </div>
  );
}
import { ToastProvider } from './components/Toast';
import { DialogProvider } from './components/Dialogs';
import { AuthProvider } from './components/Auth';
import './theme.css';
import './app.css';

// GitHub Pages has no Node/Fastify service: open the native Aldine Chinese
// editor with local BusyTeX by default. Real Aldine server HTML doesn't carry
// this meta marker and continues to use normal server routes.
const params = new URLSearchParams(window.location.search);
const isStaticSite = document.querySelector('meta[name="aldine-static-pages"]')?.getAttribute('content') === '1';
const localBrowserMode = params.get('local') === '1' || (isStaticSite && params.get('server') !== '1');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {localBrowserMode ? <BrowserWorkspace /> : (
    <ToastProvider>
     <DialogProvider>
      <AuthProvider>
        <BrowserRouter basename={BASE_PATH} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/p/:id" element={<Editor />} />
            <Route path="/oauth/authorize" element={<OAuthConsent />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
     </DialogProvider>
    </ToastProvider>
    )}
  </React.StrictMode>,
);
