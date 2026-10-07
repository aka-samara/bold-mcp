import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

// Names that may hold an API key or OAuth token. Any of them appearing inside
// a logging call is a lint error (brief: "a lint rule blocks logging variables
// named apiKey, key or token"). Log `keyFingerprint(apiKey)` instead.
const SECRET_NAMES = "^(apiKey|api_key|key|token|accessToken|refreshToken|access_token|refresh_token|authorization)$";
const LOG_METHODS = "^(log|info|warn|error|debug|trace|fatal|child)$";

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "coverage/**"] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "no-restricted-syntax": [
        "error",
        {
          selector: `CallExpression[callee.property.name=/${LOG_METHODS}/] Identifier[name=/${SECRET_NAMES}/]`,
          message: "Never log API keys or tokens. Log keyFingerprint(apiKey) instead.",
        },
        {
          selector: `CallExpression[callee.property.name=/${LOG_METHODS}/] Property[key.name=/${SECRET_NAMES}/]`,
          message: "Never log API keys or tokens. Log keyFingerprint(apiKey) instead.",
        },
      ],
    },
  },
);
