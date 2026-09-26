// Uso: node scripts/check-pr2-frontend-contract.js C:/DelBicosV2
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Module = require("node:module");
const ts = require("typescript");

function loadTypeScript(file) {
  const source = fs.readFileSync(file, "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const loaded = new Module(file, module);
  loaded.filename = file;
  loaded.paths = Module._nodeModulePaths(path.dirname(file));
  loaded._compile(outputText, file);
  return loaded.exports;
}

if (!process.argv[2]) throw new Error("Informe o diretório do frontend na branch PR2.");
const frontend = loadTypeScript(path.resolve(process.argv[2], "src/lib/helpers/datetime.ts"));
const backend = loadTypeScript(path.resolve(__dirname, "../src/utils/date.util.ts"));
const date = "2099-01-05";
const cases = [
  ["09:00", "COLETANDO_HORARIO", { date }, date, "09:00"],
  ["sim", "CONFIRMACAO", { date, time: "09:00", timeZone: "Asia/Tokyo" }, date, "09:00"],
  ["sim", "CONFIRMACAO", { pendingAction: "RESCHEDULE", date, time: "09:00", newDate: "2099-01-06", newTime: "22:30" }, "2099-01-06", "22:30"],
  ["2099-01-06|00:30", "COLETANDO_HORARIO", { date }, "2099-01-06", "00:30"],
];
for (const [message, state, context, expectedDate, expectedTime] of cases) {
  const selected = frontend.resolveBotSelectedTimeIso(message, state, context);
  assert.equal(selected, backend.parseLocalAppointmentStart(expectedDate, expectedTime).toISOString());
}
console.log(`Contrato PR2: ${cases.length} cenários aprovados (TZ=${process.env.TZ || "sistema"}).`);
