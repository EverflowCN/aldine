import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import Home from './pages/Home';
const Editor = lazy(() => import('./pages/Editor'));
const OAuthConsent = lazy(() => import('./pages/OAuthConsent'));
const Admin = lazy(() => import('./pages/Admin'));
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


export default function ServerApp() {
  return <ToastProvider><DialogProvider><AuthProvider>
    <BrowserRouter basename={BASE_PATH} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Suspense fallback={<div className="browser-editor-loading">正在打开页面…</div>}><Routes>
        <Route path="/" element={<Home />} />
        <Route path="/p/:id" element={<Editor />} />
        <Route path="/oauth/authorize" element={<OAuthConsent />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<NotFound />} />
      </Routes></Suspense>
    </BrowserRouter>
  </AuthProvider></DialogProvider></ToastProvider>;
}
