import { defineConfig, globalIgnores } from "eslint/config";
import nextConfig from "eslint-config-next/core-web-vitals";

export default defineConfig([
  ...nextConfig,
  {
    rules: {
      "react-hooks/set-state-in-effect": "off",
      "@next/next/no-img-element": "off",
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  globalIgnores([
    "**/.next/**",
    "**/dist/**",
    "**/coverage/**",
    "**/artifacts/**",
    "**/test-results/**",
    "**/playwright-report/**",
    "contracts/lib/**",
    "contracts/out/**",
    "contracts/cache/**",
    "supabase/.temp/**",
  ]),
]);
