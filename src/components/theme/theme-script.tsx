export const THEME_STORAGE_KEY = "agent-taskbay-theme"

/**
 * Runs synchronously in <head> before first paint. Resolves the stored
 * preference (light | dark | system, default system) and applies the
 * `.dark` class + color-scheme to <html> so there is never a flash.
 */
const script = `(function(){try{var k="${THEME_STORAGE_KEY}";var p=localStorage.getItem(k);if(p!=="light"&&p!=="dark")p="system";var d=p==="dark"||(p==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";r.dataset.themePreference=p}catch(e){}})()`

export function ThemeScript() {
  return <script dangerouslySetInnerHTML={{ __html: script }} />
}
