import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/*
 * Only the hook rules. Formatting and style are the codebase's own; what a linter catches here
 * that tsc cannot is an effect reading a value its dependency list leaves out.
 */
export default tseslint.config(
  { ignores: ["dist/**", "public/**"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: { parser: tseslint.parser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "error",
    },
  },
);
