
  import { createRoot } from "react-dom/client";
  import { Component, type ReactNode } from "react";
  import App from "./app/App.tsx";
  import "./styles/index.css";

  class ErrorBoundary extends Component<
    { children: ReactNode },
    { error: Error | null }
  > {
    constructor(props: { children: ReactNode }) {
      super(props);
      this.state = { error: null };
    }
    static getDerivedStateFromError(error: Error) {
      return { error };
    }
    render() {
      if (this.state.error) {
        return (
          <div style={{ padding: 32, fontFamily: 'monospace', background: '#fff1f2', minHeight: '100vh' }}>
            <h2 style={{ color: '#b91c1c', marginBottom: 12 }}>⚠ App crashed — error details:</h2>
            <pre style={{ background: '#fff', border: '1px solid #fca5a5', padding: 16, borderRadius: 8, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </pre>
          </div>
        );
      }
      return this.props.children;
    }
  }

  createRoot(document.getElementById("root")!).render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
