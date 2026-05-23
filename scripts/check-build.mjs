// build-check.mjs — 构建产物合规检查
// 在 CI 或发布前运行：node scripts/check-build.mjs
// 检查项：无内联脚本、无 CDN 引用、无 eval

import { readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const distDir = join(__dirname, '..', 'dist');

if (!existsSync(distDir)) {
  console.error('❌ dist/ 目录不存在。请先运行 npm run build');
  process.exit(1);
}

let errors = [];

// 递归扫描 dist 目录中的所有 HTML 文件
function scanDir(dir) {
  const { readdirSync, statSync } = await import('fs');
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      scanDir(fullPath);
    } else if (entry.endsWith('.html')) {
      checkHtml(fullPath);
    } else if (entry.endsWith('.js')) {
      checkJs(fullPath);
    }
  }
}

function checkHtml(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const relative = filePath.replace(distDir, '');

  // 检查内联脚本：<script> 标签之间包含代码
  const inlineScripts = content.match(/<script(?!\s+src=)[^>]*>[\s\S]*?<\/script>/gi);
  if (inlineScripts) {
    inlineScripts.forEach((script, i) => {
      const code = script.replace(/<script[^>]*>/, '').replace('<\/script>', '').trim();
      if (code) {
        errors.push(`❌ ${relative}: 发现内联脚本 #${i + 1}`);
      }
    });
  }

  // 检查 CDN 引用
  const cdnPatterns = [
    /https?:\/\/(?:cdn|unpkg|fonts\.googleapis|ajax\.google|cdnjs)\./gi,
  ];
  cdnPatterns.forEach(pattern => {
    const matches = content.match(pattern);
    if (matches) {
      errors.push(`❌ ${relative}: 发现 CDN 引用: ${matches.join(', ')}`);
    }
  });
}

function checkJs(filePath) {
  const content = readFileSync(filePath, 'utf-8');
  const relative = filePath.replace(distDir, '');

  // 检查 eval 和 new Function
  if (/\beval\s*\(/.test(content) && !/\/\/\s*eval/i.test(content)) {
    errors.push(`❌ ${relative}: 发现 eval() 调用`);
  }
  if (/new\s+Function\s*\(/.test(content)) {
    errors.push(`❌ ${relative}: 发现 new Function()`);
  }
}

// 执行扫描
scanDir(distDir);

if (errors.length === 0) {
  console.log('✅ 构建产物合规检查通过');
  console.log('   - 无内联脚本');
  console.log('   - 无 CDN 引用');
  console.log('   - 无 eval / new Function');
  process.exit(0);
} else {
  console.error(`\n❌ 发现 ${errors.length} 个合规问题:\n`);
  errors.forEach(e => console.error(`  ${e}`));
  console.error('\n请在提交前修复以上问题。');
  process.exit(1);
}
