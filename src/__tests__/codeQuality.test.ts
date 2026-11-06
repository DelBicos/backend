/**
 * Regras de qualidade que valem para todo o codigo de producao: evitam que
 * `any`, `console.*` e arquivos gigantes voltem sem ninguem perceber.
 */
import fs from "fs";
import path from "path";

const SRC = path.resolve(__dirname, "..");
const MAX_LINES = 600;

function productionFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "__tests__" || entry.name === "__mocks__"
        ? []
        : productionFiles(full);
    }
    const isCode = /\.(ts|js)$/.test(entry.name) && !entry.name.endsWith(".d.ts");
    return isCode && !/\.test\.(ts|js)$/.test(entry.name) ? [full] : [];
  });
}

const files = productionFiles(SRC);
const rel = (file: string) => path.relative(SRC, file);
const withoutComments = (text: string) =>
  text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("qualidade do codigo", () => {
  it("nao usa `any` explicito", () => {
    const offenders = files.filter((file) =>
      /(:\s*any\b|\bas any\b|<any>|\bany\[\]|Record<string,\s*any>)/.test(
        withoutComments(fs.readFileSync(file, "utf8")),
      ),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it("registra pelo logger, nao por console.*", () => {
    const offenders = files.filter((file) =>
      /\bconsole\.(log|info|warn|error|debug)\(/.test(
        withoutComments(fs.readFileSync(file, "utf8")),
      ),
    );
    expect(offenders.map(rel)).toEqual([]);
  });

  it(`mantem cada arquivo abaixo de ${MAX_LINES} linhas`, () => {
    const offenders = files
      // src/docs so tem comentarios OpenAPI (nao e logica).
      .filter((file) => !rel(file).startsWith(`docs${path.sep}`))
      .map((file) => ({ file: rel(file), lines: fs.readFileSync(file, "utf8").split("\n").length }))
      .filter(({ lines }) => lines > MAX_LINES);
    expect(offenders).toEqual([]);
  });
});
