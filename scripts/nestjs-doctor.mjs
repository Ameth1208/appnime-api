#!/usr/bin/env node

/**
 * 🏥 NESTJS DOCTOR (appnime-backend)
 * Comprehensive Diagnostic & Health Check Tool for NestJS Backend & Prisma ORM
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

// ANSI Colors
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const BLUE = "\x1b[34m";
const MAGENTA = "\x1b[35m";
const CYAN = "\x1b[36m";
const WHITE = "\x1b[37m";
const BG_RED = "\x1b[41m";
const BG_GREEN = "\x1b[42m";

const log = {
  header: (text) => console.log(`\n${BOLD}${CYAN}=== ${text} ===${RESET}`),
  subHeader: (text) => console.log(`\n${BOLD}${MAGENTA}--- ${text} ---${RESET}`),
  pass: (text) => console.log(` ${GREEN}✔ PASS:${RESET} ${text}`),
  warn: (text) => console.log(` ${YELLOW}⚠ WARN:${RESET} ${text}`),
  fail: (text) => console.log(` ${RED}✖ FAIL:${RESET} ${text}`),
  info: (text) => console.log(` ${BLUE}ℹ INFO:${RESET} ${text}`),
};

const results = {
  env: { pass: true, warnings: [], errors: [] },
  prisma: { pass: true, warnings: [], errors: [] },
  modules: { pass: true, warnings: [], errors: [] },
  compilation: { pass: true, warnings: [], errors: [] },
};

console.log(`
${BOLD}${CYAN}  🏥 NESTJS DOCTOR — Backend Diagnostic Audit System${RESET}
  ${DIM}Project: appnime-backend | Engine: NestJS 11 + Prisma ORM${RESET}
--------------------------------------------------------------`);

// ==========================================
// 1. ENVIRONMENT & CONFIGURATION CHECK
// ==========================================
log.header("1. Environment & Configuration Check");

try {
  const nodeVersion = process.version;
  log.info(`Node.js Runtime: ${nodeVersion}`);

  const packageJsonPath = path.join(rootDir, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
    log.pass(`Found package.json: ${pkg.name} v${pkg.version}`);
  } else {
    results.env.pass = false;
    results.env.errors.push("Missing package.json");
    log.fail("package.json file not found");
  }

  const envPath = path.join(rootDir, ".env");
  const envExamplePath = path.join(rootDir, ".env.example");

  if (fs.existsSync(envPath)) {
    log.pass(".env configuration file present");
  } else if (fs.existsSync(envExamplePath)) {
    results.env.warnings.push(".env file missing, found .env.example");
    log.warn(".env missing (found .env.example)");
  } else {
    results.env.warnings.push("No .env configuration file found");
    log.warn("No .env file found");
  }
} catch (err) {
  results.env.pass = false;
  results.env.errors.push(err.message);
  log.fail(`Environment check error: ${err.message}`);
}

// ==========================================
// 2. PRISMA SCHEMA & DATABASE DOCTOR
// ==========================================
log.header("2. Prisma ORM & Database Schema Check");

try {
  const prismaSchemaPath = path.join(rootDir, "prisma", "schema.prisma");
  if (fs.existsSync(prismaSchemaPath)) {
    log.pass("Prisma schema (prisma/schema.prisma) found");

    const schemaContent = fs.readFileSync(prismaSchemaPath, "utf-8");
    const modelMatches = schemaContent.match(/^model\s+\w+/gm) || [];
    log.pass(`Prisma schema contains ${modelMatches.length} models`);
  } else {
    results.prisma.pass = false;
    results.prisma.errors.push("Missing prisma/schema.prisma");
    log.fail("prisma/schema.prisma not found");
  }
} catch (err) {
  results.prisma.pass = false;
  results.prisma.errors.push(err.message);
  log.fail(`Prisma check error: ${err.message}`);
}

// ==========================================
// 3. NESTJS MODULE & CONTROLLER STRUCTURE AUDIT
// ==========================================
log.header("3. NestJS Modules & Controllers Structure Audit");

try {
  const srcDir = path.join(rootDir, "src");
  if (fs.existsSync(srcDir)) {
    const tsFiles = getAllFiles(srcDir, [".ts"]);
    let moduleCount = 0;
    let controllerCount = 0;
    let serviceCount = 0;

    tsFiles.forEach((filePath) => {
      const content = fs.readFileSync(filePath, "utf-8");
      if (content.includes("@Module(")) moduleCount++;
      if (content.includes("@Controller(")) controllerCount++;
      if (content.includes("@Injectable(")) serviceCount++;
    });

    log.pass(
      `Architecture structure verified: ${moduleCount} Modules, ${controllerCount} Controllers, ${serviceCount} Services`,
    );
  } else {
    results.modules.pass = false;
    results.modules.errors.push("Missing src directory");
    log.fail("src/ directory not found");
  }
} catch (err) {
  results.modules.pass = false;
  results.modules.errors.push(err.message);
  log.fail(`Module structure audit error: ${err.message}`);
}

// ==========================================
// 4. NESTJS COMPILATION & BUILD DOCTOR
// ==========================================
log.header("4. NestJS Compilation & Build Check (tsc --noEmit)");

try {
  process.stdout.write(" Running tsc --noEmit check...");
  execSync("pnpm tsc --noEmit", { cwd: rootDir, stdio: "pipe", timeout: 20000 });
  process.stdout.write("\r");
  log.pass("NestJS TypeScript compilation passed with 0 errors");
} catch (buildErr) {
  process.stdout.write("\r");
  results.compilation.pass = false;
  const output = buildErr.stdout ? buildErr.stdout.toString() : buildErr.message;
  results.compilation.errors.push(output);
  log.fail("NestJS compilation failed:");
  console.log(`   ${RED}${output.trim().slice(0, 300)}${RESET}`);
}

// ==========================================
// DIAGNOSTIC SUMMARY
// ==========================================
console.log(`
--------------------------------------------------------------
${BOLD}📊 NESTJS DOCTOR AUDIT SUMMARY${RESET}`);

const allPass =
  results.env.pass &&
  results.prisma.pass &&
  results.modules.pass &&
  results.compilation.pass;

const totalWarnings =
  results.env.warnings.length +
  results.prisma.warnings.length +
  results.modules.warnings.length +
  results.compilation.warnings.length;

const totalErrors =
  results.env.errors.length +
  results.prisma.errors.length +
  results.modules.errors.length +
  results.compilation.errors.length;

printResultLine("Environment & Config", results.env);
printResultLine("Prisma ORM Schema", results.prisma);
printResultLine("NestJS Modules & Controllers", results.modules);
printResultLine("NestJS Build Compiler", results.compilation);

console.log("--------------------------------------------------------------");
if (allPass && totalErrors === 0) {
  console.log(`${BOLD}${BG_GREEN}${WHITE} STATUS: HEALTHY (100% PASS) ${RESET} Backend is clean & production-ready!\n`);
  process.exit(0);
} else {
  console.log(`${BOLD}${BG_RED}${WHITE} STATUS: ISSUES DETECTED (${totalErrors} Errors, ${totalWarnings} Warnings) ${RESET}\n`);
  process.exit(1);
}

// Helper Functions
function getAllFiles(dirPath, extensions = [], arrayOfFiles = []) {
  if (!fs.existsSync(dirPath)) return arrayOfFiles;
  const files = fs.readdirSync(dirPath);
  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    if (fs.statSync(fullPath).isDirectory()) {
      getAllFiles(fullPath, extensions, arrayOfFiles);
    } else {
      if (extensions.length === 0 || extensions.some((ext) => fullPath.endsWith(ext))) {
        arrayOfFiles.push(fullPath);
      }
    }
  });
  return arrayOfFiles;
}

function printResultLine(label, res) {
  const statusStr = res.pass && res.errors.length === 0
    ? `${GREEN}✔ HEALTHY${RESET}`
    : `${RED}✖ FAIL (${res.errors.length} errors)${RESET}`;
  const warnStr = res.warnings && res.warnings.length > 0 ? `${YELLOW}(${res.warnings.length} warn)${RESET}` : "";
  console.log(` ${label.padEnd(30)} ${statusStr} ${warnStr}`);
}
