#!/usr/bin/env node
/**
 * Backfill the `project` field for existing lessons in memory/lesson-index.jsonl.
 * All lessons in this repo are from the "superroo2" project.
 */
import fs from "fs"
import path from "path"

const jsonlPath = path.resolve("memory", "lesson-index.jsonl")
const content = fs.readFileSync(jsonlPath, "utf-8")
const lines = content.split("\n").filter(l => l.trim())

let updated = 0
let skipped = 0

const result = lines.map(line => {
    try {
        const obj = JSON.parse(line)
        if (!obj.project) {
            obj.project = "superroo2"
            updated++
        } else {
            skipped++
        }
        return JSON.stringify(obj)
    } catch {
        return line
    }
})

fs.writeFileSync(jsonlPath, result.join("\n") + "\n", "utf-8")
console.log(`✅ Backfill complete:`)
console.log(`   Total lessons: ${lines.length}`)
console.log(`   Updated (added project field): ${updated}`)
console.log(`   Already had project field: ${skipped}`)
