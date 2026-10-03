# Derleme

Node.js 24 ve pnpm 11.19.0 ile pnpm install --frozen-lockfile, pnpm test ve pnpm mac:arm64 / pnpm mac:x64 / pnpm exe komutlarını kullanın. Hedef tarayıcılar pakete eklenir.

Önbellek mevcutsa node scripts/build.cjs mac arm64 --offline (veya mac x64 / win x64) indirmeden derler. Çıktılar dist/<sürüm>/ klasörüne yazılır. node_modules ve chromium yerel derleme bağımlılıklarıdır; GitHub’a yüklenmez.
