export type Network = 'local' | 'testnet' | 'mainnet';
export type BackendMode = 'demo' | 'full';

export const config = {
  network: (import.meta.env.VITE_NETWORK ?? 'testnet') as Network,
  backend: (import.meta.env.VITE_BACKEND ?? 'demo') as BackendMode,
  apiUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4100',
};

export const isDemo = (): boolean => config.backend === 'demo';
