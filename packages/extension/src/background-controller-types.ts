export type NativePortLike = {
  readonly onMessage: {
    addListener(listener: (message: unknown) => void): void;
  };
  readonly onDisconnect: {
    addListener(listener: (error?: { readonly message?: string }) => void): void;
  };
  postMessage(message: unknown): void;
};

export type BackgroundRuntimeAdapter = {
  connectNative(name: string): NativePortLike;
};

export type BackgroundStorageAdapter = {
  getPairToken(): Promise<string | null>;
  setPairToken(token: string | null): Promise<void>;
};

export type ExtensionStatus = {
  readonly connected: boolean;
  readonly approved: boolean;
  readonly lastError?: string;
  readonly diagnostics: string;
};
