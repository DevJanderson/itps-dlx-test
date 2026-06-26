#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";

const VERSION = "0.3.0";
const DEFAULT_STYLES_PACKAGE =
  "https://github.com/DevJanderson/itps-dlx-test/releases/download/v0.3.0-test/itps-styles-0.3.0.tgz";
const INLINE_START = "/* itps-theme:start */";
const INLINE_END = "/* itps-theme:end */";
const LEGACY_INLINE_START = "/* sinapse-theme:start */";
const LEGACY_INLINE_END = "/* sinapse-theme:end */";

const CSS_CANDIDATES = [
  "src/index.css",
  "src/main.css",
  "src/globals.css",
  "src/global.css",
  "src/styles/global.css",
  "src/styles/globals.css",
  "app/globals.css",
  "src/app/globals.css",
  "styles/globals.css",
  "styles/global.css",
  "assets/css/main.css",
  "app/assets/css/main.css",
];

const BUTTON_CANDIDATES = [
  "src/components/ui/button.tsx",
  "components/ui/button.tsx",
  "app/components/ui/button.tsx",
  "src/components/ui/button/index.ts",
  "components/ui/button/index.ts",
  "app/components/ui/button/index.ts",
];

const LEGACY_SINAPSE_BUTTON_VARIANT_PATTERN = /\n\s*sinapse:\n\s*"rounded-form border border-primary-900 bg-background text-info hover:border-primary-900 hover:bg-primary hover:text-primary-foreground active:border-primary-900 active:bg-primary active:text-primary-foreground",?/;
const LEGACY_ITPS_BUTTON_ROUNDED_PREFIX_PATTERNS = [
  /(\n\s*itps:\n\s*")rounded-form\s+/,
  /(\n\s*itpsSecondary:\n\s*")rounded-form\s+/,
];
const THEME_DECLARATIONS = new Set([
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--destructive-foreground",
  "--border",
  "--input",
  "--ring",
  "--chart-1",
  "--chart-2",
  "--chart-3",
  "--chart-4",
  "--chart-5",
  "--radius",
  "--sidebar",
  "--sidebar-foreground",
  "--sidebar-primary",
  "--sidebar-primary-foreground",
  "--sidebar-accent",
  "--sidebar-accent-foreground",
  "--sidebar-border",
  "--sidebar-ring",
]);

const COMMAND_HANDLERS = {
  help: () => printHelp(),
  "--help": () => printHelp(),
  "-h": () => printHelp(),
  "--version": () => console.log(VERSION),
  "-v": () => console.log(VERSION),
  init: (args) => runInit(parseInitArgs(args)),
};

function main() {
  const [command = "help", ...args] = process.argv.slice(2);
  const handler = COMMAND_HANDLERS[command];

  if (!handler) {
    fail(`Comando desconhecido: ${command}`);
  }

  handler(args);
}

function parseInitArgs(args) {
  const options = {
    css: undefined,
    dryRun: false,
    install: true,
    packageSpec: DEFAULT_STYLES_PACKAGE,
  };

  for (let index = 0; index < args.length; index += 1) {
    index += applyInitArg(options, args, index);
  }

  return options;
}

function applyInitArg(options, args, index) {
  const arg = args[index];
  const equals = arg.match(/^(--css|--package)=(.+)$/);

  if (equals) {
    assignInitValue(options, equals[1], equals[2]);
    return 0;
  }

  if (arg === "--css" || arg === "--package") {
    assignInitValue(options, arg, readValue(args, index, arg));
    return 1;
  }

  if (applyBooleanInitArg(options, arg)) {
    return 0;
  }

  fail(`Opcao desconhecida: ${arg}`);
}

function assignInitValue(options, flag, value) {
  if (flag === "--css") {
    options.css = value;
    return;
  }

  options.packageSpec = value;
}

function applyBooleanInitArg(options, arg) {
  const handlers = {
    "--dry-run": () => {
      options.dryRun = true;
    },
    "--skip-install": () => {
      options.install = false;
    },
    "--inline": () => {},
  };
  const handler = handlers[arg];

  if (!handler) {
    return false;
  }

  handler();
  return true;
}

function runInit(options) {
  const root = process.cwd();
  assertConsumerRoot(root);
  const cssPath = resolveCssPath(root, options.css);
  const buttonPath = resolveButtonPath(root);
  const packageManager = detectPackageManager(root);

  installIfNeeded(options, packageManager);
  const before = readFileSync(cssPath, "utf8");
  const theme = resolveTheme(root, options);
  const after = theme ? transformCss(before, theme) : before;
  const buttonPatch = buttonPath && getButtonPatch(buttonPath);

  if (options.dryRun) {
    printDryRun({ after, before, buttonPatch, cssPath, packageManager, root, theme }, options);
    return;
  }

  writeCssResult({ after, before, cssPath, root });
  writeButtonPatch({ buttonPatch, root });
  printAppliedTheme();
}

function assertConsumerRoot(root) {
  if (!existsSync(join(root, "package.json"))) {
    fail("Execute o init na raiz do projeto consumidor, onde existe package.json.");
  }
}

function installIfNeeded(options, packageManager) {
  if (!options.dryRun && options.install) {
    runPackageInstall(packageManager, options.packageSpec);
  }
}

function resolveTheme(root, options) {
  const inlineTheme = readInlineShadcnTheme(root, {
    allowMissing: options.dryRun && options.install,
  });
  return inlineTheme && { kind: "inline", value: inlineTheme };
}

function buildInitSteps(root, cssPath, packageManager, options) {
  const steps = [];
  if (options.install) {
    steps.push(`${packageManager} add ${options.packageSpec}`);
  }
  steps.push(`Atualizar ${relative(root, cssPath)} (inline)`);
  const buttonPath = resolveButtonPath(root);
  if (buttonPath) {
    steps.push(`Adicionar variants itps em ${relative(root, buttonPath)}`);
  }
  return steps;
}

function printDryRun(context, options) {
  console.log("ITpS init em modo dry-run.");
  for (const step of buildInitSteps(context.root, context.cssPath, context.packageManager, options)) {
    console.log(`- ${step}`);
  }

  if (!context.theme) {
    console.log(
      "\nCSS resultante indisponivel no dry-run inline porque @itps/styles ainda nao esta instalado.",
    );
    console.log("Rode sem --dry-run para instalar e aplicar, ou instale @itps/styles antes.");
    return;
  }

  if (context.before !== context.after) {
    console.log("\nCSS resultante:\n");
    console.log(context.after);
  } else {
    console.log("\nCSS ja estava configurado.");
  }

  if (context.buttonPatch?.changed) {
    console.log(`\nVariants itps seriam adicionadas em ${relative(context.root, context.buttonPatch.path)}.`);
  }
}

function writeCssResult({ after, before, cssPath, root }) {
  if (before !== after) {
    writeFileSync(cssPath, after);
    console.log(`Atualizado ${relative(root, cssPath)}.`);
    return;
  }

  console.log(`${relative(root, cssPath)} ja estava configurado.`);
}

function printAppliedTheme() {
  console.log("Tema ITpS aplicado inline.");
}

function writeButtonPatch({ buttonPatch, root }) {
  if (!buttonPatch) {
    console.log("Button shadcn nao encontrado; rode o init novamente depois de adicionar components/ui/button.tsx.");
    return;
  }

  if (!buttonPatch.changed) {
    console.log(`${relative(root, buttonPatch.path)} ja possui variants itps.`);
    return;
  }

  writeFileSync(buttonPatch.path, buttonPatch.after);
  console.log(`Atualizado ${relative(root, buttonPatch.path)} com variants itps.`);
}

function resolveCssPath(root, explicitCssPath) {
  if (explicitCssPath) {
    const cssPath = isAbsolute(explicitCssPath)
      ? explicitCssPath
      : resolve(root, explicitCssPath);
    if (!existsSync(cssPath)) {
      fail(`Arquivo CSS nao encontrado: ${explicitCssPath}`);
    }
    return cssPath;
  }

  for (const candidate of CSS_CANDIDATES) {
    const cssPath = join(root, candidate);
    if (existsSync(cssPath)) {
      return cssPath;
    }
  }

  fail(
    [
      "Nao encontrei o CSS global do projeto.",
      "Use --css caminho/do/arquivo.css para informar explicitamente.",
    ].join(" "),
  );
}

function resolveButtonPath(root) {
  for (const candidate of BUTTON_CANDIDATES) {
    const buttonPath = join(root, candidate);
    if (existsSync(buttonPath)) {
      return buttonPath;
    }
  }

  return undefined;
}

function getButtonPatch(buttonPath) {
  const before = readFileSync(buttonPath, "utf8");
  const after = patchButtonSource(before);
  return { after, before, changed: before !== after, path: buttonPath };
}

function patchButtonSource(source) {
  return patchButtonAttributes(patchButtonVariant(source));
}

function patchButtonVariant(source) {
  const normalizedSource = normalizeButtonVariants(source);
  const missingVariants = getMissingButtonVariants(normalizedSource);
  if (missingVariants.length === 0) return normalizedSource;

  const variantStart = normalizedSource.search(/\bvariant\s*:\s*{/);
  if (variantStart === -1) {
    return normalizedSource;
  }

  const open = normalizedSource.indexOf("{", variantStart);
  const close = findMatchingBrace(normalizedSource, open);
  if (close === -1) {
    return normalizedSource;
  }

  return insertButtonVariants(normalizedSource, open, missingVariants);
}

function normalizeButtonVariants(source) {
  let output = source.replace(LEGACY_SINAPSE_BUTTON_VARIANT_PATTERN, "");

  for (const pattern of LEGACY_ITPS_BUTTON_ROUNDED_PREFIX_PATTERNS) {
    output = output.replace(pattern, "$1");
  }

  output = ensureVariantClass(output, "itps", "cursor-pointer");
  output = ensureVariantClass(output, "itpsSecondary", "cursor-pointer");

  return output;
}

function ensureVariantClass(source, variantName, className) {
  const pattern = new RegExp(`(\\n\\s*${variantName}:\\n\\s*")([^"]*)(")`);
  return source.replace(pattern, (match, prefix, classes, suffix) => {
    if (classes.split(/\s+/).includes(className)) {
      return match;
    }

    return `${prefix}${className} ${classes}${suffix}`;
  });
}

function getMissingButtonVariants(source) {
  const variants = [];
  if (!/\bitps\s*:/.test(source)) {
    variants.push(
      '        itps:',
      '          "cursor-pointer border border-primary-900 bg-background text-info hover:border-primary-900 hover:bg-primary hover:text-primary-foreground active:border-primary-900 active:bg-primary active:text-primary-foreground",',
    );
  }
  if (!/\bitpsSecondary\s*:/.test(source)) {
    variants.push(
      '        itpsSecondary:',
      '          "cursor-pointer border border-secondary-200 bg-background text-secondary-foreground hover:border-secondary-200 hover:bg-secondary-200 hover:text-secondary-foreground active:border-secondary-300 active:bg-secondary-300 active:text-secondary-foreground",',
    );
  }

  return variants;
}

function insertButtonVariants(source, open, variants) {
  return `${source.slice(0, open + 1)}\n${variants.join("\n")}${source.slice(open + 1)}`;
}

function patchButtonAttributes(source) {
  if (!/data-slot=(["'])button\1/.test(source)) {
    return source;
  }

  let output = source;
  if (!/\bdata-variant=/.test(output)) {
    output = output.replace(
      /(\s+)data-slot=(["'])button\2/,
      "$1data-slot=$2button$2$1data-variant={variant}",
    );
  }

  if (!/\bdata-size=/.test(output)) {
    output = output.replace(/(\s+)data-variant={variant}/, "$1data-variant={variant}$1data-size={size}");
  }

  return output;
}

function transformCss(input, theme) {
  let css = normalizeNewlines(input);

  css = removeGeneratedInlineTheme(css);
  css = removeItpsStylesImports(css);
  css = removeShadcnPackageImport(css);
  css = removeDarkCustomVariant(css);
  css = processThemeBlocks(css);
  css = processTokenBlocks(css, ":root");
  css = processTokenBlocks(css, ".dark");
  css = insertTheme(css, theme);
  css = cleanupBlankLines(css);

  return css.endsWith("\n") ? css : `${css}\n`;
}

function readInlineShadcnTheme(root, options = {}) {
  const stylesRoot = join(root, "node_modules", "@itps", "styles");
  const entryPath = join(stylesRoot, "shadcn.css");
  if (!existsSync(entryPath)) {
    if (options.allowMissing) {
      return undefined;
    }
    fail(
      [
        "Nao encontrei node_modules/@itps/styles/shadcn.css para aplicar o tema inline.",
        "Rode sem --skip-install ou instale @itps/styles antes.",
      ].join(" "),
    );
  }

  const entry = normalizeNewlines(readFileSync(entryPath, "utf8"));
  const expandedTheme = entry.replace(
    /^[ \t]*@import\s+["']\.\/tokens\.css["'];[ \t]*$/m,
    () => normalizeNewlines(readFileSync(join(stylesRoot, "tokens.css"), "utf8")).trim(),
  ).trim();

  return expandedTheme;
}

function removeGeneratedInlineTheme(css) {
  const currentPattern = createInlineThemePattern(INLINE_START, INLINE_END);
  const legacyPattern = createInlineThemePattern(LEGACY_INLINE_START, LEGACY_INLINE_END);
  return css.replace(currentPattern, "").replace(legacyPattern, "");
}

function createInlineThemePattern(start, end) {
  return new RegExp(`${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}\\s*`, "g");
}

function removeItpsStylesImports(css) {
  return css.replace(
    /^[ \t]*@import\s+["']@itps\/styles(?:\/shadcn\.css)?["'];[ \t]*\n?/gm,
    "",
  );
}

function removeShadcnPackageImport(css) {
  return css.replace(/^[ \t]*@import\s+["']shadcn\/tailwind\.css["'];[ \t]*\n?/gm, "");
}

function removeDarkCustomVariant(css) {
  return css.replace(/^[ \t]*@custom-variant\s+dark\s+\([^;]+;\n?/gm, "");
}

function processThemeBlocks(css) {
  return processBlocks(css, "@theme inline", (body) => {
    const kept = filterDeclarations(body, (name) => {
      return !(name.startsWith("--color-") || name.startsWith("--radius-"));
    });

    if (!kept.trim()) {
      return "";
    }

    return `@theme inline {\n${kept}}\n`;
  });
}

function processTokenBlocks(css, selector) {
  return processBlocks(css, selector, (body) => {
    const declarationNames = getDeclarationNames(body);
    const semanticHits = declarationNames.filter((name) => THEME_DECLARATIONS.has(name));

    if (semanticHits.length < 3) {
      return `${selector} {\n${trimBlockBody(body)}}\n`;
    }

    const kept = filterDeclarations(body, (name) => !THEME_DECLARATIONS.has(name));
    if (!kept.trim()) {
      return "";
    }

    return `${selector} {\n${kept}}\n`;
  });
}

function processBlocks(css, selector, mapper) {
  let output = "";
  let cursor = 0;

  while (cursor < css.length) {
    const block = findNextBlock(css, selector, cursor);

    if (block.kind === "done") {
      output += css.slice(cursor);
      break;
    }

    if (block.kind === "skip") {
      output += css.slice(cursor, block.cursor);
      cursor = block.cursor;
      continue;
    }

    output += css.slice(cursor, block.start);
    output += mapper(css.slice(block.open + 1, block.close));
    cursor = block.close + 1;
  }

  return output;
}

function findNextBlock(css, selector, cursor) {
  const start = css.indexOf(selector, cursor);
  if (start === -1) {
    return { kind: "done" };
  }

  if (!hasSelectorBoundary(css, start)) {
    return { kind: "skip", cursor: start + selector.length };
  }

  const open = css.indexOf("{", start + selector.length);
  if (open === -1) {
    return { kind: "done" };
  }

  const close = findMatchingBrace(css, open);
  if (close === -1) {
    return { kind: "done" };
  }

  return { kind: "found", start, open, close };
}

function hasSelectorBoundary(css, start) {
  return start === 0 || /[\s;}]/.test(css[start - 1] ?? "");
}

function filterDeclarations(body, shouldKeep) {
  const lines = body.split("\n");
  const kept = [];

  for (const line of lines) {
    const match = line.match(/^\s*(--[-\w]+)\s*:/);
    if (match && !shouldKeep(match[1])) {
      continue;
    }
    kept.push(line);
  }

  return trimBlockBody(kept.join("\n"));
}

function getDeclarationNames(body) {
  return [...body.matchAll(/^\s*(--[-\w]+)\s*:/gm)].map((match) => match[1]);
}

function trimBlockBody(body) {
  const lines = body.split("\n");
  while (lines.length > 0 && !lines[0].trim()) {
    lines.shift();
  }
  while (lines.length > 0 && !lines.at(-1).trim()) {
    lines.pop();
  }
  return lines.length > 0 ? `${lines.join("\n")}\n` : "";
}

function insertTheme(css, theme) {
  const lines = css.split("\n");
  let lastImportIndex = -1;

  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*@import\s+/.test(lines[index])) {
      lastImportIndex = index;
    }
  }

  if (!lines.some((line) => line.trim() === '@import "tailwindcss";')) {
    lines.unshift('@import "tailwindcss";');
    lastImportIndex += 1;
  }

  const insertion = `${INLINE_START}\n${theme.value}\n${INLINE_END}\n`;

  lines.splice(lastImportIndex + 1, 0, insertion);
  return lines.join("\n");
}

function cleanupBlankLines(css) {
  return css.replace(/\n{3,}/g, "\n\n").trimStart();
}

function findMatchingBrace(source, openIndex) {
  let depth = 0;
  let quote = "";

  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];

    if (quote || isQuote(char)) {
      quote = nextQuoteState(quote, char, source[index - 1]);
      continue;
    }

    const result = readBrace(char, depth);
    depth = result.depth;
    if (result.closed) {
      return index;
    }
  }

  return -1;
}

function nextQuoteState(quote, char, previous) {
  if (!quote) {
    return char;
  }

  return char === quote && previous !== "\\" ? "" : quote;
}

function readBrace(char, depth) {
  if (char === "{") {
    return { depth: depth + 1, closed: false };
  }

  if (char === "}") {
    return { depth: depth - 1, closed: depth === 1 };
  }

  return { depth, closed: false };
}

function isQuote(char) {
  return char === '"' || char === "'";
}

function detectPackageManager(root) {
  if (existsSync(join(root, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(join(root, "yarn.lock"))) {
    return "yarn";
  }
  if (existsSync(join(root, "bun.lockb")) || existsSync(join(root, "bun.lock"))) {
    return "bun";
  }
  return "npm";
}

function runPackageInstall(packageManager, packageSpec) {
  const argsByManager = {
    bun: ["add", packageSpec],
    npm: ["install", packageSpec],
    pnpm: ["add", packageSpec],
    yarn: ["add", packageSpec],
  };

  const args = argsByManager[packageManager];
  console.log(`Executando: ${packageManager} ${args.join(" ")}`);
  const result = spawnSync(packageManager, args, {
    cwd: process.cwd(),
    stdio: "inherit",
    env: { ...process.env, COREPACK_ENABLE_AUTO_PIN: "0" },
  });

  if (result.status !== 0) {
    fail(`Falha ao instalar ${packageSpec}.`);
  }
}

function readValue(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    fail(`Informe um valor para ${flag}.`);
  }
  return value;
}

function normalizeNewlines(value) {
  return value.replace(/\r\n/g, "\n");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function printHelp() {
  console.log(`ITpS Design System CLI ${VERSION}

Uso:
  itps init [opcoes]

Opcoes:
  --css <arquivo>        CSS global a alterar, quando a deteccao automatica nao bastar
  --package <specifier>  Pacote a instalar (default: styles tarball da GitHub Release)
  --skip-install         Nao executar package manager add
  --inline               Compatibilidade: o init ja escreve inline por padrao
  --dry-run              Mostrar mudancas sem escrever arquivos

Exemplos:
  itps init
  itps init --dry-run
  itps init --css src/index.css --package /tmp/itps-styles-0.3.0.tgz
  itps init --skip-install
`);
}

function fail(message) {
  console.error(`Erro: ${message}`);
  process.exit(1);
}

main();
