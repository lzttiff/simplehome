import React, { PropsWithChildren } from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

export const createTestQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const url = String(queryKey[0]);
          const response = await fetch(url, {
            credentials: 'include',
            cache: 'no-store',
          });

          if (!response.ok) {
            const message = (await response.text()) || response.statusText;
            throw new Error(`${response.status}: ${message}`);
          }

          return response.json();
        },
      },
      mutations: {
        retry: false,
      },
    },
  });

type RenderWithClientOptions = Omit<RenderOptions, 'wrapper'> & {
  client?: QueryClient;
};

export function renderWithQueryClient(
  ui: React.ReactElement,
  options: RenderWithClientOptions = {},
) {
  const { client = createTestQueryClient(), ...renderOptions } = options;

  function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }

  return {
    client,
    ...render(ui, {
      wrapper: Wrapper,
      ...renderOptions,
    }),
  };
}

export function mockJsonFetch(
  handlers: Record<string, unknown | ((url: string) => unknown | Promise<unknown>)>,
) {
  const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    for (const [key, valueOrResolver] of Object.entries(handlers)) {
      if (!url.includes(key)) {
        continue;
      }

      const payload =
        typeof valueOrResolver === 'function'
          ? await valueOrResolver(url)
          : valueOrResolver;

      return {
        ok: true,
        status: 200,
        json: async () => payload,
        text: async () => JSON.stringify(payload),
      } as Response;
    }

    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => '{}',
    } as Response;
  });

  global.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}
