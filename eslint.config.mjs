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
          allowDefaultProject: [
            "*.config.*",
            ".*rc.*",
            "*.mjs",
            "scripts/*.cjs",
            "vscode/*.mjs",
            "vscode/scripts/*.mjs",
          ],
          /* Node utility scripts are not under a tsconfig root, so we whitelist them explicitly */
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
    files: ["*.mjs", "scripts/*.cjs", "vscode/**/*.mjs"],
    languageOptions: {
      globals: {
        __dirname: "readonly",
        console: "readonly",
        module: "readonly",
        process: "readonly",
        require: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-implied-eval": "off",
      "@typescript-eslint/no-require-imports": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
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
