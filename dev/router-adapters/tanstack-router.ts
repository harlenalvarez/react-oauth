import type { AnyRouter } from '@tanstack/react-router';
import type { AuthNavigationAdapter } from '@huddle-ai/auth';

export function adaptTanStackRouter(router: AnyRouter): AuthNavigationAdapter {
  return {
    // href is the public app path; the router translates its configured basepath.
    navigate: ({ to, replace }) => router.navigate({ href: to, replace }),
    getLocation: () => {
      const { pathname, search, hash } = router.history.location;
      return `${pathname}${search}${hash}`;
    },
    subscribe: (listener) => router.history.subscribe(listener),
  };
}
