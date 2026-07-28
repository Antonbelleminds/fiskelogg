import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const [nextBase, ...nextConfigs] = nextCoreWebVitals

export default defineConfig([
  {
    ...nextBase,
    rules: {
      ...nextBase.rules,
      "@next/next/no-img-element": "off",
      // These React 19 compiler-oriented rules are stricter than the legacy
      // codebase. Keep them visible without making the existing app unbuildable.
      "react-hooks/immutability": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  ...nextConfigs,
])
