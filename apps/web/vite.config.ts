import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import { copyFileSync, mkdirSync, existsSync } from "fs"
import { resolve, dirname } from "path"
import { createRequire } from "module"

// The @tanstack/browser-db-sqlite-persistence dist ships a pre-bundled Web
// Worker at a hardcoded path (/assets/opfs-worker-CCciqEMo.js). That worker
// loads wa-sqlite.wasm relative to itself. Both files must be available from
// the public directory so Vite's dev server (and production builds) can serve
// them at the expected URLs.
function copyPersistenceAssets() {
  const require = createRequire(import.meta.url)
  const outDir = resolve(import.meta.dirname!, "public/assets")

  try {
    const persistPkg = dirname(
      require.resolve("@tanstack/browser-db-sqlite-persistence/package.json")
    )
    const workerSrc = resolve(persistPkg, "dist/assets/opfs-worker-CCciqEMo.js")
    const waSqlitePkg = dirname(
      require.resolve("@journeyapps/wa-sqlite/package.json")
    )
    const wasmSrc = resolve(waSqlitePkg, "dist/wa-sqlite.wasm")

    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
    if (existsSync(workerSrc)) copyFileSync(workerSrc, resolve(outDir, "opfs-worker-CCciqEMo.js"))
    if (existsSync(wasmSrc)) copyFileSync(wasmSrc, resolve(outDir, "wa-sqlite.wasm"))
  } catch {
    console.warn("[vite] Could not copy persistence assets — OPFS persistence may not work")
  }
}

copyPersistenceAssets()

export default defineConfig({
  plugins: [tanstackStart(), react()],
  worker: {
    format: "es",
  },
  optimizeDeps: {
    exclude: [
      "@journeyapps/wa-sqlite",
      "@tanstack/browser-db-sqlite-persistence",
    ],
  },
})
