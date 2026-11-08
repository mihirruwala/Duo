#!/usr/bin/env node
/**
 * Builds DUO's Android app: a Trusted Web Activity that opens https://duoforyou.cv full screen.
 *
 *   node scripts/android-app.cjs            build android/app-release-bundle.aab (+ a signed .apk to sideload)
 *   node scripts/android-app.cjs --bump     same, with the next version code (needed for every Play upload)
 *
 * Needs the toolchain from ~/.bubblewrap (Bubblewrap, JDK 17, Android SDK; see docs/PLAY_STORE.md).
 * The upload key lives at ~/.android-keys/duo-upload.jks and its password in the macOS Keychain
 * (service "DUO Android upload key"); both are created on the first run. Back them up: without the
 * upload key you can't publish updates (Google can reset it, but it takes days).
 */
const { createRequire } = require("node:module");
const { execFileSync, spawn } = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const TOOLS = path.join(os.homedir(), ".bubblewrap", "tools");
const req = createRequire(path.join(TOOLS, "package.json"));
const core = req("@bubblewrap/core");
const { InquirerPrompt } = req("@bubblewrap/cli/dist/lib/Prompt");
const { build } = req("@bubblewrap/cli/dist/lib/cmds/build");
const { computeChecksum } = req("@bubblewrap/cli/dist/lib/cmds/shared");

const SITE = "https://duoforyou.cv";
const PACKAGE_ID = "cv.duoforyou.app";
const PROJECT = path.join(ROOT, "android");
const KEY_DIR = path.join(os.homedir(), ".android-keys");
const KEYSTORE = path.join(KEY_DIR, "duo-upload.jks");
const ALIAS = "duo-upload";
const KEYCHAIN_SERVICE = "DUO Android upload key";
const ICON_PORT = 8765;

/** Reads the key password from the Keychain, creating a random one on the first run. */
function keyPassword() {
  try {
    return execFileSync("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-a", ALIAS, "-w"], {
      encoding: "utf8",
    }).trim();
  } catch {
    const pw = crypto.randomBytes(24).toString("base64url");
    execFileSync("security", ["add-generic-password", "-s", KEYCHAIN_SERVICE, "-a", ALIAS, "-w", pw, "-U"]);
    return pw;
  }
}

/** Never prompts: the build runs unattended. */
class AutoPrompt extends InquirerPrompt {
  async promptConfirm() {
    return true;
  }
}

