import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** When this changes the boundary clears, so moving to another page recovers. */
  resetKey?: string;
  fallback(error: unknown, retry: () => void): ReactNode;
  children?: ReactNode;
}

export class ErrorBoundary extends Component<Props, { error: unknown; failed: boolean }> {
  state = { error: null as unknown, failed: false };

  static getDerivedStateFromError(error: unknown) {
    return { error, failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("Page error", error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) this.setState({ error: null, failed: false });
  }

  retry = () => this.setState({ error: null, failed: false });

  render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.state.error, this.retry) : this.props.children;
  }
}
