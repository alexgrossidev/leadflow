const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_DIR = process.cwd();
const GEN_DIR = path.join(BASE_DIR, 'src', 'gen');
const INDEX_FILE = path.join(GEN_DIR, 'index.ts');

try {
  // 1. CLEANUP
  console.log('🧹 Cleaning old files...');
  if (fs.existsSync(GEN_DIR)) {
    fs.rmSync(GEN_DIR, { recursive: true, force: true });
  }
  fs.mkdirSync(GEN_DIR, { recursive: true });

  // 2. GENERATE (Run buf inside node to protect the paths)
  console.log('🚀 Running Buf generate...');
  execSync('npx buf generate', { stdio: 'inherit', cwd: BASE_DIR });

  // 3. BARREL EXPORTS
  console.log('📦 Creating barrel file...');
  const walk = (dir) => {
    let results = [];
    const list = fs.readdirSync(dir);
    list.forEach(file => {
      const fullPath = path.join(dir, file);
      if (fs.statSync(fullPath).isDirectory()) {
        results = results.concat(walk(fullPath));
      } else if (file.endsWith('.ts') && file !== 'index.ts') {
        const rel = path.relative(GEN_DIR, fullPath).replace(/\.ts$/, '').replace(/\\/g, '/');
        results.push(`export * from './${rel}.js';`);
      }
    });
    return results;
  };

  const exports = walk(GEN_DIR);
  fs.writeFileSync(INDEX_FILE, `// Auto-generated\n${exports.join('\n')}\n`);

  console.log('✅ Production Codegen Complete.');
} catch (err) {
  console.error('❌ Critical Failure during Codegen');
  process.exit(1);
}