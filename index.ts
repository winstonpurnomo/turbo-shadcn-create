// oxlint-disable func-style
import {
  cancel,
  group,
  intro,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";
import { $, file, write } from "bun";

intro("Welcome to Turborepo Generator for TanStack Start");

const { location, packageManager, generator } = await group(
  // oxlint-disable-next-line sort-keys
  {
    location: () =>
      text({
        defaultValue: ".",
        message: "Where do you want to create your Turborepo?",
        placeholder: ".",
      }),
    packageManager: () =>
      select({
        message: "Which package manager do you want to use?",
        options: [
          {
            label: "bun",
            value: "bun",
          },
          {
            label: "pnpm",
            value: "pnpm",
          },
        ],
      }),
    generator: () =>
      text({
        defaultValue: `shadcn@latest create --preset "https://ui.shadcn.com/init?base=base&style=vega&baseColor=neutral&theme=neutral&iconLibrary=lucide&font=inter&menuAccent=subtle&menuColor=default&radius=default&template=start" --template start`,
        message: "Paste your shadcn create command",
      }),
  },
  {
    onCancel: () => {
      cancel("Cancelled");
      process.exit(0);
    },
  }
);

const path = location.toString().trim();
const packageManagerString = packageManager.toString().trim();

const packageManagerXCommand = packageManagerString === "bun" ? "x" : "dlx";

if (path !== ".") {
  await $`mkdir -p ${path}`;
}

await createTurborepo();
$.cwd(path);
await createTanstackStart();

// Delete the standard Next.js apps
await $`cd apps && rm -rf web/ docs/`;

async function createTurborepo() {
  const spinnerTurbo = spinner();
  spinnerTurbo.start("Creating Turborepo");
  await $`${packageManagerString} create turbo@latest --package-manager ${packageManagerString} ${path}`.quiet();
  spinnerTurbo.stop("Turborepo created");
}

async function createTanstackStart() {
  const command = generator.toString().trim();
  // Strip all package managers from the command (bun x, pnpm dlx, etc.)
  const commandWithoutPackageManager = command.replace(
    /(bun x|pnpm dlx|yarn dlx|npx)/,
    ""
  );

  const spinnerTanstack = spinner();
  spinnerTanstack.start("Creating TanStack Start with shadcn create command");
  await $`cd apps && ${packageManagerString} ${packageManagerXCommand} ${{ raw: commandWithoutPackageManager }} web`.quiet();
  spinnerTanstack.stop("TanStack Start created");
}

const spinnerPaths = spinner();
spinnerPaths.start("Configuring shadcn");

await configureComponentsJson();

// oxlint-disable-next-line max-statements
async function configureComponentsJson() {
  const componentFile = file(`${path}/apps/web/components.json`);
  const componentJson = await componentFile.json();
  const copyComponentJson = structuredClone(componentJson);

  componentJson.tailwind.css = "../../packages/ui/src/styles/globals.css";
  componentJson.aliases.utils = "@repo/ui/lib/utils";
  componentJson.aliases.ui = "@repo/ui/components";

  copyComponentJson.tailwind.css = "src/styles/globals.css";
  copyComponentJson.aliases.components = "@repo/ui/components";
  copyComponentJson.aliases.utils = "@repo/ui/lib/utils";
  copyComponentJson.aliases.ui = "@repo/ui/components";
  copyComponentJson.aliases.lib = "@repo/ui/lib";
  copyComponentJson.aliases.hooks = "@repo/ui/hooks";

  await write(componentFile, JSON.stringify(componentJson, null, 2));

  await write(
    file(`${path}/packages/ui/components.json`),
    JSON.stringify(copyComponentJson, null, 2)
  );
}

await $`cd packages/ui && rm -rf src/*.tsx && cd src && mkdir components hooks lib styles`;

await $`mv apps/web/src/styles.css packages/ui/src/styles/globals.css`;

// Move the apps/web/src/components folder to packages/ui/src/components

const utilsContent = `import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
`;

const useMobileContent = `import * as React from "react";

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    undefined
  );

  React.useEffect(() => {
    const mql = window.matchMedia(
      "(max-width: " + (MOBILE_BREAKPOINT - 1) + "px)"
    );
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    mql.addEventListener("change", onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return !!isMobile;
}
`;

await write(file(`${path}/packages/ui/src/lib/utils.ts`), utilsContent);
await write(
  file(`${path}/packages/ui/src/hooks/use-mobile.ts`),
  useMobileContent
);

await updatePackageJsons();

// oxlint-disable-next-line max-statements
async function updatePackageJsons() {
  const appPackageJson = file(`${path}/apps/web/package.json`);
  const appPackageJsonContent = await appPackageJson.json();

  const uiPackageJson = file(`${path}/packages/ui/package.json`);
  const uiPackageJsonContent = await uiPackageJson.json();

  // find the dependency of fontsource
  // oxlint-disable-next-line typescript/no-non-null-assertion
  const fontsourceDependency = Object.entries(
    appPackageJsonContent.dependencies
  ).find(([key]) => key.includes("@fontsource"))!;

  const uiDependency = Object.entries(
    appPackageJsonContent.dependencies || {}
  ).filter(([name]) => name.includes("@base-ui") || name.includes("radix-ui"));

  appPackageJsonContent.name = "@repo/web";
  appPackageJsonContent.dependencies["@repo/ui"] = "workspace:*";

  // oxlint-disable-next-line prefer-destructuring
  uiPackageJsonContent.dependencies[fontsourceDependency[0]] =
    fontsourceDependency[1];

  for (const dependency of uiDependency) {
    // oxlint-disable-next-line prefer-destructuring
    uiPackageJsonContent.dependencies[dependency[0]] = dependency[1];
  }

  uiPackageJsonContent.exports = {
    "./components/*": "./src/components/*.tsx",
    "./hooks/*": "./src/hooks/*.ts",
    "./lib/*": "./src/lib/*.ts",
    "./styles/globals.css": "./src/styles/globals.css",
  };

  await write(appPackageJson, JSON.stringify(appPackageJsonContent, null, 2));
  await write(uiPackageJson, JSON.stringify(uiPackageJsonContent, null, 2));
}

await $`cd packages/ui && ${packageManagerString} i clsx class-variance-authority tailwindcss tailwind-merge tw-animate-css shadcn`.quiet();

// Copy the apps/web/src/components/ui contents to packages/ui/src/components
await $`cd apps/web && rm -rf .git`.quiet();
await $`mkdir -p packages/ui/src/components`;
await $`cp apps/web/src/components/ui/combobox.tsx packages/ui/src/components/combobox.tsx`;

let exampleFile = file(`${path}/apps/web/src/components/component-example.tsx`);
let exampleFileContent = await exampleFile.text();
exampleFileContent = exampleFileContent.replaceAll(
  "@/components/ui",
  "@repo/ui/components"
);
await write(exampleFile, exampleFileContent);

const rootTsxFile = file(`${path}/apps/web/src/routes/__root.tsx`);
let rootTsxFileContent = await rootTsxFile.text();
rootTsxFileContent = rootTsxFileContent.replace(
  "import appCss from '../styles.css?url'",
  "import appCss from '@repo/ui/styles/globals.css?url'"
);
await write(rootTsxFile, rootTsxFileContent);

const cssFile = file(`${path}/packages/ui/src/styles/globals.css`);
let cssFileContent = await cssFile.text();
// after the @import statements, add source paths
cssFileContent = cssFileContent.replace(
  /(@import[^;]+;\s*)+/,
  (match) =>
    `${match}@source "../../../apps/**/*.{ts,tsx}";\n@source "../../../components/**/*.{ts,tsx}";\n@source "../**/*.{ts,tsx}";\n`
);
await write(cssFile, cssFileContent);

const appTsconfig = file(`${path}/apps/web/tsconfig.json`);
let appTsconfigCleaned = await appTsconfig.text();
appTsconfigCleaned = appTsconfigCleaned.replaceAll(
  /\\"|"(?:\\.|[^\\"])*"|(\/\*.*?\*\/|\/\/.*)$/gm,
  (match, group1) => (group1 ? "" : match)
);

let appTsconfigContent = JSON.parse(appTsconfigCleaned);
appTsconfigContent.compilerOptions.paths["@repo/ui/*"] = [
  "../../packages/ui/src/*",
];
await write(appTsconfig, JSON.stringify(appTsconfigContent, null, 2));

let uiTsconfig = file(`${path}/packages/ui/tsconfig.json`);
let uiTsconfigContent = await uiTsconfig.json();
uiTsconfigContent.compilerOptions.rootDir = "src";
uiTsconfigContent.compilerOptions.baseUrl = ".";
uiTsconfigContent.compilerOptions.module = "ESNext";
uiTsconfigContent.compilerOptions.moduleResolution = "bundler";
uiTsconfigContent.compilerOptions.paths = {
  "@repo/ui/*": ["./src/*"],
};

await write(uiTsconfig, JSON.stringify(uiTsconfigContent, null, 2));

await $`cd apps/web && ${packageManagerString} ${packageManagerXCommand} shadcn@latest add --all --yes`.quiet();

spinnerPaths.stop("Configured shadcn");

outro("Your Turborepo is ready!");
