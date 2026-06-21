// ABOUTME: Configures ESLint rules for the Pi x IDE package and IDE plugins.
// ABOUTME: Defines TypeScript, JavaScript, and generated-output lint boundaries.
// @ts-check
import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { defineConfig } from "eslint/config";
import prettierConfig from "eslint-config-prettier";

export default defineConfig(
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
            "scripts/*.mjs",
            "ide-plugins/vscode/*.mjs",
            "ide-plugins/vscode/scripts/*.mjs",
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
    files: ["*.mjs", "scripts/**/*.mjs", "scripts/*.cjs", "ide-plugins/vscode/**/*.mjs"],
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
    files: ["ide-plugins/vscode/src/**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: {
          allowDefaultProject: [],
          defaultProject: "ide-plugins/vscode/tsconfig.json",
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
    ignores: [
      "dist/",
      "ide-plugins/nvim/bin/",
      "ide-plugins/vscode/out/",
      "ide-plugins/vscode/dist/",
      "ide-plugins/jetbrains/.gradle/",
      "ide-plugins/jetbrains/.intellijPlatform/",
      "ide-plugins/jetbrains/build/",
      "ide-plugins/jetbrains/out/",
      "ide-plugins/jetbrains/run/",
      "ide-plugins/jetbrains/sandbox/",
      "node_modules/",
      ".pi/",
      ".worktrees/",
    ],
  },
);
