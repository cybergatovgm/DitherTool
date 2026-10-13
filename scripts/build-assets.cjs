const { execFileSync } = require('node:child_process');
const { copyFileSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');

const root = path.resolve(__dirname, '..');
const assets = path.join(root, 'public', 'assets');
const inter = path.join(root, 'node_modules', '@fontsource', 'inter');
const phosphor = path.join(root, 'node_modules', '@phosphor-icons', 'web');

mkdirSync(path.join(assets, 'fonts', 'files'), { recursive: true });
mkdirSync(path.join(assets, 'icons'), { recursive: true });
mkdirSync(path.join(assets, 'licenses'), { recursive: true });

execFileSync(process.execPath, [
    require.resolve('tailwindcss/lib/cli.js'),
    '--input', 'styles/tailwind.css',
    '--content', 'public/Bitmaptool.html',
    '--output', 'public/assets/tailwind.css',
    '--minify'
], { cwd: root, stdio: 'inherit' });

const fontStyles = [];
for (const weight of [400, 500, 600]) {
    fontStyles.push(readFileSync(path.join(inter, `latin-${weight}.css`), 'utf8'));
    for (const extension of ['woff2', 'woff']) {
        const file = `inter-latin-${weight}-normal.${extension}`;
        copyFileSync(path.join(inter, 'files', file), path.join(assets, 'fonts', 'files', file));
    }
}
writeFileSync(path.join(assets, 'fonts', 'inter.css'), fontStyles.join('\n'));

for (const file of ['style.css', 'Phosphor.woff2', 'Phosphor.woff', 'Phosphor.ttf', 'Phosphor.svg']) {
    copyFileSync(path.join(phosphor, 'src', 'regular', file), path.join(assets, 'icons', file));
}
for (const [name, directory, licenseFile] of [
    ['inter', inter, 'LICENSE'],
    ['phosphor', phosphor, 'LICENSE'],
    ['tailwind', path.join(root, 'node_modules', 'tailwindcss'), 'LICENSE'],
    ['gifenc', path.join(root, 'node_modules', 'gifenc'), 'LICENSE.md'],
    ['gifuct-js', path.join(root, 'node_modules', 'gifuct-js'), 'LICENSE']
]) {
    copyFileSync(path.join(directory, licenseFile), path.join(assets, 'licenses', `${name}.txt`));
}

build({
    entryPoints: [path.join(root, 'src', 'animated-media.mjs')],
    bundle: true,
    format: 'iife',
    globalName: 'AnimatedMedia',
    minify: true,
    outfile: path.join(assets, 'animated-media.js'),
    target: 'es2020'
}).catch(error => {
    console.error('Could not bundle animated-media assets:', error);
    process.exitCode = 1;
});
