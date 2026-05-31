export interface NativePortLike {
  readonly onMessage: {
    addListener(listener: (message: unknown) => void): void;
  };
  readonly onDisconnect: {
    addListener(listener: (error?: { readonly message?: string }) => void): void;
  };
  postMessage(message: unknown): void;
}

export interface BackgroundRuntimeAdapter {
  connectNative(name: string): NativePortLike;
}

export interface BackgroundStorageAdapter {
  getPairToken(): Promise<string | null>;
  setPairToken(token: string | null): Promise<void>;
}

export interface ExtensionStatus {
  readonly connected: boolean;
  readonly approved: boolean;
  readonly lastError?: string;
  readonly diagnostics: string;
}
