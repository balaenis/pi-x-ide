// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";

export default tseslint.config(
  // Base recommended rules
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  // ---- Global options ----
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: ["*.config.*", ".*rc.*", "*.mjs", "vscode/*.mjs", "vscode/scripts/*.mjs"],
          /* vscode/esbuild.mjs is not under a tsconfig root, so we whitelist it explicitly */
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Allow unused vars prefixed with underscore
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  // ---- Node.js JavaScript utility scripts ----
  {
    files: ["*.mjs", "vscode/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
  },

  // ---- Root source + test files ----
  {
    files: ["src/**/*.ts", "test/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },

  // ---- vscode workspace files ----
  {
    files: ["vscode/src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [],
          defaultProject: "vscode/tsconfig.json",
        },
      },
    },
  },

  // ---- Disable rules that don't work for this project ----
  {
    rules: {
      // Empty interfaces extending a supertype are used for semantic subtypes
      // that may gain properties later (e.g., SelectionChangedParams extends EditorSelectionSnapshot)
      "@typescript-eslint/no-empty-object-type": "off",
    },
  },

  // ---- Prettier (must be last to disable conflicting rules) ----
  prettierConfig,

  // ---- Global ignores ----
  {
    ignores: ["dist/", "vscode/out/", "vscode/dist/", "node_modules/", ".pi/"],
  },
);
