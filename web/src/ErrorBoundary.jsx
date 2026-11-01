import { Component } from 'react';

// A screen that can't load (weak Wi-Fi, or a tab left open across an update) must
// not blank the whole app. Reloading fetches it again, and the journal is on the
// device, so nothing is lost.
export default class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app">
        <div className="stack" role="alert" style={{ marginTop: '30vh' }}>
          <h1>This page didn’t load</h1>
          <p className="muted">Check your connection and try again. Your journal is safe on this device.</p>
          <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
        </div>
      </main>
    );
  }
}