async function main() {
  const config = await core.Config.loadConfig(path.join(os.homedir(), ".bubblewrap", "config.json"));
  if (!config) throw new Error("No ~/.bubblewrap/config.json: set up the toolchain first (docs/PLAY_STORE.md).");
  const jdkHelper = new core.JdkHelper(process, config);
  const password = keyPassword();

  // 1. Upload key (once).
  if (!fs.existsSync(KEYSTORE)) {
    fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
    await new core.KeyTool(jdkHelper).createSigningKey({
      path: KEYSTORE,
      alias: ALIAS,
      password,
      keypassword: password,
      fullName: "Mihir Ruwala",
      organizationalUnit: "DUO",
      organization: "DUO",
      country: "IN",
    });
    fs.chmodSync(KEYSTORE, 0o600);
    console.log(`Created upload key at ${KEYSTORE}`);
  }

  // 2. The TWA manifest: DUO's web manifest plus Android details. Version comes from the previous build.
  const manifestPath = path.join(PROJECT, "twa-manifest.json");
  const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : null;
  const versionCode = (previous?.appVersionCode ?? 0) + (previous === null || process.argv.includes("--bump") ? 1 : 0);
  // The generator downloads the web manifest and icons. Serve local copies (the manifest compiled
  // from src/app/manifest.ts) so the app can be built before the site is deployed.
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), "duo-twa-"));
  fs.cpSync(path.join(ROOT, "public", "icons"), path.join(staging, "icons"), { recursive: true });
  const { buildSync } = require(path.join(ROOT, "node_modules", "esbuild"));
  const compiled = buildSync({
    entryPoints: [path.join(ROOT, "src/app/manifest.ts")],
    bundle: true,
    format: "cjs",
    platform: "node",
    write: false,
  });
  const mod = { exports: {} };
  new Function("module", "exports", "require", compiled.outputFiles[0].text)(mod, mod.exports, require);
  fs.writeFileSync(path.join(staging, "manifest.webmanifest"), JSON.stringify(mod.exports.default()));
  const local = `http://localhost:${ICON_PORT}`;
  const iconServer = spawn("python3", ["-m", "http.server", String(ICON_PORT), "-d", staging], { stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));
  try {
    const twa = new core.TwaManifest({
      packageId: PACKAGE_ID,
      host: new URL(SITE).host,
      name: "DUO",
      launcherName: "DUO",
      display: "standalone",
      themeColor: "#1a1420",
      themeColorDark: "#1a1420",
      navigationColor: "#1a1420",
      navigationColorDark: "#1a1420",
      navigationDividerColor: "#1a1420",
      navigationDividerColorDark: "#1a1420",
      backgroundColor: "#1a1420",
      enableNotifications: true,
      startUrl: "/home",
      iconUrl: `${local}/icons/icon-512.png`,
      maskableIconUrl: `${local}/icons/maskable-512.png`,
      splashScreenFadeOutDuration: 300,
      signingKey: { path: KEYSTORE, alias: ALIAS },
      appVersionCode: versionCode,
      appVersionName: `1.0.${versionCode - 1}`,
      shortcuts: [],
      generatorApp: "bubblewrap-cli",
      webManifestUrl: `${local}/manifest.webmanifest`,
      fallbackType: "customtabs",
      features: {},
      enableSiteSettingsShortcut: true,
      isChromeOSOnly: false,
      isMetaQuest: false,
      fullScopeUrl: `${SITE}/`,
      minSdkVersion: 24, // android-browser-helper needs Android 7.0+
      orientation: "default",
      fingerprints: [],
      additionalTrustedOrigins: [],
      retainedBundles: [],
    });
    const errors = twa.validate();
    if (errors) throw new Error(`Invalid TWA manifest: ${errors}`);
    fs.mkdirSync(PROJECT, { recursive: true });
    await new core.TwaGenerator().createTwaProject(PROJECT, twa, new core.ConsoleLog("generate"));
    // Point the saved manifest at the real site (the local URLs were only for generating).
    twa.webManifestUrl = new URL(`${SITE}/manifest.webmanifest`);
    twa.iconUrl = `${SITE}/icons/icon-512.png`;
    twa.maskableIconUrl = `${SITE}/icons/maskable-512.png`;
    await twa.saveToFile(manifestPath);
    fs.writeFileSync(path.join(PROJECT, "manifest-checksum.txt"), computeChecksum(fs.readFileSync(manifestPath)));
  } finally {
    iconServer.kill();
    fs.rmSync(staging, { recursive: true, force: true });
  }

  // 3. Build and sign the bundle (for Play) and an APK (to install on a phone directly).
  process.env.BUBBLEWRAP_KEYSTORE_PASSWORD = password;
  process.env.BUBBLEWRAP_KEY_PASSWORD = password;
  const prevCwd = process.cwd();
  process.chdir(PROJECT);
  try {
    const ok = await build(
      config,
      { skipPwaValidation: true, manifest: manifestPath, directory: PROJECT },
      new core.ConsoleLog("build"),
      new AutoPrompt(),
    );
    if (ok === false) throw new Error("The Android build failed (see the output above).");
  } finally {
    process.chdir(prevCwd);
  }

  // 4. Digital Asset Links: proves the app and duoforyou.cv belong together (no URL bar in the app).
  const info = await new core.KeyTool(jdkHelper).keyInfo({ path: KEYSTORE, alias: ALIAS, password, keypassword: password });
  const uploadFingerprint = info.fingerprints.get("SHA256");
  const linksPath = path.join(ROOT, "public", ".well-known", "assetlinks.json");
  const existing = fs.existsSync(linksPath) ? JSON.parse(fs.readFileSync(linksPath, "utf8")) : [];
  const fingerprints = new Set(existing.flatMap((e) => e.target?.sha256_cert_fingerprints ?? []));
  fingerprints.add(uploadFingerprint);
  fs.mkdirSync(path.dirname(linksPath), { recursive: true });
  fs.writeFileSync(
    linksPath,
    `${JSON.stringify(
      [
        {
          relation: ["delegate_permission/common.handle_all_urls"],
          target: { namespace: "android_app", package_name: PACKAGE_ID, sha256_cert_fingerprints: [...fingerprints] },
        },
      ],
      null,
      2,
    )}\n`,
  );
  console.log(
    `\nBuilt version ${versionCode}:\n  ${path.join(PROJECT, "app-release-bundle.aab")}\n  ${path.join(PROJECT, "app-release-signed.apk")}`,
  );
  console.log(`Upload key SHA-256: ${uploadFingerprint}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
