import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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

describe("open-source hygiene", () => {
  test("repository text files do not contain personal-machine absolute paths", () => {
    const unixPrefixes = ["/ho" + "me/", "/Us" + "ers/", "/me" + "dia/"];
    const windowsUserPath = /[A-Za-z]:\\(?:Users|Documents and Settings)\\/;
    const failures: string[] = [];

    for (const file of repositoryFiles()) {
      const bytes = readFileSync(join(repositoryRoot, file));
      if (bytes.includes(0)) continue;
      const content = bytes.toString("utf8");
      if (unixPrefixes.some((prefix) => content.includes(prefix)) || windowsUserPath.test(content)) {
        failures.push(file);
      }
    }

    expect(failures).toEqual([]);
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
});
