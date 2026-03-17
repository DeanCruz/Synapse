// useElectronAPI — provides access to window.electronAPI with convenience
import { useMemo } from 'react';

export function useElectronAPI() {
  return useMemo(() => window.electronAPI || null, []);
}

export function useIsElectron() {
  return !!window.electronAPI;
}
