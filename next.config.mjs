/** @type {import("next").NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  // Keep Node-only database drivers (including PGlite's WASM assets) outside
  // the Server Components/Route Handler bundle. All database entry points run
  // in the Node.js runtime.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "@mikro-orm/migrations",
    "@mikro-orm/pglite",
    "@mikro-orm/postgresql",
  ],
  async headers() {
    const isProd = process.env.NODE_ENV === "production";
    const scriptSrc = isProd ? "'self' 'unsafe-inline'" : "'self' 'unsafe-inline' 'unsafe-eval'";
    const securityHeaders = [
      { key: "Content-Security-Policy", value: `default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none'; script-src ${scriptSrc}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' data: blob: https:; connect-src 'self'; font-src 'self' data:` },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
      { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    ];
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
