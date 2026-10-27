// node scripts/collect-licenses.js <out-dir>
//
// Copies the licence files of every production dependency into <out-dir>,
// one folder per package, plus an index (name, version, licence). Run in the
// image build after `npm ci`, so it describes exactly what was installed.
//
// Production, not only what the server's node_modules keeps: the bundler
// copies code from these packages into the JavaScript every page loads, so
// all of them are distributed (THIRD_PARTY_NOTICES.md).
const fs = require("node:fs");
const path = require("node:path");

const LICENCE_FILE = /^(licen[cs]e|copying|notice|authors)(\.|-|$)/i;

function productionPackages(root) {
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
  return Object.entries(lock.packages)
    .filter(([where, entry]) => where.startsWith("node_modules/") && !entry.dev)
    .map(([where]) => path.join(root, where))
    .filter((dir) => fs.existsSync(path.join(dir, "package.json")));
}

function licenceOf(manifest) {
  const { license, licenses } = manifest;
  if (typeof license === "string") return license;
  if (license?.type) return license.type;
  if (Array.isArray(licenses)) return licenses.map((l) => l.type ?? l).join(" OR ");
  return "UNKNOWN";
}

function collect(root, out) {
  const index = [];
  for (const dir of productionPackages(root)) {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    const name = `${manifest.name}@${manifest.version}`;
    const target = path.join(out, name.replace("/", "__"));
    const files = fs.readdirSync(dir).filter((f) => LICENCE_FILE.test(f) && fs.statSync(path.join(dir, f)).isFile());
    fs.mkdirSync(target, { recursive: true });
    for (const file of files) fs.copyFileSync(path.join(dir, file), path.join(target, file));
    index.push([manifest.name, manifest.version, licenceOf(manifest)].join("\t"));
  }
  index.sort();
  fs.writeFileSync(path.join(out, "INDEX.tsv"), `name\tversion\tlicence\n${index.join("\n")}\n`);
  return index.length;
}

module.exports = { productionPackages, licenceOf };

if (require.main === module) {
  const out = process.argv[2];
  if (!out) {
    console.error("usage: node scripts/collect-licenses.js <out-dir>");
    process.exit(2);
  }
  fs.mkdirSync(out, { recursive: true });
  console.log(`licences of ${collect(process.cwd(), out)} production packages in ${out}`);
}
