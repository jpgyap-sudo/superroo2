const fs = require("fs")
const path = require("path")

const pkgPath = path.join(__dirname, "..", "src", "package.json")
const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"))

const [major, minor, patch] = pkg.version.split(".").map(Number)
pkg.version = `${major}.${minor}.${patch + 1}`

fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, "\t") + "\n")
console.log(`Version bumped to ${pkg.version}`)
