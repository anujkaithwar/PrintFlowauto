import { Component, StrictMode, type ErrorInfo, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

try {
  registerSW({
    immediate: true,
    onRegisterError() {
      // Ignore Service Worker failures on non-HTTPS or restricted cPanel environments
    },
  });
} catch {
  // Ignore unsupported SW runtime errors
}

interface BoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { hasError: false, errorMessage: '' };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { hasError: true, errorMessage: error?.message || 'Unexpected render error' };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // Error captured cleanly by boundary UI
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full rounded-2xl border border-red-200 bg-white p-6 text-center space-y-4">
            <h1 className="text-lg font-bold text-slate-900">PrintFlow UI Recovery</h1>
            <p className="text-xs text-red-700 break-words">{this.state.errorMessage}</p>
            <div className="flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white cursor-pointer"
              >
                Reload Page
              </button>
              <a
                href="./install.php"
                className="rounded-xl border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-800"
              >
                Open install.php
              </a>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>
);
