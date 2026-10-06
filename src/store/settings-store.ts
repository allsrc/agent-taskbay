"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";

export const OUTPUT_MODE_OPTIONS = [
  { key: "text/plain", title: "Plain text" },
  { key: "text/markdown", title: "Markdown" },
  { key: "application/json", title: "Structured data" },
  { key: "application/pdf", title: "PDF files" },
] as const;

export interface ExtensionSetting {
  uri: string;
  enabled: boolean;
}

interface SettingsState {
  /** `acceptedOutputModes` used when an agent card doesn't declare its own. */
  acceptedOutputModes: string[];
  returnImmediately: boolean;
  /** Empty string = unset (no limit). */
  historyLength: string;
  extensions: ExtensionSetting[];
  toggleOutputMode: (mode: string) => void;
  setReturnImmediately: (value: boolean) => void;
  setHistoryLength: (value: string) => void;
  addExtension: (uri: string) => void;
  toggleExtension: (uri: string) => void;
  removeExtension: (uri: string) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      acceptedOutputModes: ["text/plain", "text/markdown", "application/json"],
      returnImmediately: false,
      historyLength: "",
      extensions: [],
      toggleOutputMode: (mode) =>
        set((state) => ({
          acceptedOutputModes: state.acceptedOutputModes.includes(mode)
            ? state.acceptedOutputModes.filter((item) => item !== mode)
            : [...state.acceptedOutputModes, mode],
        })),
      setReturnImmediately: (returnImmediately) => set({ returnImmediately }),
      setHistoryLength: (historyLength) => set({ historyLength }),
      addExtension: (uri) =>
        set((state) => (state.extensions.some((item) => item.uri === uri) ? state : { extensions: [...state.extensions, { uri, enabled: true }] })),
      toggleExtension: (uri) =>
        set((state) => ({ extensions: state.extensions.map((item) => (item.uri === uri ? { ...item, enabled: !item.enabled } : item)) })),
      removeExtension: (uri) => set((state) => ({ extensions: state.extensions.filter((item) => item.uri !== uri) })),
    }),
    { name: "agent-taskbay.settings" },
  ),
);
