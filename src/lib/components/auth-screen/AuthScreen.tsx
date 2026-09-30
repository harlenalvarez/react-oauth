import type { ComponentPropsWithoutRef, ReactElement } from 'react';
import './AuthScreen.css';

export type AuthScreenProps = ComponentPropsWithoutRef<'main'>;

export function AuthScreen({ className, children, ...props }: AuthScreenProps): ReactElement {
  return <main {...props} className={className === undefined ? 'react-oauth-screen' : `react-oauth-screen ${className}`}>
    {children}
  </main>;
}
