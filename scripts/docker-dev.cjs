const { spawnSync } = require("node:child_process");
const path = require("node:path");

// Capture before startup so even fast startup failures remain visible.
const since = new Date().toISOString();
const options = { cwd: path.resolve(__dirname, ".."), stdio: "inherit" };

function run(args) {
  const result = spawnSync("docker", ["compose", ...args], options);
  if (result.error) {
    console.error(`Falha ao executar Docker: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(["up", "-d"]);
console.log("Acompanhando logs desta execução. Histórico completo: npm run docker:logs");
run(["logs", "--since", since, "--timestamps", "--follow", "delbicos-server"]);
