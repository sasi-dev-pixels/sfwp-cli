#! /usr/bin/env node
import { Command } from "commander";
import inquirer from "inquirer";
import fs from "fs-extra";
import path from "path";
import ora from "ora";
import figlet from "figlet";
import chalk from "chalk";
import { fileURLToPath } from "url";

import AdmZip from "adm-zip";

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);
const program = new Command();
const traitRegistryPath = path.join(__dirname, "traits.json");

function zipCurrentDirectory(outputName) {
  const spinner = ora("📦 Creating zip...").start();
  const zip = new AdmZip();
  const root = process.cwd();

  zip.addLocalFolder(root);

  const outputPath = path.join(
    root,
    outputName.endsWith(".zip") ? outputName : `${outputName}.zip`
  );
  zip.writeZip(outputPath);

  spinner.succeed(`✅ Zipped to ${outputPath}`);
}
async function generateWidgetDocs(widgetName) {
  const spinner = ora(`📚 Generating docs for ${widgetName}...`).start();
  const root = process.cwd();
  const fileName = widgetName.toLowerCase().replace(/\s+/g, "-");
  const phpPath = path.join(root, "widgets", `${fileName}.php`);
  const docPath = path.join(root, "docs", "widgets", `${fileName}.md`);

  if (!fs.existsSync(phpPath)) {
    spinner.fail(`Widget file not found: ${phpPath}`);
    return;
  }

  if (!fs.existsSync(docPath)) {
    spinner.fail(`Markdown file not found: ${docPath}`);
    return;
  }

  const content = fs.readFileSync(phpPath, "utf8");
  const markdown = fs.readFileSync(docPath, "utf8");
  const placeholder = "<!-- SFWP_DOCS_PLACEHOLDER -->";

  if (!markdown.includes(placeholder)) {
    spinner.fail(`Placeholder not found in ${docPath}`);
    return;
  }

  function extract(regex, group = 1) {
    const match = content.match(regex);
    return match ? match[group].trim() : "";
  }

  function extractAll(regex, group = 1) {
    const globalRegex = new RegExp(
      regex.source,
      regex.flags.includes("g") ? regex.flags : regex.flags + "g"
    );
    return [...content.matchAll(globalRegex)].map((m) => m[group].trim());
  }

  const data = {
    WIDGET_NAME: (() => {
      const raw = extract(
        /get_title\s*\(\)\s*{[^}]*?return\s+__\(\s*['"](.+?)['"]/
      );
      return raw.toLowerCase().startsWith("sf") ? raw.slice(2).trim() : raw;
    })(),
    TRAITS: extractAll(
      /use\s+\\?SFWPStudio\\Core\\Helpers\\Traits\\([A-Za-z0-9_]+);/
    ),
  };

  const block =
    "```json\n" +
    JSON.stringify(
      {
        widget_name: data.WIDGET_NAME || "",
        summary: "",
        free_features: [
          { name: "", description: "" },
          { name: "", description: "" },
        ],
        pro_features: [
          { name: "", description: "" },
          { name: "", description: "" },
        ],
        background_motivation: {
          limitations: "",
          motivation: "",
        },
        architecture: {
          type: "Choose Any One: 'custom', 'extended', 'forked', or 'hooked'",
          base: "Choose Any One: 'Elementor' or 'ElementsKit'",
          extends: "",
          forked_from: "",
          traits: data.TRAITS || [],
          is_separate_style_sheet: content.includes("get_style_depends")
            ? "yes"
            : "no",
          is_JS_Used: content.includes("get_script_depends") ? "yes" : "no",
          pro_feature_hook_type: "Choose Any One: 'elementor' or 'wordpress'",
          icon_used: "",
        },
        impact: ["", "", "", ""],
        next: {
          features: [
            { name: "", description: "" },
            { name: "", description: "" },
          ],
        },
        usage_context: {
          used_in: ["", "", ""],
          compatible_with: ["", "", ""],
        },
      },
      null,
      2
    ) +
    "\n```";

  const updated = markdown.replace(placeholder, block);
  fs.writeFileSync(docPath, updated);
  spinner.succeed(`✅ Metadata inserted into ${docPath}`);
}

async function injectTraitsIntoWidget(traits, widgetName) {
  const spinner = ora(`🔧 Injecting traits into ${widgetName}...`).start();
  const root = process.cwd();
  const fileName = widgetName
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase();
  const phpPath = path.join(root, "widgets", `${fileName}.php`);

  if (!fs.existsSync(phpPath)) {
    spinner.fail(`❌ Widget file not found: ${phpPath}`);
    return;
  }

  let content = fs.readFileSync(phpPath, "utf8");
  let modified = false;

  const getTraitSlug = (traitName) =>
    traitName
      .replace(/Trait$/, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[\s\-]+/g, "_")
      .toLowerCase();

  console.log(
    chalk.bold(`\n🧩 Trait Injection Summary for ${chalk.cyan(fileName)}\n`)
  );

  traits.forEach((traitName) => {
    const traitSlug = getTraitSlug(traitName);
    const traitUse = `use \\SFWPStudio\\Core\\Helpers\\Traits\\${traitName};`;
    const controlCall = `$this->register_${traitSlug}_controls();`;
    const renderCall = `$this->render_${traitSlug}();`;

    // 1️⃣ Inject trait use after class opening {
    const classOpenRegex = /class\s+[A-Za-z_][A-Za-z0-9_]*[\s\S]*?\{\s*\n/;
    if (!content.includes(traitUse)) {
      content = content.replace(
        classOpenRegex,
        (match) => `${match}    ${traitUse}\n`
      );
      console.log(chalk.green(`✅ Injected: ${traitUse}`));
      modified = true;
    } else {
      console.log(chalk.yellow(`⚠️  Skipped: ${traitUse} already present.`));
    }

    // 2️⃣ Inject control registration
    const registerRegex =
      /function\s+register_controls\s*\(\)\s*\{([\s\S]*?)\}/m;
    const beforeControls = content;
    content = content.replace(registerRegex, (match, body) => {
      if (!body.includes(controlCall)) {
        const lines = body.split("\n");
        const indent = (lines[0] || "").match(/^\s*/)?.[0] || "    ";
        lines.splice(0, 0, `${indent}${controlCall}`);
        console.log(chalk.green(`✅ Injected: ${controlCall}`));
        return `function register_controls() {\n${lines.join("\n")}\n}`;
      } else {
        console.log(
          chalk.yellow(`⚠️  Skipped: ${controlCall} already present.`)
        );
        return match;
      }
    });
    if (content !== beforeControls) modified = true;

    // 3️⃣ Inject render call
    const renderAnyRegex =
      /function\s+(render|render_raw)\s*\(\)\s*\{([\s\S]*?)\}/m;
    const beforeRender = content;
    content = content.replace(renderAnyRegex, (match, fnName, body) => {
      if (!body.includes(renderCall)) {
        const lines = body.split("\n");
        const indent = (lines[0] || "").match(/^\s*/)?.[0] || "    ";
        lines.splice(0, 0, `${indent}${renderCall}`);
        console.log(chalk.green(`✅ Injected: ${renderCall} into ${fnName}()`));
        return `function ${fnName}() {\n${lines.join("\n")}\n}`;
      } else {
        console.log(
          chalk.yellow(
            `⚠️  Skipped: ${renderCall} already present in ${fnName}()`
          )
        );
        return match;
      }
    });
    if (content !== beforeRender) modified = true;
  });

  if (modified) {
    fs.writeFileSync(phpPath, content);
    spinner.succeed(`✅ Traits injected into ${chalk.cyan(phpPath)}\n`);
  } else {
    spinner.stop();
  }
}

function formatTraitNames(input) {
  const raw = input.trim().replace(/Trait$/, "");
  const className =
    raw
      .replace(/[\s_-]+/g, " ")
      .split(" ")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join("") + "Trait";

  const slug = raw
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s\-]+/g, "_")
    .toLowerCase();

  const fileSlug = raw
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();

  return { className, slug, fileName: `${fileSlug}-trait.php` };
}

function readStub(name) {
  return fs.readFileSync(path.join(__dirname, "stubs", name), "utf8");
}

function writeFromStub(stubName, destPath, replacements = {}) {
  let content = readStub(stubName);

  // console.log('Stub content before replacement:\n', content);

  for (const [k, v] of Object.entries(replacements)) {
    const re = new RegExp(`{{${k}}}`, "g");
    content = content.replace(re, v || "");
  }

  content = content.replace(/{{}}/g, "");
  content = content.replace(/\/\*__([a-z0-9_-]+)__\*\//gi, "");
  content = content.replace(/^[ \t]*\/\*__([a-z0-9_-]+)__\*\/[ \t]*\n?/gim, "");

  // console.log('Final content after replacement:\n', content);
  fs.outputFileSync(destPath, content);
}

async function syncTraits() {
  const traitDir = path.join(process.cwd(), "core", "helpers", "traits");
  const traitFiles = fs.existsSync(traitDir)
    ? fs.readdirSync(traitDir).filter((f) => f.endsWith("-trait.php"))
    : [];

  const traitNames = traitFiles.map((f) => {
    const base = f.replace("-trait.php", "");
    return (
      base
        .replace(/[\s_-]+/g, " ")
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join("") + "Trait"
    );
  });

  fs.writeJsonSync(traitRegistryPath, traitNames, { spaces: 2 });
  return traitNames;
}

async function runTraitCreation(name) {
  const spinner = ora("Creating trait...").start();
  const { className, slug, fileName } = formatTraitNames(name);
  const traitDir = path.join(process.cwd(), "core", "helpers", "traits");
  const traitPath = path.join(traitDir, fileName);

  if (fs.existsSync(traitPath)) {
    spinner.stop();
    console.log(chalk.yellow(`Trait ${fileName} already exists.`));
    const { overwrite } = await inquirer.prompt([
      {
        type: "confirm",
        name: "overwrite",
        message: "Do you want to overwrite it?",
        default: false,
      },
    ]);
    if (!overwrite) {
      console.log(chalk.red("Trait creation cancelled."));
      return;
    }
    spinner.start();
  }

  fs.ensureDirSync(traitDir);
  writeFromStub("trait.php.stub", traitPath, {
    TRAITNAME: className,
    TRAITSLUG: slug,
  });
  spinner.succeed(chalk.green(`Trait ${className} created!`));
  console.log(chalk.blue("File created:\n ") + traitPath);
}

async function interactiveFlow(traitChoices) {
  const answers = await inquirer.prompt([
    {
      type: "input",
      name: "name",
      message: "Widget name (e.g. Heading, Icon Box):",
      validate: (val) => !!val || "Name required",
    },
    {
      type: "confirm",
      name: "css",
      message: "Create CSS file?",
      default: true,
    },
    { type: "confirm", name: "js", message: "Create JS file?", default: false },
    {
      type: "confirm",
      name: "readme",
      message: "Create README.md?",
      default: true,
    },
    {
      type: "input",
      name: "icon",
      message:
        "Elementor icon class (e.g. eicon-star):\nBrowse icons here 👉 (https://elementor.github.io/elementor-icons/):",
      default: "eicon-star",
    },
    {
      type: "checkbox",
      name: "traits",
      message: "Select traits to include:",
      choices: traitChoices,
    },
  ]);
  return answers;
}

async function runCreate(opts) {
  const spinner = ora("Generating widget files...").start();
  const words = opts.name.trim().split(/[\s_-]+/);
  const className = words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("_");

  const fileName = words.map((w) => w.toLowerCase()).join("-");
  const slug = "sf_" + words.map((w) => w.toLowerCase()).join("_");
  const widgetName =
    "SF " +
    words
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");

  const root = process.cwd();
  const paths = {
    php: path.join(root, "widgets", `${fileName}.php`),
    css: path.join(root, "assets", "css", `${fileName}.css`),
    js: path.join(root, "assets", "js", `${fileName}.js`),
    readme: path.join(root, "docs", "widgets", `${fileName}.md`),
  };

  const traitUses = opts.traits
    .map((t) => `use \\SFWPStudio\\Core\\Helpers\\Traits\\${t};`)
    .join("\n");

  const traitControls = opts.traits
    .map((t) => {
      // const slug = t.replace(/Trait$/, '').replace(/([a-z])([A-Z])/g, '$1_').toLowerCase();
      const slug = getTraitSlug(t);
      return `$this->register_${slug}_controls();`;
    })
    .join("\n    ");

  function getTraitSlug(traitName) {
    return traitName
      .replace(/Trait$/, "") // Remove "Trait"
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2") // Add underscore between camelCase
      .replace(/[\s\-]+/g, "_") // Normalize spaces and hyphens
      .toLowerCase(); // Lowercase everything
  }

  const traitRender = opts.traits
    .map((t) => {
      const slug = getTraitSlug(t);
      return `$this->render_${slug}();`;
    })
    .join("\n    ");

  const replacements = {
    CLASSNAME: className,
    FILENAME: fileName,
    SLUG: slug,
    ICON: opts.icon,
    STYLE_DEPENDS: opts.css
      ? `public function get_style_depends() {\n    return [ '${fileName}' ];\n}`
      : "",
    SCRIPT_DEPENDS: opts.js
      ? `public function get_script_depends() {\n    return [ '${fileName}' ];\n}`
      : "",
    TRAIT_USES: traitUses || "",
    TRAIT_IMPORTS: traitUses || "",
    TRAIT_CONTROLS: traitControls || "",
    TRAIT_RENDER: traitRender || "",
    WIDGET_NAME: widgetName || "",
  };

  const existing = Object.entries(paths)
    .filter(([key, file]) => opts[key] !== false && fs.existsSync(file))
    .map(([_, file]) => file);
  if (existing.length) {
    spinner.stop();
    console.log(chalk.yellow("The following files already exist:"));
    existing.forEach((f) => console.log(" " + f));
    const { overwrite } = await inquirer.prompt([
      {
        type: "confirm",
        name: "overwrite",
        message: "Overwrite existing files?",
        default: false,
      },
    ]);
    if (!overwrite) {
      console.log(chalk.red("Aborted — no files changed."));
      return;
    }
    spinner.start();
  }

  writeFromStub("widget.php.stub", paths.php, replacements);
  if (opts.css) writeFromStub("style.css.stub", paths.css, replacements);
  if (opts.js) writeFromStub("script.js.stub", paths.js, replacements);
  if (opts.readme) writeFromStub("readme.md.stub", paths.readme, replacements);

  spinner.succeed(chalk.green(`Widget ${className} created!`));
  console.log(chalk.blue("📁 Files created:"));
  Object.entries(paths).forEach(([key, file]) => {
    if (opts[key] !== false) console.log("  " + file);
  });
}

program
  .command("create [name...]") // capture all words
  .description("Create a widget or trait")
  .option("--no-css", "Skip CSS file creation")
  .option("--no-js", "Skip JS file creation")
  .option("--no-readme", "Skip README.md creation")
  .option("--traits <traits...>", "Traits to include (one or more)")
  .option("--icon <icon>", "Elementor icon class", "eicon-star")
  .action(async (nameParts, options) => {
    console.log(
      chalk.cyan(figlet.textSync("SFWP CLI", { horizontalLayout: "full" }))
    );

    const spinner = ora("🍳 Cooking up trait list...").start();
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const traitChoices = await syncTraits();
    spinner.succeed("Traits synced!");

    // Join all name parts into a single string (e.g., ['sasi','king'] -> 'sasi king')
    const providedName =
      Array.isArray(nameParts) && nameParts.length ? nameParts.join(" ") : null;

    if (providedName) {
      // Normalize using the same rules runCreate expects
      const words = providedName.trim().split(/[\s_-]+/);
      const normalizedName = words
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");

      // Commander passes traits as array (space-separated). Support comma-separated too.
      const traits = Array.isArray(options.traits)
        ? options.traits
            .flatMap((t) => String(t).split(","))
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

      await runCreate({
        name: normalizedName,
        css: options.css !== false, // default true unless --no-css
        js: options.js !== false, // default true unless --no-js
        readme: options.readme !== false, // default true unless --no-readme
        icon: options.icon,
        traits,
      });
    } else {
      // Interactive flow unchanged
      const { type } = await inquirer.prompt([
        {
          type: "list",
          name: "type",
          message: "What do you want to create?",
          choices: ["Widget", "Trait"],
        },
      ]);

      if (type === "Trait") {
        const { traitName } = await inquirer.prompt([
          {
            type: "input",
            name: "traitName",
            message: "Enter trait name (e.g. CardTrait):",
            validate: (val) => !!val || "Trait name required",
          },
        ]);
        await runTraitCreation(traitName);
      } else {
        const answers = await interactiveFlow(traitChoices);
        await runCreate({ ...answers });
      }
    }
  });

program
  .command("zip <filename>")
  .description("Zip the current working directory into <filename>.zip")
  .action((filename) => {
    zipCurrentDirectory(filename);
  });

program
  .command("docs <widgetName>")
  .description("Generate documentation metadata for a widget")
  .action(async (widgetName) => {
    await generateWidgetDocs(widgetName);
  });

program
  .command("add:trait <traits...>")
  .option("--to <widgetName>", "Target widget name")
  .description("Inject traits into an existing widget")
  .action(async (traits, options) => {
    await injectTraitsIntoWidget(traits, options.to);
  });

function toggleDebugMode(enable) {
  let currentDir = process.cwd();
  let wpConfigPath = "";

  // Traverse up to find wp-config.php
  while (currentDir !== path.parse(currentDir).root) {
    const candidate = path.join(currentDir, "wp-config.php");
    if (fs.existsSync(candidate)) {
      wpConfigPath = candidate;
      break;
    }
    currentDir = path.dirname(currentDir);
  }

  if (!wpConfigPath) {
    console.log(
      chalk.red(
        "❌ wp-config.php not found — make sure you’re inside a plugin/widget directory"
      )
    );
    return;
  }

  let content = fs.readFileSync(wpConfigPath, "utf8");
  let modified = false;

  // Step 1: Update WP_DEBUG value
  const wpDebugRegex = /define\(\s*['"]WP_DEBUG['"]\s*,\s*(true|false)\s*\);/;
  const wpDebugReplacement = `define('WP_DEBUG', ${enable});`;
  if (content.match(wpDebugRegex)) {
    content = content.replace(wpDebugRegex, wpDebugReplacement);
    modified = true;
  }

  // Step 2: Prepare debug block
  const debugBlock = `
if ( ! defined( 'WP_DEBUG_LOG' ) ) {
  define( 'WP_DEBUG_LOG', true );
}

if ( ! defined( 'WP_DEBUG_DISPLAY' ) ) {
  define( 'WP_DEBUG_DISPLAY', true );
}
`.trim();

  // Step 3: Handle block insertion/removal
  if (enable) {
    if (content.includes(debugBlock)) {
      console.log(chalk.yellow("⚠️ Debug block already present"));
    } else {
      const wpDebugLineRegex =
        /define\(\s*['"]WP_DEBUG['"]\s*,\s*true\s*\);\s*/;
      if (content.match(wpDebugLineRegex)) {
        content = content.replace(
          wpDebugLineRegex,
          `define('WP_DEBUG', true);\n\n${debugBlock}\n`
        );
        modified = true;
      } else {
        console.log(
          chalk.red("❌ WP_DEBUG line not found — cannot insert debug block")
        );
        return;
      }
    }
  } else {
    // Remove debug block if present
    const blockRegex = new RegExp(
      `\\n?if\\s*\\(\\s*!\\s*defined\\s*\\(\\s*['"]WP_DEBUG_LOG['"]\\s*\\)\\s*\\)\\s*{[^}]*}\\s*\\n?if\\s*\\(\\s*!\\s*defined\\s*\\(\\s*['"]WP_DEBUG_DISPLAY['"]\\s*\\)\\s*\\)\\s*{[^}]*}`,
      "g"
    );
    if (content.match(blockRegex)) {
      content = content.replace(blockRegex, "").trim();
      modified = true;
    }
  }

  if (modified) {
    fs.writeFileSync(wpConfigPath, content + "\n");
    console.log(
      chalk.green(
        `✅ Debug mode ${
          enable ? "activated" : "deactivated"
        } and config updated`
      )
    );
    if (enable) {
      console.log(
        chalk.blue("\n📣 To verify logging, paste this in any PHP file:")
      );
      console.log(
        chalk.yellow(`\n  error_log(print_r("Welcome to SFWP Debug", true));\n`)
      );
      console.log(
        chalk.white(`Then check:`),
        chalk.cyan(`wp-content/debug.log\n`)
      );
    }
  } else {
    console.log(chalk.yellow("ℹ️ No changes needed — everything already set"));
  }
}

program
  .command("debug <mode>")
  .description("Toggle WP_DEBUG settings in wp-config.php (appended at end)")
  .action((mode) => {
    const enable = mode === "on";
    toggleDebugMode(enable);
  });

program.parse(process.argv);
