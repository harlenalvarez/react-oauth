import { useLayoutEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { AuthNavigationAdapter } from '@huddle-ai/auth';

export function useReactRouterAuthNavigation(basename = '/'): AuthNavigationAdapter {
  const location = useLocation();
  const navigate = useNavigate();
  const base = basename === '/' ? '' : `/${basename.replace(/^\/+|\/+$/g, '')}`;
  const path = `${base}${location.pathname}${location.search}${location.hash}`;
  const current = useRef(path);
  const listeners = useRef(new Set<() => void>());

  useLayoutEffect(() => {
    if (current.current === path) return;
    current.current = path;
    listeners.current.forEach((listener) => listener());
  }, [path]);

  return useMemo(() => ({
    navigate: ({ to, replace }) => {
      const target = new URL(to, window.location.origin);
      if (base !== '' && target.pathname !== base && !target.pathname.startsWith(`${base}/`)) {
        throw new Error('Auth navigation must stay inside the router basename.');
      }
      const pathname = target.pathname.slice(base.length) || '/';
      navigate(`${pathname}${target.search}${target.hash}`, { replace });
    },
    getLocation: () => current.current,
    subscribe: (listener) => {
      listeners.current.add(listener);
      return () => { listeners.current.delete(listener); };
    },
  }), [navigate, base]);
}
