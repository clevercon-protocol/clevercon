import { QueryClient } from '@tanstack/react-query';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      // Short staleness so returning to the tab or remounting shows current data,
      // without refetching on every render. Per-query refetchInterval is used
      // sparingly (only the vault) to keep load predictable as users scale.
      staleTime: 10_000,
      refetchOnWindowFocus: true,
    },
  },
});
