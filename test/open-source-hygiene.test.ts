import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dir, "..");

function repositoryFiles(): string[] {
  const result = Bun.spawnSync(["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: repositoryRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ls-files failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString().split("\0").filter(Boolean);
}

function containsPersonalMachinePath(content: string): boolean {
  const unixPrefixes = ["/ho" + "me/", "/Us" + "ers/", "/me" + "dia/"];
  const windowsUserPath = /[A-Za-z]:(?:\/(?:Users|Documents and Settings)\/|\\+(?:Users|Documents and Settings)\\+)/;
  return unixPrefixes.some((prefix) => content.includes(prefix)) || windowsUserPath.test(content);
}

describe("open-source hygiene", () => {
  test("repository text files do not contain personal-machine absolute paths", () => {
    const failures: string[] = [];

    for (const file of repositoryFiles()) {
      const bytes = readFileSync(join(repositoryRoot, file));
      if (bytes.includes(0)) continue;
      const content = bytes.toString("utf8");
      if (containsPersonalMachinePath(content)) {
        failures.push(file);
      }
    }

    expect(failures).toEqual([]);
  });

  test("personal path detection covers slash and escaped Windows user paths", () => {
    const samples = [
      ["C:", "/", "Us" + "ers", "/", "example/project"].join(""),
      ["D:", "\\", "Documents and Settings", "\\", "example\\project"].join(""),
      ["E:", "\\\\", "Users", "\\\\", "example\\\\project"].join(""),
    ];

    for (const sample of samples) expect(containsPersonalMachinePath(sample)).toBe(true);
  });

  test("repository metadata and package boundaries are public-release ready", () => {
    const packageJson = JSON.parse(readFileSync(join(repositoryRoot, "package.json"), "utf8")) as {
      private?: boolean;
      description?: string;
      repository?: { type?: string; url?: string };
      homepage?: string;
      bugs?: { url?: string };
      files?: string[];
    };
    const gitignore = readFileSync(join(repositoryRoot, ".gitignore"), "utf8").split("\n");

    expect(gitignore).toContain(".omx/");
    expect(packageJson.private).toBe(true);
    expect(packageJson.description).toBeTruthy();
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/qwes98/gbrain-tutoring-system.git",
    });
    expect(packageJson.homepage).toBe("https://github.com/qwes98/gbrain-tutoring-system#readme");
    expect(packageJson.bugs).toEqual({ url: "https://github.com/qwes98/gbrain-tutoring-system/issues" });
    expect(packageJson.files).toEqual([
      "src",
      "schemas",
      "templates",
      "skills",
      "docs",
      "scripts/smoke.sh",
      "test/fixtures/concurrency-lecture.md",
      "CONTRIBUTING.md",
      "SECURITY.md",
    ]);
  });

  test("published schema identifiers use stable repository URLs", () => {
    const base = "https://raw.githubusercontent.com/qwes98/gbrain-tutoring-system/main/schemas";
    const ledger = JSON.parse(readFileSync(join(repositoryRoot, "schemas", "ledger-event.schema.json"), "utf8"));
    const appContract = JSON.parse(readFileSync(join(repositoryRoot, "schemas", "app-contract.v1.schema.json"), "utf8"));

    expect(ledger.$id).toBe(`${base}/ledger-event.schema.json`);
    expect(appContract.$id).toBe(`${base}/app-contract.v1.schema.json`);
  });

  test("security and optional Hermes documentation describe available paths accurately", () => {
    const security = readFileSync(join(repositoryRoot, "SECURITY.md"), "utf8");
    const readme = readFileSync(join(repositoryRoot, "README.md"), "utf8");

    expect(security).toContain("qwes8873@gmail.com");
    expect(security).not.toContain("currently supported line");
    expect(readme).toContain("skipped when `HERMES_AGENT_PYTHONPATH` is unset");
  });

  test("the extracted npm package completes its smoke workflow", () => {
    const packRoot = mkdtempSync(join(tmpdir(), "gbrain-pack-smoke-"));
    try {
      const pack = Bun.spawnSync(["npm", "pack", "--silent", "--pack-destination", packRoot], {
        cwd: repositoryRoot,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(pack.exitCode, pack.stderr.toString()).toBe(0);
      const archiveName = pack.stdout.toString().trim().split("\n").at(-1);
      expect(archiveName).toBeTruthy();

      const archive = join(packRoot, archiveName!);
      const listing = Bun.spawnSync(["tar", "-tzf", archive], { stdout: "pipe", stderr: "pipe" });
      expect(listing.exitCode, listing.stderr.toString()).toBe(0);
      expect(listing.stdout.toString()).not.toContain(".omx");

      const extract = Bun.spawnSync(["tar", "-xzf", archive, "-C", packRoot], {
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(extract.exitCode, extract.stderr.toString()).toBe(0);

      const smoke = Bun.spawnSync(["bun", "run", "smoke"], {
        cwd: join(packRoot, "package"),
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(smoke.exitCode, smoke.stderr.toString()).toBe(0);
    } finally {
      rmSync(packRoot, { recursive: true, force: true });
    }
  }, 30_000);
});
