#!/usr/bin/env node
const { readFileSync, writeFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const { fileURLToPath } = require("node:url");
const ts = require("typescript");

const root = resolve(__dirname, "..");
const optionsPath = resolve(root, "src", "shared", "config-options.ts");
const schemaPath = resolve(root, "schemas", "config.json");
const check = process.argv.includes("--check");

const { CONFIG_OPTIONS, CONFIG_ENV_OPTIONS, CONFIG_ENV_PATTERN_OPTIONS, CONFIG_ENV_VALUE_TYPES } =
  loadConfigOptions(optionsPath);
const schema = buildSchema(CONFIG_OPTIONS, CONFIG_ENV_OPTIONS, CONFIG_ENV_PATTERN_OPTIONS, CONFIG_ENV_VALUE_TYPES);
const content = `${JSON.stringify(schema, null, 2)}\n`;

if (check) {
  const current = readFileSync(schemaPath, "utf8");
  if (current !== content) {
    console.error(`${relativeToRoot(schemaPath)} is out of date. Run bun run generate:config-schema.`);
    process.exitCode = 1;
  }
} else {
  writeFileSync(schemaPath, content);
}

function loadConfigOptions(path) {
  const source = readFileSync(path, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: path,
    reportDiagnostics: true,
  });

  const errors = output.diagnostics?.filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error) ?? [];
  if (errors.length > 0) {
    for (const error of errors) console.error(ts.flattenDiagnosticMessageText(error.messageText, "\n"));
    process.exit(1);
  }

  const module = { exports: {} };
  const localRequire = (specifier) => {
    if (specifier === "node:url") return { fileURLToPath };
    throw new Error(`Unexpected require from config options: ${specifier}`);
  };
  const compiledDir = dirname(path);
  const execute = new Function("exports", "require", "module", "__filename", "__dirname", output.outputText);
  execute(module.exports, localRequire, module, path, compiledDir);
  return module.exports;
}

function buildSchema(configOptions, envOptions, envPatternOptions, valueTypes) {
  const topLevelProperties = Object.fromEntries(
    Object.entries(configOptions).map(([name, option]) => [name, buildOptionSchema(option)]),
  );
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "https://github.com/balaenis/pi-x-ide/schemas/config.json",
    title: "Pi config.json",
    description: "Schema for Pi-side configuration read from ~/.pi/pi-x-ide/config.json.",
    type: "object",
    additionalProperties: true,
    properties: {
      ...topLevelProperties,
      env: {
        type: "object",
        description: "Pi-side environment variables. Real environment variables override these values.",
        additionalProperties: { type: [...valueTypes] },
        properties: Object.fromEntries(
          Object.entries(envOptions).map(([name, option]) => [name, buildEnvOptionSchema(option)]),
        ),
        patternProperties: Object.fromEntries(
          envPatternOptions.map((option) => [option.pattern, buildEnvOptionSchema(option)]),
        ),
      },
    },
    examples: [
      {
        ...Object.fromEntries(
          Object.entries(configOptions).flatMap(([name, option]) =>
            option.default ? [[name, option.default]] : [],
          ),
        ),
        env: {
          PI_X_IDE_AUTO_INSTALL: "0",
          PI_X_IDE_ATTACH_SHORTCUT: "ctrl+alt+k",
          PI_X_IDE_ZED_DB: "/home/user/.local/share/zed/db/0-stable/db.sqlite",
          PI_X_IDE_ZED_POLL_INTERVAL_MS: 1000,
        },
      },
    ],
  };
}

function buildOptionSchema(option) {
  const schema = { type: option.type.length === 1 ? option.type[0] : [...option.type], description: option.description };
  if (option.default !== undefined) schema.default = option.default;
  return schema;
}

function buildEnvOptionSchema(option) {
  return {
    type: option.type.length === 1 ? option.type[0] : [...option.type],
    description: option.description,
  };
}

function relativeToRoot(path) {
  return path.startsWith(root) ? path.slice(root.length + 1) : path;
}
